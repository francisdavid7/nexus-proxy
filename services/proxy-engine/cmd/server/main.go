package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/config"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/logging"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/proxy"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error(
			"configuration failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger := logging.New(
		cfg.Environment,
		cfg.LogLevel,
	).With(
		slog.String("node_id", cfg.NodeID),
	)

	authenticator := auth.NewBasicAuthenticator(
		cfg.Username,
		cfg.Password,
	)

	validator := proxy.NewDestinationValidator(
		cfg.AllowPrivateIPs,
	)

	proxyHandler := proxy.NewHandler(
		logger,
		authenticator,
		validator,
		cfg.ConnectTimeout,
	)

	proxyServer := server.New(
		logger,
		cfg.Address(),
		proxyHandler,
		cfg.ReadTimeout,
		cfg.WriteTimeout,
		cfg.IdleTimeout,
	)

	serverErrors := make(chan error, 1)

	go func() {
		serverErrors <- proxyServer.Start()
	}()

	shutdownSignals := make(chan os.Signal, 1)

	signal.Notify(
		shutdownSignals,
		syscall.SIGINT,
		syscall.SIGTERM,
	)

	select {
	case signalValue := <-shutdownSignals:
		logger.Info(
			"shutdown signal received",
			slog.String("signal", signalValue.String()),
		)

	case serverError := <-serverErrors:
		if serverError != nil {
			logger.Error(
				"proxy server failed",
				slog.String("error", serverError.Error()),
			)

			os.Exit(1)
		}
	}

	shutdownContext, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	if err := proxyServer.Shutdown(shutdownContext); err != nil {
		logger.Error(
			"graceful shutdown failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger.Info("proxy engine stopped successfully")
}
