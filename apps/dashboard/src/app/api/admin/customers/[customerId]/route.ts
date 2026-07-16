import {
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireStaffUser,
} from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const authorization =
    await requireStaffUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const {
    customerId,
  } = await context.params;

  const idValidation =
    z.string()
      .uuid()
      .safeParse(customerId);

  if (!idValidation.success) {
    return Response.json(
      {
        message:
          "The customer ID is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const customer =
      await prisma.user.findFirst({
        where: {
          id: idValidation.data,
          role: "CUSTOMER",
        },

        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,

          _count: {
            select: {
              ownedOrganizations: true,
              memberships: true,
              credentials: true,
              devices: true,
              sessions: true,
              authSessions: true,
            },
          },

          ownedOrganizations: {
            orderBy: {
              createdAt: "asc",
            },

            select: {
              id: true,
              name: true,
              slug: true,
              ownerId: true,
              createdAt: true,
              updatedAt: true,

              _count: {
                select: {
                  members: true,
                  credentials: true,
                  devices: true,
                  sessions: true,
                },
              },

              subscriptions: {
                orderBy: {
                  currentPeriodEnd:
                    "desc",
                },

                take: 5,

                select: {
                  id: true,
                  status: true,
                  currentPeriodStart: true,
                  currentPeriodEnd: true,
                  canceledAt: true,
                  createdAt: true,

                  plan: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      monthlyPriceCents:
                        true,
                      deviceLimit: true,
                      credentialLimit: true,

                      maxConcurrentConnections:
                        true,

                      connectionsPerMinute:
                        true,

                      active: true,
                    },
                  },
                },
              },
            },
          },

          credentials: {
            orderBy: {
              createdAt: "desc",
            },

            take: 50,

            select: {
              id: true,
              organizationId: true,
              deviceId: true,
              username: true,
              secretPrefix: true,
              status: true,
              allowedProtocols: true,
              expiresAt: true,
              lastUsedAt: true,
              revokedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },

          memberships: {
            orderBy: {
              createdAt: "asc",
            },

            select: {
              id: true,
              role: true,
              createdAt: true,

              organization: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

    if (!customer) {
      return Response.json(
        {
          message:
            "The customer was not found.",
        },
        {
          status: 404,
        },
      );
    }

    return Response.json(
      {
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          email: customer.email,
          role: customer.role,
          status: customer.status,

          emailVerified:
            customer.emailVerifiedAt !==
            null,

          emailVerifiedAt:
            customer.emailVerifiedAt,

          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,

          totals: {
            ownedOrganizations:
              customer._count
                .ownedOrganizations,

            memberships:
              customer._count
                .memberships,

            credentials:
              customer._count
                .credentials,

            devices:
              customer._count.devices,

            sessions:
              customer._count.sessions,

            activeLoginSessions:
              customer._count
                .authSessions,
          },

          organizations:
            customer.ownedOrganizations,

          memberships:
            customer.memberships,

          credentials:
            customer.credentials,
        },
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
      "Failed to load customer:",
      error,
    );

    return Response.json(
      {
        message:
          "The customer information could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
