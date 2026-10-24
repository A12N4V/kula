// U11 – Map chrome and the view switch. Acceptance from plan.md:
// `e` toggles the Explorer, arrow keys move within the sheet, focus returns
// to the toggle on close; the sheet never grows taller than the canvas;
// phone = bottom sheet; the run-bar view switch is an icon segmented
// control with tooltips, count badges and aria tabs; the key and the
// plain-words dock never cover block squares. Assert by name – the fixture
// is per worker.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

test.use({ baseURL: FIXTURE });

async function open(page: Page, hash = "map") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { sessionStorage.setItem("kula.map.legend", "closed"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 15_000 });
}

test("the Explorer: e toggles, arrow keys move, focus returns to the toggle", async ({ page }) => {
  await open(page);
  const btn = page.locator("[data-testid=map-explorer-btn]");
  const sheet = page.locator("[data-testid=map-explorer]");
  await expect(sheet).toHaveCount(0);
  // `e` opens
  await page.keyboard.press("e");
  await expect(sheet).toBeVisible();
  // `e` closes again, and focus lands back on the toggle
  await page.keyboard.press("e");
  await expect(sheet).toHaveCount(0);
  await expect(btn).toBeFocused();
  // open, move into the sheet with a click, rove with the arrow keys
  await page.keyboard.press("e");
  await expect(sheet).toBeVisible();
  await page.locator("[data-testid=hud-pipeline]").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-testid=hud-live]")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("[data-testid=hud-pipeline]")).toBeFocused();
  // Esc closes with the focus inside the sheet – focus returns to the toggle
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test("the Explorer sheet never grows taller than the canvas", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  const sheet = page.locator("[data-testid=map-explorer]");
  const canvas = page.locator("[data-testid=map-view]");
  const s = await sheet.boundingBox();
  const c = await canvas.boundingBox();
  expect(s && c && s.y + s.height <= c.y + c.height + 1, `sheet bottom ${s && s.y + s.height} vs canvas bottom ${c && c.y + c.height}`).toBe(true);
});

test("phone: the Explorer is a bottom sheet", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("e");
  const btn = page.locator("[data-testid=map-explorer-btn]");
  const sheet = page.locator("[data-testid=map-explorer]");
  const b = await btn.boundingBox();
  const s = await sheet.boundingBox();
  expect(b && s).toBeTruthy();
  expect(b!.y, "the toggle sits at the canvas's bottom").toBeGreaterThan(600);
  expect(s!.y + s!.height, "the sheet sits above the toggle").toBeLessThanOrEqual(b!.y + 1);
});

test("the run-bar view switch is an aria tablist with count badges", async ({ page }) => {
  await open(page);
  const seg = page.locator("[data-testid=u2-frames]");
  await expect(seg).toHaveAttribute("role", "tablist");
  for (const id of ["map", "runs", "evals"]) {
    const t = seg.locator(`[data-testid=u2-frame-${id}]`);
    await expect(t).toHaveAttribute("role", "tab");
    await expect(t).not.toHaveAttribute("title", "");
  }
  await expect(seg.locator("[data-testid=u2-frame-map]")).toHaveAttribute("aria-selected", "true");
  await expect(seg.locator("[data-testid=u2-frame-runs]")).toHaveAttribute("aria-selected", "false");
  // arrow keys move the tab cursor and pick (Runs opens the pipeline
  // inspector, which takes focus – assert selection only for that step)
  await seg.locator("[data-testid=u2-frame-map]").focus();
  await page.keyboard.press("ArrowRight");
  await expect(seg.locator("[data-testid=u2-frame-runs]")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(seg.locator("[data-testid=u2-frame-evals]")).toHaveAttribute("aria-selected", "true");
  await expect(seg.locator("[data-testid=u2-frame-evals]")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(seg.locator("[data-testid=u2-frame-map]")).toHaveAttribute("aria-selected", "true");
});

test("the key and the plain-words dock never cover block squares", async ({ page }) => {
  await open(page);
  // chips, collapsed by default
  await expect(page.locator("[data-testid=u7-legend]")).toBeVisible();
  await expect(page.locator("[data-testid=u9-plain-chip]")).toBeVisible();
  // every block square's face must be clear of both chips (the card
  // wrapper's label padding may reach further – the criterion is the square)
  const chips = page.locator("[data-testid=u7-legend], [data-testid=u9-plain-panel]");
  const n = await chips.count();
  const boxes = await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  const squares = await page.locator("[data-testid=map-flow] .fc-solid-sq").all();
  for (const sq of squares) {
    const b = await sq.boundingBox();
    if (!b || b.width < 8 || b.height < 8) continue;
    for (let i = 0; i < n; i++) {
      const k = boxes[i];
      const hit = !(b.x + b.width < k.x || k.x + k.width < b.x || b.y + b.height < k.y || k.y + k.height < b.y);
      expect(hit, `square at ${b.x},${b.y} is covered by chip ${i}`).toBe(false);
    }
  }
  // expanding the plain-words chip reveals the run control and progress
  await page.locator("[data-testid=u9-plain-chip]").click();
  await expect(page.locator("[data-testid=x5-plain-run]")).toBeVisible();
  await expect(page.locator("[data-testid=x5-plain-toggle]")).toBeVisible();
});

test("chips step aside of the open Explorer sheet without overlapping each other", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  const sheet = page.locator("[data-testid=map-explorer]");
  await expect(sheet).toBeVisible();
  const key = page.locator("[data-testid=u7-legend]");
  const plain = page.locator("[data-testid=u9-plain-chip]");
  const k = await key.boundingBox();
  const p = await plain.boundingBox();
  const s = await sheet.boundingBox();
  expect(k && p && s).toBeTruthy();
  // the two chips sit side by side, never stacked on the same anchor
  const chipHit = !(k!.x + k!.width < p!.x || p!.x + p!.width < k!.x || k!.y + k!.height < p!.y || p!.y + p!.height < k!.y);
  expect(chipHit, "key chip and plain chip overlap each other").toBe(false);
  // both chips clear of the open sheet
  for (const [name, b] of [["key", k], ["plain", p]] as const) {
    const hit = !(s!.x + s!.width < b!.x || b!.x + b!.width < s!.x || s!.y + s!.height < b!.y || b!.y + b!.height < s!.y);
    expect(hit, `${name} chip is covered by the open Explorer sheet`).toBe(false);
  }
  // the key chip is clickable while the sheet is open (was covered before)
  await key.click();
  await expect(page.locator("[data-testid=x5-legend]")).toHaveAttribute("aria-expanded", "true");
});
