import {
  mkdirSync,
} from "node:fs";

import {
  dirname,
  resolve,
} from "node:path";

import {
  expect,
  test as setup,
} from "@playwright/test";

const authFile = resolve(
  process.cwd(),
  "playwright/.auth/admin.json",
);

setup(
  "authenticate administrator",
  async ({
    request,
  }) => {
    const email =
      process.env
        .E2E_ADMIN_EMAIL
        ?.trim();

    const password =
      process.env
        .E2E_ADMIN_PASSWORD;

    expect(
      email,
      "E2E_ADMIN_EMAIL is missing from .env.e2e",
    ).toBeTruthy();

    expect(
      password,
      "E2E_ADMIN_PASSWORD is missing from .env.e2e",
    ).toBeTruthy();

    const loginResponse =
      await request.post(
        "/api/auth/login",
        {
          data: {
            email,
            password,
          },
        },
      );

    const loginBody =
      await loginResponse.text();

    expect(
      loginResponse.ok(),
      `Administrator login failed with HTTP ${loginResponse.status()}: ${loginBody}`,
    ).toBeTruthy();

    const sessionResponse =
      await request.get(
        "/api/auth/me",
      );

    const sessionBody =
      await sessionResponse.text();

    expect(
      sessionResponse.ok(),
      `Session verification failed with HTTP ${sessionResponse.status()}: ${sessionBody}`,
    ).toBeTruthy();

    const session =
      JSON.parse(sessionBody);

    const role =
      session.user?.role ??
      session.role;

    expect([
      "SUPER_ADMIN",
      "ADMIN",
      "SUPPORT",
    ]).toContain(role);

    mkdirSync(
      dirname(authFile),
      {
        recursive: true,
      },
    );

    await request.storageState({
      path: authFile,
    });
  },
);
