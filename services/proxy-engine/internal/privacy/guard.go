package privacy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

var (
	ErrBlockedDestination = errors.New(
		"destination is not publicly routable",
	)

	ErrDisallowedPort = errors.New(
		"destination port is not allowed",
	)
)

var blockedHostnames = map[string]struct{}{
	"localhost": {},

	"metadata.google.internal": {},

	"metadata.amazonaws.com": {},

	"instance-data.ec2.internal": {},
}

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix(
		"0.0.0.0/8",
	),

	netip.MustParsePrefix(
		"100.64.0.0/10",
	),

	netip.MustParsePrefix(
		"192.0.0.0/24",
	),

	netip.MustParsePrefix(
		"192.0.2.0/24",
	),

	netip.MustParsePrefix(
		"192.88.99.0/24",
	),

	netip.MustParsePrefix(
		"198.18.0.0/15",
	),

	netip.MustParsePrefix(
		"198.51.100.0/24",
	),

	netip.MustParsePrefix(
		"203.0.113.0/24",
	),

	netip.MustParsePrefix(
		"224.0.0.0/4",
	),

	netip.MustParsePrefix(
		"240.0.0.0/4",
	),

	netip.MustParsePrefix(
		"2001:db8::/32",
	),
}

type Guard struct {
	resolver Resolver

	allowedPorts map[uint16]struct{}

	dnsTimeout time.Duration

	dialer net.Dialer
}

func NewGuard(
	config Config,
) *Guard {
	defaults := DefaultConfig()

	if config.Resolver == nil {
		config.Resolver =
			defaults.Resolver
	}

	if len(config.AllowedPorts) == 0 {
		config.AllowedPorts =
			defaults.AllowedPorts
	}

	if config.DNSTimeout <= 0 {
		config.DNSTimeout =
			defaults.DNSTimeout
	}

	if config.DialTimeout <= 0 {
		config.DialTimeout =
			defaults.DialTimeout
	}

	if config.KeepAlive <= 0 {
		config.KeepAlive =
			defaults.KeepAlive
	}

	ports := make(
		map[uint16]struct{},
		len(config.AllowedPorts),
	)

	for port := range config.AllowedPorts {
		ports[port] = struct{}{}
	}

	return &Guard{
		resolver: config.Resolver,

		allowedPorts: ports,

		dnsTimeout: config.DNSTimeout,

		dialer: net.Dialer{
			Timeout: config.DialTimeout,

			KeepAlive: config.KeepAlive,
		},
	}
}

func (
	guard *Guard,
) ValidateAddress(
	ctx context.Context,
	address string,
) ([]netip.Addr, string, error) {
	host, portText, err :=
		net.SplitHostPort(address)

	if err != nil {
		return nil, "", fmt.Errorf(
			"destination must use host:port format: %w",
			err,
		)
	}

	portNumber, err :=
		strconv.ParseUint(
			portText,
			10,
			16,
		)

	if err != nil ||
		portNumber == 0 {
		return nil, "", fmt.Errorf(
			"invalid destination port %q",
			portText,
		)
	}

	if _, allowed :=
		guard.allowedPorts[uint16(portNumber)]; !allowed {
		return nil, "", fmt.Errorf(
			"%w: %d",
			ErrDisallowedPort,
			portNumber,
		)
	}

	addresses, err :=
		guard.ResolveHost(
			ctx,
			host,
		)

	if err != nil {
		return nil, "", err
	}

	return addresses,
		portText,
		nil
}

func (
	guard *Guard,
) ResolveHost(
	ctx context.Context,
	rawHost string,
) ([]netip.Addr, error) {
	host, err :=
		normalizeHost(rawHost)

	if err != nil {
		return nil, err
	}

	if isBlockedHostname(host) {
		return nil, fmt.Errorf(
			"%w: %s",
			ErrBlockedDestination,
			host,
		)
	}

	if address, parseError :=
		netip.ParseAddr(host); parseError == nil {
		address =
			address.Unmap()

		if IsBlockedAddress(address) {
			return nil, fmt.Errorf(
				"%w: %s",
				ErrBlockedDestination,
				address,
			)
		}

		return []netip.Addr{
			address,
		}, nil
	}

	if err := validateDomainName(
		host,
	); err != nil {
		return nil, err
	}

	lookupContext, cancel :=
		context.WithTimeout(
			ctx,
			guard.dnsTimeout,
		)

	defer cancel()

	addresses, err :=
		guard.resolver.LookupNetIP(
			lookupContext,
			"ip",
			host,
		)

	if err != nil {
		return nil, fmt.Errorf(
			"resolve destination %q: %w",
			host,
			err,
		)
	}

	if len(addresses) == 0 {
		return nil, fmt.Errorf(
			"destination %q returned no addresses",
			host,
		)
	}

	unique :=
		make(
			map[netip.Addr]struct{},
		)

	approved :=
		make(
			[]netip.Addr,
			0,
			len(addresses),
		)

	for _, address := range addresses {
		address =
			address.Unmap()

		if IsBlockedAddress(address) {
			return nil, fmt.Errorf(
				"%w: %s resolves to %s",
				ErrBlockedDestination,
				host,
				address,
			)
		}

		if _, exists :=
			unique[address]; exists {
			continue
		}

		unique[address] =
			struct{}{}

		approved =
			append(
				approved,
				address,
			)
	}

	return approved, nil
}

func (
	guard *Guard,
) DialContext(
	ctx context.Context,
	network string,
	address string,
) (net.Conn, error) {
	if network != "tcp" &&
		network != "tcp4" &&
		network != "tcp6" {
		return nil, fmt.Errorf(
			"unsupported proxy network %q",
			network,
		)
	}

	addresses, port, err :=
		guard.ValidateAddress(
			ctx,
			address,
		)

	if err != nil {
		return nil, err
	}

	var dialErrors []error

	for _, resolvedAddress := range addresses {
		if network == "tcp4" &&
			!resolvedAddress.Is4() {
			continue
		}

		if network == "tcp6" &&
			!resolvedAddress.Is6() {
			continue
		}

		dialNetwork := network

		if network == "tcp" {
			if resolvedAddress.Is4() {
				dialNetwork =
					"tcp4"
			} else {
				dialNetwork =
					"tcp6"
			}
		}

		literalAddress :=
			net.JoinHostPort(
				resolvedAddress.String(),
				port,
			)

		connection, dialError :=
			guard.dialer.DialContext(
				ctx,
				dialNetwork,
				literalAddress,
			)

		if dialError == nil {
			return connection, nil
		}

		dialErrors =
			append(
				dialErrors,
				fmt.Errorf(
					"dial %s: %w",
					literalAddress,
					dialError,
				),
			)
	}

	if len(dialErrors) == 0 {
		return nil, fmt.Errorf(
			"no destination addresses matched network %q",
			network,
		)
	}

	return nil, fmt.Errorf(
		"all approved destination addresses failed: %w",
		errors.Join(dialErrors...),
	)
}

func IsBlockedAddress(
	address netip.Addr,
) bool {
	if !address.IsValid() {
		return true
	}

	address =
		address.Unmap()

	if !address.IsGlobalUnicast() ||
		address.IsPrivate() ||
		address.IsLoopback() ||
		address.IsLinkLocalUnicast() ||
		address.IsMulticast() ||
		address.IsUnspecified() {
		return true
	}

	for _, prefix := range blockedPrefixes {
		if prefix.Contains(address) {
			return true
		}
	}

	return false
}

func normalizeHost(
	rawHost string,
) (string, error) {
	host :=
		strings.TrimSpace(
			rawHost,
		)

	if strings.HasPrefix(
		host,
		"[",
	) && strings.HasSuffix(
		host,
		"]",
	) {
		host =
			host[1 : len(host)-1]
	}

	host =
		strings.TrimSuffix(
			host,
			".",
		)

	host =
		strings.ToLower(host)

	if host == "" {
		return "", fmt.Errorf(
			"destination hostname is empty",
		)
	}

	if strings.ContainsAny(
		host,
		"\x00\r\n\t /\\",
	) {
		return "", fmt.Errorf(
			"destination hostname contains invalid characters",
		)
	}

	if strings.Contains(
		host,
		"%",
	) {
		return "", fmt.Errorf(
			"IPv6 zone identifiers are not allowed",
		)
	}

	for _, character := range host {
		if character > 127 {
			return "", fmt.Errorf(
				"destination hostname must use ASCII or punycode",
			)
		}
	}

	return host, nil
}

func validateDomainName(
	host string,
) error {
	if len(host) > 253 {
		return fmt.Errorf(
			"destination hostname is too long",
		)
	}

	labels :=
		strings.Split(
			host,
			".",
		)

	for _, label := range labels {
		if label == "" ||
			len(label) > 63 {
			return fmt.Errorf(
				"destination hostname contains an invalid label",
			)
		}

		if label[0] == '-' ||
			label[len(label)-1] == '-' {
			return fmt.Errorf(
				"destination hostname labels cannot start or end with a hyphen",
			)
		}

		for _, character := range label {
			valid :=
				character >= 'a' &&
					character <= 'z' ||
					character >= '0' &&
						character <= '9' ||
					character == '-'

			if !valid {
				return fmt.Errorf(
					"destination hostname contains invalid characters",
				)
			}
		}
	}

	return nil
}

func isBlockedHostname(
	host string,
) bool {
	if _, blocked :=
		blockedHostnames[host]; blocked {
		return true
	}

	return strings.HasSuffix(
		host,
		".localhost",
	) ||
		strings.HasSuffix(
			host,
			".local",
		) ||
		strings.HasSuffix(
			host,
			".home.arpa",
		)
}
