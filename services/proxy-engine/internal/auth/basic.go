package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

var (
	ErrUnauthorized       = errors.New("proxy authentication failed")
	ErrCredentialNotFound = errors.New("proxy credential not found")
)

type Protocol string

const (
	ProtocolHTTP   Protocol = "HTTP"
	ProtocolHTTPS  Protocol = "HTTPS"
	ProtocolSOCKS5 Protocol = "SOCKS5"
)

type Credential struct {
	ID                       string     `json:"id"`
	OrganizationID           string     `json:"organizationId"`
	UserID                   string     `json:"userId"`
	Username                 string     `json:"username"`
	SecretDigest             string     `json:"secretDigest"`
	Status                   string     `json:"status"`
	UserStatus               string     `json:"userStatus"`
	AllowedProtocols         []string   `json:"allowedProtocols"`
	ExpiresAt                *time.Time `json:"expiresAt"`
	SubscriptionActive       bool       `json:"subscriptionActive"`
	BandwidthLimitBytes      *int64     `json:"bandwidthLimitBytes"`
	MaxConcurrentConnections int        `json:"maxConcurrentConnections"`
	ConnectionsPerMinute     int        `json:"connectionsPerMinute"`
	CurrentPeriodStart       time.Time  `json:"currentPeriodStart"`
	CurrentPeriodEnd         time.Time  `json:"currentPeriodEnd"`
}

type Principal struct {
	CredentialID             string
	OrganizationID           string
	UserID                   string
	Username                 string
	BandwidthLimitBytes      *int64
	MaxConcurrentConnections int
	ConnectionsPerMinute     int
	CurrentPeriodStart       time.Time
	CurrentPeriodEnd         time.Time
}

type CredentialRepository interface {
	FindByUsername(
		ctx context.Context,
		username string,
	) (Credential, error)
}

type CredentialCache interface {
	Get(
		ctx context.Context,
		username string,
	) (Credential, bool, error)

	Set(
		ctx context.Context,
		username string,
		credential Credential,
		ttl time.Duration,
	) error

	Delete(
		ctx context.Context,
		username string,
	) error

	IsRevoked(
		ctx context.Context,
		username string,
	) (bool, error)
}

type Authenticator struct {
	logger     *slog.Logger
	repository CredentialRepository
	cache      CredentialCache
	pepper     []byte
	cacheTTL   time.Duration
}

func NewAuthenticator(
	logger *slog.Logger,
	repository CredentialRepository,
	cache CredentialCache,
	pepper []byte,
	cacheTTL time.Duration,
) *Authenticator {
	return &Authenticator{
		logger:     logger,
		repository: repository,
		cache:      cache,
		pepper:     pepper,
		cacheTTL:   cacheTTL,
	}
}

func (a *Authenticator) Authenticate(
	ctx context.Context,
	request *http.Request,
	protocol Protocol,
) (Principal, error) {
	username, secret, valid := readProxyBasicAuth(request)
	if !valid {
		return Principal{}, ErrUnauthorized
	}

	if a.cache != nil {
		revoked, err := a.cache.IsRevoked(ctx, username)

		if err != nil {
			a.logger.Warn(
				"credential revocation lookup failed",
				slog.String("username", username),
				slog.String("error", err.Error()),
			)
		} else if revoked {
			return Principal{}, ErrUnauthorized
		}
	}

	credential, err := a.loadCredential(ctx, username)
	if err != nil {
		return Principal{}, ErrUnauthorized
	}

	if credential.Status != "ACTIVE" ||
		credential.UserStatus != "ACTIVE" ||
		!credential.SubscriptionActive {
		a.deleteCachedCredential(ctx, username)

		return Principal{}, ErrUnauthorized
	}

	if credential.ExpiresAt != nil &&
		time.Now().After(*credential.ExpiresAt) {
		a.deleteCachedCredential(ctx, username)

		return Principal{}, ErrUnauthorized
	}

	if !protocolAllowed(
		credential.AllowedProtocols,
		protocol,
	) {
		return Principal{}, ErrUnauthorized
	}

	expectedDigest, err := hex.DecodeString(
		credential.SecretDigest,
	)
	if err != nil {
		a.logger.Error(
			"stored credential digest is invalid",
			slog.String(
				"credential_id",
				credential.ID,
			),
		)

		return Principal{}, ErrUnauthorized
	}

	mac := hmac.New(sha256.New, a.pepper)

	_, _ = mac.Write([]byte(secret))

	if !hmac.Equal(mac.Sum(nil), expectedDigest) {
		return Principal{}, ErrUnauthorized
	}

	return Principal{
		CredentialID:             credential.ID,
		OrganizationID:           credential.OrganizationID,
		UserID:                   credential.UserID,
		Username:                 credential.Username,
		BandwidthLimitBytes:      credential.BandwidthLimitBytes,
		MaxConcurrentConnections: credential.MaxConcurrentConnections,
		ConnectionsPerMinute:     credential.ConnectionsPerMinute,
		CurrentPeriodStart:       credential.CurrentPeriodStart,
		CurrentPeriodEnd:         credential.CurrentPeriodEnd,
	}, nil
}

func (a *Authenticator) loadCredential(
	ctx context.Context,
	username string,
) (Credential, error) {
	if a.cache != nil {
		cachedCredential, found, err :=
			a.cache.Get(ctx, username)

		if err != nil {
			a.logger.Warn(
				"credential cache read failed",
				slog.String("error", err.Error()),
			)
		} else if found {
			return cachedCredential, nil
		}
	}

	credential, err :=
		a.repository.FindByUsername(ctx, username)

	if err != nil {
		return Credential{}, err
	}

	if a.cache != nil {
		if err := a.cache.Set(
			ctx,
			username,
			credential,
			a.cacheTTL,
		); err != nil {
			a.logger.Warn(
				"credential cache write failed",
				slog.String("error", err.Error()),
			)
		}
	}

	return credential, nil
}

func (a *Authenticator) deleteCachedCredential(
	ctx context.Context,
	username string,
) {
	if a.cache == nil {
		return
	}

	if err := a.cache.Delete(ctx, username); err != nil {
		a.logger.Warn(
			"credential cache deletion failed",
			slog.String("username", username),
			slog.String("error", err.Error()),
		)
	}
}

func readProxyBasicAuth(
	request *http.Request,
) (string, string, bool) {
	header := strings.TrimSpace(
		request.Header.Get("Proxy-Authorization"),
	)

	const prefix = "Basic "

	if !strings.HasPrefix(header, prefix) {
		return "", "", false
	}

	encodedCredentials := strings.TrimSpace(
		strings.TrimPrefix(header, prefix),
	)

	decodedCredentials, err :=
		base64.StdEncoding.DecodeString(
			encodedCredentials,
		)

	if err != nil {
		return "", "", false
	}

	username, secret, found := strings.Cut(
		string(decodedCredentials),
		":",
	)

	username = strings.TrimSpace(username)

	if !found || username == "" || secret == "" {
		return "", "", false
	}

	return username, secret, true
}

func protocolAllowed(
	allowedProtocols []string,
	requested Protocol,
) bool {
	for _, protocol := range allowedProtocols {
		if protocol == string(requested) {
			return true
		}
	}

	return false
}
