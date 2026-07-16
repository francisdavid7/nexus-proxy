import {
  getCurrentUser,
} from "@/lib/auth/session";

export type AuthenticatedUser =
  NonNullable<
    Awaited<
      ReturnType<typeof getCurrentUser>
    >
  >;

type AuthorizedResult = {
  authorized: true;
  user: AuthenticatedUser;
};

type UnauthorizedResult = {
  authorized: false;
  response: Response;
};

export type AuthorizationResult =
  | AuthorizedResult
  | UnauthorizedResult;

function unauthorizedResponse(): Response {
  return Response.json(
    {
      message:
        "Authentication is required.",
    },
    {
      status: 401,
    },
  );
}

function forbiddenResponse(): Response {
  return Response.json(
    {
      message:
        "You do not have permission to perform this action.",
    },
    {
      status: 403,
    },
  );
}

export async function requireAuthenticatedUser():
  Promise<AuthorizationResult> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      authorized: false,
      response: unauthorizedResponse(),
    };
  }

  return {
    authorized: true,
    user,
  };
}

export async function requireStaffUser():
  Promise<AuthorizationResult> {
  const authentication =
    await requireAuthenticatedUser();

  if (!authentication.authorized) {
    return authentication;
  }

  const allowedRoles = new Set([
    "SUPER_ADMIN",
    "ADMIN",
    "SUPPORT",
  ]);

  if (
    !allowedRoles.has(
      authentication.user.role,
    )
  ) {
    return {
      authorized: false,
      response: forbiddenResponse(),
    };
  }

  return authentication;
}

export async function requireAdministrator():
  Promise<AuthorizationResult> {
  const authentication =
    await requireAuthenticatedUser();

  if (!authentication.authorized) {
    return authentication;
  }

  const allowedRoles = new Set([
    "SUPER_ADMIN",
    "ADMIN",
  ]);

  if (
    !allowedRoles.has(
      authentication.user.role,
    )
  ) {
    return {
      authorized: false,
      response: forbiddenResponse(),
    };
  }

  return authentication;
}

export async function requireCustomerUser():
  Promise<AuthorizationResult> {
  const authentication =
    await requireAuthenticatedUser();

  if (!authentication.authorized) {
    return authentication;
  }

  if (
    authentication.user.role !==
    "CUSTOMER"
  ) {
    return {
      authorized: false,
      response: forbiddenResponse(),
    };
  }

  return authentication;
}
