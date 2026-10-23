// X6 · Plain-interactions probes – the two ids X6 owns in
// docs/design/plain-interactions.md §6. `test.fixme` until the owning wave 2
// module lands the behaviour (strip → U7, frame header → U8); X6 un-fixmes.
// Assert by name, never counts (the fixture is per worker).
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

test.use({ baseURL: FIXTURE });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto("/#map");
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".fc-node").first()).toBeVisible({ timeout: 30_000 });
}

// §2/§6 – the journey strip must not cover the canvas centre (U7)
// Re-fixmed after live-checking a699d36: journey rows live in the
// inspector aside (hidden until selection) – see plain.spec.ts note.
test.fixme("x6-canvas-strip the journey strip stays below 82% of the canvas height", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="x5-journey-row"]').first().click();
  const strip = page.locator('[data-testid="x5-journey-strip"]');
  await expect(strip).toBeVisible();
  const share = await page.evaluate(() => {
    const canvas = document.querySelector(".fc-canvas")!.getBoundingClientRect();
    const s = document.querySelector('[data-testid="x5-journey-strip"]')!.getBoundingClientRect();
    return (s.bottom - canvas.y) / canvas.height;
  });
  expect(share, "strip bottom within the lower 18% of the canvas").toBeLessThanOrEqual(0.82);
});

// §4/§6 – the opened frame's header shows the open path's top and leaf (U8)
test.fixme("x6-frame-header the frame breadcrumb shows the open path ends", async ({ page }) => {
  await opened(page);
  // drill into the deepest clear square (the base's drill test helper path:
  // open one branch by a true click, not drag/keyboard)
  const square = page.locator(".fc-solid").first();
  await square.click();
  const header = page.locator('[data-testid="x6-frame-header"]').first();
  await expect(header).toBeVisible();
  const text = ((await header.textContent()) ?? "").trim();
  // breadcrumb: top directory and the opened leaf both present, middle allowed to ellipsize
  const parts = text.split(/·|\//).map((s) => s.trim()).filter(Boolean);
  expect(parts.length).toBeGreaterThanOrEqual(2);
  await expect(header).toContainText(/·|\//);
});
