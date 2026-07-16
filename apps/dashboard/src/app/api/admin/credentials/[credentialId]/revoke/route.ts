import {
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  createAuditIpDigest,
} from "@/lib/audit/ip";

import {
  requireAdministrator,
} from "@/lib/auth/authorization";

import {
  runSerializableTransaction,
} from "@/lib/database/transaction";

import {
  clearProxyCredentialRevocation,
  markProxyCredentialRevoked,
} from "@/lib/redis/proxy-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    credentialId: string;
  }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const authorization =
    await requireAdministrator();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const {
    credentialId,
  } = await context.params;

  const idValidation =
    z.string()
      .uuid()
      .safeParse(credentialId);

  if (!idValidation.success) {
    return Response.json(
      {
        message:
          "The credential ID is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  const existing =
    await prisma.proxyCredential
      .findUnique({
        where: {
          id: idValidation.data,
        },

        select: {
          id: true,
          username: true,
          status: true,
        },
      });

  if (!existing) {
    return Response.json(
      {
        message:
          "The proxy credential was not found.",
      },
      {
        status: 404,
      },
    );
  }

  /*
   * Block the credential across proxy nodes
   * before changing PostgreSQL. If Redis is
   * unavailable, do not claim immediate
   * revocation succeeded.
   */
  try {
    await markProxyCredentialRevoked(
      existing.username,
    );
  } catch (error) {
    console.error(
      "Redis credential revocation failed:",
      error,
    );

    return Response.json(
      {
        message:
          "Immediate credential revocation is currently unavailable.",
      },
      {
        status: 503,
      },
    );
  }

  try {
    const result =
      await runSerializableTransaction(
        async (transaction) => {
          const credential =
            await transaction
              .proxyCredential
              .findUnique({
                where: {
                  id:
                    idValidation.data,
                },

                select: {
                  id: true,
                  organizationId: true,
                  userId: true,
                  username: true,
                  status: true,
                  revokedAt: true,
                },
              });

          if (!credential) {
            throw new Error(
              "Credential disappeared during revocation.",
            );
          }

          if (
            credential.status ===
            "REVOKED"
          ) {
            return {
              credential,
              changed: false,
            };
          }

          const revokedCredential =
            await transaction
              .proxyCredential.update({
                where: {
                  id: credential.id,
                },

                data: {
                  status: "REVOKED",
                  revokedAt:
                    new Date(),
                },

                select: {
                  id: true,
                  organizationId: true,
                  userId: true,
                  username: true,
                  status: true,
                  revokedAt: true,
                },
              });

          await transaction
            .auditLog.create({
              data: {
                organizationId:
                  credential.organizationId,

                actorUserId:
                  authorization.user.id,

                action:
                  "proxy_credential.revoked",

                resourceType:
                  "ProxyCredential",

                resourceId:
                  credential.id,

                ipDigest:
                  createAuditIpDigest(
                    request,
                  ),

                metadata: {
                  username:
                    credential.username,

                  previousStatus:
                    credential.status,
                },
              },
            });

          return {
            credential:
              revokedCredential,

            changed: true,
          };
        },
      );

    return Response.json(
      {
        message:
          result.changed
            ? "Proxy credential revoked immediately."
            : "Proxy credential was already revoked.",

        credential:
          result.credential,
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    /*
     * Restore access only when the database
     * credential was not already revoked.
     */
    if (
      existing.status !== "REVOKED"
    ) {
      try {
        await clearProxyCredentialRevocation(
          existing.username,
        );
      } catch (redisError) {
        console.error(
          "Failed to compensate Redis revocation:",
          redisError,
        );
      }
    }

    console.error(
      "Database credential revocation failed:",
      error,
    );

    return Response.json(
      {
        message:
          "The proxy credential could not be revoked.",
      },
      {
        status: 500,
      },
    );
  }
}
