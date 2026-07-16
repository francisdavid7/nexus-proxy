import {
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireCustomerUser,
} from "@/lib/auth/authorization";

import {
  CustomerHasNoOrganizationError,
  OrganizationNotFoundError,
  OrganizationSelectionRequiredError,
  resolveCustomerOrganization,
} from "@/lib/customer/organization-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateQueryValue = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)),
    {
      message:
        "The date value is invalid.",
    },
  );

const usageQuerySchema = z.object({
  organizationId: z
    .string()
    .uuid()
    .optional(),

  from: dateQueryValue.optional(),
  to: dateQueryValue.optional(),
});

function getCurrentMonthStart(): Date {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1,
    ),
  );
}

function parseDate(
  value: string | undefined,
  fallback: Date,
): Date {
  return value
    ? new Date(value)
    : fallback;
}

function validateDateRange(
  from: Date,
  to: Date,
): string | null {
  if (from >= to) {
    return (
      "`from` must be earlier than `to`."
    );
  }

  const maximumRangeMilliseconds =
    366 * 24 * 60 * 60 * 1000;

  if (
    to.getTime() - from.getTime() >
    maximumRangeMilliseconds
  ) {
    return (
      "The requested usage range cannot exceed 366 days."
    );
  }

  return null;
}

export async function GET(
  request: Request,
): Promise<Response> {
  const authorization =
    await requireCustomerUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const url = new URL(request.url);

  const validation =
    usageQuerySchema.safeParse({
      organizationId:
        url.searchParams.get(
          "organizationId",
        ) ?? undefined,

      from:
        url.searchParams.get("from") ??
        undefined,

      to:
        url.searchParams.get("to") ??
        undefined,
    });

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The usage query is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  try {
    const organization =
      await resolveCustomerOrganization(
        authorization.user.id,
        validation.data.organizationId,
      );

    const now = new Date();

    const activeSubscription =
      await prisma.subscription
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
            currentPeriodStart: true,
            currentPeriodEnd: true,

            plan: {
              select: {
                id: true,
                name: true,
                code: true,
                bandwidthLimitBytes: true,
              },
            },
          },
        });

    const defaultFrom =
      activeSubscription
        ?.currentPeriodStart ??
      getCurrentMonthStart();

    const defaultTo =
      activeSubscription
        ? (
            activeSubscription
              .currentPeriodEnd < now
              ? activeSubscription
                  .currentPeriodEnd
              : now
          )
        : now;

    const from = parseDate(
      validation.data.from,
      defaultFrom,
    );

    const to = parseDate(
      validation.data.to,
      defaultTo,
    );

    const rangeError =
      validateDateRange(from, to);

    if (rangeError) {
      return Response.json(
        {
          message: rangeError,
        },
        {
          status: 400,
        },
      );
    }

    const usageWhere = {
      organizationId:
        organization.id,

      periodStart: {
        lt: to,
      },

      periodEnd: {
        gt: from,
      },
    };

    const [
      totals,
      dailyRecords,
    ] = await prisma.$transaction([
      prisma.usageRecord.aggregate({
        where: usageWhere,

        _sum: {
          bytesUploaded: true,
          bytesDownloaded: true,
          connectionCount: true,
        },
      }),

      prisma.usageRecord.findMany({
        where: usageWhere,

        orderBy: [
          {
            periodStart: "asc",
          },
          {
            createdAt: "asc",
          },
        ],

        select: {
          id: true,
          credentialId: true,
          nodeId: true,
          periodStart: true,
          periodEnd: true,
          bytesUploaded: true,
          bytesDownloaded: true,
          connectionCount: true,
          createdAt: true,
          updatedAt: true,

          credential: {
            select: {
              id: true,
              username: true,
              secretPrefix: true,
              status: true,
            },
          },

          node: {
            select: {
              id: true,
              name: true,
              hostname: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const bytesUploaded =
      totals._sum.bytesUploaded ?? 0n;

    const bytesDownloaded =
      totals._sum.bytesDownloaded ?? 0n;

    const totalBytes =
      bytesUploaded + bytesDownloaded;

    return Response.json(
      {
        organization,

        range: {
          from,
          to,
        },

        subscription:
          activeSubscription
            ? {
                id:
                  activeSubscription.id,

                status:
                  activeSubscription
                    .status,

                currentPeriodStart:
                  activeSubscription
                    .currentPeriodStart,

                currentPeriodEnd:
                  activeSubscription
                    .currentPeriodEnd,

                plan: {
                  id:
                    activeSubscription
                      .plan.id,

                  name:
                    activeSubscription
                      .plan.name,

                  code:
                    activeSubscription
                      .plan.code,

                  bandwidthLimitBytes:
                    activeSubscription
                      .plan
                      .bandwidthLimitBytes
                      ?.toString() ??
                    null,
                },
              }
            : null,

        totals: {
          bytesUploaded:
            bytesUploaded.toString(),

          bytesDownloaded:
            bytesDownloaded.toString(),

          totalBytes:
            totalBytes.toString(),

          connectionCount:
            totals._sum
              .connectionCount ?? 0,
        },

        records:
          dailyRecords.map(
            (record) => ({
              ...record,

              bytesUploaded:
                record.bytesUploaded
                  .toString(),

              bytesDownloaded:
                record.bytesDownloaded
                  .toString(),

              totalBytes:
                (
                  record.bytesUploaded +
                  record.bytesDownloaded
                ).toString(),
            }),
          ),

        generatedAt:
          new Date().toISOString(),
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, max-age=0",

          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    if (
      error instanceof
      OrganizationNotFoundError
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
        CustomerHasNoOrganizationError ||
      error instanceof
        OrganizationSelectionRequiredError
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
      "Failed to load customer usage:",
      error,
    );

    return Response.json(
      {
        message:
          "Your usage information could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
