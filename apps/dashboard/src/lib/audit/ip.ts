import {
  createHmac,
} from "node:crypto";

function getClientAddress(
  request: Request,
): string | null {
  const forwardedFor =
    request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const firstAddress =
      forwardedFor
        .split(",")[0]
        ?.trim();

    if (firstAddress) {
      return firstAddress;
    }
  }

  return (
    request.headers
      .get("x-real-ip")
      ?.trim() || null
  );
}

export function createAuditIpDigest(
  request: Request,
): string | null {
  const pepper =
    process.env.AUDIT_IP_PEPPER?.trim();

  const address =
    getClientAddress(request);

  if (!pepper || !address) {
    return null;
  }

  return createHmac(
    "sha256",
    pepper,
  )
    .update(address)
    .digest("hex");
}
