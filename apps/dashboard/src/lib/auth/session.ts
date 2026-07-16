import {
  createHash,
  randomBytes,
} from "node:crypto";

import { prisma } from "@nexus/database";
import { cookies } from "next/headers";

const DEFAULT_COOKIE_NAME = "nexus_session";
const DEFAULT_SESSION_TTL_DAYS = 7;

function getCookieName(): string {
  return (
    process.env.SESSION_COOKIE_NAME?.trim() ||
    DEFAULT_COOKIE_NAME
  );
}

function getSessionTTLDays(): number {
  const configuredValue = Number.parseInt(
    process.env.SESSION_TTL_DAYS ?? "",
    10,
  );

  if (
    Number.isNaN(configuredValue) ||
    configuredValue < 1
  ) {
    return DEFAULT_SESSION_TTL_DAYS;
  }

  return configuredValue;
}

function shouldUseSecureCookies(): boolean {
  return (
    process.env.COOKIE_SECURE
      ?.trim()
      .toLowerCase() === "true"
  );
}

function digestSessionToken(
  token: string,
): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

function createSessionExpiration(): Date {
  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() +
      getSessionTTLDays(),
  );

  return expiresAt;
}

async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set({
    name: getCookieName(),
    value: "",
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function createUserSession(
  userId: string,
): Promise<void> {
  const rawToken = randomBytes(32).toString(
    "base64url",
  );

  const tokenDigest =
    digestSessionToken(rawToken);

  const expiresAt =
    createSessionExpiration();

  await prisma.$transaction(
    async (transaction) => {
      await transaction.authSession.deleteMany({
        where: {
          userId,

          expiresAt: {
            lte: new Date(),
          },
        },
      });

      await transaction.authSession.create({
        data: {
          userId,
          tokenDigest,
          expiresAt,
        },
      });
    },
  );

  const cookieStore = await cookies();

  cookieStore.set({
    name: getCookieName(),
    value: rawToken,
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser() {
  const cookieStore = await cookies();

  const rawToken = cookieStore.get(
    getCookieName(),
  )?.value;

  if (!rawToken) {
    return null;
  }

  const tokenDigest =
    digestSessionToken(rawToken);

  const session =
    await prisma.authSession.findUnique({
      where: {
        tokenDigest,
      },

      select: {
        id: true,
        expiresAt: true,
        lastSeenAt: true,

        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
          },
        },
      },
    });

  if (!session) {
    await deleteSessionCookie();

    return null;
  }

  const now = new Date();

  if (session.expiresAt <= now) {
    await prisma.authSession.deleteMany({
      where: {
        id: session.id,
      },
    });

    await deleteSessionCookie();

    return null;
  }

  if (session.user.status !== "ACTIVE") {
    await prisma.authSession.deleteMany({
      where: {
        id: session.id,
      },
    });

    await deleteSessionCookie();

    return null;
  }

  const lastSeenUpdateThreshold =
    new Date(now.getTime() - 5 * 60 * 1000);

  if (
    session.lastSeenAt <
    lastSeenUpdateThreshold
  ) {
    await prisma.authSession.update({
      where: {
        id: session.id,
      },

      data: {
        lastSeenAt: now,
      },
    });
  }

  return session.user;
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();

  const rawToken = cookieStore.get(
    getCookieName(),
  )?.value;

  if (rawToken) {
    const tokenDigest =
      digestSessionToken(rawToken);

    await prisma.authSession.deleteMany({
      where: {
        tokenDigest,
      },
    });
  }

  await deleteSessionCookie();
}
