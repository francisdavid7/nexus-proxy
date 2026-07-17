import {
  prisma,
} from "@nexus/database";

import {
  requireStaffUser,
} from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET():
  Promise<Response> {
  const authorization =
    await requireStaffUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  try {
    const plans =
      await prisma.plan.findMany({
        where: {
          active: true,
        },

        orderBy: [
          {
            monthlyPriceCents: "asc",
          },
          {
            name: "asc",
          },
        ],

        select: {
          id: true,
          name: true,
          code: true,
          monthlyPriceCents: true,
          bandwidthLimitBytes: true,
          deviceLimit: true,
          credentialLimit: true,
          maxConcurrentConnections:
            true,
          connectionsPerMinute: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    return Response.json(
      {
        plans: plans.map(
          (plan) => ({
            ...plan,

            bandwidthLimitBytes:
              plan.bandwidthLimitBytes
                ?.toString() ??
              null,
          }),
        ),
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
      "Failed to load plans:",
      error,
    );

    return Response.json(
      {
        message:
          "The subscription plans could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
