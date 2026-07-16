import {
  createClient,
} from "redis";

function createNexusRedisClient(
  redisURL: string,
) {
  const client = createClient({
    url: redisURL,
  });

  client.on("error", (error) => {
    console.error(
      "Redis client error:",
      error,
    );
  });

  return client;
}

type NexusRedisClient =
  ReturnType<
    typeof createNexusRedisClient
  >;

type RedisGlobalState = {
  nexusRedisClient?:
    NexusRedisClient;

  nexusRedisConnection?:
    Promise<void>;
};

const globalForRedis =
  globalThis as unknown as RedisGlobalState;

function getRedisURL(): string {
  const redisURL =
    process.env.REDIS_URL?.trim();

  if (!redisURL) {
    throw new Error(
      "REDIS_URL is not configured.",
    );
  }

  return redisURL;
}

export async function getRedisClient():
  Promise<NexusRedisClient> {
  let client =
    globalForRedis.nexusRedisClient;

  if (!client) {
    client = createNexusRedisClient(
      getRedisURL(),
    );

    globalForRedis.nexusRedisClient =
      client;
  }

  if (!client.isOpen) {
    if (
      !globalForRedis
        .nexusRedisConnection
    ) {
      globalForRedis
        .nexusRedisConnection =
        client
          .connect()
          .then(() => undefined)
          .finally(() => {
            globalForRedis
              .nexusRedisConnection =
              undefined;
          });
    }

    await globalForRedis
      .nexusRedisConnection;
  }

  return client;
}
