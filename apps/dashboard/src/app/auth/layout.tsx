import type {
  Metadata,
} from "next";

import type {
  ReactNode,
} from "react";

export const metadata:
  Metadata = {
  title: "Sign in | Nexus Proxy",

  description:
    "Secure access to the Nexus Proxy control portal.",
};

export default function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
