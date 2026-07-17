import type {
  ReactNode,
} from "react";

import {
  AccessGate,
} from "@/components/portal/access-gate";

import {
  PortalShell,
} from "@/components/portal/portal-shell";

export function PortalLayout({
  portal,
  children,
}: {
  portal: "admin" | "customer";
  children: ReactNode;
}) {
  return (
    <AccessGate portal={portal}>
      <PortalShell portal={portal}>
        {children}
      </PortalShell>
    </AccessGate>
  );
}
