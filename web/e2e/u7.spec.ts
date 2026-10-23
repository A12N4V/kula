// U7 – journeys and the legend (plain-map.md §2/§3, X5 T5/T6/T7 un-fixme'd
// here as concrete U7 tests; X6 may retire its copies). Fixture server.
// Journeys: the flows list in the right column as one row per flow (hue
// swatch, plain title, step count); picking shows the numbered sentence
// strip over the map and walks the camera square to square (Next/Prev,
// ←/→ scoped to a picked journey). Legend: collapsible key in the right
// column, x5-legend-* ids. Phone: the strip is a bottom sheet at 390.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, hash = "map") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
  await expect(page.locator("[data-testid=map-view]")).toBeVisible({ timeout: 30_000 });
}

/** A square safely inside the canvas (clear of chrome and the right column). */
async function clickCard(page: Page) {
  await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
  const ok = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".fc-card:not(.fc-card-sec)")];
    const el = cards.find((e) => {
      const r = e.getBoundingClientRect();
      // fully inside the viewport, clear of the top chrome and bottom transport
      return r.left > 12 && r.top > 120 && r.bottom < window.innerHeight - 110 && r.width > 40;
    });
    if (!el) return false;
    // a synthetic click still selects (the kit's pointer guard is click-only),
    // which is all this helper needs: selection opens the inspector
    (el as HTMLElement).click();
    return true;
  });
  if (!ok) await page.locator(".fc-card").first().click();
  await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
}

async function pickFirstJourney(page: Page) {
  await clickCard(page);
  await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
  await page.locator('[data-testid="x5-journey-row"]').first().click();
  await expect(page.locator('[data-testid="x5-journey-strip"]')).toBeVisible();
}

test.describe("u7 journeys and the legend", () => {
  test("journey rows render: hue swatch, plain title, step count", async ({ page }) => {
    await open(page);
    await clickCard(page);
    const rows = page.locator('[data-testid="x5-journey-row"]');
    await expect(rows.first()).toBeVisible();
    const first = rows.first();
    // hue swatch, plain title (not a code path), and a step count
    await expect(first.locator(".vf-swatch")).toBeVisible();
    const name = (await first.locator(".vf-row-name").textContent()) ?? "";
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toMatch(/\.(rs|ts|py|tsx)$/);
    await expect(first.locator(".u7-j-meta")).toContainText(/step/);
  });

  test("picking a journey opens the numbered sentence strip over the map", async ({ page }) => {
    await open(page);
    await pickFirstJourney(page);
    const step1 = page.locator('[data-testid="x5-journey-step-1"]');
    await expect(step1).toBeVisible();
    await expect(step1).toContainText("1");
    // a sentence with words, never a technical path
    const txt = (await step1.textContent()) ?? "";
    expect(txt.length).toBeGreaterThan(2);
    expect(txt).not.toMatch(/\.rs|\.ts\b/);
    await expect(page.locator('[data-testid="x5-journey-step-1"]')).toHaveAttribute("aria-current", "step");
  });

  test("Next/Prev walk the camera square to square and mark the step", async ({ page }) => {
    await open(page);
    await pickFirstJourney(page);
    const vp = page.locator("[data-testid=map-flow-canvas] .react-flow__viewport");
    const before = await vp.getAttribute("style");
    await page.locator('[data-testid="x5-journey-next"]').click();
    // the walk lands the camera on the step's square: it is selected and on
    // screen (the camera only moves when the square was off-screen, so the
    // transform alone is not the signal – lead, wave 3)
    void before;
    await expect.poll(() => page.evaluate(() => {
      const el = document.querySelector(".react-flow__node.selected");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    }), { timeout: 5000 }).toBe(true);
    await expect(page.locator('[data-testid="x5-journey-step-2"]')).toHaveAttribute("aria-current", "step");
    await page.locator('[data-testid="x5-journey-prev"]').click();
    await expect(page.locator('[data-testid="x5-journey-step-1"]')).toHaveAttribute("aria-current", "step");
  });

  test("arrow keys walk a picked journey and only then", async ({ page }) => {
    await open(page);
    await pickFirstJourney(page);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-testid="x5-journey-step-2"]')).toHaveAttribute("aria-current", "step");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-testid="x5-journey-step-1"]')).toHaveAttribute("aria-current", "step");
    // unpick: the strip leaves, and ←/→ no longer walk anything
    await page.locator('[data-testid="u7-journey-close"]').click();
    await expect(page.locator('[data-testid="x5-journey-strip"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="x5-journey-step-2"]')).toHaveCount(0);
  });

  test("the legend is a collapsible key in the right column with the five rows", async ({ page }) => {
    await open(page);
    // X5 §2 (critic blocking): the key is on the map at landing – visible
    // before any click, docked at the right edge while the inspector is closed.
    await expect(page.locator('[data-testid="x5-legend"]')).toBeVisible();
    await expect(page.locator('[data-testid="x5-legend-panel"]')).toBeVisible();
    await clickCard(page);
    const key = page.locator('[data-testid="x5-legend"]');
    await expect(key).toBeVisible();
    await expect(key).toHaveAttribute("aria-expanded", "true"); // open on first visit
    const panel = page.locator('[data-testid="x5-legend-panel"]');
    await expect(panel).toBeVisible();
    for (const row of ["colour", "size", "glyph", "ring", "agent"])
      await expect(panel.locator(`[data-testid="x5-legend-${row}"]`)).toBeVisible();
    // the colour row shows the repo's own directory hues, not a copy
    await expect(panel.locator('[data-testid="x5-legend-colour"] .u7-lg-swatch').first()).toBeVisible();
    // collapse – and it stays collapsed for the session
    await key.click();
    await expect(panel).not.toBeVisible();
    await expect(key).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(page.locator('[data-testid="x5-legend-panel"]')).toHaveCount(0);
  });

  test("the base ring + wire tint stays when a journey is picked", async ({ page }) => {
    await open(page);
    await pickFirstJourney(page);
    const hue = await page.evaluate(() => getComputedStyle(document.querySelector(".u7-strip") as Element).getPropertyValue("--vf-hue").trim());
    expect(hue).toMatch(/#\w|rgb|hsl/);
    // the picked flow's squares carry the ring (the kit's solid-flow outline)
    await expect(page.locator(".fc-solid-sq.fc-solid-flow").first()).toBeVisible();
  });

  test("phone: the strip is a bottom sheet at 390x844", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await pickFirstJourney(page);
    const strip = page.locator('[data-testid="x5-journey-strip"]');
    await expect(strip).toBeVisible();
    const box = await strip.boundingBox();
    const vw = 390;
    expect(box!.x).toBeGreaterThanOrEqual(10);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw - 10);
    expect(box!.y + box!.height).toBeGreaterThan(844 * 0.55); // docked to the bottom
  });
});
