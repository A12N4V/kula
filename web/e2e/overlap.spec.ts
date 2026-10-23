import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { explore } from "./explore";

// Text-overlap probe: on every view at desktop, laptop and phone widths, no
// two visible runs of text collide, no text is cut off without an ellipsis,
// and nothing scrolls sideways. Layout is the same in both themes, so dark
// only.

type Spot = { name: string; hash: string; base?: string; then?: (page: Page) => Promise<void> };

const SPOTS: Spot[] = [
  { name: "graph", hash: "graph" },
  { name: "overview", hash: "overview" },
  { name: "changes", hash: "changes" },
  { name: "history", hash: "history" },
  { name: "workspace", hash: "map" },
  {
    name: "workspace + inspector", hash: "map", then: async (page) => {
      // the Workspace may land with a block already selected
      await explore(page); if (!(await page.getByTestId("map-inspector").isVisible())) await page.getByTestId("map-side-toggle").click({ timeout: 5_000 });
      await expect(page.getByTestId("map-inspector")).toBeVisible({ timeout: 5_000 });
    },
  },
  {
    name: "bottom panel", hash: "overview", then: async (page) => {
      await page.getByTestId("sb-dock").click();
      await expect(page.locator("[data-testid=dock]")).toBeVisible({ timeout: 5_000 });
    },
  },
  { name: "agents", hash: "agents", base: FIXTURE },
  { name: "agents workflows", hash: "agents/workflows", base: FIXTURE },
  { name: "agents memory", hash: "agents/memory", base: FIXTURE },
  { name: "settings", hash: "settings" },
];

async function open(page: Page, spot: Spot) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`${spot.base ?? ""}/#${spot.hash}`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".loading, .view-loading")).toHaveCount(0, { timeout: 30_000 });
  // the graph's layout checklist overlays the legend until layout settles
  await expect(page.locator(".gl-step")).toHaveCount(0, { timeout: 30_000 });
  if (spot.then) await spot.then(page);
  await page.waitForTimeout(500);
}

/** Collisions between visible text runs, text clipped with no ellipsis, and
 *  sideways page scroll. */
async function probe(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const label = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.split(" ").filter(Boolean).slice(0, 2).join(".") : "";
      const t = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${t}"`;
    };
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);

    // Every visible text run, as the element that owns the text node and the
    // tight rect of the glyphs (a Range, not the element's box).
    type Run = { el: Element; r: DOMRect };
    const runs: Run[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest("script, style, noscript, [aria-hidden=true], .sr-only")) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const raw of Array.from(range.getClientRects())) {
        // Clip to every scrolling or clipping ancestor: text scrolled out of
        // its list (under the status bar, say) is not on screen.
        let l = raw.left, tp = raw.top, rt = raw.right, bt = raw.bottom;
        for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
          const as = getComputedStyle(a);
          if (as.overflowX === "visible" && as.overflowY === "visible") continue;
          const ar = a.getBoundingClientRect();
          l = Math.max(l, ar.left); tp = Math.max(tp, ar.top); rt = Math.min(rt, ar.right); bt = Math.min(bt, ar.bottom);
        }
        l = Math.max(l, 0); tp = Math.max(tp, 0); rt = Math.min(rt, vw); bt = Math.min(bt, vh);
        if (rt - l < 2 || bt - tp < 2) continue;
        runs.push({ el, r: new DOMRect(l, tp, rt - l, bt - tp) });
      }
    }

    // Two runs from unrelated elements intersecting, where one of them is on
    // top at that spot (so a sheet covering both is not a collision).
    const seen = new Set<string>();
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i], b = runs[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // The canvas pans under its floating HUD and inspector by design;
        // collisions inside the canvas (one node's labels) still count.
        const ca = a.el.closest(".fc-canvas"), cb = b.el.closest(".fc-canvas");
        if (ca !== cb) continue;
        if (ca && !a.el.closest(".react-flow__panel") !== !b.el.closest(".react-flow__panel")) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix <= 2 || iy <= 2) continue;
        const top = document.elementFromPoint(Math.max(a.r.left, b.r.left) + ix / 2, Math.max(a.r.top, b.r.top) + iy / 2);
        if (!top || !(a.el.contains(top) || top.contains(a.el) || b.el.contains(top) || top.contains(b.el))) continue;
        const key = `${label(a.el)} × ${label(b.el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(`overlap: ${key}`);
      }
    }

    // Text cut off at its box with no ellipsis to say so.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (!Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent?.trim())) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      if (!["hidden", "clip"].includes(s.overflowX) || s.textOverflow === "ellipsis") continue;
      if (el.scrollWidth - el.clientWidth > 2) out.push(`clipped, no ellipsis: ${label(el)}`);
    }
    return out;
  });
}

for (const width of [1440, 1100, 390] as const) {
  test(`no text overlap at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "widths are set in the spec");
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const bad: string[] = [];
    for (const spot of SPOTS) {
      await open(page, spot);
      bad.push(...(await probe(page)).map((s) => `${spot.name}: ${s}`));
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
}
