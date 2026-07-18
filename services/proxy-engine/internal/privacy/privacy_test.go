package privacy

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"testing"
)

type fakeResolver struct {
	results map[string][]netip.Addr
	errors  map[string]error
}

func (
	resolver fakeResolver,
) LookupNetIP(
	_ context.Context,
	_ string,
	host string,
) ([]netip.Addr, error) {
	if err :=
		resolver.errors[host]; err != nil {
		return nil, err
	}

	return resolver.results[host],
		nil
}

func newTestGuard(
	resolver Resolver,
) *Guard {
	return NewGuard(
		Config{
			Resolver: resolver,

			AllowedPorts: map[uint16]struct{}{
				80:  {},
				443: {},
			},
		},
	)
}

func TestResolveHostAcceptsPublicAddress(
	t *testing.T,
) {
	t.Parallel()

	guard :=
		newTestGuard(
			fakeResolver{
				results: map[string][]netip.Addr{
					"example.com": {
						netip.MustParseAddr(
							"93.184.216.34",
						),
					},
				},
			},
		)

	addresses, err :=
		guard.ResolveHost(
			context.Background(),
			"example.com",
		)

	if err != nil {
		t.Fatalf(
			"expected public address to pass: %v",
			err,
		)
	}

	if len(addresses) != 1 {
		t.Fatalf(
			"expected one address, received %d",
			len(addresses),
		)
	}
}

func TestResolveHostRejectsPrivateResults(
	t *testing.T,
) {
	t.Parallel()

	testCases :=
		map[string]string{
			"loopback": "127.0.0.1",

			"private-v4": "10.20.30.40",

			"docker-network": "172.18.0.2",

			"link-local": "169.254.169.254",

			"private-v6": "fd00::10",

			"loopback-v6": "::1",
		}

	for name, rawAddress := range testCases {
		name := name
		rawAddress := rawAddress

		t.Run(
			name,
			func(t *testing.T) {
				t.Parallel()

				guard :=
					newTestGuard(
						fakeResolver{
							results: map[string][]netip.Addr{
								"blocked.test": {
									netip.MustParseAddr(
										rawAddress,
									),
								},
							},
						},
					)

				_, err :=
					guard.ResolveHost(
						context.Background(),
						"blocked.test",
					)

				if !errors.Is(
					err,
					ErrBlockedDestination,
				) {
					t.Fatalf(
						"expected blocked destination error, received %v",
						err,
					)
				}
			},
		)
	}
}

func TestResolveHostRejectsMixedDNSResults(
	t *testing.T,
) {
	t.Parallel()

	guard :=
		newTestGuard(
			fakeResolver{
				results: map[string][]netip.Addr{
					"rebind.test": {
						netip.MustParseAddr(
							"93.184.216.34",
						),

						netip.MustParseAddr(
							"127.0.0.1",
						),
					},
				},
			},
		)

	_, err :=
		guard.ResolveHost(
			context.Background(),
			"rebind.test",
		)

	if !errors.Is(
		err,
		ErrBlockedDestination,
	) {
		t.Fatalf(
			"expected mixed DNS response to be rejected, received %v",
			err,
		)
	}
}

func TestResolveHostRejectsMetadataHostname(
	t *testing.T,
) {
	t.Parallel()

	guard :=
		newTestGuard(
			fakeResolver{},
		)

	_, err :=
		guard.ResolveHost(
			context.Background(),
			"metadata.google.internal",
		)

	if !errors.Is(
		err,
		ErrBlockedDestination,
	) {
		t.Fatalf(
			"expected metadata hostname to be rejected, received %v",
			err,
		)
	}
}

func TestValidateAddressRejectsDisallowedPort(
	t *testing.T,
) {
	t.Parallel()

	guard :=
		newTestGuard(
			fakeResolver{},
		)

	_, _, err :=
		guard.ValidateAddress(
			context.Background(),
			"example.com:22",
		)

	if !errors.Is(
		err,
		ErrDisallowedPort,
	) {
		t.Fatalf(
			"expected disallowed port error, received %v",
			err,
		)
	}
}

func TestPrepareOutboundRequestStripsPrivacyHeaders(
	t *testing.T,
) {
	t.Parallel()

	request, err :=
		http.NewRequest(
			http.MethodGet,
			"http://example.com/",
			nil,
		)

	if err != nil {
		t.Fatal(err)
	}

	request.RequestURI =
		"http://example.com/"

	request.Header.Set(
		"Connection",
		"X-Connection-Secret, Keep-Alive",
	)

	request.Header.Set(
		"X-Connection-Secret",
		"sensitive",
	)

	request.Header.Set(
		"Proxy-Authorization",
		"Basic sensitive",
	)

	request.Header.Set(
		"X-Forwarded-For",
		"127.0.0.1",
	)

	request.Header.Set(
		"Forwarded",
		"for=127.0.0.1",
	)

	request.Header.Set(
		"Via",
		"nexus",
	)

	PrepareOutboundRequest(
		request,
	)

	for _, headerName := range []string{
		"Connection",
		"Keep-Alive",
		"X-Connection-Secret",
		"Proxy-Authorization",
		"X-Forwarded-For",
		"Forwarded",
		"Via",
	} {
		if value :=
			request.Header.Get(
				headerName,
			); value != "" {
			t.Fatalf(
				"expected %s to be removed, received %q",
				headerName,
				value,
			)
		}
	}

	if request.RequestURI != "" {
		t.Fatalf(
			"expected RequestURI to be cleared",
		)
	}
}

func TestSanitizeResponseHeadersRemovesAltSvc(
	t *testing.T,
) {
	t.Parallel()

	headers :=
		make(http.Header)

	headers.Set(
		"Alt-Svc",
		`h3=":443"`,
	)

	headers.Set(
		"Connection",
		"X-Origin-Hop",
	)

	headers.Set(
		"X-Origin-Hop",
		"remove-me",
	)

	SanitizeResponseHeaders(
		headers,
	)

	if headers.Get(
		"Alt-Svc",
	) != "" {
		t.Fatal(
			"expected Alt-Svc to be removed",
		)
	}

	if headers.Get(
		"X-Origin-Hop",
	) != "" {
		t.Fatal(
			"expected connection-listed response header to be removed",
		)
	}
}
