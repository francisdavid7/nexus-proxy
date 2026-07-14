package config

import (
	"fmt"
	"os"
)

type Config struct {
	Host string
	Port string
}

func Load() Config {
	host := getEnv("PROXY_HOST", "0.0.0.0")
	port := getEnv("PROXY_PORT", "8080")

	return Config{
		Host: host,
		Port: port,
	}
}

func (c Config) Address() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	return value
}
