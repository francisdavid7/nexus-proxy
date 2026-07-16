import {
  getRedisClient,
} from "@/lib/redis/client";

function credentialCacheKey(
  username: string,
): string {
  return (
    `nexus:auth:credential:${username}`
  );
}

function credentialRevocationKey(
  username: string,
): string {
  return (
    `nexus:auth:revoked:${username}`
  );
}

export async function markProxyCredentialRevoked(
  username: string,
): Promise<void> {
  const redis =
    await getRedisClient();

  await redis
    .multi()
    .del(credentialCacheKey(username))
    .set(
      credentialRevocationKey(username),
      "1",
    )
    .exec();
}

export async function clearProxyCredentialRevocation(
  username: string,
): Promise<void> {
  const redis =
    await getRedisClient();

  await redis
    .multi()
    .del(credentialCacheKey(username))
    .del(
      credentialRevocationKey(username),
    )
    .exec();
}
