package proxy

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
)

type DestinationValidator struct {
	resolver        *net.Resolver
	allowPrivateIPs bool
}

func NewDestinationValidator(
	allowPrivateIPs bool,
) *DestinationValidator {
	return &DestinationValidator{
		resolver:        net.DefaultResolver,
		allowPrivateIPs: allowPrivateIPs,
	}
}

func (v *DestinationValidator) Validate(
	ctx context.Context,
	host string,
) error {
	host = strings.TrimSpace(host)

	if host == "" {
		return fmt.Errorf("destination host is empty")
	}

	hostWithoutPort := host

	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		hostWithoutPort = parsedHost
	}

	hostWithoutPort = strings.Trim(
		hostWithoutPort,
		"[]",
	)

	ip, err := netip.ParseAddr(hostWithoutPort)
	if err == nil {
		return v.validateIP(ip)
	}

	addresses, err := v.resolver.LookupNetIP(
		ctx,
		"ip",
		hostWithoutPort,
	)
	if err != nil {
		return fmt.Errorf("resolve destination: %w", err)
	}

	if len(addresses) == 0 {
		return fmt.Errorf("destination has no IP addresses")
	}

	for _, address := range addresses {
		if err := v.validateIP(address); err != nil {
			return err
		}
	}

	return nil
}

func (v *DestinationValidator) validateIP(ip netip.Addr) error {
	if v.allowPrivateIPs {
		return nil
	}

	if !ip.IsValid() {
		return fmt.Errorf("invalid destination IP")
	}

	if ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified() {
		return fmt.Errorf(
			"connections to private or local addresses are blocked",
		)
	}

	return nil
}
