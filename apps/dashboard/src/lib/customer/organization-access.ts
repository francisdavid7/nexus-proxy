import {
  prisma,
} from "@nexus/database";

export class CustomerHasNoOrganizationError
  extends Error {}

export class OrganizationSelectionRequiredError
  extends Error {}

export class OrganizationNotFoundError
  extends Error {}

export async function resolveCustomerOrganization(
  userId: string,
  requestedOrganizationId?: string,
) {
  if (requestedOrganizationId) {
    const organization =
      await prisma.organization.findFirst({
        where: {
          id: requestedOrganizationId,

          OR: [
            {
              ownerId: userId,
            },
            {
              members: {
                some: {
                  userId,
                },
              },
            },
          ],
        },

        select: {
          id: true,
          name: true,
          slug: true,
          ownerId: true,
          createdAt: true,
        },
      });

    if (!organization) {
      /*
       * Return "not found" rather than revealing
       * that another customer's organization exists.
       */
      throw new OrganizationNotFoundError(
        "The organization was not found.",
      );
    }

    return organization;
  }

  const organizations =
    await prisma.organization.findMany({
      where: {
        OR: [
          {
            ownerId: userId,
          },
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
      },

      orderBy: {
        createdAt: "asc",
      },

      take: 2,

      select: {
        id: true,
        name: true,
        slug: true,
        ownerId: true,
        createdAt: true,
      },
    });

  if (organizations.length === 0) {
    throw new CustomerHasNoOrganizationError(
      "No organization is associated with this account.",
    );
  }

  if (organizations.length > 1) {
    throw new OrganizationSelectionRequiredError(
      "organizationId is required because this account can access multiple organizations.",
    );
  }

  const organization = organizations[0];

  if (!organization) {
    throw new CustomerHasNoOrganizationError(
      "No organization is associated with this account.",
    );
  }

  return organization;
}
