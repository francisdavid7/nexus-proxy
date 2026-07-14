package server

import (
	"context"
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
		},
	}
}

func (s *Server) Start() error {
	s.logger.Info(
		"proxy engine started",
		slog.String("address", s.httpServer.Addr),
	)

	err := s.httpServer.ListenAndServe()

	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}

	return err
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("proxy engine shutting down")

	return s.httpServer.Shutdown(ctx)
}
