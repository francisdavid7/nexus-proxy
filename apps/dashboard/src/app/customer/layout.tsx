import type {
  ReactNode,
} from "react";

import {
  PortalLayout,
} from "@/components/portal/portal-layout";

export default function CustomerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PortalLayout portal="customer">
      {children}
    </PortalLayout>
  );
}
