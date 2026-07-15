package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/auth"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/config"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/logging"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/proxy"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/server"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/usage"
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
		slog.String("node_reference", cfg.NodeID),
	)

	startupContext, cancelStartup :=
		context.WithTimeout(
			context.Background(),
			15*time.Second,
		)

	defer cancelStartup()

	databasePool, err := pgxpool.New(
		startupContext,
		cfg.DatabaseURL,
	)

	if err != nil {
		logger.Error(
			"database pool creation failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	defer databasePool.Close()

	if err := databasePool.Ping(
		startupContext,
	); err != nil {
		logger.Error(
			"database connection failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger.Info("PostgreSQL connection established")

	redisClient := redis.NewClient(
		&redis.Options{
			Addr:     cfg.RedisAddress,
			Password: cfg.RedisPassword,
			DB:       cfg.RedisDatabase,
		},
	)

	defer func() {
		if err := redisClient.Close(); err != nil {
			logger.Warn(
				"Redis connection close failed",
				slog.String("error", err.Error()),
			)
		}
	}()

	if err := redisClient.Ping(
		startupContext,
	).Err(); err != nil {
		logger.Error(
			"Redis connection failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger.Info("Redis connection established")

	credentialRepository :=
		auth.NewPostgresCredentialRepository(
			databasePool,
		)

	credentialCache :=
		auth.NewRedisCredentialCache(
			redisClient,
			"nexus:auth:credential",
		)

	authenticator := auth.NewAuthenticator(
		logger,
		credentialRepository,
		credentialCache,
		[]byte(cfg.CredentialPepper),
		cfg.AuthCacheTTL,
	)

	usageRecorder, err :=
		usage.NewPostgresRecorder(
			startupContext,
			logger,
			databasePool,
			cfg.NodeID,
		)

	if err != nil {
		logger.Error(
			"usage recorder initialization failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger.Info("usage recorder initialized")

	validator := proxy.NewDestinationValidator(
		cfg.AllowPrivateIPs,
	)

	proxyHandler := proxy.NewHandler(
		logger,
		authenticator,
		usageRecorder,
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
			slog.String(
				"signal",
				signalValue.String(),
			),
		)

	case serverError := <-serverErrors:
		if serverError != nil {
			logger.Error(
				"proxy server failed",
				slog.String(
					"error",
					serverError.Error(),
				),
			)

			os.Exit(1)
		}
	}

	shutdownContext, cancelShutdown :=
		context.WithTimeout(
			context.Background(),
			10*time.Second,
		)

	defer cancelShutdown()

	if err := proxyServer.Shutdown(
		shutdownContext,
	); err != nil {
		logger.Error(
			"graceful shutdown failed",
			slog.String("error", err.Error()),
		)

		os.Exit(1)
	}

	logger.Info("proxy engine stopped successfully")
}
