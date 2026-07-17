"use client";

import {
  Activity,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  ErrorPanel,
  LoadingPanel,
  MetricCard,
  StatusBadge,
} from "@/components/portal/ui";

import {
  useApiResource,
} from "@/hooks/use-api-resource";

import {
  formatDate,
} from "@/lib/portal/format";

type CustomerSummary = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
};

type CustomerResponse = {
  customers: CustomerSummary[];

  pagination: {
    totalItems: number;
  };
};

type NodeSummary = {
  id: string;
  name: string;
  status: string;
  heartbeatFresh: boolean;
  lastHeartbeatAt: string | null;

  location: {
    country: string;
    city: string;
  };

  capacity: {
    active: number;
    maximum: number;
    usedPercentage: number | null;
  };
};

type NodesResponse = {
  nodes: NodeSummary[];
};

export default function AdminOverviewPage() {
  const customers =
    useApiResource<CustomerResponse>(
      "/api/admin/customers?page=1&limit=5",
    );

  const activeCustomers =
    useApiResource<CustomerResponse>(
      "/api/admin/customers?page=1&limit=1&status=ACTIVE",
    );

  const nodes =
    useApiResource<NodesResponse>(
      "/api/admin/nodes",
    );

  const loading =
    customers.loading ||
    activeCustomers.loading ||
    nodes.loading;

  const error =
    customers.error ??
    activeCustomers.error ??
    nodes.error;

  if (loading) {
    return <LoadingPanel />;
  }

  if (error) {
    return (
      <ErrorPanel message={error} />
    );
  }

  const nodeList =
    nodes.data?.nodes ?? [];

  const onlineNodes =
    nodeList.filter(
      (node) =>
        node.status === "ONLINE" &&
        node.heartbeatFresh,
    ).length;

  const degradedNodes =
    nodeList.filter(
      (node) =>
        node.status === "DEGRADED",
    ).length;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">
          Infrastructure overview
        </p>

        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Admin dashboard
        </h1>

        <p className="mt-2 text-muted-foreground">
          Monitor customers, proxy nodes and service health.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total customers"
          value={
            customers.data
              ?.pagination.totalItems ??
            0
          }
          description={
            <span className="flex items-center gap-2">
              <Users className="size-4" />
              Registered accounts
            </span>
          }
        />

        <MetricCard
          title="Active customers"
          value={
            activeCustomers.data
              ?.pagination.totalItems ??
            0
          }
          description={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Enabled customer accounts
            </span>
          }
        />

        <MetricCard
          title="Healthy nodes"
          value={onlineNodes}
          description={
            <span className="flex items-center gap-2">
              <Server className="size-4" />
              Online with a fresh heartbeat
            </span>
          }
        />

        <MetricCard
          title="Degraded nodes"
          value={degradedNodes}
          description={
            <span className="flex items-center gap-2">
              <Activity className="size-4" />
              Require investigation
            </span>
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="border-b p-5">
            <h2 className="font-semibold">
              Recent customers
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Most recently created customer accounts.
            </p>
          </div>

          <div className="divide-y">
            {customers.data?.customers.map(
              (customer) => (
                <div
                  key={customer.id}
                  className="flex items-center justify-between gap-4 p-5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {customer.fullName}
                    </p>

                    <p className="truncate text-sm text-muted-foreground">
                      {customer.email}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(
                        customer.createdAt,
                      )}
                    </p>
                  </div>

                  <StatusBadge
                    status={
                      customer.status
                    }
                  />
                </div>
              ),
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="border-b p-5">
            <h2 className="font-semibold">
              Proxy node health
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Current availability and capacity.
            </p>
          </div>

          <div className="divide-y">
            {nodeList.map(
              (node) => (
                <div
                  key={node.id}
                  className="p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {node.name}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {node.location.city},{" "}
                        {node.location.country}
                      </p>
                    </div>

                    <StatusBadge
                      status={node.status}
                    />
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
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

                  <p className="mt-2 text-xs text-muted-foreground">
                    {node.capacity.active} of{" "}
                    {node.capacity.maximum} connections
                  </p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
