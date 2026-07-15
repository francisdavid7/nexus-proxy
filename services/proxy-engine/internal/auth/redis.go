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
		c.credentialKey(username),
	).Bytes()

	if err == redis.Nil {
		return Credential{}, false, nil
	}

	if err != nil {
		return Credential{}, false, err
	}

	var credential Credential

	if err := json.Unmarshal(value, &credential); err != nil {
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
		c.credentialKey(username),
		value,
		ttl,
	).Err()
}

func (c *RedisCredentialCache) Delete(
	ctx context.Context,
	username string,
) error {
	return c.client.Del(
		ctx,
		c.credentialKey(username),
	).Err()
}

func (c *RedisCredentialCache) IsRevoked(
	ctx context.Context,
	username string,
) (bool, error) {
	count, err := c.client.Exists(
		ctx,
		c.revocationKey(username),
	).Result()

	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func (c *RedisCredentialCache) MarkRevoked(
	ctx context.Context,
	username string,
) error {
	pipeline := c.client.TxPipeline()

	pipeline.Del(
		ctx,
		c.credentialKey(username),
	)

	pipeline.Set(
		ctx,
		c.revocationKey(username),
		"1",
		0,
	)

	_, err := pipeline.Exec(ctx)

	return err
}

func (c *RedisCredentialCache) ClearRevocation(
	ctx context.Context,
	username string,
) error {
	pipeline := c.client.TxPipeline()

	pipeline.Del(
		ctx,
		c.credentialKey(username),
	)

	pipeline.Del(
		ctx,
		c.revocationKey(username),
	)

	_, err := pipeline.Exec(ctx)

	return err
}

func (c *RedisCredentialCache) credentialKey(
	username string,
) string {
	return c.prefix + ":credential:" + username
}

func (c *RedisCredentialCache) revocationKey(
	username string,
) string {
	return c.prefix + ":revoked:" + username
}

// This produces an immediate compiler error if the cache no longer
// satisfies the CredentialCache interface.
var _ CredentialCache = (*RedisCredentialCache)(nil)
