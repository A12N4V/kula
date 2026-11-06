import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/* S1 kit e2e – spawns its own vite dev server on :5199 so the kit showcase
   can run independently of the app server on KULA_PW_PORT. */

let vite: ChildProcess | undefined;
const port = 5199;

test.beforeAll(async () => {
  const webDir = path.resolve(__dirname, "..");
  vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], {
    cwd: webDir,
    stdio: "ignore",
    detached: true,
  });
  await expect
    .poll(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/kit-demo.html`);
        return res.ok;
      } catch {
        return false;
      }
    }, { timeout: 30_000 })
    .toBe(true);
});

test.afterAll(async () => {
  if (vite?.pid) {
    try {
      process.kill(-vite.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
});

test("kit showcase mounts with kula tokens", async ({ page }) => {
  await page.goto(`http://localhost:${port}/kit-demo.html`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".kwb-theme")).toBeVisible();
  await expect(page.getByTestId("kwb-file-tree")).toBeVisible();
  await expect(page.getByTestId("kwb-code-view")).toBeVisible();
  await expect(page.getByTestId("kwb-lane-chart")).toBeVisible();
});

test("file tree selects a node", async ({ page }) => {
  await page.goto(`http://localhost:${port}/kit-demo.html`);
  await page.getByTestId("file-tree-item-src-kit-readme").getByText("README.md").click();
  await expect(page.getByTestId("kwb-selection")).toContainText("src-kit-readme");
});

test("code view shows blame gutter and toggles it", async ({ page }) => {
  await page.goto(`http://localhost:${port}/kit-demo.html`);
  await expect(page.getByTestId("code-blame-l2")).toContainText("e4f5a6b");
  await page.getByTestId("kwb-blame-toggle").click();
  await expect(page.getByTestId("code-blame-l2")).toHaveCount(0);
});

test("lane chart renders bars", async ({ page }) => {
  await page.goto(`http://localhost:${port}/kit-demo.html`);
  await page.getByTestId("kwb-tabs").getByText("lanes").click();
  await expect(page.getByTestId("lane-bar-t1")).toBeVisible();
  await expect(page.getByTestId("lane-bar-t3")).toBeVisible();
});

test("narrow viewport keeps kit usable", async ({ page }) => {
  await page.goto(`http://localhost:${port}/kit-demo.html`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("kwb-file-tree")).toBeVisible();
  await expect(page.getByTestId("kwb-code-view")).toBeVisible();
});
