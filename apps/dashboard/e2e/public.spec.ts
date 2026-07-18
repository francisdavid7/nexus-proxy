import {
  expect,
  test,
} from "@playwright/test";

test.describe(
  "public authentication and authorization",
  () => {
    test(
      "renders the login interface",
      async ({
        page,
      }) => {
        await page.goto(
          "/auth/login",
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Sign in to your account",
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByLabel(
            "Email address",
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "textbox",
            {
              name: "Password",
              exact: true,
            },
          ),
        ).toBeVisible();

        await expect(
          page.getByRole(
            "button",
            {
              name:
                "Sign in securely",
            },
          ),
        ).toBeVisible();
      },
    );

    test(
      "redirects unauthenticated users away from the admin portal",
      async ({
        page,
      }) => {
        await page.goto(
          "/admin",
        );

        await expect(
          page,
        ).toHaveURL(
          /\/auth\/login$/,
        );
      },
    );

    test(
      "redirects unauthenticated users away from the customer portal",
      async ({
        page,
      }) => {
        await page.goto(
          "/customer",
        );

        await expect(
          page,
        ).toHaveURL(
          /\/auth\/login$/,
        );
      },
    );

    test(
      "rejects unauthenticated admin API requests",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/admin/customers",
          );

        expect(
          response.status(),
        ).toBe(401);
      },
    );

    test(
      "rejects unauthenticated customer API requests",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/customer/overview",
          );

        expect(
          response.status(),
        ).toBe(401);
      },
    );
  },
);
