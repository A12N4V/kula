import { expect, test, type Page } from "@playwright/test";

// Visual baselines – the committed reference for what the UI looked like when
// wave 1 (U1) landed. Later modules update a baseline only for a change they
// intended and say so in the hand-off. Run with
//   KULA_PW_PORT=7810 pnpm exec playwright test visual --project=desktop --update-snapshots
// Desktop project only (see playwright.config.ts – the `visual` project);
// mobile views are covered by the overflow spec, not pixel diffs.
//
// Flake controls: the opening sequence is skipped, the clock is frozen (the
// status-bar live clock), animations are disabled (reduced motion), and the
// agents fixture is the shared per-worker one (never assert counts).

const BASE = `http://localhost:${Number(process.env.KULA_PW_PORT ?? 7431)}`;

test.use({ viewport: { width: 1440, height: 900 } });

/** Land on a view with the opening sequence skipped, motion and time frozen. */
async function at(page: Page, hash: string, opts: { light?: boolean; panel?: boolean } = {}) {
  // Reduced motion is load-bearing here, not just polite: GraphView runs its
  // FA2 layout in a worker for ~1.4–4.5 s of wall time before settling, so a
  // screenshot taken mid-flight differs run to run with machine load. With
  // `prefers-reduced-motion: reduce` the app lays out synchronously and
  // deterministically instead (GraphView.tsx, `reduced` branch).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ light, panel }) => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try {
      localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false, theme: light ? "light" : "dark" }));
    } catch { /* */ }
    try { localStorage.removeItem("kula.map.pin"); } catch { /* */ }
    // Freeze the live clock in the status bar: deterministic baselines.
    const FIXED = 1760000000000; // fixed epoch, mid-session
    const RealDate = Date;
    const now = () => FIXED;
    Object.defineProperty(Date, "now", { value: now, configurable: true });
    // Reduced motion: the harmonograph marks draw once, no transitions.
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
    if (panel) (window as unknown as Record<string, unknown>).__kulaPanelOpen = true;
  }, { light: !!opts.light, panel: !!opts.panel });
  await page.goto("about:blank"); // a hash-only change would not reload the app
  await page.goto(`/#${hash}`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  // Per-view data loaders (Overview, Contrast, the map): a fixed wait races
  // the fetch under load – wait until the view has actually rendered.
  await expect(page.locator(".loading, .view-loading")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(400);
  // The map's landing camera keeps easing after the loaders drop (the fit
  // settles only once cards hydrate) and the nodes are DOM, not canvas, so a
  // shot taken mid-flight moves. Wait until the viewport transform holds
  // still across a beat, as the interaction specs do before a drag.
  if (hash === "map") {
    await expect
      .poll(async () => {
        const t1 = await page.locator(".react-flow__viewport").getAttribute("transform");
        await page.waitForTimeout(250);
        return t1 !== null && t1 === (await page.locator(".react-flow__viewport").getAttribute("transform"));
      }, { timeout: 15_000, intervals: [250] })
      .toBe(true);
    await page.waitForTimeout(400);
  }
}

/** Pixels that change with the repo or the clock, not with the design: the
    status bar (changed count, HEAD), canvases (the graph layout, dither, life).
    The Overview additionally masks its branch-dependent text – the header
    branch name, the file/symbol facts and the Branches table names and
    ahead/behind counts, all of which differ per module branch. */
// Whatever depends on the checkout running the test, not on the design: the
// repo name, branch chip and change badges differ per worktree, so every
// module's gate failed against baselines shot in another worktree.
const volatile = (page: Page) => [
  page.locator(".statusbar"), page.locator("canvas"), page.locator(".graph-canvas"),
  page.locator(".topbar .crumb-repo"), page.locator(".topbar .chip"), page.locator(".rail .badge"),
];

// Screenshot-only CSS: give the checkout-dependent text a fixed footprint so
// a longer repo or branch name cannot shift the rest of the header.
const SHOT_CSS = `.topbar .crumb-repo, .topbar .chip { display: inline-block; width: 96px; overflow: hidden; white-space: nowrap; }`;

const VIEWS = [
  ["graph", "graph"],
  ["overview", "overview"],
  // Not "changes": it renders the live dirty tree, which this run itself changes.
  ["agents", "agents"],
  ["map", "map"],
] as const;

test.describe("visual baselines", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const width of [1440, 390] as const) {
      test(`view baselines at ${width}px ${theme}`, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "desktop-only visual project");
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const [hash, name] of VIEWS) {
          await at(page, hash, { light: theme === "light" });
          await expect(page).toHaveScreenshot(`${name}-${width}-${theme}.png`, {
            threshold: 0.2, maxDiffPixelRatio: 0.002,
            animations: "disabled",
            caret: "hide", style: SHOT_CSS,
            fullPage: false,
            // Changes lists whatever is dirty right now (this run's own test
            // output included) – keep its chrome, mask the file data.
            mask: [...volatile(page), ...(name === "overview" ? [page.locator(".ov-title, .ov-stats, .ov-facts, .br-table, .card.coupling")] : []), ...(name === "changes" ? [page.locator(".main ul, .main ol, .main table, .main pre, .main [class*=diff], .main [class*=file]")] : [])],
          });
        }
      });

      test(`map inspector open/closed at ${width}px ${theme}`, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "desktop-only visual project");
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await at(page, "map", { light: theme === "light" });
        await expect(page).toHaveScreenshot(`map-closed-${width}-${theme}.png`, {
          threshold: 0.2, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", style: SHOT_CSS, mask: [...volatile(page), page.locator(".react-flow__renderer")],
        });
        // Open the inspector via the HUD Structure button (deterministic –
        // no canvas hit-testing).
        await page.getByTestId("map-side-toggle").click();
        await expect(page.getByTestId("map-inspector")).toBeVisible({ timeout: 5_000 });
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot(`map-open-${width}-${theme}.png`, {
          threshold: 0.2, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", style: SHOT_CSS, mask: [...volatile(page), page.locator(".react-flow__renderer")],
        });
      });

      test(`dock both tabs at ${width}px ${theme}`, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "desktop-only visual project");
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await at(page, "graph", { light: theme === "light" });
        await page.getByTestId("sb-dock").click();
        await expect(page.locator("[data-testid=dock]")).toBeVisible({ timeout: 5_000 });
        await expect(page).toHaveScreenshot(`dock-terminal-${width}-${theme}.png`, {
          threshold: 0.2, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", style: SHOT_CSS, mask: volatile(page),
        });
        // Switch to the second dock tab if there is one.
        const tabs = page.locator(".dock-tabs .dock-tab");
        if ((await tabs.count()) > 1) {
          await tabs.nth(1).click();
          await page.waitForTimeout(300);
          await expect(page).toHaveScreenshot(`dock-tab2-${width}-${theme}.png`, {
            threshold: 0.2, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", style: SHOT_CSS, mask: volatile(page),
          });
        }
      });
    }
  }
});
