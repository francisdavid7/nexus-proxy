package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"
)

type Server struct {
	httpServer *http.Server
}

func New(
	address string,
	handler http.Handler,
	readTimeout time.Duration,
	writeTimeout time.Duration,
	idleTimeout time.Duration,
) *Server {
	return &Server{
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
	log.Printf(
		"Nexus proxy engine listening on %s",
		s.httpServer.Addr,
	)

	err := s.httpServer.ListenAndServe()

	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}

	return err
}

func (s *Server) Shutdown(ctx context.Context) error {
	log.Println("shutting down Nexus proxy engine")

	return s.httpServer.Shutdown(ctx)
}
