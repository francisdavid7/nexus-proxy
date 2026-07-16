import {
  z,
} from "zod";

export class InvalidConnectionCursorError
  extends Error {}

const cursorSchema = z.object({
  id: z.string().uuid(),

  startedAt: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !Number.isNaN(
          Date.parse(value),
        ),
      {
        message:
          "The cursor date is invalid.",
      },
    ),
});

export type ConnectionCursor = {
  id: string;
  startedAt: Date;
};

export function encodeConnectionCursor(
  cursor: ConnectionCursor,
): string {
  const payload = JSON.stringify({
    id: cursor.id,
    startedAt:
      cursor.startedAt.toISOString(),
  });

  return Buffer
    .from(payload, "utf8")
    .toString("base64url");
}

export function decodeConnectionCursor(
  encodedCursor: string,
): ConnectionCursor {
  if (
    encodedCursor.length === 0 ||
    encodedCursor.length > 512
  ) {
    throw new InvalidConnectionCursorError(
      "The pagination cursor is invalid.",
    );
  }

  try {
    const decoded = Buffer
      .from(
        encodedCursor,
        "base64url",
      )
      .toString("utf8");

    const parsed = cursorSchema.parse(
      JSON.parse(decoded),
    );

    return {
      id: parsed.id,
      startedAt:
        new Date(parsed.startedAt),
    };
  } catch {
    throw new InvalidConnectionCursorError(
      "The pagination cursor is invalid.",
    );
  }
}
