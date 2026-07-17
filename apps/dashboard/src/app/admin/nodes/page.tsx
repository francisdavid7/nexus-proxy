"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  ErrorPanel,
  LoadingPanel,
  StatusBadge,
} from "@/components/portal/ui";

import {
  requestJSON,
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatDate,
} from "@/lib/portal/format";

type NodeRecord = {
  id: string;
  name: string;
  hostname: string;
  publicIp: string | null;
  httpPort: number;
  protocols: string[];
  status: string;
  version: string | null;
  heartbeatFresh: boolean;
  lastHeartbeatAt: string | null;
  activeAgentKeys: number;

  location: {
    city: string;
    country: string;
    code: string;
  };

  capacity: {
    active: number;
    maximum: number;
    available: number;
    usedPercentage: number | null;
  };
};

type NodesResponse = {
  nodes: NodeRecord[];
};

export default function NodesPage() {
  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState("");

  const [
    updatingNode,
    setUpdatingNode,
  ] = useState<string | null>(
    null,
  );

  const [actionError, setActionError] =
    useState<string | null>(null);

  const url = useMemo(() => {
    const params =
      new URLSearchParams();

    if (search.trim()) {
      params.set(
        "search",
        search.trim(),
      );
    }

    if (status) {
      params.set(
        "status",
        status,
      );
    }

    const query =
      params.toString();

    return query
      ? `/api/admin/nodes?${query}`
      : "/api/admin/nodes";
  }, [search, status]);

  const resource =
    useApiResource<NodesResponse>(
      url,
    );

  async function setMaintenance(
    node: NodeRecord,
  ) {
    setUpdatingNode(node.id);
    setActionError(null);

    try {
      await requestJSON(
        `/api/admin/nodes/${node.id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            maintenance:
              node.status !==
              "MAINTENANCE",
          }),
        },
      );

      resource.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The node could not be updated.",
      );
    } finally {
      setUpdatingNode(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Infrastructure management
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Proxy nodes
        </h1>

        <p className="mt-2 text-muted-foreground">
          Monitor heartbeats, capacity, agent keys and maintenance state.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row">
        <input
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value,
            )
          }
          placeholder="Search node, hostname or IP"
          className="h-11 flex-1 rounded-xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <select
          value={status}
          onChange={(event) =>
            setStatus(
              event.target.value,
            )
          }
          className="h-11 rounded-xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">
            All statuses
          </option>
          <option value="ONLINE">
            Online
          </option>
          <option value="DEGRADED">
            Degraded
          </option>
          <option value="OFFLINE">
            Offline
          </option>
          <option value="MAINTENANCE">
            Maintenance
          </option>
          <option value="PROVISIONING">
            Provisioning
          </option>
        </select>
      </div>

      {actionError ? (
        <ErrorPanel
          message={actionError}
        />
      ) : null}

      {resource.loading ? (
        <LoadingPanel />
      ) : resource.error ? (
        <ErrorPanel
          message={resource.error}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {resource.data?.nodes.map(
            (node) => (
              <article
                key={node.id}
                className="rounded-2xl border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">
                      {node.name}
                    </h2>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {node.location.city},{" "}
                      {node.location.country}
                    </p>
                  </div>

                  <StatusBadge
                    status={node.status}
                  />
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">
                      Address
                    </dt>
                    <dd className="mt-1 font-medium">
                      {node.publicIp ??
                        "Not assigned"}
                      :
                      {node.httpPort}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted-foreground">
                      Version
                    </dt>
                    <dd className="mt-1 font-medium">
                      {node.version ??
                        "Unknown"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted-foreground">
                      Agent keys
                    </dt>
                    <dd className="mt-1 font-medium">
                      {
                        node.activeAgentKeys
                      }
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted-foreground">
                      Heartbeat
                    </dt>
                    <dd className="mt-1 font-medium">
                      {node.heartbeatFresh
                        ? "Fresh"
                        : "Stale"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Connection capacity
                    </span>

                    <span>
                      {node.capacity.active}/
                      {
                        node.capacity
                          .maximum
                      }
                    </span>
                  </div>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${
                          node.capacity
                            .usedPercentage ??
                          0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                  Last heartbeat:{" "}
                  {formatDate(
                    node.lastHeartbeatAt,
                  )}
                </p>

                <button
                  type="button"
                  disabled={
                    updatingNode ===
                    node.id
                  }
                  onClick={() =>
                    setMaintenance(node)
                  }
                  className="mt-5 w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingNode ===
                  node.id
                    ? "Updating…"
                    : node.status ===
                        "MAINTENANCE"
                      ? "Exit maintenance"
                      : "Enter maintenance"}
                </button>
              </article>
            ),
          )}
        </div>
      )}
    </div>
  );
}
