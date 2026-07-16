import {
  OrganizationRole,
  Prisma,
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireCustomerUser,
} from "@/lib/auth/authorization";

import {
  decodeConnectionCursor,
  encodeConnectionCursor,
  InvalidConnectionCursorError,
} from "@/lib/connections/cursor";

import {
  CustomerHasNoOrganizationError,
  OrganizationNotFoundError,
  OrganizationSelectionRequiredError,
  resolveCustomerOrganization,
} from "@/lib/customer/organization-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateValueSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !Number.isNaN(
        Date.parse(value),
      ),
    {
      message:
        "The date value is invalid.",
    },
  );

const connectionQuerySchema =
  z.object({
    organizationId: z
      .string()
      .uuid()
      .optional(),

    cursor: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional(),

    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25),

    credentialId: z
      .string()
      .uuid()
      .optional(),

    nodeId: z
      .string()
      .uuid()
      .optional(),

    protocol: z
      .enum([
        "HTTP",
        "HTTPS",
        "SOCKS5",
      ])
      .optional(),

    status: z
      .enum([
        "ACTIVE",
        "CLOSED",
        "FAILED",
      ])
      .optional(),

    from:
      dateValueSchema.optional(),

    to:
      dateValueSchema.optional(),
  });

function createDefaultFromDate(
  to: Date,
): Date {
  return new Date(
    to.getTime() -
      30 * 24 * 60 * 60 * 1000,
  );
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

  const maximumRange =
    366 * 24 * 60 * 60 * 1000;

  if (
    to.getTime() - from.getTime() >
    maximumRange
  ) {
    return (
      "The requested connection range cannot exceed 366 days."
    );
  }

  return null;
}

function calculateDurationSeconds(
  startedAt: Date,
  endedAt: Date | null,
  now: Date,
): number {
  const effectiveEnd =
    endedAt ?? now;

  return Math.max(
    0,
    Math.floor(
      (
        effectiveEnd.getTime() -
        startedAt.getTime()
      ) / 1000,
    ),
  );
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
    connectionQuerySchema.safeParse({
      organizationId:
        url.searchParams.get(
          "organizationId",
        ) ?? undefined,

      cursor:
        url.searchParams.get(
          "cursor",
        ) ?? undefined,

      limit:
        url.searchParams.get(
          "limit",
        ) ?? undefined,

      credentialId:
        url.searchParams.get(
          "credentialId",
        ) ?? undefined,

      nodeId:
        url.searchParams.get(
          "nodeId",
        ) ?? undefined,

      protocol:
        url.searchParams.get(
          "protocol",
        ) ?? undefined,

      status:
        url.searchParams.get(
          "status",
        ) ?? undefined,

      from:
        url.searchParams.get(
          "from",
        ) ?? undefined,

      to:
        url.searchParams.get(
          "to",
        ) ?? undefined,
    });

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The connection-history query is invalid.",

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

    const to = validation.data.to
      ? new Date(validation.data.to)
      : now;

    const from = validation.data.from
      ? new Date(validation.data.from)
      : createDefaultFromDate(to);

    const dateRangeError =
      validateDateRange(from, to);

    if (dateRangeError) {
      return Response.json(
        {
          message: dateRangeError,
        },
        {
          status: 400,
        },
      );
    }

    const cursor =
      validation.data.cursor
        ? decodeConnectionCursor(
            validation.data.cursor,
          )
        : null;

    const filters:
      Prisma.ConnectionSessionWhereInput[] =
      [
        {
          organizationId:
            organization.id,

          startedAt: {
            gte: from,
            lt: to,
          },
        },
      ];

    /*
     * Regular organization members may see
     * only their own sessions. Owners and
     * organization administrators may see
     * organization-wide connection history.
     */
    if (
      organization.accessRole ===
      OrganizationRole.MEMBER
    ) {
      filters.push({
        userId:
          authorization.user.id,
      });
    }

    if (
      validation.data.credentialId
    ) {
      filters.push({
        credentialId:
          validation.data
            .credentialId,
      });
    }

    if (validation.data.nodeId) {
      filters.push({
        nodeId:
          validation.data.nodeId,
      });
    }

    if (validation.data.protocol) {
      filters.push({
        protocol:
          validation.data.protocol,
      });
    }

    if (validation.data.status) {
      filters.push({
        status:
          validation.data.status,
      });
    }

    if (cursor) {
      filters.push({
        OR: [
          {
            startedAt: {
              lt: cursor.startedAt,
            },
          },
          {
            startedAt:
              cursor.startedAt,

            id: {
              lt: cursor.id,
            },
          },
        ],
      });
    }

    const records =
      await prisma.connectionSession
        .findMany({
          where: {
            AND: filters,
          },

          orderBy: [
            {
              startedAt: "desc",
            },
            {
              id: "desc",
            },
          ],

          take:
            validation.data.limit + 1,

          select: {
            id: true,
            protocol: true,
            status: true,
            bytesUploaded: true,
            bytesDownloaded: true,
            startedAt: true,
            endedAt: true,

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
                status: true,

                location: {
                  select: {
                    id: true,
                    code: true,
                    countryCode: true,
                    country: true,
                    city: true,
                    region: true,
                  },
                },
              },
            },
          },
        });

    const hasMore =
      records.length >
      validation.data.limit;

    const pageRecords = hasMore
      ? records.slice(
          0,
          validation.data.limit,
        )
      : records;

    const finalRecord =
      pageRecords[
        pageRecords.length - 1
      ];

    const nextCursor =
      hasMore && finalRecord
        ? encodeConnectionCursor({
            id: finalRecord.id,
            startedAt:
              finalRecord.startedAt,
          })
        : null;

    return Response.json(
      {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,

          accessRole:
            organization.accessRole,
        },

        range: {
          from,
          to,
        },

        filters: {
          credentialId:
            validation.data
              .credentialId ?? null,

          nodeId:
            validation.data
              .nodeId ?? null,

          protocol:
            validation.data
              .protocol ?? null,

          status:
            validation.data
              .status ?? null,
        },

        connections:
          pageRecords.map(
            (record) => {
              const totalBytes =
                record.bytesUploaded +
                record.bytesDownloaded;

              return {
                id: record.id,
                protocol:
                  record.protocol,
                status:
                  record.status,

                startedAt:
                  record.startedAt,

                endedAt:
                  record.endedAt,

                durationSeconds:
                  calculateDurationSeconds(
                    record.startedAt,
                    record.endedAt,
                    now,
                  ),

                traffic: {
                  bytesUploaded:
                    record
                      .bytesUploaded
                      .toString(),

                  bytesDownloaded:
                    record
                      .bytesDownloaded
                      .toString(),

                  totalBytes:
                    totalBytes.toString(),
                },

                credential:
                  record.credential,

                node: {
                  id:
                    record.node.id,

                  status:
                    record.node.status,

                  location:
                    record.node.location,
                },
              };
            },
          ),

        pagination: {
          limit:
            validation.data.limit,

          hasMore,
          nextCursor,
        },

        privacy: {
          sourceIpExposed: false,

          destinationDataStored:
            false,

          internalNodeHostnameExposed:
            false,

          nodePublicIpExposed:
            false,
        },

        generatedAt:
          now.toISOString(),
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
      InvalidConnectionCursorError
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
      "Failed to load connection history:",
      error,
    );

    return Response.json(
      {
        message:
          "Your connection history could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
