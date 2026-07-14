package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Host            string
	Port            string
	Username        string
	Password        string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ConnectTimeout  time.Duration
	AllowPrivateIPs bool
}

func Load() (Config, error) {
	cfg := Config{
		Host:            getEnv("PROXY_HOST", "0.0.0.0"),
		Port:            getEnv("PROXY_PORT", "8080"),
		Username:        os.Getenv("PROXY_USERNAME"),
		Password:        os.Getenv("PROXY_PASSWORD"),
		ReadTimeout:     getDuration("PROXY_READ_TIMEOUT", 30*time.Second),
		WriteTimeout:    getDuration("PROXY_WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:     getDuration("PROXY_IDLE_TIMEOUT", 60*time.Second),
		ConnectTimeout:  getDuration("PROXY_CONNECT_TIMEOUT", 10*time.Second),
		AllowPrivateIPs: getBool("PROXY_ALLOW_PRIVATE_IPS", false),
	}

	if cfg.Username == "" {
		return Config{}, fmt.Errorf("PROXY_USERNAME is required")
	}

	if cfg.Password == "" {
		return Config{}, fmt.Errorf("PROXY_PASSWORD is required")
	}

	if len(cfg.Password) < 12 {
		return Config{}, fmt.Errorf(
			"PROXY_PASSWORD must contain at least 12 characters",
		)
	}

	return cfg, nil
}

func (c Config) Address() string {
	return c.Host + ":" + c.Port
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	return value
}

func getDuration(key string, fallback time.Duration) time.Duration {
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
