package ratelimit

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const fixedWindowScript = `
	local current = redis.call("INCR", KEYS[1])

	if current == 1 then
		redis.call("EXPIRE", KEYS[1], ARGV[1])
	end

	local ttl = redis.call("TTL", KEYS[1])
	local limit = tonumber(ARGV[2])

	if current > limit then
		return {0, current, ttl}
	end

	return {1, current, ttl}
`

type Decision struct {
	Allowed    bool
	Current    int64
	Limit      int
	RetryAfter time.Duration
}

type RedisLimiter struct {
	client *redis.Client
	prefix string
	script *redis.Script
}

func NewRedisLimiter(
	client *redis.Client,
	prefix string,
) *RedisLimiter {
	return &RedisLimiter{
		client: client,
		prefix: prefix,
		script: redis.NewScript(
			fixedWindowScript,
		),
	}
}

func (l *RedisLimiter) Allow(
	ctx context.Context,
	credentialID string,
	limit int,
) (Decision, error) {
	if limit <= 0 {
		return Decision{
			Allowed: true,
			Limit:   limit,
		}, nil
	}

	now := time.Now().UTC()

	window := now.Unix() / 60

	key := fmt.Sprintf(
		"%s:%s:%d",
		l.prefix,
		credentialID,
		window,
	)

	result, err := l.script.Run(
		ctx,
		l.client,
		[]string{key},
		120,
		limit,
	).Slice()

	if err != nil {
		return Decision{}, err
	}

	if len(result) != 3 {
		return Decision{}, fmt.Errorf(
			"unexpected rate limiter response",
		)
	}

	allowedValue, err := toInt64(result[0])
	if err != nil {
		return Decision{}, err
	}

	current, err := toInt64(result[1])
	if err != nil {
		return Decision{}, err
	}

	ttlSeconds, err := toInt64(result[2])
	if err != nil {
		return Decision{}, err
	}

	if ttlSeconds < 1 {
		ttlSeconds = 1
	}

	return Decision{
		Allowed:    allowedValue == 1,
		Current:    current,
		Limit:      limit,
		RetryAfter: time.Duration(ttlSeconds) * time.Second,
	}, nil
}

func toInt64(value any) (int64, error) {
	switch converted := value.(type) {
	case int64:
		return converted, nil

	case string:
		return strconv.ParseInt(
			converted,
			10,
			64,
		)

	case []byte:
		return strconv.ParseInt(
			string(converted),
			10,
			64,
		)

	default:
		return strconv.ParseInt(
			fmt.Sprint(value),
			10,
			64,
		)
	}
}
