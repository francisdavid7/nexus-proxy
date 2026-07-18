import {
  expect,
  test,
} from "@playwright/test";

test.describe(
  "customer portal",
  () => {
    test(
      "loads the customer dashboard",
      async ({
        page,
      }) => {
        await page.goto(
          "/customer",
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                /Welcome,/,
            },
          ),
        ).toBeVisible();
      },
    );

    test(
      "loads connection history",
      async ({
        page,
      }) => {
        await page.goto(
          "/customer/connections",
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Connection history",
            },
          ),
        ).toBeVisible();
      },
    );

    test(
      "loads proxy setup",
      async ({
        page,
      }) => {
        await page.goto(
          "/customer/proxy",
        );

        await expect(
          page.getByRole(
            "heading",
            {
              name:
                "Proxy setup",
            },
          ),
        ).toBeVisible();
      },
    );

    test(
      "rejects customer access to admin APIs",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/admin/customers",
          );

        expect([
          401,
          403,
        ]).toContain(
          response.status(),
        );
      },
    );

    test(
      "redirects customers away from the admin portal",
      async ({
        page,
      }) => {
        await page.goto(
          "/admin",
        );

        await expect(
          page,
        ).toHaveURL(
          /\/customer$/,
        );
      },
    );
  },
);
