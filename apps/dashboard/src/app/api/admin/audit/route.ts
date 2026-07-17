import {
  Prisma,
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireStaffUser,
} from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const auditQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30),

  action: z
    .string()
    .trim()
    .max(150)
    .optional(),

  resourceType: z
    .string()
    .trim()
    .max(100)
    .optional(),
});

export async function GET(
  request: Request,
): Promise<Response> {
  const authorization =
    await requireStaffUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const url = new URL(request.url);

  const validation =
    auditQuerySchema.safeParse({
      page:
        url.searchParams.get("page") ??
        undefined,

      limit:
        url.searchParams.get("limit") ??
        undefined,

      action:
        url.searchParams.get("action") ??
        undefined,

      resourceType:
        url.searchParams.get(
          "resourceType",
        ) ?? undefined,
    });

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The audit query is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  const {
    page,
    limit,
    action,
    resourceType,
  } = validation.data;

  const skip =
    (page - 1) * limit;

  const where:
    Prisma.AuditLogWhereInput = {
    ...(action
      ? {
          action: {
            contains: action,
            mode: "insensitive",
          },
        }
      : {}),

    ...(resourceType
      ? {
          resourceType: {
            contains:
              resourceType,

            mode: "insensitive",
          },
        }
      : {}),
  };

  try {
    const [
      totalItems,
      auditLogs,
    ] = await prisma.$transaction([
      prisma.auditLog.count({
        where,
      }),

      prisma.auditLog.findMany({
        where,

        orderBy: {
          createdAt: "desc",
        },

        skip,
        take: limit,

        select: {
          id: true,
          organizationId: true,
          actorUserId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    const actorIds = [
      ...new Set(
        auditLogs
          .map(
            (record) =>
              record.actorUserId,
          )
          .filter(
            (
              actorId,
            ): actorId is string =>
              Boolean(actorId),
          ),
      ),
    ];

    const actors =
      actorIds.length > 0
        ? await prisma.user.findMany({
            where: {
              id: {
                in: actorIds,
              },
            },

            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          })
        : [];

    const actorMap = new Map(
      actors.map((actor) => [
        actor.id,
        actor,
      ]),
    );

    return Response.json(
      {
        records: auditLogs.map(
          (record) => ({
            ...record,

            actor:
              record.actorUserId
                ? actorMap.get(
                    record.actorUserId,
                  ) ?? null
                : null,
          }),
        ),

        pagination: {
          page,
          limit,
          totalItems,

          totalPages:
            Math.ceil(
              totalItems / limit,
            ),

          hasPreviousPage:
            page > 1,

          hasNextPage:
            skip +
              auditLogs.length <
            totalItems,
        },
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
    console.error(
      "Failed to load audit records:",
      error,
    );

    return Response.json(
      {
        message:
          "The audit records could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
