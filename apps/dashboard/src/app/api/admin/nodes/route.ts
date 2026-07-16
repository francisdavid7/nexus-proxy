import {
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireStaffUser,
} from "@/lib/auth/authorization";

import {
  getNodeStaleCutoff,
} from "@/lib/nodes/settings";

import {
  reconcileStaleNodes,
} from "@/lib/nodes/stale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120)
    .optional(),

  locationCode: z
    .string()
    .trim()
    .max(50)
    .optional(),

  status: z
    .enum([
      "PROVISIONING",
      "ONLINE",
      "DEGRADED",
      "OFFLINE",
      "MAINTENANCE",
    ])
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
    nodeQuerySchema.safeParse({
      search:
        url.searchParams.get("search") ??
        undefined,

      locationCode:
        url.searchParams.get(
          "locationCode",
        ) ?? undefined,

      status:
        url.searchParams.get("status") ??
        undefined,
    });

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The node query is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  try {
    const reconciled =
      await reconcileStaleNodes();

    const nodes =
      await prisma.proxyNode.findMany({
        where: {
          ...(validation.data.status
            ? {
                status:
                  validation.data.status,
              }
            : {}),

          ...(validation.data.locationCode
            ? {
                location: {
                  code:
                    validation.data
                      .locationCode,
                },
              }
            : {}),

          ...(validation.data.search
            ? {
                OR: [
                  {
                    name: {
                      contains:
                        validation.data
                          .search,

                      mode:
                        "insensitive",
                    },
                  },
                  {
                    hostname: {
                      contains:
                        validation.data
                          .search,

                      mode:
                        "insensitive",
                    },
                  },
                  {
                    publicIp: {
                      contains:
                        validation.data
                          .search,
                    },
                  },
                ],
              }
            : {}),
        },

        orderBy: [
          {
            location: {
              country: "asc",
            },
          },
          {
            location: {
              city: "asc",
            },
          },
          {
            name: "asc",
          },
        ],

        take: 200,

        select: {
          id: true,
          name: true,
          hostname: true,
          publicIp: true,
          httpPort: true,
          tlsPort: true,
          socksPort: true,
          protocols: true,
          status: true,
          maxConnections: true,
          activeConnections: true,
          version: true,
          lastHeartbeatAt: true,
          createdAt: true,
          updatedAt: true,

          location: {
            select: {
              id: true,
              code: true,
              countryCode: true,
              country: true,
              city: true,
              region: true,
              active: true,
            },
          },

          agentKeys: {
            orderBy: {
              createdAt: "desc",
            },

            select: {
              id: true,
              keyId: true,
              status: true,
              lastUsedAt: true,
              revokedAt: true,
              createdAt: true,
            },
          },
        },
      });

    const cutoff =
      getNodeStaleCutoff();

    return Response.json(
      {
        nodes: nodes.map((node) => ({
          ...node,

          heartbeatFresh:
            node.lastHeartbeatAt !==
              null &&
            node.lastHeartbeatAt >=
              cutoff,

          capacity: {
            active:
              node.activeConnections,

            maximum:
              node.maxConnections,

            available:
              Math.max(
                node.maxConnections -
                  node.activeConnections,
                0,
              ),

            usedPercentage:
              node.maxConnections > 0
                ? Number(
                    (
                      (
                        node.activeConnections /
                        node.maxConnections
                      ) *
                      100
                    ).toFixed(2),
                  )
                : null,
          },

          activeAgentKeys:
            node.agentKeys.filter(
              (key) =>
                key.status ===
                "ACTIVE",
            ).length,
        })),

        reconciliation: {
          nodesMarkedOffline:
            reconciled,
        },

        generatedAt:
          new Date().toISOString(),
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
      "Failed to load proxy nodes:",
      error,
    );

    return Response.json(
      {
        message:
          "The proxy nodes could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
