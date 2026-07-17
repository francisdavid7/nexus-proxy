"use client";

import {
  KeyRound,
  Network,
  Radio,
  Waypoints,
} from "lucide-react";

import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  MetricCard,
  StatusBadge,
} from "@/components/portal/ui";

import {
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatBytes,
  formatDate,
  formatMoney,
} from "@/lib/portal/format";

type Credential = {
  id: string;
  username: string;
  secretPrefix: string;
  status: string;
  allowedProtocols: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
};

type Organization = {
  id: string;
  name: string;
  slug: string;

  totals: {
    credentials: number;
    devices: number;
    sessions: number;
    members: number;
  };

  subscription: {
    status: string;

    plan: {
      name: string;
      monthlyPriceCents: number;
      bandwidthLimitBytes:
        | string
        | null;
      credentialLimit: number;
      maxConcurrentConnections:
        number;
    };
  } | null;

  finalizedUsage: {
    totalBytes: string;
    connectionCount: number;
    bandwidthUsedPercentage:
      | number
      | null;
  } | null;

  credentials: Credential[];
};

type OverviewResponse = {
  customer: {
    fullName: string;
    email: string;
    status: string;
  };

  organizations: Organization[];
};

export default function CustomerOverviewPage() {
  const resource =
    useApiResource<OverviewResponse>(
      "/api/customer/overview",
    );

  if (resource.loading) {
    return <LoadingPanel />;
  }

  if (resource.error) {
    return (
      <ErrorPanel
        message={resource.error}
      />
    );
  }

  const organization =
    resource.data
      ?.organizations[0];

  if (!organization) {
    return (
      <EmptyPanel
        title="No organization available"
        description="Your account is not currently linked to a proxy organization."
      />
    );
  }

  const subscription =
    organization.subscription;

  const usage =
    organization.finalizedUsage;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">
          Customer workspace
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Welcome,{" "}
          {
            resource.data?.customer
              .fullName
          }
        </h1>

        <p className="mt-2 text-muted-foreground">
          Review your service plan, credentials and usage.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Current plan"
          value={
            subscription?.plan.name ??
            "No plan"
          }
          description={
            subscription
              ? formatMoney(
                  subscription.plan
                    .monthlyPriceCents,
                )
              : "Subscription required"
          }
        />

        <MetricCard
          title="Bandwidth used"
          value={formatBytes(
            usage?.totalBytes,
          )}
          description={
            subscription?.plan
              .bandwidthLimitBytes
              ? `of ${formatBytes(
                  subscription.plan
                    .bandwidthLimitBytes,
                )}`
              : "Unlimited or not configured"
          }
        />

        <MetricCard
          title="Credentials"
          value={
            organization.totals
              .credentials
          }
          description={
            <span className="flex items-center gap-2">
              <KeyRound className="size-4" />
              Limit:{" "}
              {subscription?.plan
                .credentialLimit ?? 0}
            </span>
          }
        />

        <MetricCard
          title="Connections"
          value={
            usage?.connectionCount ??
            organization.totals.sessions
          }
          description={
            <span className="flex items-center gap-2">
              <Waypoints className="size-4" />
              Finalized sessions
            </span>
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="border-b p-5">
            <h2 className="font-semibold">
              Proxy credentials
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Active and previously issued credentials.
            </p>
          </div>

          {organization.credentials
            .length === 0 ? (
            <div className="p-6">
              <EmptyPanel
                title="No credentials"
                description="A proxy credential has not yet been issued to your account."
              />
            </div>
          ) : (
            <div className="divide-y">
              {organization.credentials.map(
                (credential) => (
                  <div
                    key={credential.id}
                    className="p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-sm font-medium">
                          {
                            credential.username
                          }
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          Secret prefix:{" "}
                          {
                            credential.secretPrefix
                          }
                          …
                        </p>
                      </div>

                      <StatusBadge
                        status={
                          credential.status
                        }
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {credential.allowedProtocols.map(
                        (protocol) => (
                          <span
                            key={
                              protocol
                            }
                            className="rounded-lg bg-muted px-2.5 py-1 text-xs"
                          >
                            {protocol}
                          </span>
                        ),
                      )}
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      Last used:{" "}
                      {formatDate(
                        credential.lastUsedAt,
                      )}
                    </p>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <article className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-3">
              <Network className="size-5 text-primary" />

              <h2 className="font-semibold">
                Organization
              </h2>
            </div>

            <p className="mt-4 text-lg font-medium">
              {organization.name}
            </p>

            <p className="text-sm text-muted-foreground">
              {organization.slug}
            </p>
          </article>

          <article className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-3">
              <Radio className="size-5 text-primary" />

              <h2 className="font-semibold">
                Service state
              </h2>
            </div>

            <div className="mt-4">
              <StatusBadge
                status={
                  subscription?.status ??
                  "INACTIVE"
                }
              />
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Maximum concurrent connections:{" "}
              <span className="font-medium text-foreground">
                {subscription?.plan
                  .maxConcurrentConnections ??
                  0}
              </span>
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
