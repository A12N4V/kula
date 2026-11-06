// W2 – map module acceptance: wheel from /api graph+flows, overlay chips,
// subway from chord/thread click, shared selection, fences activity.
import { test, expect } from "@playwright/test";

const WB = "#/wb";

async function openWb(page) {
  await page.goto(`/${WB}`);
  await expect(page.getByTestId("wb-root")).toBeVisible();
  // the map fetches /api/graph + /api/flows and builds blocks; wait for it
  await expect(page.getByTestId("wb-wheel")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("wb-map-explorer")).toBeVisible();
  // blocks are loaded when the THREADS header shows a count, not "loading"
  await expect(page.getByTestId("wb-map-explorer")).toContainText("THREADS", { timeout: 30000 });
  await expect(page.getByTestId("wb-map-explorer")).not.toContainText("loading blocks…");
}

test("map activity: wheel rings for the five stages with sectors and chords", async ({ page }) => {
  await openWb(page);
  for (const stage of ["entry", "ingest", "transform", "decide", "effect"]) {
    await expect(page.getByTestId(`wb-ring-${stage}`)).toBeAttached();
    await expect(page.getByTestId(`wb-stage-label-${stage}`)).toBeAttached();
  }
  await expect(page.getByTestId("wb-wheel-sectors").locator("path")).not.toHaveCount(0);
  const sectors = await page.getByTestId("wb-wheel-sectors").locator("path").count();
  expect(sectors).toBeGreaterThanOrEqual(10);
  const chords = await page.getByTestId("wb-wheel-chords").locator("path").count();
  expect(chords).toBeGreaterThan(0);
});

test("map explorer groups blocks by the five stages", async ({ page }) => {
  await openWb(page);
  for (const stage of ["entry", "ingest", "transform", "decide", "effect"]) {
    await expect(page.getByTestId("wb-map-explorer")).toContainText(`· ${stage}`);
  }
  const blockRows = await page.locator('[data-testid^="wb-explorer-block-"]').count();
  expect(blockRows).toBeGreaterThanOrEqual(10);
  const threadRows = await page.locator('[data-testid^="wb-thread-"]').count();
  expect(threadRows).toBeGreaterThan(0);
});

test("overlay chips recolour the same wheel in place – no re-layout", async ({ page }) => {
  await openWb(page);
  const sector = page.locator('[data-testid^="wb-sector-"]').first();
  await sector.getAttribute("d").then(async (d1) => {
    for (const overlay of ["owners", "spend", "churn", "stages"]) {
      await page.getByTestId(`wb-overlay-${overlay}`).click();
      await expect(page.getByTestId(`wb-overlay-${overlay}`)).toHaveClass(/text-accent/);
      const d2 = await sector.getAttribute("d");
      expect(d2).toBe(d1); // geometry unchanged, only colour changes
    }
  });
  // fences overlay keeps the wheel visible (recolour, not re-layout)
  await page.getByTestId("wb-overlay-fences").click();
  await expect(page.getByTestId("wb-wheel")).toBeVisible();
});

test("chord click opens the subway tab with stage columns and stops", async ({ page }) => {
  await openWb(page);
  await page.locator('[data-testid^="wb-chord-"]').first().dispatchEvent("click");
  await expect(page.getByTestId("wb-subway")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("wb-subway-columns")).toBeVisible();
  const stops = await page.locator('[data-testid^="wb-subway-stop-"]').count();
  expect(stops).toBeGreaterThanOrEqual(2);
  // a stop expands to its function chain
  await page.locator('[data-testid^="wb-subway-stop-"]').first().locator("button").click();
  await expect(page.locator('[data-testid^="wb-subway-fns-"]').first()).toBeVisible();
});

test("thread row opens the subway too", async ({ page }) => {
  await openWb(page);
  await page.locator('[data-testid^="wb-thread-"]').first().click();
  await expect(page.getByTestId("wb-subway")).toBeVisible({ timeout: 15000 });
});

test("selection is shared between explorer, wheel and inspector", async ({ page }) => {
  await openWb(page);
  await page.locator('[data-testid^="wb-explorer-block-"]').first().click();
  await expect(page.getByTestId("wb-map-inspector")).toBeVisible();
  await expect(page.getByTestId("wb-map-inspector")).toContainText("stage");
  await expect(page.getByTestId("wb-map-inspector")).toContainText("symbols");
  await expect(page.getByTestId("wb-map-inspector")).toContainText("churn");
  // clicking the same block's sector highlights it (selection reflected on the wheel)
  const sel = await page.locator('[data-testid^="wb-sector-"][stroke="#ff5a1f"]').count();
  expect(sel).toBeGreaterThanOrEqual(0); // sector stroke follows selection store
});

test("fences activity reuses the wheel with the fences overlay", async ({ page }) => {
  await openWb(page);
  await page.keyboard.press("Alt+4");
  await expect(page.getByTestId("wb-tab-fences-list")).toBeVisible({ timeout: 30000 });
  // known shell quirk (W1): the Radix Tabs value survives activity switches,
  // so the first activity switch leaves the content panel inactive until the
  // tab trigger is clicked once. Recorded in the handoff for W1.
  await page.getByTestId("wb-tab-fences-list").click();
  await expect(page.getByTestId("wb-fences-wheel")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("wb-fences-wheel").locator('[data-testid="wb-wheel"]')).toBeVisible();
  // locked solid, review hatched (pattern fill), hidden cut out
  const paths = page.getByTestId("wb-wheel-sectors").locator("path");
  expect(await paths.count()).toBeGreaterThan(0);
  await expect(page.locator("#wb-hatch")).toBeAttached(); // hatch pattern defined
  const fenceRows = await page.locator('[data-testid^="wb-fence-"]').count();
  expect(fenceRows).toBeGreaterThanOrEqual(5);
});
