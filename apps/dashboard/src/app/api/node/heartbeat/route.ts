import {
  NodeStatus,
  Prisma,
  ProxyProtocol,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  runSerializableTransaction,
} from "@/lib/database/transaction";

import {
  authenticateNodeAgentRequest,
  NodeAgentAuthenticationError,
} from "@/lib/nodes/agent-auth";

import {
  getNodeDegradedThreshold,
} from "@/lib/nodes/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const percentageValue = z
  .number()
  .min(0)
  .max(100)
  .nullable()
  .default(null);

const heartbeatSchema = z.object({
  nodeId: z.string().uuid(),

  version: z
    .string()
    .trim()
    .min(1)
    .max(50),

  protocols: z
    .array(
      z.enum([
        "HTTP",
        "HTTPS",
      ]),
    )
    .min(1)
    .max(2)
    .transform((values) =>
      [...new Set(values)],
    ),

  reportedMaxConnections: z
    .number()
    .int()
    .min(1)
    .max(1_000_000),

  system: z
    .object({
      cpuPercent:
        percentageValue,

      memoryPercent:
        percentageValue,

      diskPercent:
        percentageValue,

      uptimeSeconds: z
        .number()
        .int()
        .min(0)
        .nullable()
        .default(null),
    })
    .default({
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      uptimeSeconds: null,
    }),
});

function isMetricDegraded(
  value: number | null,
  threshold: number,
): boolean {
  return (
    value !== null &&
    value >= threshold
  );
}

function selectStatus(
  currentStatus: NodeStatus,
  activeConnections: number,
  maxConnections: number,
  system: {
    cpuPercent: number | null;
    memoryPercent: number | null;
    diskPercent: number | null;
  },
): NodeStatus {
  if (
    currentStatus ===
    NodeStatus.MAINTENANCE
  ) {
    return NodeStatus.MAINTENANCE;
  }

  const threshold =
    getNodeDegradedThreshold();

  const capacityExceeded =
    maxConnections > 0 &&
    activeConnections >=
      maxConnections;

  const unhealthy =
    capacityExceeded ||
    isMetricDegraded(
      system.cpuPercent,
      threshold,
    ) ||
    isMetricDegraded(
      system.memoryPercent,
      threshold,
    ) ||
    isMetricDegraded(
      system.diskPercent,
      threshold,
    );

  return unhealthy
    ? NodeStatus.DEGRADED
    : NodeStatus.ONLINE;
}

export async function POST(
  request: Request,
): Promise<Response> {
  const bodyText = await request.text();

  if (bodyText.length > 32_768) {
    return Response.json(
      {
        message:
          "Heartbeat payload is too large.",
      },
      {
        status: 413,
      },
    );
  }

  let authenticatedAgent;

  try {
    authenticatedAgent =
      await authenticateNodeAgentRequest(
        request,
        bodyText,
      );
  } catch (error) {
    if (
      error instanceof
      NodeAgentAuthenticationError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error(
      "Unexpected node authentication error:",
      error,
    );

    return Response.json(
      {
        message:
          "Node authentication failed.",
      },
      {
        status: 500,
      },
    );
  }

  let requestBody: unknown;

  try {
    requestBody =
      JSON.parse(bodyText);
  } catch {
    return Response.json(
      {
        message:
          "The heartbeat payload is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  const validation =
    heartbeatSchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The heartbeat payload is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  if (
    validation.data.nodeId !==
    authenticatedAgent.nodeId
  ) {
    return Response.json(
      {
        message:
          "The node identity does not match the registered key.",
      },
      {
        status: 403,
      },
    );
  }

  const protocolMap = {
    HTTP: ProxyProtocol.HTTP,
    HTTPS: ProxyProtocol.HTTPS,
  } as const;

  try {
    const result =
      await runSerializableTransaction(
        async (transaction) => {
          const now = new Date();

          const currentNode =
            await transaction.proxyNode
              .findUnique({
                where: {
                  id:
                    authenticatedAgent
                      .nodeId,
                },

                select: {
                  id: true,
                  name: true,
                  status: true,
                  metadata: true,
                  maxConnections: true,
                  activeConnections: true,
                  lastHeartbeatAt: true,
                },
              });

          if (!currentNode) {
            throw new Error(
              "Registered node was not found.",
            );
          }

          const nextStatus =
            selectStatus(
              currentNode.status,
              currentNode
                .activeConnections,
              currentNode
                .maxConnections,
              validation.data.system,
            );

          const existingMetadata =
            currentNode.metadata &&
            typeof currentNode.metadata ===
              "object" &&
            !Array.isArray(
              currentNode.metadata,
            )
              ? currentNode.metadata
              : {};

          const metadata = {
            ...existingMetadata,

            agent: {
              keyId:
                authenticatedAgent
                  .keyId,

              reportedAt:
                now.toISOString(),

              reportedMaxConnections:
                validation.data
                  .reportedMaxConnections,

              cpuPercent:
                validation.data.system
                  .cpuPercent,

              memoryPercent:
                validation.data.system
                  .memoryPercent,

              diskPercent:
                validation.data.system
                  .diskPercent,

              uptimeSeconds:
                validation.data.system
                  .uptimeSeconds,
            },
          } as Prisma.InputJsonValue;

          const node =
            await transaction.proxyNode
              .update({
                where: {
                  id: currentNode.id,
                },

                data: {
                  version:
                    validation.data
                      .version,

                  protocols:
                    validation.data
                      .protocols.map(
                        (protocol) =>
                          protocolMap[
                            protocol
                          ],
                      ),

                  status:
                    nextStatus,

                  lastHeartbeatAt:
                    now,

                  metadata,
                },

                select: {
                  id: true,
                  name: true,
                  status: true,
                  maxConnections: true,
                  activeConnections: true,
                  version: true,
                  protocols: true,
                  lastHeartbeatAt: true,
                },
              });

          await transaction.nodeAgentKey
            .update({
              where: {
                id:
                  authenticatedAgent
                    .nodeKeyRecordId,
              },

              data: {
                lastUsedAt: now,
              },
            });

          if (
            currentNode.status !==
            nextStatus
          ) {
            await transaction.auditLog
              .create({
                data: {
                  action:
                    "proxy_node.status_changed",

                  resourceType:
                    "ProxyNode",

                  resourceId:
                    currentNode.id,

                  metadata: {
                    previousStatus:
                      currentNode.status,

                    nextStatus,

                    source:
                      "node_heartbeat",

                    keyId:
                      authenticatedAgent
                        .keyId,
                  },
                },
              });
          }

          return node;
        },
      );

    return Response.json(
      {
        accepted: true,
        node: result,
        serverTime:
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
      "Node heartbeat processing failed:",
      error,
    );

    return Response.json(
      {
        message:
          "The heartbeat could not be processed.",
      },
      {
        status: 500,
      },
    );
  }
}
