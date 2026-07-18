import {
  expect,
  test,
} from "@playwright/test";

const adminPages = [
  {
    path: "/admin",
    heading:
      "Admin dashboard",
  },

  {
    path:
      "/admin/customers",
    heading:
      "Customers",
  },

  {
    path:
      "/admin/nodes",
    heading:
      "Proxy nodes",
  },

  {
    path:
      "/admin/audit",
    heading:
      "Audit activity",
  },
];

test.describe(
  "administrator portal",
  () => {
    for (
      const adminPage
      of adminPages
    ) {
      test(
        `loads ${adminPage.path}`,
        async ({
          page,
        }) => {
          const runtimeErrors:
            string[] = [];

          page.on(
            "pageerror",
            (error) => {
              runtimeErrors.push(
                error.message,
              );
            },
          );

          await page.goto(
            adminPage.path,
          );

          await expect(
            page,
          ).toHaveURL(
            new RegExp(
              `${adminPage.path.replaceAll(
                "/",
                "\\/",
              )}$`,
            ),
          );

          await expect(
            page.getByRole(
              "heading",
              {
                name:
                  adminPage.heading,
              },
            ),
          ).toBeVisible();

          expect(
            runtimeErrors,
          ).toEqual([]);
        },
      );
    }

    test(
      "returns the administrator session",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/auth/me",
          );

        expect(
          response.ok(),
        ).toBeTruthy();

        const payload =
          await response.json();

        const role =
          payload.user?.role ??
          payload.role;

        expect([
          "SUPER_ADMIN",
          "ADMIN",
          "SUPPORT",
        ]).toContain(role);
      },
    );

    test(
      "returns the customer list",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/admin/customers?page=1&limit=5",
          );

        expect(
          response.ok(),
        ).toBeTruthy();

        const payload =
          await response.json();

        expect(
          Array.isArray(
            payload.customers,
          ),
        ).toBeTruthy();

        expect(
          payload.pagination,
        ).toBeTruthy();
      },
    );

    test(
      "returns proxy-node information",
      async ({
        request,
      }) => {
        const response =
          await request.get(
            "/api/admin/nodes",
          );

        expect(
          response.ok(),
        ).toBeTruthy();

        const payload =
          await response.json();

        expect(
          Array.isArray(
            payload.nodes,
          ),
        ).toBeTruthy();
      },
    );

    test(
      "redirects administrators away from the customer portal",
      async ({
        page,
      }) => {
        await page.goto(
          "/customer",
        );

        await expect(
          page,
        ).toHaveURL(
          /\/admin$/,
        );
      },
    );
  },
);
