package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
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
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/ratelimit"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/server"
	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/usage"
)

type managedListener struct {
	name   string
	server *server.Server
	start  func() error
}

func main() {
	os.Exit(run())
}

func run() int {
	cfg, err := config.Load()
	if err != nil {
		slog.Error(
			"configuration failed",
			slog.String("error", err.Error()),
		)

		return 1
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

		return 1
	}

	defer databasePool.Close()

	if err := databasePool.Ping(
		startupContext,
	); err != nil {
		logger.Error(
			"database connection failed",
			slog.String("error", err.Error()),
		)

		return 1
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

		return 1
	}

	logger.Info("Redis connection established")

	credentialRepository :=
		auth.NewPostgresCredentialRepository(
			databasePool,
		)

	credentialCache :=
		auth.NewRedisCredentialCache(
			redisClient,
			"nexus:auth",
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

		return 1
	}

	logger.Info("usage recorder initialized")

	rateLimiter := ratelimit.NewRedisLimiter(
		redisClient,
		"nexus:rate:connections",
	)

	validator := proxy.NewDestinationValidator(
		cfg.AllowPrivateIPs,
	)

	proxyHandler := proxy.NewHandler(
		logger,
		authenticator,
		usageRecorder,
		rateLimiter,
		validator,
		cfg.ConnectTimeout,
	)

	rootHandler := healthAwareHandler(proxyHandler)

	listeners := make(
		[]managedListener,
		0,
		2,
	)

	if cfg.PlainEnabled {
		plainServer := server.New(
			logger,
			cfg.Address(),
			rootHandler,
			cfg.ReadTimeout,
			cfg.WriteTimeout,
			cfg.IdleTimeout,
		)

		listeners = append(
			listeners,
			managedListener{
				name:   "plaintext",
				server: plainServer,
				start:  plainServer.Start,
			},
		)
	}

	if cfg.TLSEnabled {
		tlsServer := server.New(
			logger,
			cfg.TLSAddress(),
			rootHandler,
			cfg.ReadTimeout,
			cfg.WriteTimeout,
			cfg.IdleTimeout,
		)

		listeners = append(
			listeners,
			managedListener{
				name:   "tls",
				server: tlsServer,
				start: func() error {
					return tlsServer.StartTLS(
						cfg.TLSCertFile,
						cfg.TLSKeyFile,
					)
				},
			},
		)
	}

	serverErrors := make(
		chan error,
		len(listeners),
	)

	for _, configuredListener := range listeners {
		listener := configuredListener

		go func() {
			err := listener.start()
			if err != nil {
				err = fmt.Errorf(
					"%s listener: %w",
					listener.name,
					err,
				)
			}

			serverErrors <- err
		}()
	}

	shutdownSignals := make(chan os.Signal, 1)

	signal.Notify(
		shutdownSignals,
		syscall.SIGINT,
		syscall.SIGTERM,
	)

	defer signal.Stop(shutdownSignals)

	exitCode := 0

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

			exitCode = 1
		}
	}

	shutdownContext, cancelShutdown :=
		context.WithTimeout(
			context.Background(),
			10*time.Second,
		)

	defer cancelShutdown()

	for _, listener := range listeners {
		if err := listener.server.Shutdown(
			shutdownContext,
		); err != nil {
			logger.Error(
				"graceful shutdown failed",
				slog.String("listener", listener.name),
				slog.String("error", err.Error()),
			)

			exitCode = 1
		}
	}

	if exitCode == 0 {
		logger.Info("proxy engine stopped successfully")
	}

	return exitCode
}

func healthAwareHandler(
	proxyHandler http.Handler,
) http.Handler {
	return http.HandlerFunc(
		func(
			writer http.ResponseWriter,
			request *http.Request,
		) {
			if request.Method == http.MethodGet &&
				request.URL != nil &&
				request.URL.Host == "" &&
				request.URL.Path == "/healthz" {
				writer.Header().Set(
					"Cache-Control",
					"no-store",
				)

				writer.Header().Set(
					"Content-Type",
					"text/plain; charset=utf-8",
				)

				writer.WriteHeader(http.StatusOK)

				_, _ = writer.Write(
					[]byte("ok\n"),
				)

				return
			}

			proxyHandler.ServeHTTP(
				writer,
				request,
			)
		},
	)
}
