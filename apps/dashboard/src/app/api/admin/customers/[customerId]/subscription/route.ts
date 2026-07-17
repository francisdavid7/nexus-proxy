import {
  SubscriptionStatus,
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

const assignSubscriptionSchema =
  z.object({
    action: z.literal("ASSIGN"),

    organizationId: z
      .string()
      .uuid(),

    planId: z
      .string()
      .uuid(),

    status: z
      .enum([
        "TRIAL",
        "ACTIVE",
      ])
      .default("ACTIVE"),

    periodDays: z
      .number()
      .int()
      .min(1)
      .max(366)
      .default(30),
  });

const cancelSubscriptionSchema =
  z.object({
    action: z.literal("CANCEL"),

    organizationId: z
      .string()
      .uuid(),
  });

const subscriptionActionSchema =
  z.discriminatedUnion(
    "action",
    [
      assignSubscriptionSchema,
      cancelSubscriptionSchema,
    ],
  );

export async function PATCH(
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
    subscriptionActionSchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The subscription request is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  try {
    const result =
      await runSerializableTransaction(
        async (transaction) => {
          const customer =
            await transaction.user
              .findFirst({
                where: {
                  id:
                    customerIdValidation
                      .data,

                  role: "CUSTOMER",
                },

                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              });

          if (!customer) {
            return {
              outcome:
                "CUSTOMER_NOT_FOUND" as const,
            };
          }

          const organization =
            await transaction.organization
              .findFirst({
                where: {
                  id:
                    validation.data
                      .organizationId,

                  ownerId:
                    customer.id,
                },

                select: {
                  id: true,
                  name: true,
                },
              });

          if (!organization) {
            return {
              outcome:
                "ORGANIZATION_NOT_FOUND" as const,
            };
          }

          const now = new Date();

          if (
            validation.data.action ===
            "CANCEL"
          ) {
            const canceled =
              await transaction.subscription
                .updateMany({
                  where: {
                    organizationId:
                      organization.id,

                    status: {
                      in: [
                        SubscriptionStatus.TRIAL,
                        SubscriptionStatus.ACTIVE,
                      ],
                    },
                  },

                  data: {
                    status:
                      SubscriptionStatus.CANCELED,

                    canceledAt: now,

                    currentPeriodEnd:
                      now,
                  },
                });

            await transaction.auditLog
              .create({
                data: {
                  organizationId:
                    organization.id,

                  actorUserId:
                    authorization.user.id,

                  action:
                    "subscription.canceled",

                  resourceType:
                    "Organization",

                  resourceId:
                    organization.id,

                  ipDigest:
                    createAuditIpDigest(
                      request,
                    ),

                  metadata: {
                    customerId:
                      customer.id,

                    organizationName:
                      organization.name,

                    subscriptionsCanceled:
                      canceled.count,
                  },
                },
              });

            return {
              outcome:
                "CANCELED" as const,

              canceledCount:
                canceled.count,
            };
          }

          const plan =
            await transaction.plan
              .findFirst({
                where: {
                  id:
                    validation.data
                      .planId,

                  active: true,
                },

                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              });

          if (!plan) {
            return {
              outcome:
                "PLAN_NOT_FOUND" as const,
            };
          }

          await transaction.subscription
            .updateMany({
              where: {
                organizationId:
                  organization.id,

                status: {
                  in: [
                    SubscriptionStatus.TRIAL,
                    SubscriptionStatus.ACTIVE,
                  ],
                },
              },

              data: {
                status:
                  SubscriptionStatus.CANCELED,

                canceledAt: now,

                currentPeriodEnd:
                  now,
              },
            });

          const periodEnd =
            new Date(
              now.getTime() +
                validation.data
                  .periodDays *
                  24 *
                  60 *
                  60 *
                  1000,
            );

          const status =
            validation.data.status ===
            "TRIAL"
              ? SubscriptionStatus.TRIAL
              : SubscriptionStatus.ACTIVE;

          const subscription =
            await transaction.subscription
              .create({
                data: {
                  organizationId:
                    organization.id,

                  planId:
                    plan.id,

                  status,

                  currentPeriodStart:
                    now,

                  currentPeriodEnd:
                    periodEnd,
                },

                select: {
                  id: true,
                  status: true,
                  currentPeriodStart: true,
                  currentPeriodEnd: true,

                  plan: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              });

          await transaction.auditLog
            .create({
              data: {
                organizationId:
                  organization.id,

                actorUserId:
                  authorization.user.id,

                action:
                  "subscription.assigned",

                resourceType:
                  "Subscription",

                resourceId:
                  subscription.id,

                ipDigest:
                  createAuditIpDigest(
                    request,
                  ),

                metadata: {
                  customerId:
                    customer.id,

                  organizationName:
                    organization.name,

                  planId:
                    plan.id,

                  planCode:
                    plan.code,

                  status,

                  periodDays:
                    validation.data
                      .periodDays,
                },
              },
            });

          return {
            outcome:
              "ASSIGNED" as const,

            subscription,
          };
        },
      );

    switch (result.outcome) {
      case "CUSTOMER_NOT_FOUND":
        return Response.json(
          {
            message:
              "The customer was not found.",
          },
          {
            status: 404,
          },
        );

      case "ORGANIZATION_NOT_FOUND":
        return Response.json(
          {
            message:
              "The customer organization was not found.",
          },
          {
            status: 404,
          },
        );

      case "PLAN_NOT_FOUND":
        return Response.json(
          {
            message:
              "The selected plan was not found or is inactive.",
          },
          {
            status: 404,
          },
        );

      case "CANCELED":
        return Response.json(
          {
            message:
              "The subscription was canceled.",

            canceledCount:
              result.canceledCount,
          },
          {
            status: 200,
          },
        );

      case "ASSIGNED":
        return Response.json(
          {
            message:
              "The subscription was assigned.",

            subscription:
              result.subscription,
          },
          {
            status: 200,
          },
        );
    }
  } catch (error) {
    console.error(
      "Subscription update failed:",
      error,
    );

    return Response.json(
      {
        message:
          "The subscription could not be updated.",
      },
      {
        status: 500,
      },
    );
  }
}
