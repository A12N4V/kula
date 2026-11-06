// W1 – workbench shell acceptance (route, slots, keys, registry).
import { test, expect } from "@playwright/test";

const WB = "#/wb";

async function openWb(page) {
  await page.goto(`/${WB}`);
  await expect(page.getByTestId("wb-root")).toBeVisible();
}

test("route #/wb renders the workbench shell", async ({ page }) => {
  await openWb(page);
  await expect(page.getByTestId("wb-titlebar")).toBeVisible();
  await expect(page.getByTestId("wb-activity-bar")).toBeVisible();
  await expect(page.getByTestId("wb-explorer")).toBeVisible();
  await expect(page.getByTestId("wb-center")).toBeVisible();
  await expect(page.getByTestId("wb-inspector")).toBeVisible();
  await expect(page.getByTestId("wb-bottom-panel")).toBeVisible();
});

test("title bar shows repo, branch, live run, tokens", async ({ page }) => {
  await openWb(page);
  await expect(page.getByTestId("wb-run-live")).toContainText("run #42 live");
  await expect(page.getByTestId("wb-tokens")).toContainText("M tok");
});

test("activity bar lists registry activities and switches", async ({ page }) => {
  await openWb(page);
  for (const id of ["map", "runs", "agents", "fences"]) {
    await expect(page.getByTestId(`wb-activity-${id}`)).toBeVisible();
  }
  await page.getByTestId("wb-activity-runs").click();
  await expect(page.getByTestId("wb-tab-runs-lanes")).toBeVisible();
});

test("bottom panel has all six tabs", async ({ page }) => {
  await openWb(page);
  for (const t of ["ledger", "terminal", "diff", "tests", "check", "problems"]) {
    await expect(page.getByTestId(`wb-panel-tab-${t}`)).toBeVisible();
  }
  await page.getByTestId("wb-panel-tab-problems").click();
  await expect(page.getByTestId("wb-panel-problems")).toBeVisible();
});

test("⌘K opens the command palette with CLI verbs and blocks", async ({ page }) => {
  await openWb(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dlg = page.locator("[cmdk-root]");
  await expect(dlg).toBeVisible();
  await page.keyboard.type("graph query");
  await expect(dlg).toContainText("kula graph query");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dlg).not.toBeVisible();
});

test("⌘J toggles the bottom panel, ⌥I the inspector", async ({ page }) => {
  await openWb(page);
  await expect(page.getByTestId("wb-bottom-panel")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("wb-bottom-panel")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("wb-bottom-panel")).toBeVisible();
  await page.keyboard.press("Alt+i");
  await expect(page.getByTestId("wb-inspector")).toHaveCount(0);
  await page.keyboard.press("Alt+i");
  await expect(page.getByTestId("wb-inspector")).toBeVisible();
});

test("⌥1–4 switch activities", async ({ page }) => {
  await openWb(page);
  await page.keyboard.press("Alt+2");
  await expect(page.getByTestId("wb-tab-runs-lanes")).toBeVisible();
  await page.keyboard.press("Alt+1");
  await expect(page.getByTestId("wb-tab-map-graph")).toBeVisible();
});

test("⌘K outside #/wb still opens the global palette", async ({ page }) => {
  await page.goto("/#overview");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator('[role="dialog"][aria-label="Command palette"]')).toBeVisible();
});

test("explorer placeholders present in every slot", async ({ page }) => {
  await openWb(page);
  await expect(page.getByTestId("wb-placeholder").first()).toBeVisible();
  await expect(page.getByTestId("wb-inspector").getByText("map inspector", { exact: false })).toBeVisible();
});
