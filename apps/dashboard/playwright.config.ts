import {
  defineConfig,
  devices,
} from "@playwright/test";

import {
  config as loadEnvironment,
} from "dotenv";

loadEnvironment({
  path: ".env.e2e",
  override: false,
});

const baseURL =
  process.env.E2E_BASE_URL ??
  "http://127.0.0.1:3000";

const customerTestingConfigured =
  Boolean(
    process.env.E2E_CUSTOMER_EMAIL &&
    process.env.E2E_CUSTOMER_PASSWORD,
  );

const customerProjects =
  customerTestingConfigured
    ? [
        {
          name: "customer-setup",

          testMatch:
            /customer\.setup\.ts/,
        },

        {
          name: "customer",

          testMatch:
            /customer\.spec\.ts/,

          dependencies: [
            "customer-setup",
          ],

          use: {
            ...devices[
              "Desktop Chrome"
            ],

            storageState:
              "playwright/.auth/customer.json",
          },
        },
      ]
    : [];

export default defineConfig({
  testDir: "./e2e",

  outputDir:
    "test-results",

  fullyParallel: true,

  forbidOnly:
    Boolean(process.env.CI),

  retries:
    process.env.CI
      ? 2
      : 0,

  workers:
    process.env.CI
      ? 1
      : undefined,

  timeout: 30_000,

  expect: {
    timeout: 10_000,
  },

  reporter: [
    ["list"],

    [
      "html",
      {
        outputFolder:
          "playwright-report",

        open: "never",
      },
    ],
  ],

  use: {
    baseURL,

    actionTimeout:
      10_000,

    navigationTimeout:
      20_000,

    trace:
      "retain-on-failure",

    screenshot:
      "only-on-failure",

    video:
      "retain-on-failure",
  },

  webServer:
    process.env.E2E_SKIP_WEBSERVER ===
    "true"
      ? undefined
      : {
          command:
            "pnpm start",

          url:
            `${baseURL}/auth/login`,

          reuseExistingServer:
            !process.env.CI,

          timeout:
            120_000,

          stdout: "pipe",
          stderr: "pipe",
        },

  projects: [
    {
      name: "public",

      testMatch:
        /public\.spec\.ts/,

      use: {
        ...devices[
          "Desktop Chrome"
        ],

        storageState: {
          cookies: [],
          origins: [],
        },
      },
    },

    {
      name: "admin-setup",

      testMatch:
        /admin\.setup\.ts/,
    },

    {
      name: "admin",

      testMatch:
        /admin\.spec\.ts/,

      dependencies: [
        "admin-setup",
      ],

      use: {
        ...devices[
          "Desktop Chrome"
        ],

        storageState:
          "playwright/.auth/admin.json",
      },
    },

    ...customerProjects,
  ],
});
