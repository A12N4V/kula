// U8 · Squares, polished – the open/fold motion (≤ 160 ms, reduced motion
// off), the frame header's breadcrumb of the open path and fold button, the
// camera keeping the opened square under the pointer, square sizes on a
// 3-step scale, captions that never collide, and hover lifting the square's
// wires to 100% while the rest dim to 15%. Assert by name, never counts.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

test.use({ baseURL: FIXTURE });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`/#map`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
}

/** Fit the view, open the first openable solid square and wait for its frame. */
async function openFirst(page: Page) {
  await page.locator('[data-testid="fc-fit"]').click();
  await page.waitForTimeout(500);
  // a square that holds sub-blocks (not only functions), so its frame has openable children
  const sq = page.locator('.fm-flow .fc-solid[data-fc-has]:not([data-fc-has=""]):not(.fc-solid-leaf):not(.fc-dim)').first();
  const id = await sq.getAttribute("data-testid");
  await sq.click();
  const frame = page.locator('[data-testid^="fc-node-open:"]').first();
  await expect(frame).toBeVisible({ timeout: 15_000 });
  return { id: id!.replace("fc-node-", ""), frame };
}

test("opening a square animates in at ≤ 160 ms and stops under reduced motion", async ({ page }) => {
  await opened(page);
  const { id } = await openFirst(page);
  const node = page.locator(`.fm-flow .fc-solid`).first();
  await expect(node).toBeVisible();
  const anim = await node.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, ms: parseFloat(cs.animationDuration) * 1000 };
  });
  expect(anim.name).toBe("fc-open-in");
  expect(anim.ms).toBeGreaterThan(0);
  expect(anim.ms).toBeLessThanOrEqual(160);
  // The runtime flag (views can tinker motion off) stops it too.
  await page.evaluate(() => document.documentElement.setAttribute("data-rm", "1"));
  const animOff = await node.evaluate((el) => getComputedStyle(el).animationName);
  expect(animOff).toBe("none");
  void id;
});

test("the open frame header carries the breadcrumb of the open path and a fold button that folds", async ({ page }) => {
  await opened(page);
  const { id } = await openFirst(page);
  // The crumb for the opened block lists its open path. A top-level section
  // is a one-segment path, so open a child inside the frame to see the chain.
  // The camera keeps panning (the anchor's ~200 ms pan), so the frame box is
  // re-measured inside the child loop – never captured once before it.
  await page.waitForTimeout(400); // let the anchor pan settle
  const frameBox = () => page.locator('[data-testid^="fc-node-open:"]').first().boundingBox();
  expect(await frameBox()).toBeTruthy();
  const kids = page.locator(".fm-flow .fc-solid:not(.fc-solid-leaf):not(.fc-dim)");
  const nKids = await kids.count();
  let childId: string | null = null;
  for (let i = 0; i < nKids && !childId; i++) {
    const k = kids.nth(i);
    const b = await k.boundingBox();
    const fb = await frameBox();
    if (!b || !fb) continue;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx > fb.x && cx < fb.x + fb.width && cy > fb.y && cy < fb.y + fb.height) {
      childId = (await k.getAttribute("data-testid"))!.replace("fc-node-", "");
      await k.click();
    }
  }
  expect(childId, "the opened frame holds an openable child square").toBeTruthy();
  const childFrame = page.locator(`[data-testid="fc-node-open:${childId}"]`);
  await expect(childFrame).toBeVisible({ timeout: 15_000 });
  const crumb = page.locator(`[data-testid="fc-crumb-${childId}"]`);
  await expect(crumb).toBeVisible();
  const segs = await crumb.locator(".fc-crumb-seg").allTextContents();
  // section → … → the opened block, in order.
  expect(segs.length).toBeGreaterThanOrEqual(2);
  expect(segs[segs.length - 1].length).toBeGreaterThan(0);
  expect(segs.join(" → ")).toContain(" → ");
  // The fold button folds: the open frame leaves the DOM.
  const fold = page.locator(`[data-testid="fc-fold-open\\:${childId}"]`);
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(childFrame).toHaveCount(0, { timeout: 15_000 });
  // The square is back where the frame stood – the fold keeps the place.
  await expect(page.locator(`[data-testid="fc-node-${childId}"]`)).toBeVisible();
  void id;
});

test("the camera keeps the opened square under the pointer", async ({ page }) => {
  await opened(page);
  await openFirst(page);
  await page.waitForTimeout(700); // let the anchor's 200 ms settle
  const box = await page.locator('[data-testid^="fc-node-open:"]').first().boundingBox();
  expect(box).toBeTruthy();
  const vp = page.viewportSize()!;
  const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
  // Centred, not yanked to a corner: within 30% of the viewport centre.
  expect(Math.abs(cx - vp.width / 2)).toBeLessThan(vp.width * 0.3);
  expect(Math.abs(cy - vp.height / 2)).toBeLessThan(vp.height * 0.3);
});

test("square sizes sit on a 3-step scale", async ({ page }) => {
  await opened(page);
  const widths = await page.evaluate(() => {
    const set = new Set<number>();
    for (const el of document.querySelectorAll(".fm-flow .fc-solid-sq")) set.add(Math.round(el.getBoundingClientRect().width));
    return [...set];
  });
  // Three distinct sizes on screen at the landing zoom – the scale, not a
  // continuum (screen px vary with zoom; the count of steps is the contract).
  expect(widths.length).toBe(3);
});

test("hovering a square lifts its wires to 100% and dims the rest to 15%", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="fc-fit"]').click();
  await page.waitForTimeout(500);
  // Hover squares until one with wires lights up (a leaf with no edges has
  // nothing to lift; the contract is about the wires, not that one square).
  const nodes = page.locator(".fm-flow .fc-solid:not(.fc-dim)");
  const n = await nodes.count();
  let ops: { lit: string[]; faint: string[]; nLit: number; nFaint: number } | null = null;
  for (let i = 0; i < Math.min(n, 12) && !(ops && ops.nLit > 0); i++) {
    await nodes.nth(i).hover({ force: true });
    await page.waitForTimeout(250);
    ops = await page.evaluate(() => {
      const lit: string[] = [], faint: string[] = [];
      for (const el of document.querySelectorAll(".fm-flow .fc-edge")) {
        const cls = el.classList;
        if (cls.contains("fc-edge-lit")) lit.push(getComputedStyle(el).opacity);
        else if (cls.contains("fc-edge-faint")) faint.push(getComputedStyle(el).opacity);
      }
      return { lit: [...new Set(lit)], faint: [...new Set(faint)], nLit: lit.length, nFaint: faint.length };
    });
  }
  expect(ops, "some square with wires was hovered").toBeTruthy();
  expect(ops!.nLit).toBeGreaterThan(0);
  expect(ops!.lit.every((o) => parseFloat(o) === 1)).toBe(true);
  expect(ops!.nFaint).toBeGreaterThan(0);
  expect(ops!.faint.every((o) => Math.abs(parseFloat(o) - 0.15) < 0.01)).toBe(true);
});

test("captions never collide at 1440, 1100 and 390 (overlap probe)", async ({ page, browser }) => {
  test.setTimeout(90_000);
  for (const [w, h] of [[1440, 900], [1100, 700], [390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark", hasTouch: w < 600 });
    await opened(p);
    // Open one branch too: the frame is where captions crowd.
    if (w >= 700) await openFirst(p);
    await p.waitForTimeout(600);
    const overlaps = await p.evaluate(() => {
      const caps = [...document.querySelectorAll(".fm-flow .fc-solid-name")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const hits: string[] = [];
      for (let i = 0; i < caps.length; i++) {
        const a = caps[i].getBoundingClientRect();
        for (let j = i + 1; j < caps.length; j++) {
          const b = caps[j].getBoundingClientRect();
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
            hits.push(`${caps[i].textContent} × ${caps[j].textContent}`);
          }
        }
      }
      return hits;
    });
    expect(overlaps, `${w}×${h}: ${overlaps.join("; ")}`).toEqual([]);
    await p.close();
  }
});

test("the child count and the + open affordance survive far zoom", async ({ page }) => {
  await opened(page);
  // Zoom the canvas out hard (the − control steps down), then the count and
  // the mark must still be rendered and styled to read.
  for (let i = 0; i < 8; i++) {
    await page.locator('[data-testid="fc-zoom-out"]').click().catch(async () => { await page.keyboard.press("-"); });
  }
  await page.waitForTimeout(500);
  const marked = await page.evaluate(() => {
    let withCount = 0, withOpen = 0;
    for (const sq of document.querySelectorAll(".fm-flow .fc-solid")) {
      if (sq.querySelector(".fc-solid-n")) withCount++;
      if (sq.querySelector(".fc-solid-open")) withOpen++;
    }
    return { withCount, withOpen };
  });
  expect(marked.withCount).toBeGreaterThan(0);
  expect(marked.withOpen).toBeGreaterThan(0);
});
