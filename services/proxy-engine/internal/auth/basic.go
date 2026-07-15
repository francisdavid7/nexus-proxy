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
	ID                 string     `json:"id"`
	OrganizationID     string     `json:"organizationId"`
	UserID             string     `json:"userId"`
	Username           string     `json:"username"`
	SecretDigest       string     `json:"secretDigest"`
	Status             string     `json:"status"`
	UserStatus         string     `json:"userStatus"`
	AllowedProtocols   []string   `json:"allowedProtocols"`
	ExpiresAt          *time.Time `json:"expiresAt"`
	SubscriptionActive bool       `json:"subscriptionActive"`
}

type Principal struct {
	CredentialID   string
	OrganizationID string
	UserID         string
	Username       string
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

	credential, err := a.loadCredential(ctx, username)
	if err != nil {
		return Principal{}, ErrUnauthorized
	}

	if credential.Status != "ACTIVE" {
		return Principal{}, ErrUnauthorized
	}

	if credential.UserStatus != "ACTIVE" {
		return Principal{}, ErrUnauthorized
	}

	if !credential.SubscriptionActive {
		return Principal{}, ErrUnauthorized
	}

	if credential.ExpiresAt != nil &&
		time.Now().After(*credential.ExpiresAt) {
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

	calculatedDigest := mac.Sum(nil)

	if !hmac.Equal(calculatedDigest, expectedDigest) {
		return Principal{}, ErrUnauthorized
	}

	return Principal{
		CredentialID:   credential.ID,
		OrganizationID: credential.OrganizationID,
		UserID:         credential.UserID,
		Username:       credential.Username,
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

	encodedCredentials :=
		strings.TrimSpace(
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

	if !found ||
		strings.TrimSpace(username) == "" ||
		secret == "" {
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
