package privacy

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"
)

type Resolver interface {
	LookupNetIP(
		ctx context.Context,
		network string,
		host string,
	) ([]netip.Addr, error)
}

type Config struct {
	Resolver     Resolver
	AllowedPorts map[uint16]struct{}
	DNSTimeout   time.Duration
	DialTimeout  time.Duration
	KeepAlive    time.Duration
}

func DefaultConfig() Config {
	return Config{
		Resolver: net.DefaultResolver,

		AllowedPorts: map[uint16]struct{}{
			80:  {},
			443: {},
		},

		DNSTimeout:  5 * time.Second,
		DialTimeout: 10 * time.Second,
		KeepAlive:   30 * time.Second,
	}
}

func ConfigFromEnv() (Config, error) {
	config := DefaultConfig()

	var err error

	config.AllowedPorts, err =
		parseAllowedPorts(
			os.Getenv(
				"PROXY_ALLOWED_DESTINATION_PORTS",
			),
		)

	if err != nil {
		return Config{}, err
	}

	config.DNSTimeout, err =
		parseDurationEnvironment(
			"PROXY_DNS_TIMEOUT",
			config.DNSTimeout,
		)

	if err != nil {
		return Config{}, err
	}

	config.DialTimeout, err =
		parseDurationEnvironment(
			"PROXY_DIAL_TIMEOUT",
			config.DialTimeout,
		)

	if err != nil {
		return Config{}, err
	}

	config.KeepAlive, err =
		parseDurationEnvironment(
			"PROXY_KEEP_ALIVE",
			config.KeepAlive,
		)

	if err != nil {
		return Config{}, err
	}

	return config, nil
}

func parseAllowedPorts(
	raw string,
) (map[uint16]struct{}, error) {
	raw = strings.TrimSpace(raw)

	if raw == "" {
		return map[uint16]struct{}{
			80:  {},
			443: {},
		}, nil
	}

	result := make(
		map[uint16]struct{},
	)

	for _, value := range strings.Split(
		raw,
		",",
	) {
		value = strings.TrimSpace(value)

		parsed, err := strconv.ParseUint(
			value,
			10,
			16,
		)

		if err != nil || parsed == 0 {
			return nil, fmt.Errorf(
				"invalid proxy destination port %q",
				value,
			)
		}

		result[uint16(parsed)] =
			struct{}{}
	}

	if len(result) == 0 {
		return nil, fmt.Errorf(
			"at least one proxy destination port is required",
		)
	}

	return result, nil
}

func parseDurationEnvironment(
	key string,
	fallback time.Duration,
) (time.Duration, error) {
	raw := strings.TrimSpace(
		os.Getenv(key),
	)

	if raw == "" {
		return fallback, nil
	}

	value, err :=
		time.ParseDuration(raw)

	if err != nil || value <= 0 {
		return 0, fmt.Errorf(
			"%s must be a positive duration",
			key,
		)
	}

	return value, nil
}
