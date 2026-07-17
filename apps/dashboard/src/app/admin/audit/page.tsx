"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  ErrorPanel,
  LoadingPanel,
} from "@/components/portal/ui";

import {
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatDate,
} from "@/lib/portal/format";

type AuditRecord = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  organizationId: string | null;
  metadata: unknown;
  createdAt: string;

  actor: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  } | null;
};

type AuditResponse = {
  records: AuditRecord[];

  pagination: {
    page: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

export default function AuditPage() {
  const [
    action,
    setAction,
  ] = useState("");

  const [
    resourceType,
    setResourceType,
  ] = useState("");

  const [
    page,
    setPage,
  ] = useState(1);

  const url = useMemo(() => {
    const params =
      new URLSearchParams({
        page: page.toString(),
        limit: "30",
      });

    if (action.trim()) {
      params.set(
        "action",
        action.trim(),
      );
    }

    if (resourceType.trim()) {
      params.set(
        "resourceType",
        resourceType.trim(),
      );
    }

    return `/api/admin/audit?${params.toString()}`;
  }, [
    action,
    resourceType,
    page,
  ]);

  const resource =
    useApiResource<AuditResponse>(
      url,
    );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Security and operations
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Audit activity
        </h1>

        <p className="mt-2 text-muted-foreground">
          Review administrative and infrastructure changes.
        </p>
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <input
          value={action}
          onChange={(event) => {
            setAction(
              event.target.value,
            );

            setPage(1);
          }}
          placeholder="Filter by action"
          className="h-11 rounded-xl border bg-background px-4 text-sm"
        />

        <input
          value={resourceType}
          onChange={(event) => {
            setResourceType(
              event.target.value,
            );

            setPage(1);
          }}
          placeholder="Filter by resource type"
          className="h-11 rounded-xl border bg-background px-4 text-sm"
        />
      </div>

      {resource.loading ? (
        <LoadingPanel />
      ) : resource.error ? (
        <ErrorPanel
          message={resource.error}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">
                    Time
                  </th>

                  <th className="px-5 py-4">
                    Action
                  </th>

                  <th className="px-5 py-4">
                    Actor
                  </th>

                  <th className="px-5 py-4">
                    Resource
                  </th>

                  <th className="px-5 py-4">
                    Resource ID
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {resource.data?.records.map(
                  (record) => (
                    <tr
                      key={record.id}
                      className="hover:bg-muted/30"
                    >
                      <td className="px-5 py-4 text-muted-foreground">
                        {formatDate(
                          record.createdAt,
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <code className="text-xs">
                          {record.action}
                        </code>
                      </td>

                      <td className="px-5 py-4">
                        {record.actor ? (
                          <>
                            <p className="font-medium">
                              {
                                record.actor
                                  .fullName
                              }
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {
                                record.actor
                                  .email
                              }
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            System
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {
                          record.resourceType
                        }
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                        {record.resourceId ??
                          "—"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t p-4">
            <p className="text-sm text-muted-foreground">
              {resource.data
                ?.pagination.totalItems ??
                0}{" "}
              records
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  !resource.data
                    ?.pagination
                    .hasPreviousPage
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        current - 1,
                        1,
                      ),
                  )
                }
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              >
                Previous
              </button>

              <button
                type="button"
                disabled={
                  !resource.data
                    ?.pagination
                    .hasNextPage
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      current + 1,
                  )
                }
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
