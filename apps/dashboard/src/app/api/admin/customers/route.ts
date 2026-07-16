import {
  createHmac,
} from "node:crypto";

import {
  Prisma,
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireAdministrator,
} from "@/lib/auth/authorization";

import {
  hashPassword,
} from "@/lib/auth/password";

import {
  createOrganizationSlug,
} from "@/lib/organizations/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class CustomerAlreadyExistsError
  extends Error {}

class PlanUnavailableError
  extends Error {}

const createCustomerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2)
      .max(120),

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
      .min(12)
      .max(128)
      .regex(
        /[a-z]/,
        "Password must contain a lowercase letter.",
      )
      .regex(
        /[A-Z]/,
        "Password must contain an uppercase letter.",
      )
      .regex(
        /\d/,
        "Password must contain a number.",
      )
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain a special character.",
      ),

    organizationName: z
      .string()
      .trim()
      .min(2)
      .max(120),

    planCode: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .transform((value) =>
        value.toLowerCase(),
      ),

    accountStatus: z
      .enum([
        "PENDING_VERIFICATION",
        "ACTIVE",
      ])
      .default("PENDING_VERIFICATION"),

    markEmailVerified: z
      .boolean()
      .default(false),

    subscriptionStatus: z
      .enum([
        "TRIAL",
        "ACTIVE",
      ])
      .default("TRIAL"),

    periodDays: z
      .number()
      .int()
      .min(1)
      .max(366)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.markEmailVerified &&
      value.accountStatus !== "ACTIVE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["markEmailVerified"],
        message:
          "A verified customer account must be active.",
      });
    }
  });

function createPeriodEnd(
  periodStart: Date,
  periodDays: number,
): Date {
  const periodEnd = new Date(periodStart);

  periodEnd.setUTCDate(
    periodEnd.getUTCDate() + periodDays,
  );

  return periodEnd;
}

function getClientAddress(
  request: Request,
): string | null {
  const forwardedFor =
    request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstAddress =
      forwardedFor.split(",")[0]?.trim();

    if (firstAddress) {
      return firstAddress;
    }
  }

  return (
    request.headers
      .get("x-real-ip")
      ?.trim() || null
  );
}

function createIpDigest(
  request: Request,
): string | null {
  const pepper =
    process.env.AUDIT_IP_PEPPER?.trim();

  const clientAddress =
    getClientAddress(request);

  if (!pepper || !clientAddress) {
    return null;
  }

  return createHmac(
    "sha256",
    pepper,
  )
    .update(clientAddress)
    .digest("hex");
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

export async function POST(
  request: Request,
): Promise<Response> {
  const authorization =
    await requireAdministrator();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const requestBody = await request
    .json()
    .catch(() => null);

  const validation =
    createCustomerSchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The customer information is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  const input = validation.data;

  /*
   * Password hashing is deliberately done before
   * opening the database transaction because
   * scrypt is CPU intensive.
   */
  const passwordHash =
    await hashPassword(input.password);

  const ipDigest =
    createIpDigest(request);

  const currentPeriodStart =
    new Date();

  const periodDays =
    input.periodDays ??
    (
      input.subscriptionStatus === "TRIAL"
        ? 14
        : 30
    );

  const currentPeriodEnd =
    createPeriodEnd(
      currentPeriodStart,
      periodDays,
    );

  try {
    const result =
      await prisma.$transaction(
        async (transaction) => {
          const existingUser =
            await transaction.user.findUnique({
              where: {
                email: input.email,
              },

              select: {
                id: true,
              },
            });

          if (existingUser) {
            throw new CustomerAlreadyExistsError(
              "A customer with this email already exists.",
            );
          }

          const plan =
            await transaction.plan.findFirst({
              where: {
                code: input.planCode,
                active: true,
              },

              select: {
                id: true,
                name: true,
                code: true,
                monthlyPriceCents: true,
                bandwidthLimitBytes: true,
                deviceLimit: true,
                credentialLimit: true,
                maxConcurrentConnections: true,
                connectionsPerMinute: true,
              },
            });

          if (!plan) {
            throw new PlanUnavailableError(
              "The selected plan does not exist or is inactive.",
            );
          }

          let organizationSlug =
            createOrganizationSlug(
              input.organizationName,
            );

          /*
           * The random suffix makes a collision
           * extremely unlikely. This loop also
           * handles pre-existing slug collisions.
           */
          for (
            let attempt = 0;
            attempt < 5;
            attempt += 1
          ) {
            const existingOrganization =
              await transaction.organization
                .findUnique({
                  where: {
                    slug:
                      organizationSlug,
                  },

                  select: {
                    id: true,
                  },
                });

            if (!existingOrganization) {
              break;
            }

            organizationSlug =
              createOrganizationSlug(
                input.organizationName,
              );

            if (attempt === 4) {
              throw new Error(
                "Unable to generate a unique organization slug.",
              );
            }
          }

          const user =
            await transaction.user.create({
              data: {
                fullName: input.fullName,
                email: input.email,
                passwordHash,
                role: "CUSTOMER",
                status:
                  input.accountStatus,

                emailVerifiedAt:
                  input.markEmailVerified
                    ? new Date()
                    : null,
              },

              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                status: true,
                emailVerifiedAt: true,
                createdAt: true,
              },
            });

          const organization =
            await transaction.organization
              .create({
                data: {
                  name:
                    input.organizationName,

                  slug:
                    organizationSlug,

                  ownerId:
                    user.id,
                },

                select: {
                  id: true,
                  name: true,
                  slug: true,
                  ownerId: true,
                  createdAt: true,
                },
              });

          const membership =
            await transaction
              .organizationMember.create({
                data: {
                  organizationId:
                    organization.id,

                  userId:
                    user.id,

                  role:
                    "OWNER",
                },

                select: {
                  id: true,
                  role: true,
                  createdAt: true,
                },
              });

          const subscription =
            await transaction.subscription
              .create({
                data: {
                  organizationId:
                    organization.id,

                  planId:
                    plan.id,

                  status:
                    input.subscriptionStatus,

                  currentPeriodStart,
                  currentPeriodEnd,
                },

                select: {
                  id: true,
                  status: true,
                  currentPeriodStart: true,
                  currentPeriodEnd: true,
                  createdAt: true,
                },
              });

          await transaction.auditLog.create({
            data: {
              organizationId:
                organization.id,

              actorUserId:
                authorization.user.id,

              action:
                "customer.created",

              resourceType:
                "User",

              resourceId:
                user.id,

              ipDigest,

              metadata: {
                customerEmail:
                  user.email,

                organizationId:
                  organization.id,

                organizationSlug:
                  organization.slug,

                membershipId:
                  membership.id,

                subscriptionId:
                  subscription.id,

                planCode:
                  plan.code,

                accountStatus:
                  user.status,

                subscriptionStatus:
                  subscription.status,

                emailMarkedVerified:
                  input.markEmailVerified,
              },
            },
          });

          return {
            user,
            organization,
            membership,
            subscription,

            plan: {
              id: plan.id,
              name: plan.name,
              code: plan.code,

              monthlyPriceCents:
                plan.monthlyPriceCents,

              bandwidthLimitBytes:
                plan.bandwidthLimitBytes
                  ?.toString() ?? null,

              deviceLimit:
                plan.deviceLimit,

              credentialLimit:
                plan.credentialLimit,

              maxConcurrentConnections:
                plan.maxConcurrentConnections,

              connectionsPerMinute:
                plan.connectionsPerMinute,
            },
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel
              .Serializable,

          maxWait: 5_000,
          timeout: 15_000,
        },
      );

    return Response.json(
      {
        message:
          "Customer created successfully.",

        customer:
          result.user,

        organization:
          result.organization,

        membership:
          result.membership,

        subscription:
          result.subscription,

        plan:
          result.plan,
      },
      {
        status: 201,

        headers: {
          "Cache-Control":
            "no-store, max-age=0",

          Location:
            `/api/admin/customers/${result.user.id}`,
        },
      },
    );
  } catch (error) {
    if (
      error instanceof
      CustomerAlreadyExistsError
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
      PlanUnavailableError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: 400,
        },
      );
    }

    if (isUniqueConstraintError(error)) {
      return Response.json(
        {
          message:
            "A customer or organization with conflicting information already exists.",
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "Failed to create customer:",
      error,
    );

    return Response.json(
      {
        message:
          "The customer could not be created.",
      },
      {
        status: 500,
      },
    );
  }
}
