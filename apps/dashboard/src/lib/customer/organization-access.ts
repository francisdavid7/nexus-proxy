import {
  OrganizationRole,
  prisma,
} from "@nexus/database";

export class CustomerHasNoOrganizationError
  extends Error {}

export class OrganizationSelectionRequiredError
  extends Error {}

export class OrganizationNotFoundError
  extends Error {}

type AccessibleOrganization = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
  accessRole: OrganizationRole;
};

export async function resolveCustomerOrganization(
  userId: string,
  requestedOrganizationId?: string,
): Promise<AccessibleOrganization> {
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

          members: {
            where: {
              userId,
            },

            take: 1,

            select: {
              role: true,
            },
          },
        },
      });

    if (!organization) {
      throw new OrganizationNotFoundError(
        "The organization was not found.",
      );
    }

    const accessRole =
      organization.ownerId === userId
        ? OrganizationRole.OWNER
        : organization.members[0]?.role;

    if (!accessRole) {
      throw new OrganizationNotFoundError(
        "The organization was not found.",
      );
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      ownerId: organization.ownerId,
      createdAt: organization.createdAt,
      accessRole,
    };
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

        members: {
          where: {
            userId,
          },

          take: 1,

          select: {
            role: true,
          },
        },
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

  const accessRole =
    organization.ownerId === userId
      ? OrganizationRole.OWNER
      : organization.members[0]?.role;

  if (!accessRole) {
    throw new CustomerHasNoOrganizationError(
      "No organization is associated with this account.",
    );
  }

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    ownerId: organization.ownerId,
    createdAt: organization.createdAt,
    accessRole,
  };
}
