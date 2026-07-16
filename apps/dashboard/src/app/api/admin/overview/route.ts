import { prisma } from "@nexus/database";

import {
  requireStaffUser,
} from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const authorization =
    await requireStaffUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  try {
    const [
      totalUsers,
      totalCustomers,
      totalOrganizations,
      totalCredentials,
      totalNodes,
      totalSessions,
      activeSessions,
    ] = await prisma.$transaction([
      prisma.user.count(),

      prisma.user.count({
        where: {
          role: "CUSTOMER",
        },
      }),

      prisma.organization.count(),

      prisma.proxyCredential.count(),

      prisma.proxyNode.count(),

      prisma.connectionSession.count(),

      prisma.connectionSession.count({
        where: {
          status: "ACTIVE",
        },
      }),
    ]);

    return Response.json(
      {
        viewer: {
          id: authorization.user.id,
          fullName:
            authorization.user.fullName,
          email:
            authorization.user.email,
          role:
            authorization.user.role,
        },

        statistics: {
          users: {
            total: totalUsers,
            customers: totalCustomers,
          },

          organizations: {
            total: totalOrganizations,
          },

          proxyCredentials: {
            total: totalCredentials,
          },

          proxyNodes: {
            total: totalNodes,
          },

          sessions: {
            total: totalSessions,
            active: activeSessions,
          },
        },

        generatedAt:
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
      "Failed to load admin overview:",
      error,
    );

    return Response.json(
      {
        message:
          "The dashboard statistics could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
