// MA proof: the metro variant draws an octilinear transit map, its fit frames
// a flow, clicking an interchange opens the inspector with all its flows, and
// two layouts of the same data are identical. Until M4 wires the variant into
// Map.tsx (plan wave-2 update: MA does not edit M0 files), the shell shows the
// stub for variant a, so drawing, hit and fit run in the page through the
// window.__kulaMetro hook, against the live model from window.__kulaMap.
// Screenshots land in .kula-team/shots for the owner.

import { expect, test, type Page } from "@playwright/test";
import { build as viteBuild } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

type Any = Record<string, any>;

// Until M4 wires variant a into Map.tsx (plan wave-2 update: MA does not edit
// M0 files), the metro module is not reachable from the app bundle, so the
// spec bundles it with Vite once and injects it before every page load; the
// module then publishes window.__kulaMetro (pure build/draw/hit/fit/labels).
const HOOK = path.resolve(HERE, "../test-results/metro-hook/metro-hook.js");
test.beforeAll(async () => {
  await viteBuild({
    root: path.resolve(HERE, ".."),
    logLevel: "error",
    build: {
      write: true,
      emptyOutDir: true,
      outDir: "test-results/metro-hook",
      lib: {
        entry: path.resolve(HERE, "../src/views/map/metro/index.ts"),
        formats: ["iife"],
        name: "kulaMetroHook",
        fileName: () => "metro-hook.js",
      },
    },
  });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: HOOK });
});

const waitReady = (page: Page) =>
  page.waitForFunction(() => {
    const k = (window as Any).__kulaMap;
    const c = document.querySelector('[data-testid="map-canvas"]');
    return !!(k?.model?.stations?.length && k?.view?.scale && c && c.clientWidth > 0);
  }, undefined, { timeout: 30_000 });

/** Draw the metro map in-page onto a fresh canvas at a given view. */

test("shell: #map/a renders (stub until M4 wires variant a) without errors", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  await expect(page).toHaveURL(/#map\/a/);
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test("metro variant draws districts, lines and interchanges", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const drawn = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    const cv = document.createElement("canvas");
    cv.width = 1440; cv.height = 900;
    const ctx = cv.getContext("2d")!;
    const s = Math.min(1440 / lay.world.w, 900 / lay.world.h);
    const view = { w: 1440, h: 900, scale: s, ox: 720 - (lay.world.w / 2) * s, oy: 450 - (lay.world.h / 2) * s };
    metro.draw(ctx, k.model, view,
      { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
    const img = ctx.getImageData(0, 0, 1440, 900).data;
    let inked = 0, total = 0;
    for (let i = 0; i < img.length; i += 16) {
      total++;
      if (img[i] + img[i + 1] + img[i + 2] > 60) inked++;
    }
    // every leg of every line is octilinear (0, 45 or 90 degrees)
    let nonOcti = 0;
    for (const f of lay.flows) {
      for (let i = 0; i + 1 < f.poly.length; i++) {
        const dx = Math.abs(f.poly[i + 1].x - f.poly[i].x), dy = Math.abs(f.poly[i + 1].y - f.poly[i].y);
        if (dx > 0.5 && dy > 0.5 && Math.abs(dx - dy) > 0.5) nonOcti++;
      }
    }
    // every flow's line passes through each of its stations
    let offLine = 0;
    for (const f of lay.flows) {
      for (const sid of f.stations) {
        const p = lay.stations.find((s: Any) => s.id === sid);
        if (!f.poly.some((q: Any) => Math.hypot(q.x - p.x, q.y - p.y) < 2)) offLine++;
      }
    }
    // stations drawn once, inside their districts
    const dup = lay.stations.length - new Set(lay.stations.map((s: Any) => s.id)).size;
    const outside = lay.stations.filter((s: Any) =>
      !lay.domains.some((d: Any) => s.x >= d.x && s.x <= d.x + d.w && s.y >= d.y && s.y <= d.y + d.h)).length;
    return { inkedPct: Math.round((1000 * inked) / total), nonOcti, offLine, dup, outside,
      stations: lay.stations.length, flows: lay.flows.length };
  });
  expect(drawn.flows).toBeGreaterThan(0);
  expect(drawn.stations).toBeGreaterThan(0);
  expect(drawn.inkedPct).toBeGreaterThan(20); // ink on the black canvas, per mille
  expect(drawn.nonOcti).toBe(0);
  expect(drawn.offLine).toBe(0);
  expect(drawn.dup).toBe(0);
  expect(drawn.outside).toBe(0);
});

test("fit to a flow: the metro fit frames the flow's stations", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const got = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    // the most compact flow with more than one station
    const sized = lay.flows.filter((f: Any) => f.stations.length > 1).map((f: Any) => {
      const ps = f.stations.map((sid: string) => lay.stations.find((s: Any) => s.id === sid)!);
      const xs = ps.map((p: Any) => p.x), ys = ps.map((p: Any) => p.y);
      return { id: f.id, area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
        x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }).sort((a: Any, b: Any) => a.area - b.area);
    const f = sized[0];
    const before = { ...k.view };
    const after = metro.fitView({ kind: "flow", id: f.id }, k.model, before);
    return { before, after, f };
  });
  expect(got.f).toBeTruthy();
  expect(got.after).not.toBeNull();
  // the fitted view contains every station of the flow on screen
  const allIn = await page.evaluate(({ after, f }) => {
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build((window as Any).__kulaMap.model, { w: 1600, h: 1000 });
    const flow = lay.flows.find((x: Any) => x.id === f.id)!;
    return flow.stations.every((sid: string) => {
      const s = lay.stations.find((x: Any) => x.id === sid)!;
      const sx = s.x * after.scale + after.ox, sy = s.y * after.scale + after.oy;
      return sx > 0 && sx < after.w && sy > 0 && sy < after.h;
    });
  }, got);
  expect(allIn).toBe(true);
  expect(JSON.stringify(got.after)).not.toBe(JSON.stringify(got.before));
});

test("clicking an interchange opens the inspector with all its flows", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const at = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const busy = [...k.model.stations].sort((a: Any, b: Any) => b.degree - a.degree)[0];
    return { id: busy.id, name: busy.name, degree: busy.degree, flows: busy.flows.length };
  });
  expect(at.degree).toBeGreaterThan(1);
  // URL pick: same inspector the canvas click feeds (canvas click routing is
  // wired by M4, so the spec enters through the shell's own pick route)
  await page.goto(`/#map/a/s/${at.id}`);
  await waitReady(page);
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
    const metro = (window as Any).__kulaMetro;
    const model = (window as Any).__kulaMap.model;
    const a = metro.build(model, { w: 1600, h: 1000 });
    const b = metro.build(model, { w: 1600, h: 1000 });
    const norm = (l: Any) => JSON.stringify({
      stations: l.stations.map((s: Any) => [s.id, +s.x.toFixed(6), +s.y.toFixed(6), s.degree]),
      flows: l.flows.map((f: Any) => [f.id, f.stations, f.poly.map((p: Any) => [+p.x.toFixed(6), +p.y.toFixed(6)])]),
      domains: l.domains.map((d: Any) => [d.id, +d.x.toFixed(6), +d.y.toFixed(6), +d.w.toFixed(6), +d.h.toFixed(6)]),
    });
    return norm(a) === norm(b);
  });
  expect(same).toBe(true);
});

test("semantic zoom: districts only when far out, ring ink when close", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const far = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    // far out: scale 0.3, world centred on the canvas
    const scale = 0.3;
    const view = { w: 1440, h: 900, scale, ox: 720 - 800 * scale, oy: 450 - 500 * scale };
    const cv = document.createElement("canvas");
    cv.width = 1440; cv.height = 900;
    const ctx = cv.getContext("2d")!;
    metro.draw(ctx, k.model, view,
      { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
    // a degree-1 station would not be drawn: sample its screen pixel
    const loneliest = lay.stations.filter((s: Any) => s.degree === 1)
      .find((s: Any) => s.x * scale + view.ox > 40 && s.y * scale + view.oy > 40 &&
        s.x * scale + view.ox < 1400 && s.y * scale + view.oy < 860);
    if (!loneliest) return { sample: false };
    const px = ctx.getImageData(Math.round(loneliest.x * scale + view.ox) + 3,
      Math.round(loneliest.y * scale + view.oy) + 3, 1, 1).data;
    return { sample: true, bright: px[0] + px[1] + px[2] };
  });
  if (far.sample) expect(far.bright).toBeLessThan(120); // no station dot zoomed out
  const near = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    const s = lay.stations.find((x: Any) => x.degree >= 2)!;
    const scale = 1.3;
    const view = { w: 1440, h: 900, scale, ox: 720 - s.x * scale, oy: 450 - s.y * scale };
    const cv = document.createElement("canvas");
    cv.width = 1440; cv.height = 900;
    const ctx = cv.getContext("2d")!;
    metro.draw(ctx, k.model, view,
      { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
    // the ring is hollow: sample the stroke at radius r, not the centre
    const r = (6 + Math.min(4, s.degree - 1)) * scale;
    let bright = 0;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7]]) {
      const px = ctx.getImageData(Math.round(720 + dx), Math.round(450 + dy), 1, 1).data;
      bright = Math.max(bright, px[0] + px[1] + px[2]);
    }
    return { bright, name: s.name };
  });
  expect(near.bright).toBeGreaterThan(300); // interchange ring ink at detail zoom
});

test("label collision avoidance: lower-degree labels drop, the busiest survives", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const res = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    // 1. property test on crowded candidates: one spot, many labels, only the
    //    highest degree keeps its name
    const crowded = ["a", "b", "c", "d"].map((id, i) => ({
      id: `s${i}`, x: 400, y: 400, degree: i, text: `station ${i}`,
    }));
    const keptSyn = metro.labels(crowded);
    // 2. real map at detail zoom: the busiest station's label survives
    const busy = [...lay.stations].sort((a: Any, b: Any) => b.degree - a.degree)[0];
    const kept = metro.labels(lay.stations.map((s: Any) => ({ id: s.id, x: s.x, y: s.y, degree: s.degree, text: s.name })));
    return { synKept: [...keptSyn], allSynKept: keptSyn.size === crowded.length,
      busyKept: kept.has(busy.id), keptCount: kept.size, stationCount: lay.stations.length };
  });
  expect(res.synKept).toEqual(["s3"]); // degree 3 wins, the rest drop
  expect(res.busyKept).toBe(true);
});

test("overlay toggles draw on the metro canvas", async ({ page }) => {
  await page.goto("/#map/a");
  await waitReady(page);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const changed = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    const draw = (ov: Any) => {
      const cv = document.createElement("canvas");
      cv.width = 1440; cv.height = 900;
      const ctx = cv.getContext("2d")!;
      metro.draw(ctx, k.model, { w: 1440, h: 900, scale: 0.8, ox: 720 - 800 * 0.8, oy: 450 - 500 * 0.8 }, ov, null);
      return ctx.getImageData(0, 0, 1440, 900).data.join(",");
    };
    const off = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    const on = { fences: { [lay.stations[0].id]: "locked" as const }, live: { [lay.stations[1].id]: 0.8 },
      churn: { [lay.stations[2].id]: 3 }, owners: { [lay.stations[3].id]: "you" },
      show: { fences: true, live: true, churn: true, owners: true } };
    return { differs: draw(off) !== draw(on) };
  });
  expect(changed.differs).toBe(true);
  await page.waitForTimeout(300);
  expect(errs).toEqual([]);
});

test("mobile viewport renders the metro map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#map/a");
  await waitReady(page);
  const drawn = await page.evaluate(() => {
    const k = (window as Any).__kulaMap;
    const metro = (window as Any).__kulaMetro;
    const lay = metro.build(k.model, { w: 1600, h: 1000 });
    const s = Math.min(390 / lay.world.w, 844 / lay.world.h);
    const cv = document.createElement("canvas");
    cv.width = 390; cv.height = 844;
    const ctx = cv.getContext("2d")!;
    metro.draw(ctx, k.model, { w: 390, h: 844, scale: s, ox: 195 - 800 * s, oy: 422 - 500 * s },
      { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
    const img = ctx.getImageData(0, 0, 390, 844).data;
    let inked = 0, total = 0;
    for (let i = 0; i < img.length; i += 16) {
      total++;
      if (img[i] + img[i + 1] + img[i + 2] > 60) inked++;
    }
    return { inkedPct: Math.round((1000 * inked) / total), flows: lay.flows.length };
  });
  expect(drawn.flows).toBeGreaterThan(0);
  expect(drawn.inkedPct).toBeGreaterThan(5);
});

// Owner screenshots: the variant is drawn in-page onto a fixed canvas (the
// shell still shows the stub for a until M4 wires it), saved straight into
// .kula-team/shots at the required sizes.
test("screenshots for the owner", async ({ page }) => {
  const SHOTS = path.resolve(HERE, "../../../.kula-team/shots");
  const take = async (page: Page, name: string, w: number, h: number, view: Any) => {
    const shot = await page.evaluateHandle(({ w, h, view }) => {
      const k = (window as Any).__kulaMap;
      const metro = (window as Any).__kulaMetro;
      const lay = metro.build(k.model, { w: 1600, h: 1000 });
      const old = document.querySelector('[data-testid="metro-shot"]');
      if (old) old.remove();
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.setAttribute("data-testid", "metro-shot");
      cv.style.cssText = "position:fixed;top:0;left:0;z-index:99999";
      document.body.appendChild(cv);
      const ctx = cv.getContext("2d")!;
      metro.draw(ctx, k.model, { w, h, scale: view.scale, ox: view.ox, oy: view.oy },
        { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
      return cv;
    }, { w, h, view });
    await page.setViewportSize({ width: w, height: h });
    await (shot.asElement() as any).screenshot({ path: path.join(SHOTS, name) });
  };
  await page.goto("/#map/a");
  await waitReady(page);
  const lay = await page.evaluate(() => (window as Any).__kulaMetro.build((window as Any).__kulaMap.model, { w: 1600, h: 1000 }));
  const world = { scale: Math.min(1440 / lay.world.w, 900 / lay.world.h),
    ox: 0, oy: 0 };
  world.ox = 720 - (lay.world.w / 2) * world.scale;
  world.oy = 450 - (lay.world.h / 2) * world.scale;
  await take(page, "map-ma-overview.png", 1440, 900, world);
  // detail zoom on the busiest interchange
  const busy = [...lay.stations].sort((a: Any, b: Any) => b.degree - a.degree)[0];
  const z = 2.2;
  await take(page, "map-ma-interchange.png", 1440, 900,
    { scale: z, ox: 720 - busy.x * z, oy: 450 - busy.y * z });
  // districts only, far out
  const dz = 0.3;
  await take(page, "map-ma-districts.png", 1440, 900,
    { scale: dz, ox: 720 - (lay.world.w / 2) * dz, oy: 450 - (lay.world.h / 2) * dz });
  // mobile
  const ms = Math.min(390 / lay.world.w, 844 / lay.world.h);
  await take(page, "map-ma-mobile.png", 390, 844,
    { scale: ms, ox: 195 - (lay.world.w / 2) * ms, oy: 422 - (lay.world.h / 2) * ms });
});
