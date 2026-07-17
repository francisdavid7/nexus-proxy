"use client";

import type {
  ReactNode,
} from "react";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  requestJSON,
} from "@/hooks/use-api-resource";

type PortalRole =
  | "admin"
  | "customer";

type AuthenticatedUser = {
  role: string;
};

function extractUser(
  payload: unknown,
): AuthenticatedUser | null {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return null;
  }

  if (
    "user" in payload &&
    payload.user &&
    typeof payload.user === "object" &&
    "role" in payload.user &&
    typeof payload.user.role ===
      "string"
  ) {
    return {
      role: payload.user.role,
    };
  }

  if (
    "role" in payload &&
    typeof payload.role === "string"
  ) {
    return {
      role: payload.role,
    };
  }

  return null;
}

export function AccessGate({
  portal,
  children,
}: {
  portal: PortalRole;
  children: ReactNode;
}) {
  const router = useRouter();

  const [
    authorized,
    setAuthorized,
  ] = useState(false);

  useEffect(() => {
    let active = true;

    requestJSON<unknown>(
      "/api/auth/me",
    )
      .then((payload) => {
        if (!active) {
          return;
        }

        const user =
          extractUser(payload);

        if (!user) {
          router.replace(
            "/auth/login",
          );

          return;
        }

        const isAdministrator =
          [
            "SUPER_ADMIN",
            "ADMIN",
            "SUPPORT",
          ].includes(user.role);

        const isCustomer =
          user.role === "CUSTOMER";

        if (
          portal === "admin" &&
          !isAdministrator
        ) {
          router.replace(
            isCustomer
              ? "/customer"
              : "/auth/login",
          );

          return;
        }

        if (
          portal === "customer" &&
          !isCustomer
        ) {
          router.replace(
            isAdministrator
              ? "/admin"
              : "/auth/login",
          );

          return;
        }

        setAuthorized(true);
      })
      .catch(() => {
        if (active) {
          router.replace(
            "/auth/login",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [portal, router]);

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return children;
}
