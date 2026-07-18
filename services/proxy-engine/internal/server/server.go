package server

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"time"
)

type Server struct {
	logger     *slog.Logger
	httpServer *http.Server
}

func New(
	logger *slog.Logger,
	address string,
	handler http.Handler,
	readTimeout time.Duration,
	writeTimeout time.Duration,
	idleTimeout time.Duration,
) *Server {
	return &Server{
		logger: logger,
		httpServer: &http.Server{
			Addr:              address,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       readTimeout,
			WriteTimeout:      writeTimeout,
			IdleTimeout:       idleTimeout,
			MaxHeaderBytes:    1 << 20,
			TLSConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
				NextProtos: []string{"http/1.1"},
			},
		},
	}
}

func (s *Server) Start() error {
	s.logger.Info(
		"proxy listener started",
		slog.String("address", s.httpServer.Addr),
		slog.String("transport", "plaintext"),
	)

	return normalizeServerError(
		s.httpServer.ListenAndServe(),
	)
}

func (s *Server) StartTLS(
	certFile string,
	keyFile string,
) error {
	s.logger.Info(
		"proxy listener started",
		slog.String("address", s.httpServer.Addr),
		slog.String("transport", "tls"),
	)

	return normalizeServerError(
		s.httpServer.ListenAndServeTLS(
			certFile,
			keyFile,
		),
	)
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info(
		"proxy listener shutting down",
		slog.String("address", s.httpServer.Addr),
	)

	return s.httpServer.Shutdown(ctx)
}

func normalizeServerError(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}

	return err
}
