import "dotenv/config";

import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
} from "node:crypto";
import { promisify } from "node:util";

import { prisma } from "../src/client.js";

const scrypt = promisify(nodeScrypt);

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return [
    "scrypt",
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

function digestProxySecret(
  secret: string,
  pepper: string,
): string {
  return createHmac("sha256", pepper)
    .update(secret)
    .digest("hex");
}

async function main(): Promise<void> {
  const adminName = requireEnvironmentVariable("SEED_ADMIN_NAME");
  const adminEmail = requireEnvironmentVariable("SEED_ADMIN_EMAIL");
  const adminPassword = requireEnvironmentVariable(
    "SEED_ADMIN_PASSWORD",
  );

  const proxyUsername = requireEnvironmentVariable(
    "SEED_PROXY_USERNAME",
  );

  const proxySecret = requireEnvironmentVariable(
    "SEED_PROXY_SECRET",
  );

  const credentialPepper = requireEnvironmentVariable(
    "CREDENTIAL_PEPPER",
  );

  const passwordHash = await hashPassword(adminPassword);

  const secretDigest = digestProxySecret(
    proxySecret,
    credentialPepper,
  );

  const user = await prisma.user.upsert({
    where: {
      email: adminEmail,
    },

    create: {
      fullName: adminName,
      email: adminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },

    update: {
      fullName: adminName,
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const organization = await prisma.organization.upsert({
    where: {
      slug: "nexus-administration",
    },

    create: {
      name: "Nexus Administration",
      slug: "nexus-administration",
      ownerId: user.id,
    },

    update: {
      name: "Nexus Administration",
      ownerId: user.id,
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },

    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER",
    },

    update: {
      role: "OWNER",
    },
  });

  const plan = await prisma.plan.upsert({
    where: {
      code: "internal-unlimited",
    },

    create: {
      name: "Internal Unlimited",
      code: "internal-unlimited",
      monthlyPriceCents: 0,
      bandwidthLimitBytes: null,
      deviceLimit: 100,
      credentialLimit: 100,
      active: true,
    },

    update: {
      active: true,
    },
  });

  const existingSubscription =
    await prisma.subscription.findFirst({
      where: {
        organizationId: organization.id,
        planId: plan.id,
      },
    });

  const periodStart = new Date();
  const periodEnd = new Date();

  periodEnd.setFullYear(periodEnd.getFullYear() + 10);

  if (existingSubscription) {
    await prisma.subscription.update({
      where: {
        id: existingSubscription.id,
      },

      data: {
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        planId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  const location = await prisma.location.upsert({
    where: {
      code: "local-development",
    },

    create: {
      code: "local-development",
      countryCode: "NG",
      country: "Nigeria",
      city: "Local Development",
      active: true,
    },

    update: {
      active: true,
    },
  });

  const node = await prisma.proxyNode.upsert({
    where: {
      hostname: "local-dev-node",
    },

    create: {
      locationId: location.id,
      name: "Local Development Node",
      hostname: "local-dev-node",
      httpPort: 8080,
      tlsPort: 8443,
      socksPort: 1080,
      protocols: ["HTTP", "HTTPS"],
      status: "ONLINE",
      maxConnections: 1000,
      activeConnections: 0,
      version: "0.1.0",
      lastHeartbeatAt: new Date(),
    },

    update: {
      locationId: location.id,
      protocols: ["HTTP", "HTTPS"],
      status: "ONLINE",
      version: "0.1.0",
      lastHeartbeatAt: new Date(),
    },
  });

  const credential = await prisma.proxyCredential.upsert({
    where: {
      username: proxyUsername,
    },

    create: {
      organizationId: organization.id,
      userId: user.id,
      username: proxyUsername,
      secretDigest,
      secretPrefix: proxySecret.slice(0, 8),
      status: "ACTIVE",
      allowedProtocols: ["HTTP", "HTTPS"],
    },

    update: {
      organizationId: organization.id,
      userId: user.id,
      secretDigest,
      secretPrefix: proxySecret.slice(0, 8),
      status: "ACTIVE",
      allowedProtocols: ["HTTP", "HTTPS"],
      expiresAt: null,
      revokedAt: null,
    },
  });

  console.log("");
  console.log("Nexus seed completed successfully.");
  console.log("");
  console.log(`Admin email: ${adminEmail}`);
  console.log(`Admin password: ${adminPassword}`);
  console.log("");
  console.log(`Proxy username: ${proxyUsername}`);
  console.log(`Proxy secret: ${proxySecret}`);
  console.log("");
  console.log(`Organization ID: ${organization.id}`);
  console.log(`Credential ID: ${credential.id}`);
  console.log(`Node ID: ${node.id}`);
  console.log("");
  console.log(
    "Keep these development credentials private.",
  );
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
