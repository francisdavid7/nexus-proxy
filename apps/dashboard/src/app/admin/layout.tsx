import type {
  ReactNode,
} from "react";

import {
  PortalLayout,
} from "@/components/portal/portal-layout";

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PortalLayout portal="admin">
      {children}
    </PortalLayout>
  );
}
