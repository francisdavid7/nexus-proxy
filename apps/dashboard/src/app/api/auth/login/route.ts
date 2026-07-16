import { prisma } from "@nexus/database";
import { z } from "zod";

import {
  verifyPassword,
} from "@/lib/auth/password";

import {
  createUserSession,
} from "@/lib/auth/session";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((value) =>
      value.toLowerCase(),
    ),

  password: z
    .string()
    .min(1)
    .max(256),
});

export async function POST(
  request: Request,
): Promise<Response> {
  const requestBody = await request
    .json()
    .catch(() => null);

  const validationResult =
    loginSchema.safeParse(requestBody);

  if (!validationResult.success) {
    return Response.json(
      {
        message:
          "A valid email and password are required.",
      },
      {
        status: 400,
      },
    );
  }

  const user = await prisma.user.findUnique({
    where: {
      email: validationResult.data.email,
    },

    select: {
      id: true,
      fullName: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  if (
    !user ||
    user.status !== "ACTIVE"
  ) {
    return Response.json(
      {
        message:
          "The email or password is incorrect.",
      },
      {
        status: 401,
      },
    );
  }

  const passwordIsValid =
    await verifyPassword(
      validationResult.data.password,
      user.passwordHash,
    );

  if (!passwordIsValid) {
    return Response.json(
      {
        message:
          "The email or password is incorrect.",
      },
      {
        status: 401,
      },
    );
  }

  await createUserSession(user.id);

  return Response.json(
    {
      message: "Login successful.",

      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        emailVerifiedAt:
          user.emailVerifiedAt,
      },
    },
    {
      status: 200,
    },
  );
}
