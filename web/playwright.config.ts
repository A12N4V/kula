import { defineConfig, devices } from "@playwright/test";

// UI tests run against the real binary serving the embedded UI, on this repo.
// Build first (`pnpm test:ui` does: vite build → cargo build → playwright).
// PW_CHROMIUM points at any local Chromium when Playwright's own isn't installed.
const PORT = 7431;
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    colorScheme: "dark",
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
    { name: "phone", use: { ...devices["Pixel 7"], colorScheme: "dark" }, grep: /@mobile/ },
  ],
  webServer: {
    command: `KULA_TOKEN=test ../target/debug/kula -C .. view --no-open --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
