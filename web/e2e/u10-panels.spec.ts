import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { explore } from "./explore";

// U10 – panels, one mechanism: every popable panel carries the same
// PaneControls (full screen then close, top-right), a Grip on its free edge,
// and the same full-screen contract: it covers the viewport, keeps its own
// scroll, hides grips, Esc restores, close closes. On the phone every pane is
// a bottom sheet and full screen is the whole viewport.

async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

/** The full-screen contract for one panel: open → max covers the viewport →
    Esc restores → close closes. `paneSel` selects the [data-pane] element. */
async function paneCycle(page: Page, paneSel: string, ctl: string, opts: { closable?: boolean } = {}) {
  const closable = opts.closable ?? true;
  const pane = page.locator(paneSel).first();
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute("data-pane", /.*/);
  // one control pair, full screen before close, top-right
  const ctlLoc = pane.locator(`[data-testid=${ctl}-ctl]`);
  await expect(ctlLoc).toBeVisible();
  const maxBtn = pane.locator(`[data-testid=${ctl}-max]`);
  const closeBtn = pane.locator(`[data-testid=${ctl}-close]`);
  await expect(maxBtn).toBeVisible();
  if (closable) {
    await expect(closeBtn).toBeVisible();
  }
  const pair = await ctlLoc.boundingBox();
  expect(pair, "the pair has geometry").not.toBeNull();
  const paneBox = await pane.boundingBox();
  expect(paneBox, "the pane has geometry").not.toBeNull();
  expect(pair.x + pair.width).toBeGreaterThan(paneBox.x + paneBox.width * 0.7);
  expect(pair.y).toBeLessThan(paneBox.y + paneBox.height * 0.5);

  await maxBtn.click();
  await expect(pane).toHaveAttribute("data-max", "");
  const vp = page.viewportSize()!;
  const max = (await pane.boundingBox())!;
  expect(max.x, "full screen hugs the left edge").toBeLessThanOrEqual(12);
  expect(max.y).toBeLessThanOrEqual(12);
  expect(max.x + max.width, "full screen hugs the right edge").toBeGreaterThanOrEqual(vp.width - 12);
  expect(max.y + max.height, "full screen hugs the bottom edge").toBeGreaterThanOrEqual(vp.height - 12);
  // grips hide; the panel body keeps its own scroll
  expect(await pane.locator(".grip").first().isVisible().catch(() => false)).toBe(false);
  await expect(maxBtn).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(pane).not.toHaveAttribute("data-max");
  await expect(pane).toBeVisible();

  if (closable) {
    await closeBtn.click();
    await expect(pane).toHaveCount(0);
  }
}

test.describe("u10 panels – one mechanism", () => {
  test("settings: full screen, Esc, close", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    await paneCycle(page, ".settings", "settings");
  });

  test("help palette: full screen, Esc, close", async ({ page }) => {
    await open(page);
    await page.keyboard.press("?");
    await paneCycle(page, ".palette.help", "help");
  });

  test("code panel: full screen, Esc, close", async ({ page }) => {
    await open(page);
    await page.locator(".hot-row:not(.hot-headrow)").first().click();
    await expect(page.locator(".code-panel .cp-code > div").first()).toBeVisible();
    await paneCycle(page, ".code-panel", "cp");
  });

  test("dock: full screen, Esc, close – same icons and order as every pane", async ({ page }) => {
    await open(page);
    await page.locator("[data-testid=sb-dock]").click();
    const dock = page.locator("[data-testid=dock]");
    await expect(dock).toBeVisible();
    // same pair order: expand then close, top-right of the bar
    const maxBox = await page.locator("[data-testid=dock-max]").boundingBox();
    const closeBox = await page.locator("[data-testid=dock-toggle]").boundingBox();
    expect(closeBox!.x).toBeGreaterThan(maxBox!.x);
    await page.locator("[data-testid=dock-max]").click();
    const vp = page.viewportSize()!;
    const max = (await dock.boundingBox())!;
    expect(max.height).toBeGreaterThan(vp.height * 0.7);
    await expect(dock).toHaveClass(/max/);
    await page.keyboard.press("Escape");
    const restored = (await dock.boundingBox())!;
    expect(restored.height).toBeLessThan(vp.height * 0.5);
    await page.locator("[data-testid=dock-toggle]").click();
    await expect(dock).toHaveCount(0);
  });

  test("graph inspector: full screen, Esc, close", async ({ page }) => {
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("parseHash");
    await page.locator(".palette").getByText("parseHash", { exact: true }).first().click();
    const row = page.locator(".inspector .sym").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await paneCycle(page, ".inspector", "insp");
  });

  test("map inspector: full screen, Esc, close", async ({ page }) => {
    await open(page, "map");
    await page.locator("[data-testid=map-inspector]").or(page.locator("[data-testid=map-hud]")).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await explore(page);
    if (await page.locator("[data-testid=map-side-toggle]").isVisible()) await page.locator("[data-testid=map-side-toggle]").click();
    await paneCycle(page, ".map-insp", "insp");
  });

  test("block palette (np): full screen, Esc, close", async ({ page }) => {
    await open(page, "map");
    await page.locator("[data-testid=map-inspector]").or(page.locator("[data-testid=map-hud]")).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await explore(page);
    if (await page.locator("[data-testid=map-side-toggle]").isVisible()) await page.locator("[data-testid=map-side-toggle]").click();
    await page.locator("[data-testid=ws-tab-pipeline]").click();
    await page.locator("[data-testid=pl-add]").click();
    // np stays mounted when shut (the class toggles, not the element)
    const pane = page.locator("[data-testid=np]");
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-pane", /.*/);
    const maxBtn = pane.locator("[data-testid=np-max]");
    await maxBtn.click();
    await expect(pane).toHaveAttribute("data-max", "");
    const vp = page.viewportSize()!;
    const max = (await pane.boundingBox())!;
    expect(max.x).toBeLessThanOrEqual(12);
    expect(max.y).toBeLessThanOrEqual(12);
    expect(max.x + max.width).toBeGreaterThanOrEqual(vp.width - 12);
    expect(max.y + max.height).toBeGreaterThanOrEqual(vp.height - 12);
    await page.keyboard.press("Escape");
    await expect(pane).not.toHaveAttribute("data-max");
    await pane.locator("[data-testid=np-close]").click();
    await expect(pane).not.toHaveClass(/open/);
  });

  test("step details (ndv): full screen, Esc, close", async ({ page }) => {
    await open(page, "map");
    await page.locator("[data-testid=map-inspector]").or(page.locator("[data-testid=map-hud]")).first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await explore(page);
    if (await page.locator("[data-testid=map-side-toggle]").isVisible()) await page.locator("[data-testid=map-side-toggle]").click();
    await page.locator("[data-testid=ws-tab-pipeline]").click();
    await page.locator("[data-testid=pl-add]").click();
    await page.locator("[data-testid=np-cat-gate]").click();
    await page.locator("[data-testid=np-item-gate-status]").click();
    const step = page.locator("[data-testid^='fc-node-step:']").first();
    await step.click({ button: "right" });
    await expect(page.locator("[data-testid=ctx-menu]")).toBeVisible();
    await page.locator("[data-testid=cm-open]").press("Enter");
    await paneCycle(page, "[data-testid=ndv]", "ndv");
  });

  test("contrast panel: full screen, Esc, close", async ({ page }) => {
    await open(page, "graph/contrast/main/team%2Fa2");
    await page.locator(".contrast-panel").waitFor({ state: "visible", timeout: 30_000 });
    await paneCycle(page, ".contrast-panel", "contrast", { closable: false });
  });

  test("grip still resizes and double-click resets after the mechanism change", async ({ page }) => {
    await open(page, "history");
    const list = page.locator(".split > .list");
    const grip = page.locator(".split > .grip");
    const w0 = (await list.boundingBox())!.width;
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 200);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 120, g.y + 200, { steps: 6 });
    await page.mouse.up();
    expect((await list.boundingBox())!.width).toBeGreaterThan(w0 + 100);
    await grip.dblclick();
    expect(Math.abs((await list.boundingBox())!.width - w0)).toBeLessThan(2);
  });

  test("full screen survives a re-render: Esc still restores", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    const pane = page.locator(".settings");
    await expect(pane).toBeVisible();
    await page.locator("[data-testid=settings-max]").click();
    await expect(pane).toHaveAttribute("data-max", "");
    // a re-render of the app must not drop the Esc listener or the attribute
    await page.evaluate(() => document.documentElement.style.setProperty("--size-settings", "420px"));
    await page.waitForTimeout(400);
    await expect(pane).toHaveAttribute("data-max", "");
    await page.keyboard.press("Escape");
    await expect(pane).not.toHaveAttribute("data-max");
  });
});

test.describe("u10 panels – phone sheets", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a pane is a bottom sheet, full width, close reachable", async ({ page }) => {
    await open(page);
    await page.locator(".hot-row:not(.hot-headrow)").first().click();
    const pane = page.locator(".code-panel");
    await expect(pane).toBeVisible();
    const vp = page.viewportSize()!;
    const box = (await pane.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 2);
    expect(box.y + box.height, "the sheet sits at the bottom").toBeGreaterThanOrEqual(vp.height - 2);
    expect(box.y, "the sheet never reaches the top").toBeGreaterThan(0);
    await expect(pane.locator("[data-testid=cp-close]")).toBeInViewport();
  });

  test("full screen is the whole viewport, Esc restores", async ({ page }) => {
    await open(page);
    await page.locator(".hot-row:not(.hot-headrow)").first().click();
    const pane = page.locator(".code-panel");
    await expect(pane).toBeVisible();
    await pane.locator("[data-testid=cp-max]").click();
    const vp = page.viewportSize()!;
    const box = (await pane.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.x + box.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 1);
    await page.keyboard.press("Escape");
    await expect(pane).not.toHaveAttribute("data-max");
  });
});
