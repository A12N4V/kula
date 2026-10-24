import { expect, test as base, type Page } from "@playwright/test";

// U13 – toggles, icons and lists: the graph top bar (Packages/Fences are
// switches, Symbols/Files stays a segmented mode control), icon rows that
// never overflow at 360–1440, and list rows whose dot sits centred with
// counts aligned.

const test = base.extend({});

async function open(page: Page, hash: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("u13 toggles, icons and lists", () => {
  test("graph: Packages and Fences are labelled switches, not pressed buttons", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible({ timeout: 30_000 });

    const pkgs = page.getByTestId("graph-packages");
    await expect(pkgs).toHaveAttribute("role", "switch");
    await expect(pkgs).toHaveAttribute("aria-checked", "false");
    await expect(pkgs).toHaveAttribute("aria-label", /packages/i);
    await pkgs.click();
    await expect(pkgs).toHaveAttribute("aria-checked", "true");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.settings.v1") ?? "{}").packages);
    expect(stored).toBe(true);

    const fences = page.getByTestId("graph-fences");
    await expect(fences).toHaveAttribute("role", "switch");
    await expect(fences).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("f"); // the hotkey drives the same switch
    await expect(fences).toHaveAttribute("aria-checked", "true");
  });

  test("graph: Symbols/Files stays an icon segmented mode control with tooltips", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    const sym = page.getByTestId("graph-level-symbol");
    const files = page.getByTestId("graph-level-file");
    // modes, not switches: no role=switch anywhere in the segmented control
    await expect(sym).not.toHaveAttribute("role", "switch");
    await expect(sym).toHaveAttribute("aria-label", /symbols/i);
    await expect(files).toHaveAttribute("aria-label", /files/i);
    await expect(sym).toHaveClass(/on/);
    await files.click();
    await expect(files).toHaveClass(/on/);
    await expect(sym).not.toHaveClass(/on/);
  });

  test("graph: the top bar never overflows or wraps at 360–1440", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    for (const w of [360, 480, 720, 900, 1100, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 844 });
      const geo = await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>(".graph-overlay.hud");
        const doc = document.documentElement;
        if (!bar) return { page: doc.scrollWidth - doc.clientWidth, bar: 0, wrapped: false };
        const kids = Array.from(bar.children) as HTMLElement[];
        return {
          page: doc.scrollWidth - doc.clientWidth,
          // above 720 the bar is not a scroller – it must fit outright
          bar: bar.scrollWidth - bar.clientWidth,
          wrapped: kids.some((k) => k.getBoundingClientRect().top > bar.getBoundingClientRect().top + 4),
        };
      });
      expect(geo.page, `page overflow at ${w}px`).toBeLessThanOrEqual(2);
      if (w > 720) {
        expect(geo.bar, `bar overflow at ${w}px`).toBeLessThanOrEqual(2);
        expect(geo.wrapped, `bar wrapped at ${w}px`).toBe(false);
      }
    }
  });

  test("flows: every list row's dot sits centred on the two-line label", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, "flows");
    await expect(page.locator(".item > .dot").first()).toBeVisible({ timeout: 20_000 });
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of Array.from(document.querySelectorAll<HTMLElement>(".item"))) {
        const dot = row.querySelector<HTMLElement>("> .dot");
        if (!dot) continue;
        const r = row.getBoundingClientRect(), d = dot.getBoundingClientRect();
        const mid = (d.top + d.bottom) / 2, rowMid = (r.top + r.bottom) / 2;
        if (Math.abs(mid - rowMid) > 6) out.push(`${row.textContent?.slice(0, 40)} dot mid ${mid.toFixed(0)} vs row ${rowMid.toFixed(0)}`);
      }
      return out;
    });
    expect(bad, bad.join("; ")).toEqual([]);
  });

  test("notes: the graph on/off row is a switch that hides the graph", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, "notes");
    const tgl = page.getByTestId("notes-graph-toggle");
    await expect(tgl).toHaveAttribute("role", "switch", { timeout: 20_000 });
    await expect(tgl).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".notes-split canvas, .notes-split svg").first()).toBeVisible();
    await tgl.click();
    await expect(tgl).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".notes-side")).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("kula.notes.graph"));
    expect(stored).toBe("off");
  });
});
