import {
  Prisma,
  ProxyProtocol,
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
  createProxyCredentialMaterial,
} from "@/lib/proxy-credentials/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class CustomerUnavailableError
  extends Error {}

class OrganizationUnavailableError
  extends Error {}

class OrganizationSelectionError
  extends Error {}

class SubscriptionUnavailableError
  extends Error {}

class CredentialLimitError
  extends Error {}

const createCredentialSchema =
  z.object({
    organizationId: z
      .string()
      .uuid()
      .optional(),

    allowedProtocols: z
      .array(
        z.enum([
          "HTTP",
          "HTTPS",
        ]),
      )
      .min(1)
      .max(2)
      .default([
        "HTTP",
        "HTTPS",
      ])
      .transform((protocols) =>
        [...new Set(protocols)],
      ),

    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(366)
      .optional(),
  });

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

function createExpirationDate(
  expiresInDays:
    | number
    | undefined,
): Date | null {
  if (!expiresInDays) {
    return null;
  }

  const expiresAt = new Date();

  expiresAt.setUTCDate(
    expiresAt.getUTCDate() +
      expiresInDays,
  );

  return expiresAt;
}

function isUniqueConstraintError(
  error: unknown,
): boolean {
  return (
    error instanceof
      Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function createCredential(
  customerId: string,
  organizationId:
    | string
    | undefined,
  protocolNames:
    Array<"HTTP" | "HTTPS">,
  expiresAt: Date | null,
  actorUserId: string,
  ipDigest: string | null,
) {
  return runSerializableTransaction(
    async (transaction) => {
      const now = new Date();

      const customer =
        await transaction.user.findUnique({
          where: {
            id: customerId,
          },

          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
          },
        });

      if (
        !customer ||
        customer.role !== "CUSTOMER" ||
        customer.status !== "ACTIVE" ||
        !customer.emailVerifiedAt
      ) {
        throw new CustomerUnavailableError(
          "The customer must be active and email-verified.",
        );
      }

      let organization:
        | {
            id: string;
            name: string;
            slug: string;
          }
        | null = null;

      if (organizationId) {
        organization =
          await transaction.organization
            .findFirst({
              where: {
                id: organizationId,
                ownerId: customer.id,
              },

              select: {
                id: true,
                name: true,
                slug: true,
              },
            });

        if (!organization) {
          throw new OrganizationUnavailableError(
            "The organization does not belong to this customer.",
          );
        }
      } else {
        const organizations =
          await transaction.organization
            .findMany({
              where: {
                ownerId: customer.id,
              },

              select: {
                id: true,
                name: true,
                slug: true,
              },

              orderBy: {
                createdAt: "asc",
              },

              take: 2,
            });

        if (organizations.length === 0) {
          throw new OrganizationUnavailableError(
            "The customer has no organization.",
          );
        }

        if (organizations.length > 1) {
          throw new OrganizationSelectionError(
            "organizationId is required because the customer owns multiple organizations.",
          );
        }

        organization =
          organizations[0] ?? null;
      }

      if (!organization) {
        throw new OrganizationUnavailableError(
          "The customer organization could not be resolved.",
        );
      }

      const subscription =
        await transaction.subscription
          .findFirst({
            where: {
              organizationId:
                organization.id,

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
              currentPeriodEnd: "desc",
            },

            select: {
              id: true,
              status: true,
              currentPeriodEnd: true,

              plan: {
                select: {
                  id: true,
                  name: true,
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

      await transaction.proxyCredential
        .updateMany({
          where: {
            organizationId:
              organization.id,

            status: "ACTIVE",

            expiresAt: {
              lte: now,
            },
          },

          data: {
            status: "EXPIRED",
          },
        });

      const activeCredentialCount =
        await transaction.proxyCredential
          .count({
            where: {
              organizationId:
                organization.id,

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
        activeCredentialCount >=
        subscription.plan.credentialLimit
      ) {
        throw new CredentialLimitError(
          `The ${subscription.plan.name} plan allows only ${subscription.plan.credentialLimit} active proxy credential(s).`,
        );
      }

      const material =
        createProxyCredentialMaterial(
          organization.slug,
        );

      const protocolMap = {
        HTTP: ProxyProtocol.HTTP,
        HTTPS: ProxyProtocol.HTTPS,
      } as const;

      const allowedProtocols =
        protocolNames.map(
          (protocol) =>
            protocolMap[protocol],
        );

      const credential =
        await transaction.proxyCredential
          .create({
            data: {
              organizationId:
                organization.id,

              userId:
                customer.id,

              username:
                material.username,

              secretDigest:
                material.secretDigest,

              secretPrefix:
                material.secretPrefix,

              status:
                "ACTIVE",

              allowedProtocols,
              expiresAt,
            },

            select: {
              id: true,
              organizationId: true,
              userId: true,
              username: true,
              secretPrefix: true,
              status: true,
              allowedProtocols: true,
              expiresAt: true,
              createdAt: true,
            },
          });

      await transaction.auditLog.create({
        data: {
          organizationId:
            organization.id,

          actorUserId,

          action:
            "proxy_credential.created",

          resourceType:
            "ProxyCredential",

          resourceId:
            credential.id,

          ipDigest,

          metadata: {
            customerId:
              customer.id,

            customerEmail:
              customer.email,

            username:
              credential.username,

            secretPrefix:
              credential.secretPrefix,

            allowedProtocols:
              credential.allowedProtocols,

            expiresAt:
              credential.expiresAt
                ?.toISOString() ?? null,

            subscriptionId:
              subscription.id,

            planCode:
              subscription.plan.code,
          },
        },
      });

      return {
        credential,
        secret: material.secret,

        customer: {
          id: customer.id,
          fullName:
            customer.fullName,
          email: customer.email,
        },

        organization,

        plan: {
          id:
            subscription.plan.id,

          name:
            subscription.plan.name,

          code:
            subscription.plan.code,

          credentialLimit:
            subscription.plan
              .credentialLimit,

          activeCredentials:
            activeCredentialCount + 1,
        },
      };
    },
  );
}

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
    customerId,
  } = await context.params;

  const customerIdValidation =
    z.string()
      .uuid()
      .safeParse(customerId);

  if (!customerIdValidation.success) {
    return Response.json(
      {
        message:
          "The customer ID is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  const requestBody = await request
    .json()
    .catch(() => null);

  const validation =
    createCredentialSchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The credential configuration is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  const expiresAt =
    createExpirationDate(
      validation.data.expiresInDays,
    );

  try {
    let result:
      Awaited<
        ReturnType<
          typeof createCredential
        >
      >
      | undefined;

    for (
      let attempt = 1;
      attempt <= 3;
      attempt += 1
    ) {
      try {
        result =
          await createCredential(
            customerIdValidation.data,
            validation.data
              .organizationId,

            validation.data
              .allowedProtocols,

            expiresAt,

            authorization.user.id,

            createAuditIpDigest(
              request,
            ),
          );

        break;
      } catch (error) {
        if (
          !isUniqueConstraintError(
            error,
          ) ||
          attempt === 3
        ) {
          throw error;
        }
      }
    }

    if (!result) {
      throw new Error(
        "Credential generation failed.",
      );
    }

    return Response.json(
      {
        message:
          "Proxy credential created successfully.",

        warning:
          "The proxy secret is displayed only once. Store it securely now.",

        credential: {
          ...result.credential,

          /*
           * Never stored in plaintext.
           * Never returned again.
           */
          secret:
            result.secret,
        },

        customer:
          result.customer,

        organization:
          result.organization,

        plan:
          result.plan,
      },
      {
        status: 201,

        headers: {
          "Cache-Control":
            "no-store, no-cache, max-age=0",

          Pragma: "no-cache",

          Location:
            `/api/admin/credentials/${result.credential.id}`,
        },
      },
    );
  } catch (error) {
    if (
      error instanceof
      CustomerUnavailableError
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

    if (
      error instanceof
      OrganizationUnavailableError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof
      OrganizationSelectionError ||
      error instanceof
        SubscriptionUnavailableError
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

    if (
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
      "Failed to create proxy credential:",
      error,
    );

    return Response.json(
      {
        message:
          "The proxy credential could not be created.",
      },
      {
        status: 500,
      },
    );
  }
}
