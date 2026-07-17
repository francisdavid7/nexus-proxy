"use client";

import type {
  FormEvent,
} from "react";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Network,
  Server,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

type AuthenticatedUser = {
  id?: string;
  fullName?: string;
  email?: string;
  role: string;
  status?: string;
};

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<
    string,
    unknown
  >;
}

function extractUser(
  payload: unknown,
): AuthenticatedUser | null {
  const root =
    asRecord(payload);

  if (!root) {
    return null;
  }

  const nestedUser =
    asRecord(root.user);

  const candidate =
    nestedUser ?? root;

  if (
    typeof candidate.role !==
    "string"
  ) {
    return null;
  }

  return {
    id:
      typeof candidate.id ===
      "string"
        ? candidate.id
        : undefined,

    fullName:
      typeof candidate.fullName ===
      "string"
        ? candidate.fullName
        : undefined,

    email:
      typeof candidate.email ===
      "string"
        ? candidate.email
        : undefined,

    role: candidate.role,

    status:
      typeof candidate.status ===
      "string"
        ? candidate.status
        : undefined,
  };
}

function extractErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  const record =
    asRecord(payload);

  if (!record) {
    return fallback;
  }

  if (
    typeof record.message ===
    "string"
  ) {
    return record.message;
  }

  if (
    typeof record.error ===
    "string"
  ) {
    return record.error;
  }

  return fallback;
}

async function readResponseBody(
  response: Response,
): Promise<unknown> {
  const contentType =
    response.headers.get(
      "content-type",
    ) ?? "";

  if (
    contentType.includes(
      "application/json",
    )
  ) {
    return response
      .json()
      .catch(() => null);
  }

  return response
    .text()
    .catch(() => null);
}

function getPortalPath(
  role: string,
): string | null {
  if (
    [
      "SUPER_ADMIN",
      "ADMIN",
      "SUPPORT",
    ].includes(role)
  ) {
    return "/admin";
  }

  if (role === "CUSTOMER") {
    return "/customer";
  }

  return null;
}

export default function LoginPage() {
  const router =
    useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    passwordVisible,
    setPasswordVisible,
  ] = useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(
      null,
    );

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (loading) {
      return;
    }

    const normalizedEmail =
      email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError(
        "Enter your email address.",
      );

      return;
    }

    if (!password) {
      setError(
        "Enter your password.",
      );

      return;
    }

    setLoading(true);
    setError(null);

    try {
      const loginResponse =
        await fetch(
          "/api/auth/login",
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",

            headers: {
              Accept:
                "application/json",

              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              email:
                normalizedEmail,

              password,
            }),
          },
        );

      const loginPayload =
        await readResponseBody(
          loginResponse,
        );

      if (!loginResponse.ok) {
        throw new Error(
          extractErrorMessage(
            loginPayload,
            loginResponse.status ===
              401
              ? "The email or password is incorrect."
              : "Sign-in failed.",
          ),
        );
      }

      /*
       * Some login endpoints return the
       * authenticated user directly.
       * Others only return a success message.
       */
      let authenticatedUser =
        extractUser(loginPayload);

      if (!authenticatedUser) {
        const sessionResponse =
          await fetch(
            "/api/auth/me",
            {
              credentials:
                "include",

              cache: "no-store",

              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        const sessionPayload =
          await readResponseBody(
            sessionResponse,
          );

        if (!sessionResponse.ok) {
          throw new Error(
            extractErrorMessage(
              sessionPayload,
              "The session was created, but it could not be verified.",
            ),
          );
        }

        authenticatedUser =
          extractUser(
            sessionPayload,
          );
      }

      if (!authenticatedUser) {
        throw new Error(
          "The authenticated account information could not be read.",
        );
      }

      if (
        authenticatedUser.status &&
        authenticatedUser.status !==
          "ACTIVE"
      ) {
        throw new Error(
          "This account is not active.",
        );
      }

      const portalPath =
        getPortalPath(
          authenticatedUser.role,
        );

      if (!portalPath) {
        throw new Error(
          "This account does not have access to a supported portal.",
        );
      }

      router.replace(portalPath);
      router.refresh();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Sign-in failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -left-28 top-28 size-80 rounded-full border border-primary-foreground/10" />

          <div className="absolute -left-10 top-44 size-80 rounded-full border border-primary-foreground/10" />

          <div className="absolute bottom-[-160px] right-[-120px] size-[520px] rounded-full bg-primary-foreground/5" />

          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary-foreground text-primary">
                <Network className="size-6" />
              </div>

              <div>
                <p className="text-lg font-semibold">
                  Nexus Proxy
                </p>

                <p className="text-sm text-primary-foreground/60">
                  Secure proxy infrastructure
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-10 max-w-xl">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary-foreground/60">
              Control your network
            </p>

            <h1 className="mt-5 text-5xl font-semibold leading-tight tracking-tight">
              One secure portal for your proxy operations.
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-8 text-primary-foreground/70">
              Monitor infrastructure, manage customer access and review proxy activity from one workspace.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 p-4">
                <Server className="size-5" />

                <p className="mt-4 text-sm font-medium">
                  Node health
                </p>

                <p className="mt-1 text-xs leading-5 text-primary-foreground/60">
                  Monitor heartbeat and capacity.
                </p>
              </div>

              <div className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 p-4">
                <ShieldCheck className="size-5" />

                <p className="mt-4 text-sm font-medium">
                  Secure access
                </p>

                <p className="mt-1 text-xs leading-5 text-primary-foreground/60">
                  Role-based portal protection.
                </p>
              </div>

              <div className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 p-4">
                <Waypoints className="size-5" />

                <p className="mt-4 text-sm font-medium">
                  Usage visibility
                </p>

                <p className="mt-1 text-xs leading-5 text-primary-foreground/60">
                  Review connections and traffic.
                </p>
              </div>
            </div>
          </div>

          <p className="relative z-10 text-xs text-primary-foreground/50">
            Private access for authorized Nexus Proxy users.
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10 lg:px-16">
          <div className="w-full max-w-md">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Network className="size-5" />
              </div>

              <div>
                <p className="font-semibold">
                  Nexus Proxy
                </p>

                <p className="text-xs text-muted-foreground">
                  Secure control portal
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-primary">
                Welcome back
              </p>

              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Sign in to your account
              </h2>

              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Use your administrator or customer credentials to access the appropriate portal.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-5"
            >
              {error ? (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              ) : null}

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="text-sm font-medium"
                >
                  Email address
                </label>

                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(
                        event.target.value,
                      );
                    }}
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    disabled={loading}
                    placeholder="name@example.com"
                    className="h-12 w-full rounded-xl border bg-background pl-11 pr-4 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-sm font-medium"
                >
                  Password
                </label>

                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                  <input
                    id="password"
                    name="password"
                    type={
                      passwordVisible
                        ? "text"
                        : "password"
                    }
                    value={password}
                    onChange={(event) => {
                      setPassword(
                        event.target.value,
                      );
                    }}
                    autoComplete="current-password"
                    required
                    disabled={loading}
                    placeholder="Enter your password"
                    className="h-12 w-full rounded-xl border bg-background pl-11 pr-12 text-sm outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setPasswordVisible(
                        (current) =>
                          !current,
                      );
                    }}
                    disabled={loading}
                    aria-label={
                      passwordVisible
                        ? "Hide password"
                        : "Show password"
                    }
                    className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {passwordVisible ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    Sign in securely
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 rounded-xl border bg-muted/30 p-4">
              <p className="text-xs leading-5 text-muted-foreground">
                Administrators are sent to the infrastructure dashboard. Customer accounts are sent to their proxy workspace automatically.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
