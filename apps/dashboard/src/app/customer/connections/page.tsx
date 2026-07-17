"use client";

import {
  useState,
} from "react";

import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  StatusBadge,
} from "@/components/portal/ui";

import {
  requestJSON,
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatBytes,
  formatDate,
  formatDuration,
} from "@/lib/portal/format";

type OverviewResponse = {
  organizations: Array<{
    id: string;
    name: string;
  }>;
};

type ConnectionRecord = {
  id: string;
  protocol: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;

  traffic: {
    bytesUploaded: string;
    bytesDownloaded: string;
    totalBytes: string;
  };

  credential: {
    username: string;
  };

  node: {
    status: string;

    location: {
      city: string;
      country: string;
      code: string;
    };
  };
};

type ConnectionsResponse = {
  connections: ConnectionRecord[];

  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

type PaginationState = {
  organizationId: string;
  additionalConnections:
    ConnectionRecord[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
};

export default function ConnectionsPage() {
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

  const initialConnections =
    useApiResource<ConnectionsResponse>(
      organizationId
        ? `/api/customer/connections?organizationId=${encodeURIComponent(
            organizationId,
          )}&limit=20`
        : null,
    );

  const [
    pagination,
    setPagination,
  ] = useState<PaginationState>({
    organizationId: "",
    additionalConnections: [],
    cursor: null,
    hasMore: false,
    loading: false,
    error: null,
  });

  const paginationMatches =
    pagination.organizationId ===
    organizationId;

  const firstPageConnections =
    initialConnections.data
      ?.connections ?? [];

  const additionalConnections =
    paginationMatches
      ? pagination
          .additionalConnections
      : [];

  const connections = [
    ...firstPageConnections,
    ...additionalConnections,
  ];

  const cursor = paginationMatches
    ? pagination.cursor
    : initialConnections.data
        ?.pagination.nextCursor ??
      null;

  const hasMore = paginationMatches
    ? pagination.hasMore
    : initialConnections.data
        ?.pagination.hasMore ??
      false;

  const loading =
    initialConnections.loading ||
    (
      paginationMatches &&
      pagination.loading
    );

  const error =
    initialConnections.error ??
    (
      paginationMatches
        ? pagination.error
        : null
    );

  async function loadMore() {
    if (
      !organizationId ||
      !cursor ||
      loading
    ) {
      return;
    }

    const existingAdditional =
      paginationMatches
        ? pagination
            .additionalConnections
        : [];

    setPagination({
      organizationId,
      additionalConnections:
        existingAdditional,
      cursor,
      hasMore,
      loading: true,
      error: null,
    });

    try {
      const params =
        new URLSearchParams({
          organizationId,
          cursor,
          limit: "20",
        });

      const payload =
        await requestJSON<ConnectionsResponse>(
          `/api/customer/connections?${params.toString()}`,
        );

      setPagination({
        organizationId,

        additionalConnections: [
          ...existingAdditional,
          ...payload.connections,
        ],

        cursor:
          payload.pagination
            .nextCursor,

        hasMore:
          payload.pagination.hasMore,

        loading: false,
        error: null,
      });
    } catch (requestError) {
      setPagination({
        organizationId,
        additionalConnections:
          existingAdditional,
        cursor,
        hasMore,
        loading: false,

        error:
          requestError instanceof Error
            ? requestError.message
            : "More connection records could not be loaded.",
      });
    }
  }

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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Session activity
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Connection history
        </h1>

        <p className="mt-2 text-muted-foreground">
          Review proxy sessions without exposing source IP or destination data.
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

      {error ? (
        <ErrorPanel message={error} />
      ) : null}

      {initialConnections.loading ? (
        <LoadingPanel />
      ) : connections.length === 0 ? (
        <EmptyPanel
          title="No connection records"
          description="Proxy sessions will appear here after traffic is processed."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">
                    Started
                  </th>

                  <th className="px-5 py-4">
                    Credential
                  </th>

                  <th className="px-5 py-4">
                    Protocol
                  </th>

                  <th className="px-5 py-4">
                    Location
                  </th>

                  <th className="px-5 py-4">
                    Traffic
                  </th>

                  <th className="px-5 py-4">
                    Duration
                  </th>

                  <th className="px-5 py-4">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {connections.map(
                  (connection) => (
                    <tr
                      key={
                        connection.id
                      }
                    >
                      <td className="px-5 py-4 text-muted-foreground">
                        {formatDate(
                          connection.startedAt,
                        )}
                      </td>

                      <td className="px-5 py-4 font-mono text-xs">
                        {
                          connection
                            .credential
                            .username
                        }
                      </td>

                      <td className="px-5 py-4">
                        {
                          connection.protocol
                        }
                      </td>

                      <td className="px-5 py-4">
                        {
                          connection.node
                            .location.city
                        }
                        ,{" "}
                        {
                          connection.node
                            .location.country
                        }
                      </td>

                      <td className="px-5 py-4">
                        {formatBytes(
                          connection.traffic
                            .totalBytes,
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {formatDuration(
                          connection
                            .durationSeconds,
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <StatusBadge
                          status={
                            connection.status
                          }
                        />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <div className="border-t p-4 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={loadMore}
                className="rounded-xl border px-5 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {loading
                  ? "Loading…"
                  : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
