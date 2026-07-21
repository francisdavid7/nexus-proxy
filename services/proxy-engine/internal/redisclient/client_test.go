package redisclient

import (
	"crypto/tls"
	"testing"
)

func TestOptionsParsesTLSRedisURL(
	t *testing.T,
) {
	t.Parallel()

	options, err := Options(
		Config{
			URL: "rediss://default:secret@" +
				"example.upstash.io:6379/0",
		},
	)
	if err != nil {
		t.Fatalf(
			"Options returned an error: %v",
			err,
		)
	}

	if options.Addr !=
		"example.upstash.io:6379" {
		t.Fatalf(
			"unexpected Redis address: %q",
			options.Addr,
		)
	}

	if options.Username != "default" {
		t.Fatalf(
			"unexpected Redis username: %q",
			options.Username,
		)
	}

	if options.Password != "secret" {
		t.Fatal(
			"Redis password was not parsed",
		)
	}

	if options.TLSConfig == nil {
		t.Fatal(
			"TLS configuration was not enabled",
		)
	}

	if options.TLSConfig.MinVersion !=
		tls.VersionTLS12 {
		t.Fatalf(
			"unexpected minimum TLS version: %d",
			options.TLSConfig.MinVersion,
		)
	}
}

func TestOptionsSupportsLegacyRedisSettings(
	t *testing.T,
) {
	t.Parallel()

	options, err := Options(
		Config{
			Address:  "redis:6379",
			Password: "local-secret",
			Database: 2,
		},
	)
	if err != nil {
		t.Fatalf(
			"Options returned an error: %v",
			err,
		)
	}

	if options.Addr != "redis:6379" {
		t.Fatalf(
			"unexpected Redis address: %q",
			options.Addr,
		)
	}

	if options.Password != "local-secret" {
		t.Fatal(
			"legacy Redis password was not retained",
		)
	}

	if options.DB != 2 {
		t.Fatalf(
			"unexpected Redis database: %d",
			options.DB,
		)
	}

	if options.TLSConfig != nil {
		t.Fatal(
			"legacy local Redis unexpectedly enabled TLS",
		)
	}
}

func TestOptionsRejectsInvalidRedisURL(
	t *testing.T,
) {
	t.Parallel()

	_, err := Options(
		Config{
			URL: "not-a-redis-url",
		},
	)
	if err == nil {
		t.Fatal(
			"expected invalid REDIS_URL to be rejected",
		)
	}
}
