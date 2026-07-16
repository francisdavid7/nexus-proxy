function readPositiveInteger(
  name: string,
  fallback: number,
): number {
  const parsed = Number.parseInt(
    process.env[name] ?? "",
    10,
  );

  if (
    Number.isNaN(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  return parsed;
}

export function getNodeHeartbeatMaxSkewSeconds():
  number {
  return readPositiveInteger(
    "NODE_HEARTBEAT_MAX_SKEW_SECONDS",
    300,
  );
}

export function getNodeNonceTTLSeconds():
  number {
  return readPositiveInteger(
    "NODE_NONCE_TTL_SECONDS",
    600,
  );
}

export function getNodeStaleAfterSeconds():
  number {
  return readPositiveInteger(
    "NODE_STALE_AFTER_SECONDS",
    90,
  );
}

export function getNodeStaleCutoff(
  now = new Date(),
): Date {
  return new Date(
    now.getTime() -
      getNodeStaleAfterSeconds() *
        1000,
  );
}

export function getNodeDegradedThreshold():
  number {
  const parsed = Number.parseFloat(
    process.env
      .NODE_DEGRADED_PERCENT_THRESHOLD ??
      "",
  );

  if (
    Number.isNaN(parsed) ||
    parsed < 1 ||
    parsed > 100
  ) {
    return 90;
  }

  return parsed;
}
