"use client";

import {
  useState,
} from "react";

import {
  Check,
  Clipboard,
} from "lucide-react";

import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  StatusBadge,
} from "@/components/portal/ui";

import {
  useApiResource,
} from "@/hooks/use-api-resource";

type OverviewResponse = {
  organizations: Array<{
    id: string;
    name: string;
  }>;
};

type ProxyConfiguration = {
  credentialId: string;
  nodeId: string;
  username: string;
  secretPrefix: string;
  allowedProtocols: string[];

  location: {
    city: string;
    country: string;
    code: string;
  };

  proxy: {
    scheme: string;
    host: string;
    port: number;
    address: string;
    urlTemplate: string;
  };

  examples: {
    curlHttp: string;
    curlHttps: string;
  };
};

type ProxyResponse = {
  serviceAvailable: boolean;

  subscription: {
    status: string;

    plan: {
      name: string;
    };
  } | null;

  configurations:
    ProxyConfiguration[];

  important: {
    secretInstruction: string;
    httpsTraffic: string;
  };
};

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

    window.setTimeout(
      () => {
        setCopied(false);
      },
      1500,
    );
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

export default function ProxySetupPage() {
  const overview =
    useApiResource<OverviewResponse>(
      "/api/customer/overview",
    );

  const [
    selectedOrganizationId,
    setSelectedOrganizationId,
  ] = useState("");

  const organizationId =
    selectedOrganizationId ||
    overview.data
      ?.organizations[0]?.id ||
    "";

  const resource =
    useApiResource<ProxyResponse>(
      organizationId
        ? `/api/customer/proxy-config?organizationId=${encodeURIComponent(
            organizationId,
          )}`
        : null,
    );

  if (overview.loading) {
    return <LoadingPanel />;
  }

  if (overview.error) {
    return (
      <ErrorPanel
        message={overview.error}
      />
    );
  }

  if (!organizationId) {
    return (
      <EmptyPanel
        title="No organization available"
        description="Your account is not currently linked to a proxy organization."
      />
    );
  }

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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Client configuration
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Proxy setup
        </h1>

        <p className="mt-2 text-muted-foreground">
          Copy the connection information for your applications and devices.
        </p>
      </div>

      {(overview.data?.organizations
        .length ?? 0) > 1 ? (
        <select
          value={organizationId}
          onChange={(event) => {
            setSelectedOrganizationId(
              event.target.value,
            );
          }}
          className="h-11 rounded-xl border bg-background px-4 text-sm"
        >
          {overview.data
            ?.organizations.map(
              (organization) => (
                <option
                  key={organization.id}
                  value={
                    organization.id
                  }
                >
                  {organization.name}
                </option>
              ),
            )}
        </select>
      ) : null}

      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">
            Service status
          </h2>

          <StatusBadge
            status={
              resource.data
                ?.subscription
                ?.status ??
              "INACTIVE"
            }
          />
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          {
            resource.data
              ?.important
              .secretInstruction
          }
        </p>

        <p className="mt-1 text-sm text-muted-foreground">
          {
            resource.data
              ?.important
              .httpsTraffic
          }
        </p>
      </div>

      {!resource.data
        ?.serviceAvailable ? (
        <EmptyPanel
          title="Proxy service unavailable"
          description="A valid subscription, active credential and healthy proxy node are required."
        />
      ) : (
        <div className="grid gap-6">
          {resource.data
            .configurations.map(
              (configuration) => (
                <article
                  key={`${configuration.credentialId}:${configuration.nodeId}`}
                  className="rounded-2xl border bg-card p-5"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row">
                    <div>
                      <h2 className="font-semibold">
                        {
                          configuration
                            .location.city
                        }
                        ,{" "}
                        {
                          configuration
                            .location
                            .country
                        }
                      </h2>

                      <p className="mt-1 font-mono text-sm text-muted-foreground">
                        {
                          configuration
                            .proxy.address
                        }
                      </p>
                    </div>

                    <CopyButton
                      value={
                        configuration
                          .proxy.address
                      }
                    />
                  </div>

                  <dl className="mt-5 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-xl bg-muted/50 p-4">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Username
                      </dt>

                      <dd className="mt-2 break-all font-mono text-sm">
                        {
                          configuration
                            .username
                        }
                      </dd>
                    </div>

                    <div className="rounded-xl bg-muted/50 p-4">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Host
                      </dt>

                      <dd className="mt-2 break-all font-mono text-sm">
                        {
                          configuration
                            .proxy.host
                        }
                      </dd>
                    </div>

                    <div className="rounded-xl bg-muted/50 p-4">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Port
                      </dt>

                      <dd className="mt-2 font-mono text-sm">
                        {
                          configuration
                            .proxy.port
                        }
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          Proxy URL template
                        </p>

                        <CopyButton
                          value={
                            configuration
                              .proxy
                              .urlTemplate
                          }
                        />
                      </div>

                      <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100">
                        {
                          configuration
                            .proxy
                            .urlTemplate
                        }
                      </pre>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          HTTPS curl example
                        </p>

                        <CopyButton
                          value={
                            configuration
                              .examples
                              .curlHttps
                          }
                        />
                      </div>

                      <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100">
                        {
                          configuration
                            .examples
                            .curlHttps
                        }
                      </pre>
                    </div>
                  </div>
                </article>
              ),
            )}
        </div>
      )}
    </div>
  );
}
