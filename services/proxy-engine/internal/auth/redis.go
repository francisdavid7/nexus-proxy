package auth

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisCredentialCache struct {
	client *redis.Client
	prefix string
}

func NewRedisCredentialCache(
	client *redis.Client,
	prefix string,
) *RedisCredentialCache {
	return &RedisCredentialCache{
		client: client,
		prefix: prefix,
	}
}

func (c *RedisCredentialCache) Get(
	ctx context.Context,
	username string,
) (Credential, bool, error) {
	value, err := c.client.Get(
		ctx,
		c.key(username),
	).Bytes()

	if err == redis.Nil {
		return Credential{}, false, nil
	}

	if err != nil {
		return Credential{}, false, err
	}

	var credential Credential

	if err := json.Unmarshal(
		value,
		&credential,
	); err != nil {
		return Credential{}, false, err
	}

	return credential, true, nil
}

func (c *RedisCredentialCache) Set(
	ctx context.Context,
	username string,
	credential Credential,
	ttl time.Duration,
) error {
	value, err := json.Marshal(credential)
	if err != nil {
		return err
	}

	return c.client.Set(
		ctx,
		c.key(username),
		value,
		ttl,
	).Err()
}

func (c *RedisCredentialCache) key(
	username string,
) string {
	return c.prefix + ":" + username
}
