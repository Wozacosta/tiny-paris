import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the production build (`npm run build` first).
// Locally they use the installed Chrome; CI uses Playwright's own Chromium.
const chrome = process.env.CI ? {} : { channel: "chrome" };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  webServer: { command: "npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: !process.env.CI },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...chrome } },
    { name: "phone", use: { ...devices["Pixel 7"], ...chrome } },
  ],
});
