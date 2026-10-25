import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// X13 – desktop windows: every sidebar, editor popup and dialog becomes a
// movable, resizable, remembered window. Drag by its header, resize from
// every edge and corner, snap to edges, maximise (double-click header),
// minimise to a small dock, close. Several open at once; click brings to
// front. Position, size and state persist per window id in localStorage and
// reopen where the user left them, clamped back on screen when the viewport
// shrinks. At ≤ 600px windows become full-width sheets. data-pane,
// PaneControls, Esc and focus return keep working (u10-panels holds that).

async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

async function openSettings(page: Page) {
  await page.keyboard.press(",");
  const win = page.locator("[data-testid=settings]");
  await expect(win).toBeVisible();
  return win;
}

/** Drag the window by its header from the grab point by (dx, dy).
 *  boundingBox is page-relative; the mouse takes viewport coords, so the
 *  scroll offset is subtracted first. */
async function dragBy(page: Page, win: ReturnType<Page["locator"]>, dx: number, dy: number) {
  const head = win.locator("[data-testid=settings-head]");
  const hb = (await head.boundingBox())!;
  const [sx, sy] = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const gx = hb.x + hb.width / 2 - sx, gy = hb.y + hb.height / 2 - sy;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + dx, gy + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe("x13 desktop windows", () => {
  test("drags by the header, keeps data-pane, maximises on double-click, closes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    await expect(win).toHaveAttribute("data-pane", /.*/);

    // drag by the header moves the window (up-right, clear of the clamps)
    const before = (await win.boundingBox())!;
    await dragBy(page, win, 200, -80);
    const after = (await win.boundingBox())!;
    expect(Math.abs(after.x - before.x - 200)).toBeLessThan(40);
    expect(Math.abs(after.y - before.y + 80)).toBeLessThan(40);

    // double-click the header maximises; the pane-ctl pair restores (u10 contract)
    const head = win.locator("[data-testid=settings-head]");
    await head.dblclick();
    await expect(win).toHaveAttribute("data-max", "");
    const vp = page.viewportSize()!;
    const maxed = (await win.boundingBox())!;
    expect(maxed.width).toBeGreaterThanOrEqual(vp.width - 24);
    await page.keyboard.press("Escape");
    await expect(win).not.toHaveAttribute("data-max");

    // close removes the window
    await win.locator("[data-testid=settings-close]").click();
    await expect(win).toHaveCount(0);
  });

  test("resizes from every edge and corner", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    const before = (await win.boundingBox())!;
    // east grip grows eastwards
    const e = win.locator("[data-testid=settings-rz-e]");
    const eb = (await e.boundingBox())!;
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.mouse.move(eb.x + 120, eb.y, { steps: 4 });
    await page.mouse.up();
    const grown = (await win.boundingBox())!;
    expect(grown.width).toBeGreaterThan(before.width + 100);
    // south-west corner shrinks from both axes
    const sw = win.locator("[data-testid=settings-rz-sw]");
    const sb = (await sw.boundingBox())!;
    await page.mouse.move(sb.x + 4, sb.y + 4);
    await page.mouse.down();
    await page.mouse.move(sb.x + 90, sb.y - 70, { steps: 4 });
    await page.mouse.up();
    const shrunk = (await win.boundingBox())!;
    expect(shrunk.width).toBeLessThan(grown.width - 60);
    expect(shrunk.height).toBeLessThan(grown.height - 40);
    expect(Math.round(shrunk.x)).toBeGreaterThan(Math.round(grown.x)); // west edge moved in
  });

  test("keyboard: arrows move from the header, alt+arrows resize", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    await win.locator("[data-testid=settings-head]").focus();
    const before = (await win.boundingBox())!;
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const moved = (await win.boundingBox())!;
    expect(moved.x).toBeGreaterThan(before.x + 10);
    expect(moved.y).toBeGreaterThan(before.y + 10);
    await page.keyboard.press("Alt+ArrowRight");
    const grown = (await win.boundingBox())!;
    expect(grown.width).toBeGreaterThan(moved.width + 10);
  });

  test("minimises to the dock and restores from it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    await win.locator("[data-testid=settings-min]").click();
    await expect(win).toHaveCount(0);
    const dock = page.locator("[data-testid=win-dock]");
    await expect(dock).toBeVisible();
    await dock.locator("[data-testid=dock-settings]").click();
    await expect(win).toBeVisible();
    await expect(dock).toHaveCount(0);
  });

  test("two windows stack – click brings one to front (z order)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // seed a second (not-yet-owned) window with a higher z than settings
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("kula.opened", "1");
        localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false }));
        localStorage.setItem("kula.windows.v1", JSON.stringify({
          "code-panel": { x: 200, y: 200, w: 500, h: 400, z: 5, open: true },
          settings: { x: 300, y: 300, w: 700, h: 500, z: 3, open: true },
        }));
      } catch { /* */ }
    });
    await page.goto("/#overview");
    await page.keyboard.press(",");
    const win = page.locator("[data-testid=settings]");
    await expect(win).toBeVisible();
    // opening a window brings it to front: its z must pass the seeded sibling
    const sib = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.windows.v1")!)["code-panel"].z);
    const mine = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.windows.v1")!)["settings"].z);
    expect(mine).toBeGreaterThan(sib);
    // and a click on a front window keeps it front (idempotent focus)
    await win.click();
    const again = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.windows.v1")!)["settings"].z);
    expect(again).toBe(mine);
  });

  test("position and size persist in localStorage and reopen where left", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    const before = (await win.boundingBox())!;
    await dragBy(page, win, 160, 80);
    const after = (await win.boundingBox())!;
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.windows.v1")!)["settings"]);
    expect(saved.x).toBeCloseTo(after.x, 0);
    expect(saved.y).toBeCloseTo(after.y, 0);
    // close, reopen – the window comes back where it was left
    await win.locator("[data-testid=settings-close]").click();
    await page.keyboard.press(",");
    const again = page.locator("[data-testid=settings]");
    await expect(again).toBeVisible();
    await page.waitForTimeout(300); // let the pop-in animation settle
    const reopened = (await again.boundingBox())!;
    expect(Math.abs(reopened.x - after.x)).toBeLessThan(3);
    expect(Math.abs(reopened.y - after.y)).toBeLessThan(3);
  });

  test("a shrunk viewport clamps the window back on screen @responsive", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    await dragBy(page, win, 900, 500);
    await page.setViewportSize({ width: 900, height: 600 });
    const clamped = (await win.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(vp.width + 2);
    expect(clamped.y).toBeGreaterThanOrEqual(-2);
  });

  test("at 390px a window is a full-width sheet @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const win = await openSettings(page);
    const box = (await win.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.width).toBeGreaterThanOrEqual(vp.width - 2);
    expect(box.x).toBeLessThanOrEqual(1);
    // resize grips are hidden on a sheet
    await expect(win.locator("[data-testid=settings-rz-e]")).toBeHidden();
  });

  test("state persists: a minimised window reopens minimised into the dock", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const win = await openSettings(page);
    await win.locator("[data-testid=settings-min]").click();
    await expect(page.locator("[data-testid=win-dock]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-testid=win-dock]")).toBeVisible();
  });
});
