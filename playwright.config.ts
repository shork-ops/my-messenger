import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite for the core loop: launch, switch chat, send a message, react.
 *
 * Runs against the demo build (`VITE_DEMO_MODE=true`), so it needs no Supabase
 * credentials and can execute in CI on every pull request.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Demo mode keeps the app fully local: no backend, no credentials.
    command: "npm run build:demo && npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/my-messenger/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
