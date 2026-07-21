package redisclient

import (
	"crypto/tls"
	"errors"
	"strings"

	"github.com/redis/go-redis/v9"
)

type Config struct {
	URL      string
	Address  string
	Password string
	Database int
}

func New(cfg Config) (*redis.Client, error) {
	options, err := Options(cfg)
	if err != nil {
		return nil, err
	}

	return redis.NewClient(options), nil
}

func Options(cfg Config) (*redis.Options, error) {
	redisURL := strings.TrimSpace(cfg.URL)
	if redisURL != "" {
		options, err := redis.ParseURL(redisURL)
		if err != nil {
			return nil, errors.New(
				"REDIS_URL is invalid",
			)
		}

		if options.TLSConfig != nil &&
			options.TLSConfig.MinVersion <
				tls.VersionTLS12 {
			options.TLSConfig.MinVersion =
				tls.VersionTLS12
		}

		return options, nil
	}

	address := strings.TrimSpace(cfg.Address)
	if address == "" {
		return nil, errors.New(
			"REDIS_URL or REDIS_ADDR is required",
		)
	}

	return &redis.Options{
		Addr:     address,
		Password: cfg.Password,
		DB:       cfg.Database,
	}, nil
}
