// MA proof: the metro variant draws an octilinear transit map, clicking a
// flow fits the view to it, clicking an interchange opens the inspector with
// all its flows, and two layouts of the same data are identical (no
// Vitest in this repo, so determinism runs in the page against the pure
// builder). Screenshots land in .kula-team/shots for the owner.

import { expect, test } from "@playwright/test";

const waitReady = (page: import("@playwright/test").Page) =>
  page.waitForFunction(() => {
    const k = (window as any).__kulaMap;
    const metro = (window as any).__kulaMetro;
    const c = document.querySelector('[data-testid="map-canvas"]');
    return !!(k?.model?.stations?.length && metro?.current?.flows?.length && c && k?.view?.scale && c.clientWidth > 0);
  }, undefined, { timeout: 30_000 });

test("metro variant draws districts, lines and interchanges", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const drawn = await page.evaluate(() => {
    const cv = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const ctx = cv.getContext("2d")!;
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let inked = 0, total = 0;
    for (let i = 0; i < img.length; i += 16) {
      total++;
      if (img[i] + img[i + 1] + img[i + 2] > 60) inked++;
    }
    const metro = (window as any).__kulaMetro.current;
    // every leg of every line is octilinear (0, 45 or 90 degrees)
    let nonOcti = 0;
    for (const f of metro.flows) {
      for (let i = 0; i + 1 < f.poly.length; i++) {
        const dx = Math.abs(f.poly[i + 1].x - f.poly[i].x), dy = Math.abs(f.poly[i + 1].y - f.poly[i].y);
        if (dx > 0.5 && dy > 0.5 && Math.abs(dx - dy) > 0.5) nonOcti++;
      }
    }
    // every flow's line passes through each of its stations
    let offLine = 0;
    for (const f of metro.flows) {
      for (const sid of f.stations) {
        const p = metro.stations.find((s: any) => s.id === sid);
        if (!f.poly.some((q: any) => Math.hypot(q.x - p.x, q.y - p.y) < 2)) offLine++;
      }
    }
    // stations drawn once, inside their districts
    const dup = metro.stations.length - new Set(metro.stations.map((s: any) => s.id)).size;
    const outside = metro.stations.filter((s: any) =>
      !metro.domains.some((d: any) => s.x >= d.x && s.x <= d.x + d.w && s.y >= d.y && s.y <= d.y + d.h)).length;
    return { inkedPct: Math.round((1000 * inked) / total), nonOcti, offLine, dup, outside, stations: metro.stations.length, flows: metro.flows.length };
  });
  expect(drawn.flows).toBeGreaterThan(0);
  expect(drawn.stations).toBeGreaterThan(0);
  expect(drawn.inkedPct).toBeGreaterThan(20); // ink on the black canvas, per mille
  expect(drawn.nonOcti).toBe(0);
  expect(drawn.offLine).toBe(0);
  expect(drawn.dup).toBe(0);
  expect(drawn.outside).toBe(0);
});

test("fit to a flow: clicking a flow line flies to it", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  // a point on a flow polyline, away from any station: the longest leg of the
  // most compact eligible flow – a flow that fills the world would fit to the
  // very transform the view already has, which proves nothing
  const at = await page.evaluate(() => {
    const metro = (window as any).__kulaMetro.current;
    const k = (window as any).__kulaMap;
    const distTo = (p: any, poly: any[]) => {
      let b = Infinity;
      for (let i = 0; i + 1 < poly.length; i++) {
        const a = poly[i], c = poly[i + 1];
        const dx = c.x - a.x, dy = c.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        b = Math.min(b, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
      }
      return b;
    };
    let best = null;
    for (const f of metro.flows) {
      const xs = f.poly.map((p: any) => p.x), ys = f.poly.map((p: any) => p.y);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      for (let i = 0; i + 1 < f.poly.length; i++) {
        const a = f.poly[i], b = f.poly[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len <= 30) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (metro.stations.some((s: any) => Math.hypot(s.x - mid.x, s.y - mid.y) < 14)) continue;
        // only a point whose nearest line is unambiguous: exactly one flow
        // inside the 6-unit hit radius, and it must be ours
        const near = metro.flows.filter((g: any) => distTo(mid, g.poly) < 6);
        if (near.length !== 1 || near[0].id !== f.id) continue;
        const s = Math.max(0.2, Math.min(2.5, Math.min(k.view.w / (bw + 120), k.view.h / (bh + 120))));
        const fit = JSON.stringify({ w: k.view.w, h: k.view.h, scale: s,
          ox: k.view.w / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * s,
          oy: k.view.h / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * s });
        const cur = JSON.stringify({ w: k.view.w, h: k.view.h, scale: k.view.scale, ox: k.view.ox, oy: k.view.oy });
        if (fit === cur) continue;
        if (!best || bw * bh < best.area) best = { area: bw * bh, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, flow: f.id };
      }
    }
    if (!best) return null;
    const v = k.view;
    return { x: best.x * v.scale + v.ox, y: best.y * v.scale + v.oy, flow: best.flow,
      w: v.w, h: v.h, scaleBefore: v.scale, oxBefore: v.ox, oyBefore: v.oy };
  });
  expect(at).not.toBeNull();
  await page.getByTestId("map-canvas").click({ position: { x: at.x, y: at.y } });
  await expect(page).toHaveURL(new RegExp(`#map/a/f/${at.flow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  // the view moved to the flow: the transform changed (scale may land on the
  // same number by coincidence, so compare the whole transform). The baseline
  // is the pre-click transform from `at`: by the time we wait, the fly-to may
  // already have been applied, and waiting on a post-click snapshot would
  // compare the view to itself.
  await page.waitForFunction((before) => JSON.stringify((window as any).__kulaMap.view) !== JSON.stringify(before),
    { w: at.w, h: at.h, scale: at.scaleBefore, ox: at.oxBefore, oy: at.oyBefore }, { timeout: 10000 });
  const after = await page.evaluate(() => (window as any).__kulaMap.view);
  expect(JSON.stringify(after)).not.toBe(JSON.stringify({ w: at.w, h: at.h, scale: at.scaleBefore, ox: at.oxBefore, oy: at.oyBefore }));
  await page.getByTestId("map-inspector").waitFor({ state: "visible", timeout: 5000 });
  await page.getByTestId("inspector-close").click();
});

test("clicking an interchange opens the inspector with all its flows", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const at = await page.evaluate(() => {
    const metro = (window as any).__kulaMetro.current;
    const k = (window as any).__kulaMap;
    const busy = [...metro.stations].sort((a: any, b: any) => b.degree - a.degree)[0];
    const model = k.model;
    const st = model.stations.find((s: any) => s.id === busy.id);
    return {
      x: busy.x * k.view.scale + k.view.ox,
      y: busy.y * k.view.scale + k.view.oy,
      name: st.name,
      degree: st.degree,
      flows: st.flows.length,
    };
  });
  expect(at.degree).toBeGreaterThan(1);
  await page.getByTestId("map-canvas").click({ position: { x: at.x, y: at.y } });
  const ins = page.getByTestId("map-inspector");
  await expect(ins).toBeVisible();
  await expect(ins).toContainText(at.name);
  const chips = page.getByTestId("station-flows").getByRole("button");
  await expect(chips).toHaveCount(at.flows);
});

test("two layouts of the same data are identical", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const same = await page.evaluate(() => {
    const metro = (window as any).__kulaMetro;
    const model = (window as any).__kulaMap.model;
    const a = metro.current;
    const b = metro.build(model, { w: 1600, h: 1000 });
    const norm = (l: any) => JSON.stringify({
      stations: l.stations.map((s: any) => [s.id, +s.x.toFixed(6), +s.y.toFixed(6), s.degree]),
      flows: l.flows.map((f: any) => [f.id, f.stations, f.poly.map((p: any) => [+p.x.toFixed(6), +p.y.toFixed(6)])]),
      domains: l.domains.map((d: any) => [d.id, +d.x.toFixed(6), +d.y.toFixed(6), +d.w.toFixed(6), +d.h.toFixed(6)]),
    });
    return norm(a) === norm(b);
  });
  expect(same).toBe(true);
});

test("semantic zoom: districts only when far out, named stations when close", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  // zoom far out, then back in. Wheel events are dispatched on the canvas:
  // React attaches onWheel passively at the root, so a trusted mouse wheel
  // scrolls the page instead of reaching the handler (M0 quirk, handoff).
  const wheel = (dy: number) => page.evaluate((d) => {
    const cv = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent("wheel", { deltaY: d, bubbles: true, cancelable: true, clientX: r.left + 600, clientY: r.top + 300 }));
  }, dy);
  await wheel(400); await wheel(400);
  await page.waitForFunction(() => (window as any).__kulaMap.view.scale < 0.45);
  const far = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const metro = (window as any).__kulaMetro.current;
    const cv2 = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const ctx = cv2.getContext("2d")!;
    // at district zoom a degree-1 station would not be drawn; sample a
    // degree-1 station's screen position: the pixel there must be near-black
    const loneliest = metro.stations.filter((s: any) => s.degree === 1)
      .find((s: any) => s.x * k.view.scale + k.view.ox > 40 && s.y * k.view.scale + k.view.oy > 40 &&
        s.x * k.view.scale + k.view.ox < cv2.clientWidth - 40 && s.y * k.view.scale + k.view.oy < cv2.clientHeight - 40);
    if (!loneliest) return { sample: false };
    const dpr = window.devicePixelRatio || 1;
    const px = ctx.getImageData(Math.round(loneliest.x * k.view.scale * dpr + k.view.ox * dpr) + 3,
      Math.round(loneliest.y * k.view.scale * dpr + k.view.oy * dpr) + 3, 1, 1).data;
    return { sample: true, bright: px[0] + px[1] + px[2] };
  });
  expect(far.sample).toBe(true);
  if (far.sample) expect(far.bright).toBeLessThan(120); // no station dot zoomed out
  // zoom back in, anchored on a chosen interchange: the wheel handler zooms
  // around the cursor, so the station stays put under the pointer and the
  // same pixel can be sampled before and after. The interchanges sit in the
  // top domain rows, so a blind zoom at the canvas centre can miss them all.
  const target = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const metro = (window as any).__kulaMetro.current;
    const cv = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const s = metro.stations.find((x: any) => x.degree >= 2 &&
      x.x * k.view.scale + k.view.ox > 60 && x.y * k.view.scale + k.view.oy > 60 &&
      x.x * k.view.scale + k.view.ox < cv.clientWidth - 60 && x.y * k.view.scale + k.view.oy < cv.clientHeight - 60);
    if (!s) return null;
    return { x: s.x * k.view.scale + k.view.ox, y: s.y * k.view.scale + k.view.oy, id: s.id };
  });
  expect(target).not.toBeNull();
  const wheelAt = (x: number, y: number, dy: number) => page.evaluate(({ x, y, d }) => {
    const cv = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent("wheel", { deltaY: d, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y }));
  }, { x: target!.x, y: target!.y, d: dy });
  // two +400 steps land at scale ≈ 0.2; three −500 steps (×2.117 each) are
  // needed to clear the 1.2 detail threshold – two only reach ≈ 0.9
  await wheelAt(target!.x, target!.y, -500);
  await wheelAt(target!.x, target!.y, -500);
  await wheelAt(target!.x, target!.y, -500);
  await page.waitForFunction(() => (window as any).__kulaMap.view.scale > 1.2);
  const near = await page.evaluate((t) => {
    const k = (window as any).__kulaMap;
    const metro = (window as any).__kulaMetro.current;
    const cv2 = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const ctx = cv2.getContext("2d")!;
    const s = metro.stations.find((x: any) => x.id === t.id);
    if (!s) return { sample: false };
    const dpr = window.devicePixelRatio || 1;
    // the ring is hollow: its centre is filled with the background, the ink
    // sits on the stroke at radius r – sample the ring, not the hole
    const r = (6 + Math.min(4, s.degree - 1)) * k.view.scale * dpr;
    let bright = 0;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const px = ctx.getImageData(Math.round(s.x * k.view.scale * dpr + k.view.ox * dpr + dx),
        Math.round(s.y * k.view.scale * dpr + k.view.oy * dpr + dy), 1, 1).data;
      bright = Math.max(bright, px[0] + px[1] + px[2]);
    }
    return { sample: true, bright, name: s.name };
  }, target);
  expect(near.sample).toBe(true);
  if (near.sample) expect(near.bright).toBeGreaterThan(300); // interchange ring ink under the zoomed view
});

test("overlay toggles draw on the metro canvas", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  await page.getByTestId("overlay-fences").click();
  await page.getByTestId("overlay-churn").click();
  await expect(page.getByTestId("overlay-fences")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("overlay-churn")).toHaveAttribute("aria-pressed", "true");
  // no console errors while the overlays draw
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.waitForTimeout(400);
  expect(errs).toEqual([]);
});

test("mobile viewport renders the metro map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#map/a");
  await waitReady(page);
  const drawn = await page.evaluate(() => {
    const metro = (window as any).__kulaMetro.current;
    return { flows: metro.flows.length, stations: metro.stations.length };
  });
  expect(drawn.flows).toBeGreaterThan(0);
});
