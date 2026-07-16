import {
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function verifyPassword(
  password: string,
  encodedPasswordHash: string,
): Promise<boolean> {
  const parts = encodedPasswordHash.split("$");

  if (parts.length !== 3) {
    return false;
  }

  const [
    algorithm,
    saltHex,
    expectedHashHex,
  ] = parts;

  if (
    algorithm !== "scrypt" ||
    !saltHex ||
    !expectedHashHex
  ) {
    return false;
  }

  let salt: Buffer;
  let expectedHash: Buffer;

  try {
    salt = Buffer.from(saltHex, "hex");

    expectedHash = Buffer.from(
      expectedHashHex,
      "hex",
    );
  } catch {
    return false;
  }

  if (
    salt.length === 0 ||
    expectedHash.length === 0
  ) {
    return false;
  }

  const actualHash = (
    await scryptAsync(
      password,
      salt,
      expectedHash.length,
    )
  ) as Buffer;

  if (
    actualHash.length !== expectedHash.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualHash,
    expectedHash,
  );
}
