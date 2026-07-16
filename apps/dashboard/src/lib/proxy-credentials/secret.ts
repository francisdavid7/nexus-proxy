import {
  createHmac,
  randomBytes,
} from "node:crypto";

export type ProxyCredentialMaterial = {
  username: string;
  secret: string;
  secretDigest: string;
  secretPrefix: string;
};

function getCredentialPepper(): string {
  const pepper =
    process.env.CREDENTIAL_PEPPER?.trim();

  if (!pepper) {
    throw new Error(
      "CREDENTIAL_PEPPER is not configured.",
    );
  }

  if (pepper.length < 32) {
    throw new Error(
      "CREDENTIAL_PEPPER must contain at least 32 characters.",
    );
  }

  return pepper;
}

function normalizeUsernameBase(
  organizationSlug: string,
): string {
  const normalized = organizationSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 68)
    .replace(/-$/g, "");

  return normalized || "customer";
}

export function createProxyCredentialMaterial(
  organizationSlug: string,
): ProxyCredentialMaterial {
  const usernameSuffix =
    randomBytes(5).toString("hex");

  const username =
    `nx_${normalizeUsernameBase(
      organizationSlug,
    )}_${usernameSuffix}`;

  const secret =
    `npx_${randomBytes(32).toString(
      "base64url",
    )}`;

  const secretDigest = createHmac(
    "sha256",
    getCredentialPepper(),
  )
    .update(secret)
    .digest("hex");

  return {
    username,
    secret,
    secretDigest,
    secretPrefix: secret.slice(0, 16),
  };
}
