export function formatDate(
  value: string | Date | null | undefined,
): string {
  if (!value) {
    return "—";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

export function formatMoney(
  cents: number | null | undefined,
): string {
  if (
    cents === null ||
    cents === undefined
  ) {
    return "—";
  }

  return new Intl.NumberFormat(
    "en-NG",
    {
      style: "currency",
      currency: "USD",
    },
  ).format(cents / 100);
}

export function formatBytes(
  value:
    | string
    | number
    | bigint
    | null
    | undefined,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "0 B";
  }

  let bytes: bigint;

  try {
    bytes = BigInt(value);
  } catch {
    return "0 B";
  }

  if (bytes <= BigInt(0)) {
    return "0 B";
  }

  const units = [
    {
      name: "TB",
      divisor:
        BigInt(1024) ** BigInt(4),
    },
    {
      name: "GB",
      divisor:
        BigInt(1024) ** BigInt(3),
    },
    {
      name: "MB",
      divisor:
        BigInt(1024) ** BigInt(2),
    },
    {
      name: "KB",
      divisor: BigInt(1024),
    },
  ];

  for (const unit of units) {
    if (bytes >= unit.divisor) {
      const scaled =
        Number(
          (
            bytes *
            BigInt(100)
          ) /
            unit.divisor,
        ) / 100;

      return `${scaled.toLocaleString()} ${unit.name}`;
    }
  }

  return `${bytes.toString()} B`;
}

export function formatDuration(
  seconds: number,
): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours =
    Math.floor(minutes / 60);

  const remainingMinutes =
    minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}
