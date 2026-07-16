import {
  Prisma,
  UserStatus,
  prisma,
} from "@nexus/database";

export type CustomerListFilters = {
  page: number;
  limit: number;
  search?: string;
  status?: UserStatus;
};

export async function listCustomers(
  filters: CustomerListFilters,
) {
  const skip =
    (filters.page - 1) * filters.limit;

  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",

    ...(filters.status
      ? {
          status: filters.status,
        }
      : {}),

    ...(filters.search
      ? {
          OR: [
            {
              fullName: {
                contains: filters.search,
                mode: "insensitive",
              },
            },
            {
              email: {
                contains: filters.search,
                mode: "insensitive",
              },
            },
            {
              ownedOrganizations: {
                some: {
                  name: {
                    contains: filters.search,
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [
    totalCustomers,
    customers,
  ] = await prisma.$transaction([
    prisma.user.count({
      where,
    }),

    prisma.user.findMany({
      where,

      skip,
      take: filters.limit,

      orderBy: {
        createdAt: "desc",
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
            credentials: true,
            devices: true,
            sessions: true,
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
            createdAt: true,

            subscriptions: {
              orderBy: {
                currentPeriodEnd: "desc",
              },

              take: 1,

              select: {
                id: true,
                status: true,
                currentPeriodStart: true,
                currentPeriodEnd: true,

                plan: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    monthlyPriceCents: true,
                    credentialLimit: true,
                    deviceLimit: true,
                    maxConcurrentConnections:
                      true,
                    connectionsPerMinute: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    customers: customers.map(
      (customer) => ({
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
        role: customer.role,
        status: customer.status,

        emailVerified:
          customer.emailVerifiedAt !== null,

        emailVerifiedAt:
          customer.emailVerifiedAt,

        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,

        totals: {
          organizations:
            customer._count
              .ownedOrganizations,

          credentials:
            customer._count.credentials,

          devices:
            customer._count.devices,

          sessions:
            customer._count.sessions,
        },

        organizations:
          customer.ownedOrganizations.map(
            (organization) => ({
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              createdAt:
                organization.createdAt,

              subscription:
                organization
                  .subscriptions[0] ??
                null,
            }),
          ),
      }),
    ),

    pagination: {
      page: filters.page,
      limit: filters.limit,
      totalItems: totalCustomers,

      totalPages: Math.ceil(
        totalCustomers /
          filters.limit,
      ),

      hasPreviousPage:
        filters.page > 1,

      hasNextPage:
        skip + customers.length <
        totalCustomers,
    },
  };
}
