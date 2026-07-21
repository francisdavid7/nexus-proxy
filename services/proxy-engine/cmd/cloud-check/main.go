package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/francisdavid7/nexus-proxy/services/proxy-engine/internal/redisclient"
)

func main() {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		20*time.Second,
	)
	defer cancel()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fail("DATABASE_URL is required")
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		fail("REDIS_URL is required")
	}

	databasePool, err := pgxpool.New(
		ctx,
		databaseURL,
	)
	if err != nil {
		fail(
			"PostgreSQL client initialization failed",
		)
	}
	defer databasePool.Close()

	if err := databasePool.Ping(ctx); err != nil {
		fail("PostgreSQL connectivity failed")
	}

	fmt.Println(
		"PostgreSQL connectivity: PASS",
	)

	redisClient, err := redisclient.New(
		redisclient.Config{
			URL: redisURL,
		},
	)
	if err != nil {
		fail(err.Error())
	}
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		fail("Redis TLS connectivity failed")
	}

	fmt.Println(
		"Redis TLS connectivity: PASS",
	)
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
