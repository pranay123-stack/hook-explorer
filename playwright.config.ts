import { defineConfig, devices } from "@playwright/test";

/**
 * Visual and end-to-end tests.
 *
 * Kept separate from the Vitest suite: these need a real browser and a running
 * server, so they are slower and are not part of `npm run test`. Vitest owns the
 * logic; Playwright owns everything jsdom cannot see -- layout, overflow, and how
 * the page actually looks.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // The visual checks assert on layout, which is meaningless if runs race each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // A production build, not `next dev`: the dev overlay injects its own DOM and would
  // pollute both the screenshots and the overflow measurements.
  webServer: {
    command: "npm run build && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
