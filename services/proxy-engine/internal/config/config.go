package config

import (
	"fmt"
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
	cfg := Config{
		Environment:      getEnv("APP_ENV", "development"),
		LogLevel:         getEnv("LOG_LEVEL", "info"),
		NodeID:           getEnv("NODE_ID", "local-node-01"),
		Host:             getEnv("PROXY_HOST", "0.0.0.0"),
		Port:             getEnv("PROXY_PORT", "8080"),
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

	return cfg, nil
}

func (c Config) Address() string {
	return c.Host + ":" + c.Port
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
