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
    keyId: string;
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
    keyId,
  } = await context.params;

  const validation = z
    .string()
    .regex(/^nak_[a-f0-9]{24,64}$/)
    .safeParse(keyId);

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The node-agent key ID is invalid.",
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
          const key =
            await transaction.nodeAgentKey
              .findUnique({
                where: {
                  keyId:
                    validation.data,
                },

                select: {
                  id: true,
                  keyId: true,
                  nodeId: true,
                  status: true,
                },
              });

          if (!key) {
            return null;
          }

          if (
            key.status === "REVOKED"
          ) {
            return {
              key,
              changed: false,
            };
          }

          const revoked =
            await transaction.nodeAgentKey
              .update({
                where: {
                  id: key.id,
                },

                data: {
                  status: "REVOKED",
                  revokedAt:
                    new Date(),
                },

                select: {
                  id: true,
                  keyId: true,
                  nodeId: true,
                  status: true,
                  revokedAt: true,
                },
              });

          await transaction.auditLog
            .create({
              data: {
                actorUserId:
                  authorization.user.id,

                action:
                  "node_agent_key.revoked",

                resourceType:
                  "NodeAgentKey",

                resourceId:
                  key.id,

                ipDigest:
                  createAuditIpDigest(
                    request,
                  ),

                metadata: {
                  keyId:
                    key.keyId,

                  nodeId:
                    key.nodeId,
                },
              },
            });

          return {
            key: revoked,
            changed: true,
          };
        },
      );

    if (!result) {
      return Response.json(
        {
          message:
            "The node-agent key was not found.",
        },
        {
          status: 404,
        },
      );
    }

    return Response.json(
      {
        message:
          result.changed
            ? "Node-agent key revoked."
            : "Node-agent key was already revoked.",

        key: result.key,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "Failed to revoke node-agent key:",
      error,
    );

    return Response.json(
      {
        message:
          "The node-agent key could not be revoked.",
      },
      {
        status: 500,
      },
    );
  }
}
