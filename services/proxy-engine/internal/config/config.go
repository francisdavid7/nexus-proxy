package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Environment      string
	LogLevel         string
	NodeID           string
	Host             string
	Port             string
	PlainEnabled     bool
	TLSHost          string
	TLSPort          string
	TLSEnabled       bool
	TLSCertFile      string
	TLSKeyFile       string
	DatabaseURL      string
	RedisAddress     string
	RedisPassword    string
	RedisDatabase    int
	CredentialPepper string
	AuthCacheTTL     time.Duration
	ReadTimeout      time.Duration
	WriteTimeout     time.Duration
	IdleTimeout      time.Duration
	ConnectTimeout   time.Duration
	AllowPrivateIPs  bool
}

func Load() (Config, error) {
	host := getEnv("PROXY_HOST", "0.0.0.0")

	cfg := Config{
		Environment:      getEnv("APP_ENV", "development"),
		LogLevel:         getEnv("LOG_LEVEL", "info"),
		NodeID:           getEnv("NODE_ID", "local-node-01"),
		Host:             host,
		Port:             getEnv("PROXY_PORT", "8080"),
		PlainEnabled:     getBool("PROXY_PLAIN_ENABLED", true),
		TLSHost:          getEnv("PROXY_TLS_HOST", host),
		TLSPort:          getEnv("PROXY_TLS_PORT", "8443"),
		TLSEnabled:       getBool("PROXY_TLS_ENABLED", false),
		TLSCertFile:      getEnv("PROXY_TLS_CERT_FILE", "/run/nexus-tls/tls.crt"),
		TLSKeyFile:       getEnv("PROXY_TLS_KEY_FILE", "/run/nexus-tls/tls.key"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		RedisAddress:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:    os.Getenv("REDIS_PASSWORD"),
		RedisDatabase:    getInt("REDIS_DB", 0),
		CredentialPepper: os.Getenv("CREDENTIAL_PEPPER"),
		AuthCacheTTL:     getDuration("AUTH_CACHE_TTL", 30*time.Second),
		ReadTimeout:      getDuration("PROXY_READ_TIMEOUT", 30*time.Second),
		WriteTimeout:     getDuration("PROXY_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:      getDuration("PROXY_IDLE_TIMEOUT", 60*time.Second),
		ConnectTimeout:   getDuration("PROXY_CONNECT_TIMEOUT", 10*time.Second),
		AllowPrivateIPs:  getBool("PROXY_ALLOW_PRIVATE_IPS", false),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}

	if len(cfg.CredentialPepper) < 32 {
		return Config{}, fmt.Errorf(
			"CREDENTIAL_PEPPER must contain at least 32 characters",
		)
	}

	if cfg.AuthCacheTTL <= 0 {
		return Config{}, fmt.Errorf(
			"AUTH_CACHE_TTL must be greater than zero",
		)
	}

	if !cfg.PlainEnabled && !cfg.TLSEnabled {
		return Config{}, fmt.Errorf(
			"at least one proxy listener must be enabled",
		)
	}

	if cfg.PlainEnabled && cfg.Port == "" {
		return Config{}, fmt.Errorf(
			"PROXY_PORT is required when the plaintext listener is enabled",
		)
	}

	if cfg.TLSEnabled {
		if cfg.TLSPort == "" {
			return Config{}, fmt.Errorf(
				"PROXY_TLS_PORT is required when TLS is enabled",
			)
		}

		if cfg.TLSCertFile == "" {
			return Config{}, fmt.Errorf(
				"PROXY_TLS_CERT_FILE is required when TLS is enabled",
			)
		}

		if cfg.TLSKeyFile == "" {
			return Config{}, fmt.Errorf(
				"PROXY_TLS_KEY_FILE is required when TLS is enabled",
			)
		}

		if cfg.PlainEnabled && cfg.Address() == cfg.TLSAddress() {
			return Config{}, fmt.Errorf(
				"plaintext and TLS listeners cannot use the same address",
			)
		}
	}

	return cfg, nil
}

func (c Config) Address() string {
	return net.JoinHostPort(c.Host, c.Port)
}

func (c Config) TLSAddress() string {
	return net.JoinHostPort(c.TLSHost, c.TLSPort)
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	return value
}

func getDuration(
	key string,
	fallback time.Duration,
) time.Duration {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}

	return duration
}

func getBool(key string, fallback bool) bool {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func getInt(key string, fallback int) int {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}

	return parsed
}
