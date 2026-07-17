"use client";

import Link from "next/link";

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
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatDate,
} from "@/lib/portal/format";

type Customer = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;

  totals: {
    organizations: number;
    credentials: number;
    devices: number;
    sessions: number;
  };
};

type ResponseData = {
  customers: Customer[];

  pagination: {
    page: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

export default function CustomersPage() {
  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState("");

  const [page, setPage] =
    useState(1);

  const url = useMemo(() => {
    const params =
      new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });

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

    return `/api/admin/customers?${params.toString()}`;
  }, [page, search, status]);

  const resource =
    useApiResource<ResponseData>(
      url,
    );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Account management
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Customers
        </h1>

        <p className="mt-2 text-muted-foreground">
          Review customer accounts, usage relationships and credentials.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row">
        <input
          value={search}
          onChange={(event) => {
            setSearch(
              event.target.value,
            );

            setPage(1);
          }}
          placeholder="Search name, email or organization"
          className="h-11 flex-1 rounded-xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        <select
          value={status}
          onChange={(event) => {
            setStatus(
              event.target.value,
            );

            setPage(1);
          }}
          className="h-11 rounded-xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">
            All statuses
          </option>
          <option value="ACTIVE">
            Active
          </option>
          <option value="PENDING_VERIFICATION">
            Pending verification
          </option>
          <option value="SUSPENDED">
            Suspended
          </option>
          <option value="DISABLED">
            Disabled
          </option>
        </select>
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
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-4">
                    Customer
                  </th>
                  <th className="px-5 py-4">
                    Status
                  </th>
                  <th className="px-5 py-4">
                    Organizations
                  </th>
                  <th className="px-5 py-4">
                    Credentials
                  </th>
                  <th className="px-5 py-4">
                    Sessions
                  </th>
                  <th className="px-5 py-4">
                    Created
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {resource.data?.customers.map(
                  (customer) => (
                    <tr
                      key={customer.id}
                      className="hover:bg-muted/30"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="font-medium hover:underline"
                        >
                          {customer.fullName}
                        </Link>

                        <p className="text-muted-foreground">
                          {customer.email}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          {customer.emailVerified
                            ? "Email verified"
                            : "Email not verified"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <StatusBadge
                          status={
                            customer.status
                          }
                        />
                      </td>

                      <td className="px-5 py-4">
                        {
                          customer.totals
                            .organizations
                        }
                      </td>

                      <td className="px-5 py-4">
                        {
                          customer.totals
                            .credentials
                        }
                      </td>

                      <td className="px-5 py-4">
                        {
                          customer.totals
                            .sessions
                        }
                      </td>

                      <td className="px-5 py-4 text-muted-foreground">
                        {formatDate(
                          customer.createdAt,
                        )}
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
              customers
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
                className="rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
                className="rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
