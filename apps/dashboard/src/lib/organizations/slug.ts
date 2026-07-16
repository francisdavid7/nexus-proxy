import {
  randomBytes,
} from "node:crypto";

const MAX_BASE_LENGTH = 90;

export function createOrganizationSlug(
  organizationName: string,
): string {
  const normalizedName = organizationName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, "");

  const base =
    normalizedName || "organization";

  const suffix = randomBytes(4).toString(
    "hex",
  );

  return `${base}-${suffix}`;
}
