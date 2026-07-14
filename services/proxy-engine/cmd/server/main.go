package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/config"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/proxy"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}

	authenticator := auth.NewBasicAuthenticator(
		cfg.Username,
		cfg.Password,
	)

	validator := proxy.NewDestinationValidator(
		cfg.AllowPrivateIPs,
	)

	proxyHandler := proxy.NewHandler(
		authenticator,
		validator,
		cfg.ConnectTimeout,
	)

	proxyServer := server.New(
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
		log.Printf(
			"received shutdown signal: %s",
			signalValue,
		)

	case serverError := <-serverErrors:
		if serverError != nil {
			log.Fatalf(
				"proxy server failed: %v",
				serverError,
			)
		}
	}

	shutdownContext, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	if err := proxyServer.Shutdown(shutdownContext); err != nil {
		log.Printf(
			"graceful shutdown failed: %v",
			err,
		)
	}
}
