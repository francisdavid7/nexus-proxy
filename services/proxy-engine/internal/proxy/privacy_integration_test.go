package proxy

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/privacy"
)

func TestHandlerInstallsPrivacyGuard(
	t *testing.T,
) {
	t.Setenv(
		"PROXY_ALLOWED_DESTINATION_PORTS",
		"80,443",
	)

	t.Setenv(
		"PROXY_DNS_TIMEOUT",
		"2s",
	)

	t.Setenv(
		"PROXY_DIAL_TIMEOUT",
		"2s",
	)

	t.Setenv(
		"PROXY_KEEP_ALIVE",
		"15s",
	)

	logger :=
		slog.New(
			slog.NewTextHandler(
				io.Discard,
				nil,
			),
		)

	handler :=
		NewHandler(
			logger,
			nil,
			nil,
			nil,
			nil,
			2*time.Second,
		)

	if handler.egressGuard == nil {
		t.Fatal(
			"expected Handler to install an egress privacy guard",
		)
	}

	if handler.transport == nil {
		t.Fatal(
			"expected Handler to install a guarded HTTP transport",
		)
	}
}

func TestHandlerGuardRejectsLoopbackDestination(
	t *testing.T,
) {
	t.Setenv(
		"PROXY_ALLOWED_DESTINATION_PORTS",
		"80,443",
	)

	t.Setenv(
		"PROXY_DNS_TIMEOUT",
		"2s",
	)

	t.Setenv(
		"PROXY_DIAL_TIMEOUT",
		"2s",
	)

	t.Setenv(
		"PROXY_KEEP_ALIVE",
		"15s",
	)

	logger :=
		slog.New(
			slog.NewTextHandler(
				io.Discard,
				nil,
			),
		)

	handler :=
		NewHandler(
			logger,
			nil,
			nil,
			nil,
			nil,
			2*time.Second,
		)

	_, _, err :=
		handler.egressGuard.ValidateAddress(
			context.Background(),
			"127.0.0.1:80",
		)

	if !errors.Is(
		err,
		privacy.ErrBlockedDestination,
	) {
		t.Fatalf(
			"expected loopback destination to be blocked, received %v",
			err,
		)
	}
}

func TestHandlerGuardRejectsMetadataEndpoint(
	t *testing.T,
) {
	t.Setenv(
		"PROXY_ALLOWED_DESTINATION_PORTS",
		"80,443",
	)

	logger :=
		slog.New(
			slog.NewTextHandler(
				io.Discard,
				nil,
			),
		)

	handler :=
		NewHandler(
			logger,
			nil,
			nil,
			nil,
			nil,
			2*time.Second,
		)

	_, _, err :=
		handler.egressGuard.ValidateAddress(
			context.Background(),
			"169.254.169.254:80",
		)

	if !errors.Is(
		err,
		privacy.ErrBlockedDestination,
	) {
		t.Fatalf(
			"expected metadata endpoint to be blocked, received %v",
			err,
		)
	}
}

func TestHandlerGuardRejectsDisallowedPort(
	t *testing.T,
) {
	t.Setenv(
		"PROXY_ALLOWED_DESTINATION_PORTS",
		"80,443",
	)

	logger :=
		slog.New(
			slog.NewTextHandler(
				io.Discard,
				nil,
			),
		)

	handler :=
		NewHandler(
			logger,
			nil,
			nil,
			nil,
			nil,
			2*time.Second,
		)

	_, _, err :=
		handler.egressGuard.ValidateAddress(
			context.Background(),
			"example.com:22",
		)

	if !errors.Is(
		err,
		privacy.ErrDisallowedPort,
	) {
		t.Fatalf(
			"expected destination port 22 to be blocked, received %v",
			err,
		)
	}
}
