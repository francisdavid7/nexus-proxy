import {
  isIP,
} from "node:net";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateNodeSchema = z
  .object({
    maintenance: z
      .boolean()
      .optional(),

    publicIp: z
      .string()
      .trim()
      .max(45)
      .nullable()
      .optional(),

    httpPort: z
      .number()
      .int()
      .min(1)
      .max(65_535)
      .optional(),

    tlsPort: z
      .number()
      .int()
      .min(1)
      .max(65_535)
      .optional(),

    maxConnections: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .optional(),

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
      )
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.publicIp &&
      isIP(value.publicIp) === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicIp"],
        message:
          "publicIp must be a valid IPv4 or IPv6 address.",
      });
    }

    if (
      Object.keys(value).length === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "At least one node setting is required.",
      });
    }
  });

type RouteContext = {
  params: Promise<{
    nodeId: string;
  }>;
};

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
    nodeId,
  } = await context.params;

  const idValidation =
    z.string()
      .uuid()
      .safeParse(nodeId);

  if (!idValidation.success) {
    return Response.json(
      {
        message:
          "The node ID is invalid.",
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
    updateNodeSchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The node configuration is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  const protocolMap = {
    HTTP: ProxyProtocol.HTTP,
    HTTPS: ProxyProtocol.HTTPS,
  } as const;

  try {
    const node =
      await runSerializableTransaction(
        async (transaction) => {
          const existing =
            await transaction.proxyNode
              .findUnique({
                where: {
                  id: idValidation.data,
                },
              });

          if (!existing) {
            return null;
          }

          const updateData:
            Prisma.ProxyNodeUpdateInput =
            {};

          if (
            validation.data.publicIp !==
            undefined
          ) {
            updateData.publicIp =
              validation.data.publicIp;
          }

          if (
            validation.data.httpPort !==
            undefined
          ) {
            updateData.httpPort =
              validation.data.httpPort;
          }

          if (
            validation.data.tlsPort !==
            undefined
          ) {
            updateData.tlsPort =
              validation.data.tlsPort;
          }

          if (
            validation.data
              .maxConnections !==
            undefined
          ) {
            updateData.maxConnections =
              validation.data
                .maxConnections;
          }

          if (
            validation.data.protocols
          ) {
            updateData.protocols =
              validation.data.protocols
                .map(
                  (protocol) =>
                    protocolMap[
                      protocol
                    ],
                );
          }

          if (
            validation.data
              .maintenance === true
          ) {
            updateData.status =
              "MAINTENANCE";
          }

          if (
            validation.data
              .maintenance === false
          ) {
            updateData.status =
              "PROVISIONING";

            updateData.lastHeartbeatAt =
              null;
          }

          const updated =
            await transaction.proxyNode
              .update({
                where: {
                  id: existing.id,
                },

                data: updateData,

                select: {
                  id: true,
                  name: true,
                  hostname: true,
                  publicIp: true,
                  httpPort: true,
                  tlsPort: true,
                  protocols: true,
                  status: true,
                  maxConnections: true,
                  activeConnections: true,
                  lastHeartbeatAt: true,
                  updatedAt: true,
                },
              });

          await transaction.auditLog
            .create({
              data: {
                actorUserId:
                  authorization.user.id,

                action:
                  "proxy_node.updated",

                resourceType:
                  "ProxyNode",

                resourceId:
                  existing.id,

                ipDigest:
                  createAuditIpDigest(
                    request,
                  ),

                metadata: {
                  previousStatus:
                    existing.status,

                  nextStatus:
                    updated.status,

                  maintenance:
                    validation.data
                      .maintenance ??
                    null,

                  publicIpChanged:
                    validation.data
                      .publicIp !==
                    undefined,

                  maxConnections:
                    updated
                      .maxConnections,

                  protocols:
                    updated.protocols,
                },
              },
            });

          return updated;
        },
      );

    if (!node) {
      return Response.json(
        {
          message:
            "The proxy node was not found.",
        },
        {
          status: 404,
        },
      );
    }

    return Response.json(
      {
        message:
          "Proxy node updated.",
        node,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "Failed to update proxy node:",
      error,
    );

    return Response.json(
      {
        message:
          "The proxy node could not be updated.",
      },
      {
        status: 500,
      },
    );
  }
}
