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
  "playwright/.auth/customer.json",
);

setup(
  "authenticate customer",
  async ({
    request,
  }) => {
    const email =
      process.env
        .E2E_CUSTOMER_EMAIL
        ?.trim();

    const password =
      process.env
        .E2E_CUSTOMER_PASSWORD;

    expect(email).toBeTruthy();
    expect(password).toBeTruthy();

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

    expect(
      loginResponse.ok(),
      await loginResponse.text(),
    ).toBeTruthy();

    const sessionResponse =
      await request.get(
        "/api/auth/me",
      );

    expect(
      sessionResponse.ok(),
      await sessionResponse.text(),
    ).toBeTruthy();

    const session =
      await sessionResponse.json();

    expect(
      session.user?.role ??
        session.role,
    ).toBe("CUSTOMER");

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
