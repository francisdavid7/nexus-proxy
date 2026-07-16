import {
  createPublicKey,
} from "node:crypto";

import {
  Prisma,
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

const registerKeySchema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(
      /^nak_[a-f0-9]{24,64}$/,
      "The key ID is invalid.",
    ),

  publicKeyPem: z
    .string()
    .trim()
    .min(80)
    .max(2_048),

  revokeExisting: z
    .boolean()
    .default(true),
});

type RouteContext = {
  params: Promise<{
    nodeId: string;
  }>;
};

function validateEd25519PublicKey(
  publicKeyPem: string,
): void {
  let publicKey;

  try {
    publicKey =
      createPublicKey(publicKeyPem);
  } catch {
    throw new Error(
      "The public key is invalid.",
    );
  }

  if (
    publicKey.asymmetricKeyType !==
    "ed25519"
  ) {
    throw new Error(
      "The public key must be an Ed25519 key.",
    );
  }
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
    registerKeySchema.safeParse(
      requestBody,
    );

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The node key information is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  try {
    validateEd25519PublicKey(
      validation.data.publicKeyPem,
    );
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "The public key is invalid.",
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
          const node =
            await transaction.proxyNode
              .findUnique({
                where: {
                  id: idValidation.data,
                },

                select: {
                  id: true,
                  name: true,
                },
              });

          if (!node) {
            return null;
          }

          let revokedKeys = 0;

          if (
            validation.data
              .revokeExisting
          ) {
            const revocation =
              await transaction.nodeAgentKey
                .updateMany({
                  where: {
                    nodeId: node.id,
                    status: "ACTIVE",
                  },

                  data: {
                    status: "REVOKED",
                    revokedAt:
                      new Date(),
                  },
                });

            revokedKeys =
              revocation.count;
          }

          const key =
            await transaction.nodeAgentKey
              .create({
                data: {
                  nodeId: node.id,

                  keyId:
                    validation.data
                      .keyId,

                  publicKeyPem:
                    validation.data
                      .publicKeyPem,

                  status: "ACTIVE",
                },

                select: {
                  id: true,
                  nodeId: true,
                  keyId: true,
                  status: true,
                  createdAt: true,
                },
              });

          await transaction.auditLog
            .create({
              data: {
                actorUserId:
                  authorization.user.id,

                action:
                  "node_agent_key.registered",

                resourceType:
                  "NodeAgentKey",

                resourceId:
                  key.id,

                ipDigest:
                  createAuditIpDigest(
                    request,
                  ),

                metadata: {
                  nodeId:
                    node.id,

                  nodeName:
                    node.name,

                  keyId:
                    key.keyId,

                  revokedPreviousKeys:
                    revokedKeys,
                },
              },
            });

          return {
            node,
            key,
            revokedKeys,
          };
        },
      );

    if (!result) {
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
          "Node-agent public key registered.",

        ...result,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json(
        {
          message:
            "This node key ID is already registered.",
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "Failed to register node-agent key:",
      error,
    );

    return Response.json(
      {
        message:
          "The node-agent key could not be registered.",
      },
      {
        status: 500,
      },
    );
  }
}
