"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  useParams,
} from "next/navigation";

import {
  ArrowLeft,
  Check,
  Clipboard,
  KeyRound,
  RefreshCw,
  ShieldOff,
} from "lucide-react";

import Link from "next/link";

import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  MetricCard,
  StatusBadge,
} from "@/components/portal/ui";

import {
  requestJSON,
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatBytes,
  formatDate,
  formatMoney,
} from "@/lib/portal/format";

type Plan = {
  id: string;
  name: string;
  code: string;
  monthlyPriceCents: number;
  bandwidthLimitBytes:
    | string
    | null;
  credentialLimit: number;
  deviceLimit: number;
  maxConcurrentConnections:
    number;
  connectionsPerMinute: number;
};

type PlansResponse = {
  plans: Plan[];
};

type Subscription = {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;

  plan: Plan;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;

  _count: {
    members: number;
    credentials: number;
    devices: number;
    sessions: number;
  };

  subscriptions:
    Subscription[];
};

type Credential = {
  id: string;
  organizationId: string;
  username: string;
  secretPrefix: string;
  status: string;
  allowedProtocols: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type CustomerResponse = {
  customer: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    status: string;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
    createdAt: string;

    totals: {
      ownedOrganizations: number;
      memberships: number;
      credentials: number;
      devices: number;
      sessions: number;
      activeLoginSessions: number;
    };

    organizations:
      Organization[];

    credentials:
      Credential[];
  };
};

type CreatedCredential = {
  id: string;
  username: string;
  secret: string;
};

function extractCreatedCredential(
  payload: unknown,
): CreatedCredential | null {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return null;
  }

  const root =
    payload as Record<
      string,
      unknown
    >;

  const credential =
    root.credential &&
    typeof root.credential ===
      "object"
      ? root.credential as Record<
          string,
          unknown
        >
      : root;

  const id =
    credential.id;

  const username =
    credential.username;

  const secret =
    credential.secret ??
    root.secret;

  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    typeof secret !== "string"
  ) {
    return null;
  }

  return {
    id,
    username,
    secret,
  };
}

function CopyButton({
  value,
}: {
  value: string;
}) {
  const [
    copied,
    setCopied,
  ] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(
      value,
    );

    setCopied(true);

    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"
    >
      {copied ? (
        <>
          <Check className="size-4" />
          Copied
        </>
      ) : (
        <>
          <Clipboard className="size-4" />
          Copy
        </>
      )}
    </button>
  );
}

export default function CustomerDetailPage() {
  const params = useParams();

  const customerId =
    typeof params.customerId ===
    "string"
      ? params.customerId
      : "";

  const customerResource =
    useApiResource<CustomerResponse>(
      customerId
        ? `/api/admin/customers/${customerId}`
        : null,
    );

  const plansResource =
    useApiResource<PlansResponse>(
      "/api/admin/plans",
    );

  const [
    selectedOrganizationId,
    setSelectedOrganizationId,
  ] = useState("");

  const [
    selectedPlanId,
    setSelectedPlanId,
  ] = useState("");

  const [
    subscriptionStatus,
    setSubscriptionStatus,
  ] = useState<
    "ACTIVE" | "TRIAL"
  >("ACTIVE");

  const [
    periodDays,
    setPeriodDays,
  ] = useState(30);

  const [
    createdCredential,
    setCreatedCredential,
  ] = useState<CreatedCredential | null>(
    null,
  );

  const [
    actionLoading,
    setActionLoading,
  ] = useState(false);

  const [
    actionError,
    setActionError,
  ] = useState<string | null>(
    null,
  );

  const customer =
    customerResource.data?.customer;

  const organizationId =
    selectedOrganizationId ||
    customer?.organizations[0]?.id ||
    "";

  const organization = useMemo(
    () =>
      customer?.organizations.find(
        (item) =>
          item.id === organizationId,
      ) ?? null,
    [
      customer,
      organizationId,
    ],
  );

  async function createCredential() {
    if (!organizationId) {
      return;
    }

    setActionLoading(true);
    setActionError(null);
    setCreatedCredential(null);

    try {
      const payload =
        await requestJSON<unknown>(
          `/api/admin/customers/${customerId}/credentials`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              organizationId,

              allowedProtocols: [
                "HTTP",
                "HTTPS",
              ],

              expiresInDays: 90,
            }),
          },
        );

      const credential =
        extractCreatedCredential(
          payload,
        );

      if (!credential) {
        throw new Error(
          "The credential was created, but its one-time secret could not be read.",
        );
      }

      setCreatedCredential(
        credential,
      );

      customerResource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The credential could not be created.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function updateCredential(
    credential: Credential,
    action:
      | "revoke"
      | "reactivate",
  ) {
    setActionLoading(true);
    setActionError(null);

    try {
      await requestJSON(
        `/api/admin/credentials/${credential.id}/${action}`,
        {
          method: "POST",
        },
      );

      customerResource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The credential could not be updated.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function assignSubscription() {
    if (
      !organizationId ||
      !selectedPlanId
    ) {
      setActionError(
        "Select an organization and subscription plan.",
      );

      return;
    }

    setActionLoading(true);
    setActionError(null);

    try {
      await requestJSON(
        `/api/admin/customers/${customerId}/subscription`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            action: "ASSIGN",
            organizationId,
            planId: selectedPlanId,
            status:
              subscriptionStatus,
            periodDays,
          }),
        },
      );

      customerResource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The subscription could not be assigned.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelSubscription() {
    if (!organizationId) {
      return;
    }

    setActionLoading(true);
    setActionError(null);

    try {
      await requestJSON(
        `/api/admin/customers/${customerId}/subscription`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            action: "CANCEL",
            organizationId,
          }),
        },
      );

      customerResource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The subscription could not be canceled.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  if (
    customerResource.loading ||
    plansResource.loading
  ) {
    return <LoadingPanel />;
  }

  const pageError =
    customerResource.error ??
    plansResource.error;

  if (pageError) {
    return (
      <ErrorPanel
        message={pageError}
      />
    );
  }

  if (!customer) {
    return (
      <EmptyPanel
        title="Customer unavailable"
        description="The requested customer account could not be loaded."
      />
    );
  }

  const credentials =
    customer.credentials.filter(
      (credential) =>
        !organizationId ||
        credential.organizationId ===
          organizationId,
    );

  const currentSubscription =
    organization
      ?.subscriptions.find(
        (subscription) =>
          [
            "ACTIVE",
            "TRIAL",
          ].includes(
            subscription.status,
          ),
      ) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to customers
        </Link>

        <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row">
          <div>
            <p className="text-sm font-medium text-primary">
              Customer account
            </p>

            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {customer.fullName}
            </h1>

            <p className="mt-2 text-muted-foreground">
              {customer.email}
            </p>
          </div>

          <StatusBadge
            status={customer.status}
          />
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Organizations"
          value={
            customer.totals
              .ownedOrganizations
          }
        />

        <MetricCard
          title="Credentials"
          value={
            customer.totals
              .credentials
          }
        />

        <MetricCard
          title="Proxy sessions"
          value={
            customer.totals.sessions
          }
        />

        <MetricCard
          title="Login sessions"
          value={
            customer.totals
              .activeLoginSessions
          }
        />
      </section>

      {customer.organizations.length >
      1 ? (
        <select
          value={organizationId}
          onChange={(event) => {
            setSelectedOrganizationId(
              event.target.value,
            );

            setCreatedCredential(
              null,
            );
          }}
          className="h-11 rounded-xl border bg-background px-4 text-sm"
        >
          {customer.organizations.map(
            (item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.name}
              </option>
            ),
          )}
        </select>
      ) : null}

      {actionError ? (
        <ErrorPanel
          message={actionError}
        />
      ) : null}

      {createdCredential ? (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="font-semibold">
            Save this proxy secret now
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            This secret will not be displayed again.
          </p>

          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-background p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Username
              </p>

              <div className="mt-2 flex items-center justify-between gap-3">
                <code className="break-all text-sm">
                  {
                    createdCredential.username
                  }
                </code>

                <CopyButton
                  value={
                    createdCredential.username
                  }
                />
              </div>
            </div>

            <div className="rounded-xl bg-background p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Secret
              </p>

              <div className="mt-2 flex items-center justify-between gap-3">
                <code className="break-all text-sm">
                  {
                    createdCredential.secret
                  }
                </code>

                <CopyButton
                  value={
                    createdCredential.secret
                  }
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">
            Subscription
          </h2>

          {currentSubscription ? (
            <div className="mt-5 rounded-xl bg-muted/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {
                      currentSubscription
                        .plan.name
                    }
                  </p>

                  <p className="text-sm text-muted-foreground">
                    {formatMoney(
                      currentSubscription
                        .plan
                        .monthlyPriceCents,
                    )}
                  </p>
                </div>

                <StatusBadge
                  status={
                    currentSubscription.status
                  }
                />
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                Ends{" "}
                {formatDate(
                  currentSubscription
                    .currentPeriodEnd,
                )}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              This organization has no active subscription.
            </p>
          )}

          <div className="mt-5 space-y-3">
            <select
              value={selectedPlanId}
              onChange={(event) =>
                setSelectedPlanId(
                  event.target.value,
                )
              }
              className="h-11 w-full rounded-xl border bg-background px-4 text-sm"
            >
              <option value="">
                Select a plan
              </option>

              {plansResource.data?.plans.map(
                (plan) => (
                  <option
                    key={plan.id}
                    value={plan.id}
                  >
                    {plan.name} —{" "}
                    {formatMoney(
                      plan.monthlyPriceCents,
                    )}
                  </option>
                ),
              )}
            </select>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={
                  subscriptionStatus
                }
                onChange={(event) =>
                  setSubscriptionStatus(
                    event.target.value as
                      | "ACTIVE"
                      | "TRIAL",
                  )
                }
                className="h-11 rounded-xl border bg-background px-4 text-sm"
              >
                <option value="ACTIVE">
                  Active
                </option>

                <option value="TRIAL">
                  Trial
                </option>
              </select>

              <input
                type="number"
                min={1}
                max={366}
                value={periodDays}
                onChange={(event) =>
                  setPeriodDays(
                    Number.parseInt(
                      event.target.value,
                      10,
                    ) || 30,
                  )
                }
                className="h-11 rounded-xl border bg-background px-4 text-sm"
              />
            </div>

            <button
              type="button"
              disabled={actionLoading}
              onClick={assignSubscription}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Assign subscription
            </button>

            {currentSubscription ? (
              <button
                type="button"
                disabled={actionLoading}
                onClick={cancelSubscription}
                className="w-full rounded-xl border border-destructive/30 px-4 py-2.5 text-sm font-medium text-destructive disabled:opacity-50"
              >
                Cancel subscription
              </button>
            ) : null}
          </div>
        </article>

        <article className="rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">
            Organization limits
          </h2>

          {currentSubscription ? (
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  Bandwidth
                </dt>

                <dd className="mt-1 font-medium">
                  {currentSubscription
                    .plan
                    .bandwidthLimitBytes
                    ? formatBytes(
                        currentSubscription
                          .plan
                          .bandwidthLimitBytes,
                      )
                    : "Unlimited"}
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Credentials
                </dt>

                <dd className="mt-1 font-medium">
                  {
                    currentSubscription
                      .plan
                      .credentialLimit
                  }
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Devices
                </dt>

                <dd className="mt-1 font-medium">
                  {
                    currentSubscription
                      .plan.deviceLimit
                  }
                </dd>
              </div>

              <div>
                <dt className="text-muted-foreground">
                  Concurrent connections
                </dt>

                <dd className="mt-1 font-medium">
                  {
                    currentSubscription
                      .plan
                      .maxConcurrentConnections
                  }
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Assign a subscription to view plan limits.
            </p>
          )}
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-col justify-between gap-4 border-b p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">
              Proxy credentials
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Issue and manage customer proxy access.
            </p>
          </div>

          <button
            type="button"
            disabled={
              actionLoading ||
              !currentSubscription
            }
            onClick={createCredential}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <KeyRound className="size-4" />
            Generate credential
          </button>
        </div>

        {credentials.length === 0 ? (
          <div className="p-6">
            <EmptyPanel
              title="No credentials"
              description="No proxy credentials have been issued for this organization."
            />
          </div>
        ) : (
          <div className="divide-y">
            {credentials.map(
              (credential) => (
                <div
                  key={credential.id}
                  className="flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="text-sm font-medium">
                        {
                          credential.username
                        }
                      </code>

                      <StatusBadge
                        status={
                          credential.status
                        }
                      />
                    </div>

                    <p className="mt-2 text-xs text-muted-foreground">
                      Created{" "}
                      {formatDate(
                        credential.createdAt,
                      )}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Last used{" "}
                      {formatDate(
                        credential.lastUsedAt,
                      )}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {credential.status ===
                    "ACTIVE" ? (
                      <button
                        type="button"
                        disabled={
                          actionLoading
                        }
                        onClick={() =>
                          updateCredential(
                            credential,
                            "revoke",
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive disabled:opacity-50"
                      >
                        <ShieldOff className="size-4" />
                        Revoke
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          actionLoading
                        }
                        onClick={() =>
                          updateCredential(
                            credential,
                            "reactivate",
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50"
                      >
                        <RefreshCw className="size-4" />
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
