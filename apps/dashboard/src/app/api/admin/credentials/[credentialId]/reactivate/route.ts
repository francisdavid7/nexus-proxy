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
} from "@/lib/redis/proxy-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class CredentialExpiredError
  extends Error {}

class CustomerUnavailableError
  extends Error {}

class SubscriptionUnavailableError
  extends Error {}

class CredentialLimitError
  extends Error {}

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
   * Remove the cache and revocation marker
   * before changing PostgreSQL. PostgreSQL
   * still denies the credential while it
   * remains REVOKED.
   */
  try {
    await clearProxyCredentialRevocation(
      existing.username,
    );
  } catch (error) {
    console.error(
      "Redis credential reactivation failed:",
      error,
    );

    return Response.json(
      {
        message:
          "Credential reactivation is currently unavailable.",
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
          const now = new Date();

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
                  expiresAt: true,
                  revokedAt: true,
                },
              });

          if (!credential) {
            throw new Error(
              "Credential disappeared during reactivation.",
            );
          }

          if (
            credential.status ===
              "EXPIRED" ||
            (
              credential.expiresAt &&
              credential.expiresAt <= now
            )
          ) {
            throw new CredentialExpiredError(
              "An expired proxy credential cannot be reactivated.",
            );
          }

          const customer =
            await transaction.user
              .findUnique({
                where: {
                  id:
                    credential.userId,
                },

                select: {
                  role: true,
                  status: true,
                  emailVerifiedAt: true,
                },
              });

          if (
            !customer ||
            customer.role !==
              "CUSTOMER" ||
            customer.status !==
              "ACTIVE" ||
            !customer.emailVerifiedAt
          ) {
            throw new CustomerUnavailableError(
              "The credential owner must be active and email-verified.",
            );
          }

          const subscription =
            await transaction
              .subscription
              .findFirst({
                where: {
                  organizationId:
                    credential
                      .organizationId,

                  status: {
                    in: [
                      "TRIAL",
                      "ACTIVE",
                    ],
                  },

                  currentPeriodStart: {
                    lte: now,
                  },

                  currentPeriodEnd: {
                    gt: now,
                  },

                  plan: {
                    active: true,
                  },
                },

                orderBy: {
                  currentPeriodEnd:
                    "desc",
                },

                select: {
                  id: true,

                  plan: {
                    select: {
                      code: true,
                      credentialLimit: true,
                    },
                  },
                },
              });

          if (!subscription) {
            throw new SubscriptionUnavailableError(
              "The organization has no active subscription.",
            );
          }

          await transaction
            .proxyCredential
            .updateMany({
              where: {
                organizationId:
                  credential
                    .organizationId,

                status: "ACTIVE",

                expiresAt: {
                  lte: now,
                },
              },

              data: {
                status: "EXPIRED",
              },
            });

          const otherActiveCredentials =
            await transaction
              .proxyCredential.count({
                where: {
                  organizationId:
                    credential
                      .organizationId,

                  id: {
                    not:
                      credential.id,
                  },

                  status: "ACTIVE",

                  OR: [
                    {
                      expiresAt: null,
                    },
                    {
                      expiresAt: {
                        gt: now,
                      },
                    },
                  ],
                },
              });

          if (
            otherActiveCredentials >=
            subscription.plan
              .credentialLimit
          ) {
            throw new CredentialLimitError(
              `The current plan allows only ${subscription.plan.credentialLimit} active proxy credential(s).`,
            );
          }

          if (
            credential.status ===
            "ACTIVE"
          ) {
            return {
              credential,
              changed: false,
            };
          }

          const reactivated =
            await transaction
              .proxyCredential.update({
                where: {
                  id: credential.id,
                },

                data: {
                  status: "ACTIVE",
                  revokedAt: null,
                },

                select: {
                  id: true,
                  organizationId: true,
                  userId: true,
                  username: true,
                  status: true,
                  expiresAt: true,
                  revokedAt: true,
                },
              });

          await transaction
            .auditLog.create({
              data: {
                organizationId:
                  credential
                    .organizationId,

                actorUserId:
                  authorization.user.id,

                action:
                  "proxy_credential.reactivated",

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

                  planCode:
                    subscription.plan
                      .code,
                },
              },
            });

          return {
            credential:
              reactivated,

            changed: true,
          };
        },
      );

    return Response.json(
      {
        message:
          result.changed
            ? "Proxy credential reactivated."
            : "Proxy credential was already active.",

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
    if (
      error instanceof
      CredentialExpiredError ||
      error instanceof
        CustomerUnavailableError ||
      error instanceof
        SubscriptionUnavailableError ||
      error instanceof
        CredentialLimitError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "Failed to reactivate proxy credential:",
      error,
    );

    return Response.json(
      {
        message:
          "The proxy credential could not be reactivated.",
      },
      {
        status: 500,
      },
    );
  }
}
