import { defineConfig, devices } from "@playwright/test";

// UI tests run against the real binary serving the embedded UI, on this repo.
// Build first (`pnpm test:ui` does: vite build → cargo build → playwright).
// PW_CHROMIUM points at any local Chromium when Playwright's own isn't installed.
// KULA_PW_PORT lets a second checkout (or session) run the suite beside a dev server on 7431.
const PORT = Number(process.env.KULA_PW_PORT ?? 7431);
/** The agents fixture (e2e/fixture.sh) listens one port up. */
export const FIXTURE = `http://localhost:${PORT + 1}`;
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  // Three workers, one per project, is the sweet spot here: every graph page
  // runs sigma WebGL against one repo server, and more concurrent browsers
  // than that stall the loader and flake the canvas tests.
  workers: 3,
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
    { name: "tablet", use: { ...devices["iPad Mini"], browserName: "chromium", colorScheme: "dark" }, grep: /@responsive/ },
    { name: "phone", use: { ...devices["Pixel 7"], colorScheme: "dark" }, grep: /@mobile|@responsive/ },
  ],
  webServer: [
    {
      command: `KULA_TOKEN=test ../target/debug/kula -C .. view --no-open --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    // A disposable clone with guards, a task and memories (e2e/fixture.sh): only
    // the opt-in shots run needs it now – ui.spec spawns one fixture per worker.
    { command: `sh e2e/fixture.sh ${PORT + 1}`, url: `http://localhost:${PORT + 1}`, reuseExistingServer: !process.env.CI, timeout: 90_000 },
  ],
});
