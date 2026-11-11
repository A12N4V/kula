import { expect, test as base, type Page } from "@playwright/test";

const test = base.extend({});

// Skip the once-per-session opening so every test lands on the app itself.
async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("shell", () => {
  test("rail shows every group and the list pane every module", async ({ page }) => {
    await open(page);
    const rail = page.locator(".rail");
    for (const g of ["overview", "map", "code", "connectors", "agents"])
      await expect(rail.getByTestId(`rail-group-${g}`)).toBeVisible();
    const list = page.getByTestId("list-pane");
    await expect(list).toBeVisible();
    // Every registered module is listed exactly once.
    for (const id of ["overview", "graph", "flows", "syntagm", "changes", "history", "branches", "proposals", "issues", "notes", "agents", "connectors", "query", "console"])
      await expect(list.getByTestId(`rail-item-${id}`)).toHaveCount(1);
    // Only the active view's item is marked.
    await expect(list.getByTestId("rail-item-overview")).toHaveAttribute("aria-current", "true");
    await expect(list.getByTestId("rail-item-graph")).not.toHaveAttribute("aria-current", "true");
  });

  test("rail group icons open the group home view", async ({ page }) => {
    await open(page);
    for (const [g, home] of [["code", "graph"], ["map", "flows"], ["agents", "agents"], ["connectors", "connectors"]] as const) {
      await page.getByTestId(`rail-group-${g}`).click();
      await expect(page).toHaveURL(new RegExp(`#${home}$`));
      await expect(page.getByTestId("centre")).toBeVisible();
      await expect(page.getByTestId(`rail-item-${home}`)).toHaveAttribute("aria-current", "true");
    }
  });

  test("list pane items navigate and the pane marks the active view", async ({ page }) => {
    await open(page);
    const list = page.getByTestId("list-pane");
    for (const id of ["changes", "history", "query", "syntagm", "notes"]) {
      await list.getByTestId(`rail-item-${id}`).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
    }
  });

  test("⌘-number keys jump straight to their view", async ({ page }) => {
    await open(page);
    for (const [key, view] of [["1", "overview"], ["2", "graph"], ["3", "flows"], ["4", "changes"], ["5", "history"], ["6", "branches"], ["7", "proposals"], ["8", "issues"], ["9", "notes"], ["0", "console"], ["a", "agents"], ["c", "connectors"], ["q", "query"]] as const) {
      await page.keyboard.press(key);
      await expect(page).toHaveURL(new RegExp(`#${view}$`));
    }
  });

  test("deep links land on the right view", async ({ page }) => {
    for (const hash of ["flows", "syntagm", "changes", "history", "branches", "proposals", "issues", "notes", "connectors", "query", "console", "graph"]) {
      await open(page, hash);
      await expect(page.getByTestId("centre")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    }
  });

  test("the pane toggle hides and shows the list pane", async ({ page }) => {
    await open(page);
    const toggle = page.getByTestId("pane-list");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("list-pane")).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("list-pane")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(page.getByTestId("list-pane")).toBeVisible();
  });

  test("the list pane grip resizes and persists", async ({ page }) => {
    await open(page);
    const grip = page.locator(".shell-listpane .grip");
    await grip.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForFunction(() => Number(getComputedStyle(document.documentElement).getPropertyValue("--size-raillist").replace("px", "")) > 240);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.sizes.v1") ?? "{}").raillist);
    expect(saved).toBeGreaterThan(240);
  });

  test("@responsive the list pane gives way and the rail stays navigable", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "mid and phone only");
    await open(page);
    await expect(page.getByTestId("list-pane")).toBeHidden();
    await page.getByTestId("rail-group-code").click();
    await expect(page).toHaveURL(/#graph$/);
  });

  test("@mobile the rail docks at the bottom of the screen", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phones only");
    await open(page);
    const rail = page.locator(".rail");
    const rr = (await rail.boundingBox())!;
    const bottom = rr.y + rr.height;
    expect(844 - bottom).toBeLessThanOrEqual(60); // docked low, above the statusbar
    await expect(page.locator(".shell-root")).toHaveAttribute("data-tier", "mobile");
  });
});
