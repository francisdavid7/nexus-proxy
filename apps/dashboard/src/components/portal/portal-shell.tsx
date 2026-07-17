"use client";

import type {
  ReactNode,
} from "react";

import Link from "next/link";

import {
  usePathname,
  useRouter,
} from "next/navigation";

import {
  Activity,
  Gauge,
  LogOut,
  Network,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";

type PortalRole =
  | "admin"
  | "customer";

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof Gauge;
};

const adminNavigation:
  NavigationItem[] = [
    {
      label: "Overview",
      href: "/admin",
      icon: Gauge,
    },
    {
      label: "Customers",
      href: "/admin/customers",
      icon: Users,
    },
    {
      label: "Proxy nodes",
      href: "/admin/nodes",
      icon: Server,
    },
    {
      label: "Audit activity",
      href: "/admin/audit",
      icon: ScrollText,
    },
  ];

const customerNavigation:
  NavigationItem[] = [
    {
      label: "Overview",
      href: "/customer",
      icon: Gauge,
    },
    {
      label: "Connections",
      href: "/customer/connections",
      icon: Activity,
    },
    {
      label: "Proxy setup",
      href: "/customer/proxy",
      icon: Settings2,
    },
  ];

function isActiveRoute(
  pathname: string,
  href: string,
): boolean {
  if (
    href === "/admin" ||
    href === "/customer"
  ) {
    return pathname === href;
  }

  return (
    pathname === href ||
    pathname.startsWith(
      `${href}/`,
    )
  );
}

export function PortalShell({
  portal,
  children,
}: {
  portal: PortalRole;
  children: ReactNode;
}) {
  const pathname =
    usePathname();

  const router =
    useRouter();

  const navigation =
    portal === "admin"
      ? adminNavigation
      : customerNavigation;

  async function logout() {
    try {
      await fetch(
        "/api/auth/logout",
        {
          method: "POST",
          credentials: "include",
        },
      );
    } finally {
      router.replace(
        "/auth/login",
      );

      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background lg:block">
        <div className="flex h-20 items-center gap-3 border-b px-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Network className="size-5" />
          </div>

          <div>
            <p className="font-semibold">
              Nexus Proxy
            </p>

            <p className="text-xs capitalize text-muted-foreground">
              {portal} portal
            </p>
          </div>
        </div>

        <nav className="space-y-1 p-4">
          {navigation.map(
            (item) => {
              const Icon =
                item.icon;

              const active =
                isActiveRoute(
                  pathname,
                  item.href,
                );

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "flex items-center gap-3 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                      : "flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  }
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            },
          )}
        </nav>

        <div className="absolute inset-x-4 bottom-4">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b bg-background/90 px-5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-primary" />

            <div>
              <p className="font-medium">
                Secure control portal
              </p>

              <p className="text-xs text-muted-foreground">
                Manage proxy access and infrastructure
              </p>
            </div>
          </div>
        </header>

        <div className="border-b bg-background px-4 py-3 lg:hidden">
          <nav className="flex gap-2 overflow-x-auto">
            {navigation.map(
              (item) => {
                const Icon =
                  item.icon;

                const active =
                  isActiveRoute(
                    pathname,
                    item.href,
                  );

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      active
                        ? "flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                        : "flex shrink-0 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
                    }
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              },
            )}
          </nav>
        </div>

        <main className="p-5 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
