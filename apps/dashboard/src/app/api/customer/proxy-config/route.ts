import {
  ProxyProtocol,
  prisma,
} from "@nexus/database";

import {
  z,
} from "zod";

import {
  requireCustomerUser,
} from "@/lib/auth/authorization";

import {
  CustomerHasNoOrganizationError,
  OrganizationNotFoundError,
  OrganizationSelectionRequiredError,
  resolveCustomerOrganization,
} from "@/lib/customer/organization-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configurationQuerySchema =
  z.object({
    organizationId: z
      .string()
      .uuid()
      .optional(),
  });

function formatURLHost(
  host: string,
): string {
  return host.includes(":")
    ? `[${host}]`
    : host;
}

export async function GET(
  request: Request,
): Promise<Response> {
  const authorization =
    await requireCustomerUser();

  if (!authorization.authorized) {
    return authorization.response;
  }

  const url = new URL(request.url);

  const validation =
    configurationQuerySchema.safeParse({
      organizationId:
        url.searchParams.get(
          "organizationId",
        ) ?? undefined,
    });

  if (!validation.success) {
    return Response.json(
      {
        message:
          "The proxy-configuration query is invalid.",

        errors:
          validation.error.flatten(),
      },
      {
        status: 400,
      },
    );
  }

  try {
    const organization =
      await resolveCustomerOrganization(
        authorization.user.id,
        validation.data.organizationId,
      );

    const now = new Date();

    const staleAfterSeconds =
      Number.parseInt(
        process.env.NODE_STALE_AFTER_SECONDS ??
          "90",
        10,
      );

    const nodeFreshnessCutoff =
      new Date(
        now.getTime() -
          (
            Number.isNaN(staleAfterSeconds)
              ? 90
              : staleAfterSeconds
          ) *
            1000,
      );

    const [
      subscription,
      credentials,
      nodes,
    ] = await prisma.$transaction([
      prisma.subscription.findFirst({
        where: {
          organizationId:
            organization.id,

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
              bandwidthLimitBytes: true,
              credentialLimit: true,

              maxConcurrentConnections:
                true,

              connectionsPerMinute:
                true,
            },
          },
        },
      }),

      /*
       * A customer sees only credentials issued
       * specifically to their user account.
       */
      prisma.proxyCredential.findMany({
        where: {
          organizationId:
            organization.id,

          userId:
            authorization.user.id,

          status: "ACTIVE",

          OR: [
            {
              expiresAt: null,
            },
            {
              expiresAt: {
                gt: now,
              },
            },
          ],
        },

        orderBy: {
          createdAt: "desc",
        },

        select: {
          id: true,
          username: true,
          secretPrefix: true,
          status: true,
          allowedProtocols: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),

      prisma.proxyNode.findMany({
        where: {
          status: "ONLINE",

          lastHeartbeatAt: {
            gte: nodeFreshnessCutoff,
          },

          publicIp: {
            not: null,
          },

          location: {
            active: true,
          },

          protocols: {
            hasSome: [
              ProxyProtocol.HTTP,
              ProxyProtocol.HTTPS,
            ],
          },
        },

        orderBy: [
          {
            location: {
              country: "asc",
            },
          },
          {
            location: {
              city: "asc",
            },
          },
          {
            createdAt: "asc",
          },
        ],

        select: {
          id: true,
          publicIp: true,
          httpPort: true,
          protocols: true,
          activeConnections: true,
          maxConnections: true,
          lastHeartbeatAt: true,

          location: {
            select: {
              id: true,
              code: true,
              countryCode: true,
              country: true,
              city: true,
              region: true,
            },
          },
        },
      }),
    ]);

    const availableNodes =
      nodes.flatMap((node) => {
        if (
          !node.publicIp ||
          node.activeConnections >=
            node.maxConnections
        ) {
          return [];
        }

        const host =
          formatURLHost(
            node.publicIp,
          );

        return [
          {
            id: node.id,
            host: node.publicIp,
            port: node.httpPort,

            transport: "HTTP",

            location:
              node.location,

            capabilities: {
              httpDestinations:
                node.protocols.includes(
                  ProxyProtocol.HTTP,
                ),

              httpsDestinations:
                node.protocols.includes(
                  ProxyProtocol.HTTPS,
                ),

              socks5: false,
            },

            capacity: {
              activeConnections:
                node.activeConnections,

              maxConnections:
                node.maxConnections,
            },

            proxyAddress:
              `http://${host}:${node.httpPort}`,
          },
        ];
      });

    const configurations =
      credentials.flatMap(
        (credential) =>
          availableNodes.map(
            (node) => {
              const encodedUsername =
                encodeURIComponent(
                  credential.username,
                );

              const host =
                formatURLHost(
                  node.host,
                );

              const proxyAddress =
                `http://${host}:${node.port}`;

              return {
                credentialId:
                  credential.id,

                nodeId:
                  node.id,

                location:
                  node.location,

                username:
                  credential.username,

                secretPrefix:
                  credential.secretPrefix,

                secretRetrievable:
                  false,

                allowedProtocols:
                  credential
                    .allowedProtocols,

                proxy: {
                  scheme: "http",
                  host: node.host,
                  port: node.port,

                  address:
                    proxyAddress,

                  urlTemplate:
                    `http://${encodedUsername}:YOUR_PROXY_SECRET@${host}:${node.port}`,
                },

                examples: {
                  curlHttp:
                    `curl --proxy "${proxyAddress}" --proxy-user "${credential.username}:YOUR_PROXY_SECRET" "http://example.com"`,

                  curlHttps:
                    `curl --proxy "${proxyAddress}" --proxy-user "${credential.username}:YOUR_PROXY_SECRET" "https://example.com"`,
                },
              };
            },
          ),
      );

    return Response.json(
      {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,

          accessRole:
            organization.accessRole,
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
                    subscription.plan.id,

                  name:
                    subscription.plan.name,

                  code:
                    subscription.plan.code,

                  bandwidthLimitBytes:
                    subscription.plan
                      .bandwidthLimitBytes
                      ?.toString() ??
                    null,

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

        serviceAvailable:
          Boolean(subscription) &&
          credentials.length > 0 &&
          availableNodes.length > 0,

        credentials,

        nodes:
          availableNodes,

        configurations,

        important: {
          secretReturnedAgain: false,

          secretInstruction:
            "Use the proxy secret that was displayed when the credential was created.",

          httpsTraffic:
            "HTTPS destinations use CONNECT through the HTTP proxy endpoint.",

          separateTlsProxyListener:
            false,

          socks5Available:
            false,
        },

        generatedAt:
          now.toISOString(),
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
    if (
      error instanceof
      OrganizationNotFoundError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: 404,
        },
      );
    }

    if (
      error instanceof
        CustomerHasNoOrganizationError ||
      error instanceof
        OrganizationSelectionRequiredError
    ) {
      return Response.json(
        {
          message: error.message,
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "Failed to load proxy configuration:",
      error,
    );

    return Response.json(
      {
        message:
          "Your proxy configuration could not be loaded.",
      },
      {
        status: 500,
      },
    );
  }
}
