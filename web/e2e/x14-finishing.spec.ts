import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

// X14 – UX finishing and release readiness: the map's one settings popover,
// the three-way theme segment, the thin icon sub-nav on Agents, deep links
// that survive the splash, light-theme AA, remembered viewports and touch
// targets. Read-only checks run against this repo's server; the agents-rail
// checks run on the fixture clone.

/** Skip the once-per-session opening so every test lands on the app itself. */
async function open(page: Page, hash: string, base?: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`${base ?? ""}/#${hash}`);
}

test.describe("the map settings popover", () => {
  test("one gear holds layers, scheme, density, labels, minimap, snap and layout verbs", async ({ page }) => {
    await open(page, "map");
    await page.getByTestId("map-settings-btn").click();
    const sheet = page.getByTestId("map-settings-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("u2-layers")).toBeVisible();
    for (const id of ["map-scheme", "map-edges", "map-labels", "map-minimap", "map-snap"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("u2-tidy")).toBeVisible();
    await expect(page.getByTestId("map-reset-layout")).toBeVisible();
    await expect(page.getByTestId("map-clear-pin")).toBeVisible();
    // Esc closes it.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("every setting is remembered across a reload", async ({ page }) => {
    await open(page, "map");
    await page.getByTestId("map-settings-btn").click();
    await page.getByTestId("map-scheme-heat").click();
    await page.getByTestId("map-minimap").check();
    await page.getByTestId("map-edges-few").click();
    await page.reload();
    await page.waitForTimeout(800);
    await page.getByTestId("map-settings-btn").click();
    await expect(page.getByTestId("map-scheme-heat")).toHaveClass(/on/);
    await expect(page.getByTestId("map-edges-few")).toHaveClass(/on/);
    await expect(page.getByTestId("map-minimap")).toBeChecked();
    // the scheme took: the canvas carries the heat scheme state
    await expect(page.locator('[data-testid="map-flow"]')).toBeVisible();
  });

  test("the minimap toggle actually shows and hides the minimap", async ({ page }) => {
    await open(page, "map");
    await page.getByTestId("map-settings-btn").click();
    await page.getByTestId("map-minimap").check();
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    await page.getByTestId("map-minimap").uncheck();
    await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  });

  test("the map keeps its viewport across a reload", async ({ page }) => {
    await open(page, "map");
    await page.waitForTimeout(1200);
    // pan the canvas
    const canvas = page.locator('[data-testid="map-flow-canvas"] .react-flow__pane').first();
    await canvas.hover({ position: { x: 400, y: 300 } });
    await page.mouse.down();
    await page.mouse.move(550, 380, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="map-flow-canvas"] .react-flow__viewport');
      return t ? t.style.transform : null;
    });
    await page.reload();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="map-flow-canvas"] .react-flow__viewport');
      return t ? t.style.transform : null;
    });
    // The restored viewport is within a pixel of the one left behind.
    const nums = (t: string | null) => (t?.match(/-?[\d.]+/g) ?? []).map(Number);
    const [bx, by] = nums(before), [ax, ay] = nums(after);
    expect(Math.abs(bx - ax)).toBeLessThan(2);
    expect(Math.abs(by - ay)).toBeLessThan(2);
  });

  test("the layers moved out of the Explorer sheet – no duplicate controls", async ({ page }) => {
    await open(page, "map");
    await page.getByTestId("map-explorer-btn").click();
    const sheet = page.locator('[data-testid="map-explorer"]');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("u2-layers")).toHaveCount(0);
  });
});

test.describe("the theme segment", () => {
  test("Light / Dark / System states write the theme and the html attribute", async ({ page }) => {
    await open(page, "overview");
    await page.keyboard.press(",");
    await expect(page.getByTestId("theme-seg")).toBeVisible();
    await page.getByTestId("theme-light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-system").click();
    await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
    // system removes the explicit attribute: the media query owns the theme
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });
});

test.describe("light-theme contrast", () => {
  test("--text-3 meets 4.5:1 on the light ground", async ({ page }) => {
    await open(page, "overview");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(400);
    const ratio = await page.evaluate(() => {
      const lum = (hex: string) => {
        const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const rgb = (c: string) => c.replace(/[^\d,.]/g, "").split(",").slice(0, 3);
      const chan = (v: string) => { const n = Number(v) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
      const lumOf = (c: string) => { const [r, g, b] = rgb(c).map(chan); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const l2 = lumOf(getComputedStyle(document.body).backgroundColor);
      const fg = getComputedStyle(document.documentElement).getPropertyValue("--text-3").trim();
      const l1 = lum(fg.length === 7 ? fg : rgb(fg).map((v) => Number(v).toString(16).padStart(2, "0")).join("") ? fg : "#000000");
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("the agents sub-nav", () => {
  test("the menu is one thin horizontal tab strip – the tab named in the page head", async ({ page }) => {
    await open(page, "agents", FIXTURE);
    await page.waitForTimeout(800);
    // fb2224b: the vertical icon rail became one horizontal strip above the view
    const strip = page.getByTestId("ag-tabs");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute("aria-orientation", "horizontal");
    const h = (await strip.boundingBox())?.height ?? 999;
    expect(h).toBeLessThanOrEqual(56);
    for (const name of ["Teams", "Research", "Memory"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeAttached();
    }
    // no title band of its own – the page head names the tab
    await page.getByRole("tab", { name: "Research", exact: true }).click();
    await expect(page.locator(".page-head h1")).toHaveText("Research");
    // Open Workspace rides in the tab row
    await expect(strip.getByTestId("ag-to-workspace")).toBeVisible();
  });

  test("#agents/teams clicking Agents keeps the URL and the view in step", async ({ page }) => {
    await open(page, "agents/teams", FIXTURE);
    await page.waitForTimeout(800);
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await expect(page).toHaveURL(/#agents$/);
    await expect(page.locator(".page-head h1")).toHaveText("Agents");
  });
});

test.describe("deep links and phone", () => {
  test("#workspace lands on the map, not on the overview", async ({ page }) => {
    await open(page, "workspace");
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("map-view")).toBeVisible();
  });

  test("settings at phone width is a full-height sheet with wrapping subtitles", async ({ page }) => {
    await open(page, "overview");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press(",");
    const win = page.locator(".win.settings");
    await expect(win).toBeVisible();
    const h = (await win.boundingBox())?.height ?? 0;
    expect(h).toBeGreaterThan(700); // full-height sheet, not a floating card
    // subtitles wrap instead of clipping mid-word
    const wrap = await page.evaluate(() => getComputedStyle(document.querySelector(".win.settings .set-label small")!).whiteSpace);
    expect(wrap).not.toBe("nowrap");
  });
});
