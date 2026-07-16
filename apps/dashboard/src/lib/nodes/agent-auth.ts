import {
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";

import {
  prisma,
} from "@nexus/database";

import {
  getRedisClient,
} from "@/lib/redis/client";

import {
  getNodeHeartbeatMaxSkewSeconds,
  getNodeNonceTTLSeconds,
} from "@/lib/nodes/settings";

const SIGNATURE_VERSION =
  "NEXUS-NODE-V1";

export class NodeAgentAuthenticationError
  extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type AuthenticatedNodeAgent = {
  nodeId: string;
  nodeKeyRecordId: string;
  keyId: string;
};

function requireHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string {
  const value =
    request.headers.get(name)?.trim();

  if (
    !value ||
    value.length > maximumLength
  ) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  return value;
}

function createBodyDigest(
  bodyText: string,
): string {
  return createHash("sha256")
    .update(bodyText)
    .digest("hex");
}

function createCanonicalRequest(
  request: Request,
  timestamp: string,
  nonce: string,
  bodyText: string,
): string {
  const url = new URL(request.url);

  return [
    SIGNATURE_VERSION,
    request.method.toUpperCase(),
    url.pathname,
    timestamp,
    nonce,
    createBodyDigest(bodyText),
  ].join("\n");
}

function validateTimestamp(
  timestampValue: string,
): void {
  if (!/^\d{10,13}$/.test(timestampValue)) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  const timestamp =
    Number.parseInt(timestampValue, 10);

  const now =
    Math.floor(Date.now() / 1000);

  const skew =
    Math.abs(now - timestamp);

  if (
    !Number.isSafeInteger(timestamp) ||
    skew >
      getNodeHeartbeatMaxSkewSeconds()
  ) {
    throw new NodeAgentAuthenticationError(
      "The node request timestamp is outside the allowed window.",
      401,
    );
  }
}

function validateNonce(
  nonce: string,
): void {
  if (
    nonce.length < 16 ||
    nonce.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(nonce)
  ) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }
}

async function claimNonce(
  keyId: string,
  nonce: string,
): Promise<void> {
  const redis =
    await getRedisClient();

  const nonceDigest =
    createHash("sha256")
      .update(`${keyId}:${nonce}`)
      .digest("hex");

  const result = await redis.set(
    `nexus:node-auth:nonce:${nonceDigest}`,
    "1",
    {
      NX: true,
      EX: getNodeNonceTTLSeconds(),
    },
  );

  if (result !== "OK") {
    throw new NodeAgentAuthenticationError(
      "The node request has already been used.",
      409,
    );
  }
}

export async function authenticateNodeAgentRequest(
  request: Request,
  bodyText: string,
): Promise<AuthenticatedNodeAgent> {
  const keyId = requireHeader(
    request,
    "x-nexus-node-key-id",
    80,
  );

  const timestamp = requireHeader(
    request,
    "x-nexus-node-timestamp",
    20,
  );

  const nonce = requireHeader(
    request,
    "x-nexus-node-nonce",
    128,
  );

  const signatureValue = requireHeader(
    request,
    "x-nexus-node-signature",
    256,
  );

  validateTimestamp(timestamp);
  validateNonce(nonce);

  const keyRecord =
    await prisma.nodeAgentKey.findUnique({
      where: {
        keyId,
      },

      select: {
        id: true,
        nodeId: true,
        publicKeyPem: true,
        status: true,

        node: {
          select: {
            id: true,
          },
        },
      },
    });

  if (
    !keyRecord ||
    keyRecord.status !== "ACTIVE"
  ) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  let publicKey;
  let signature: Buffer;

  try {
    publicKey = createPublicKey(
      keyRecord.publicKeyPem,
    );

    signature = Buffer.from(
      signatureValue,
      "base64url",
    );
  } catch {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  if (
    publicKey.asymmetricKeyType !==
      "ed25519" ||
    signature.length !== 64
  ) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  const canonicalRequest =
    createCanonicalRequest(
      request,
      timestamp,
      nonce,
      bodyText,
    );

  const signatureIsValid = verify(
    null,
    Buffer.from(
      canonicalRequest,
      "utf8",
    ),
    publicKey,
    signature,
  );

  if (!signatureIsValid) {
    throw new NodeAgentAuthenticationError(
      "Node authentication failed.",
      401,
    );
  }

  try {
    await claimNonce(keyId, nonce);
  } catch (error) {
    if (
      error instanceof
      NodeAgentAuthenticationError
    ) {
      throw error;
    }

    console.error(
      "Node nonce verification failed:",
      error,
    );

    throw new NodeAgentAuthenticationError(
      "Node authentication is temporarily unavailable.",
      503,
    );
  }

  return {
    nodeId: keyRecord.nodeId,
    nodeKeyRecordId: keyRecord.id,
    keyId,
  };
}
