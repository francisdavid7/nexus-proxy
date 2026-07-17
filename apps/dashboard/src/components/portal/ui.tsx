import type {
  ReactNode,
} from "react";

type MetricCardProps = {
  title: string;
  value: ReactNode;
  description?: ReactNode;
};

export function MetricCard({
  title,
  value,
  description,
}: MetricCardProps) {
  return (
    <article className="rounded-2xl border bg-card p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {title}
      </p>

      <div className="mt-2 text-3xl font-semibold tracking-tight">
        {value}
      </div>

      {description ? (
        <div className="mt-2 text-sm text-muted-foreground">
          {description}
        </div>
      ) : null}
    </article>
  );
}

const statusStyles:
  Record<string, string> = {
    ACTIVE:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",

    ONLINE:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",

    CLOSED:
      "bg-slate-500/10 text-slate-700 dark:text-slate-300",

    TRIAL:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400",

    DEGRADED:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400",

    PENDING_VERIFICATION:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400",

    MAINTENANCE:
      "bg-purple-500/10 text-purple-700 dark:text-purple-400",

    PROVISIONING:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400",

    OFFLINE:
      "bg-red-500/10 text-red-700 dark:text-red-400",

    FAILED:
      "bg-red-500/10 text-red-700 dark:text-red-400",

    REVOKED:
      "bg-red-500/10 text-red-700 dark:text-red-400",

    SUSPENDED:
      "bg-red-500/10 text-red-700 dark:text-red-400",

    DISABLED:
      "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",

    EXPIRED:
      "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  };

export function StatusBadge({
  status,
}: {
  status: string;
}) {
  const style =
    statusStyles[status] ??
    "bg-muted text-muted-foreground";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${style}`}
    >
      {status
        .toLowerCase()
        .replaceAll("_", " ")}
    </span>
  );
}

export function LoadingPanel() {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
      Loading information…
    </div>
  );
}

export function ErrorPanel({
  message,
}: {
  message: string;
}) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
      {message}
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
      <h3 className="font-medium">
        {title}
      </h3>

      <p className="mt-2 text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
