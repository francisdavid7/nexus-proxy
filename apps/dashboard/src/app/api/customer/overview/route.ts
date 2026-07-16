import {
  prisma,
} from "@nexus/database";

import {
  requireCustomerUser,
} from "@/lib/auth/authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function calculateUsagePercentage(
  usedBytes: bigint,
  limitBytes: bigint | null,
): number | null {
  if (
    limitBytes === null ||
    limitBytes <= 0n
  ) {
    return null;
  }

  /*
   * BigInt arithmetic avoids losing precision.
   * Two decimal places are retained.
   */
  const percentageTimesOneHundred =
    (usedBytes * 10_000n) /
    limitBytes;

  return (
    Number(percentageTimesOneHundred) /
    100
  );
}

export async function GET():
  Promise<Response> {
  const authorization =
    await requireCustomerUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  try {
    const now = new Date();

    const organizations =
      await prisma.organization.findMany({
        where: {
          OR: [
            {
              ownerId:
                authorization.user.id,
            },
            {
              members: {
                some: {
                  userId:
                    authorization.user.id,
                },
              },
            },
          ],
        },

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
            where: {
              status: {
                in: [
                  "TRIAL",
                  "ACTIVE",
                ],
              },

              currentPeriodStart: {
                lte: now,
              },

              currentPeriodEnd: {
                gt: now,
              },

              plan: {
                active: true,
              },
            },

            orderBy: {
              currentPeriodEnd: "desc",
            },

            take: 1,

            select: {
              id: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              canceledAt: true,

              plan: {
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

                  connectionsPerMinute:
                    true,
                },
              },
            },
          },

          credentials: {
            orderBy: {
              createdAt: "desc",
            },

            take: 20,

            select: {
              id: true,
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
        },
      });

    const organizationsWithUsage =
      await Promise.all(
        organizations.map(
          async (organization) => {
            const subscription =
              organization
                .subscriptions[0] ??
              null;

            let finalizedUsage = {
              bytesUploaded: 0n,
              bytesDownloaded: 0n,
              connectionCount: 0,
            };

            if (subscription) {
              const usage =
                await prisma.usageRecord
                  .aggregate({
                    where: {
                      organizationId:
                        organization.id,

                      periodStart: {
                        lt:
                          subscription
                            .currentPeriodEnd,
                      },

                      periodEnd: {
                        gt:
                          subscription
                            .currentPeriodStart,
                      },
                    },

                    _sum: {
                      bytesUploaded: true,
                      bytesDownloaded: true,
                      connectionCount: true,
                    },
                  });

              finalizedUsage = {
                bytesUploaded:
                  usage._sum
                    .bytesUploaded ??
                  0n,

                bytesDownloaded:
                  usage._sum
                    .bytesDownloaded ??
                  0n,

                connectionCount:
                  usage._sum
                    .connectionCount ??
                  0,
              };
            }

            const totalBytes =
              finalizedUsage
                .bytesUploaded +
              finalizedUsage
                .bytesDownloaded;

            const bandwidthLimit =
              subscription?.plan
                .bandwidthLimitBytes ??
              null;

            return {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,

              customerIsOwner:
                organization.ownerId ===
                authorization.user.id,

              createdAt:
                organization.createdAt,

              updatedAt:
                organization.updatedAt,

              totals: {
                members:
                  organization._count
                    .members,

                credentials:
                  organization._count
                    .credentials,

                devices:
                  organization._count
                    .devices,

                sessions:
                  organization._count
                    .sessions,
              },

              subscription:
                subscription
                  ? {
                      id:
                        subscription.id,

                      status:
                        subscription.status,

                      currentPeriodStart:
                        subscription
                          .currentPeriodStart,

                      currentPeriodEnd:
                        subscription
                          .currentPeriodEnd,

                      plan: {
                        id:
                          subscription.plan
                            .id,

                        name:
                          subscription.plan
                            .name,

                        code:
                          subscription.plan
                            .code,

                        monthlyPriceCents:
                          subscription.plan
                            .monthlyPriceCents,

                        bandwidthLimitBytes:
                          bandwidthLimit
                            ?.toString() ??
                          null,

                        deviceLimit:
                          subscription.plan
                            .deviceLimit,

                        credentialLimit:
                          subscription.plan
                            .credentialLimit,

                        maxConcurrentConnections:
                          subscription.plan
                            .maxConcurrentConnections,

                        connectionsPerMinute:
                          subscription.plan
                            .connectionsPerMinute,
                      },
                    }
                  : null,

              finalizedUsage:
                subscription
                  ? {
                      periodStart:
                        subscription
                          .currentPeriodStart,

                      periodEnd:
                        subscription
                          .currentPeriodEnd,

                      bytesUploaded:
                        finalizedUsage
                          .bytesUploaded
                          .toString(),

                      bytesDownloaded:
                        finalizedUsage
                          .bytesDownloaded
                          .toString(),

                      totalBytes:
                        totalBytes.toString(),

                      connectionCount:
                        finalizedUsage
                          .connectionCount,

                      bandwidthUsedPercentage:
                        calculateUsagePercentage(
                          totalBytes,
                          bandwidthLimit,
                        ),
                    }
                  : null,

              credentials:
                organization.credentials,
            };
          },
        ),
      );

    return Response.json(
      {
        customer: {
          id: authorization.user.id,

          fullName:
            authorization.user.fullName,

          email:
            authorization.user.email,

          role:
            authorization.user.role,

          status:
            authorization.user.status,

          emailVerified:
            authorization.user
              .emailVerifiedAt !== null,

          emailVerifiedAt:
            authorization.user
              .emailVerifiedAt,
        },

        organizations:
          organizationsWithUsage,

        generatedAt:
          new Date().toISOString(),
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, max-age=0",

          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to load customer overview:",
      error,
    );

    return Response.json(
      {
        message:
          "Your account overview could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
