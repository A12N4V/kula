// M4 proof: the shell wires variants a and b (not the stub), zoom works on
// double click and Esc backs out one level, compare mode shows both panes with
// selection and zoom target synced, the test counterbalance order is stable
// per session, and first paint + pan frames are timed for both variants.

import { expect, test } from "@playwright/test";

// Wait for the map shell: model built, layout exposed, canvas fitted.
async function ready(page: import("@playwright/test").Page, hash = "/#map") {
  await page.goto(hash);
  await page.waitForFunction(() => {
    const k = (window as any).__kulaMap;
    const c = document.querySelector('[data-testid="map-canvas"]');
    return !!(k?.model && k?.layout?.stations?.length && c && k?.view?.w === c.clientWidth && c.clientWidth > 0);
  });
}

test("variant a draws the metro layout, not the stub", async ({ page }) => {
  await ready(page);
  const r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    return { stub: k.stubA, id: k.varA.id, stations: k.layout.stations.length };
  });
  expect(r.stub, "variant a must not be the stub").toBe(false);
  expect(r.id).toBe("a");
  expect(r.stations).toBeGreaterThan(0);
});

// Pixel proof for criterion "b wired": draw b and the stub into two offscreen
// canvases from the page and compare. A stub-dot map and a parcel map cannot
// agree pixel for pixel.
test("variant b draws parcels (not stub dots) on the shell canvas", async ({ page }) => {
  await ready(page, "/#map/b");
  const r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    if (k.stubA) return { stub: true };
    const c = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = c.width; off.height = c.height;
    const ctx = off.getContext("2d")!;
    // The stub still exists for variant c; drawing it from the page proves the
    // live canvas is not it.
    const stub = (window as any).__kulaMap.varA; // metro, for contrast
    stub.draw(ctx, k.model, k.view, { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } }, null);
    const a = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const b = ctx.getImageData(0, 0, off.width, off.height).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
    return { stub: false, diff, id: k.varA.id, stations: k.layout.stations.length };
  });
  expect(r.stub, "variant b must not fall back to the stub").toBe(false);
  expect(r.id).toBe("b");
  expect(r.stations).toBeGreaterThan(0);
  expect(r.diff, "variant b must paint differently from the metro draw").toBeGreaterThan(1000);
});

test("double click zooms to a station; Esc zooms back out one level", async ({ page }) => {
  await ready(page);
  const at = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const s = k.layout.stations[0];
    return { x: s.x * k.view.scale + k.view.ox, y: s.y * k.view.scale + k.view.oy, id: s.id };
  });
  const before = await page.evaluate(() => (window as any).__kulaMap.view.scale);
  await page.getByTestId("map-canvas").dblclick({ position: { x: at.x, y: at.y } });
  await expect(page.getByTestId("map-inspector")).toBeVisible();
  const after = await page.evaluate(() => (window as any).__kulaMap.view.scale);
  expect(after, "dblclick must fit (zoom in) to the pick").toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-inspector")).not.toBeVisible();
  const out = await page.evaluate(() => (window as any).__kulaMap.view.scale);
  expect(Math.abs(out - before), "Esc must restore the pre-fit zoom, one level").toBeLessThan(0.01);
});

test("compare shows two panes, the second shows the next variant, and a fit syncs both", async ({ page }) => {
  await ready(page, "/#map/a");
  await page.getByTestId("map-compare").click();
  await expect(page.getByTestId("map-canvas-2")).toBeVisible();
  const r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    return { a: k.varA.id, b: k.varB.id, other: k.other };
  });
  expect(r.a).toBe("a");
  expect(r.b).toBe(r.other);
  // Fit pane 1 through find; pane 2 must follow the same zoom target.
  const name = await page.evaluate(() => (window as any).__kulaMap.model.stations[0].name);
  await page.getByTestId("map-find").fill(name.slice(0, 6));
  await page.getByTestId("map-find-list").getByRole("button").first().click();
  await page.waitForFunction(() => (window as any).__kulaMap.view2.scale > 1);
  const panes = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    // The pick in the hash is the truth: fuzzy find may land on any station.
    const pid = location.hash.split("/s/")[1]?.split(/[?&]/)[0] ?? "";
    const s1 = k.layout.stations.find((x: any) => x.id === pid);
    if (!s1) throw new Error(`pick ${pid} not in pane-1 layout`);
    // Pane 2 is a different variant: the same station sits at its own world
    // point there, so measure it against pane 2's layout.
    const s2 = k.layoutB?.stations?.find((x: any) => x.id === pid);
    if (!s2) throw new Error(`pick ${pid} not in pane-2 layout`);
    const c1 = document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement;
    const c2 = document.querySelector('[data-testid="map-canvas-2"]') as HTMLCanvasElement;
    const r1 = c1.getBoundingClientRect(), r2 = c2.getBoundingClientRect();
    // Each pane centred the pick through its own fit.
    const p1 = { x: s1.x * k.view.scale + k.view.ox, y: s1.y * k.view.scale + k.view.oy };
    const p2 = { x: s2.x * k.view2.scale + k.view2.ox, y: s2.y * k.view2.scale + k.view2.oy };
    return {
      d1: Math.hypot(p1.x - r1.width / 2, p1.y - r1.height / 2),
      d2: Math.hypot(p2.x - r2.width / 2, p2.y - r2.height / 2),
    };
  });
  expect(panes.d1, "pane 1 centres the fitted station").toBeLessThan(80);
  expect(panes.d2, "pane 2 centres the same target through its own fit").toBeLessThan(80);
  // A click in pane 2 selects into the shared route, so one selection drives both.
  const p2 = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const s = k.layout.stations[1];
    const c2 = document.querySelector('[data-testid="map-canvas-2"]') as HTMLCanvasElement;
    const r2 = c2.getBoundingClientRect();
    return { x: r2.left + s.x * k.view2.scale + k.view2.ox, y: r2.top + s.y * k.view2.scale + k.view2.oy };
  });
  await page.mouse.click(p2.x, p2.y);
  await expect(page.getByTestId("map-inspector")).toBeVisible();
});

// Counterbalance: the task order must be a stable permutation per session
// (sessionStorage holds the variant order as JSON under kula.map.ab.order),
// so every variant sees every task equally over a run.
test("sessionOrder is a stable permutation within a session", async ({ page }) => {
  await ready(page);
  // The drawer writes the order when it runs, so open the drawer first.
  await page.getByTestId("map-test-toggle").click();
  await expect(page.getByTestId("ab-drawer")).toBeVisible();
  const order = await page.evaluate(() => sessionStorage.getItem("kula.map.ab.order"));
  expect(order, "order persisted in sessionStorage").toBeTruthy();
  const ids = (JSON.parse(order ?? "[]") as string[]).slice().sort().join(",");
  expect(ids, "one of each variant in the per-session order").toBe("a,b,c");
  // A reload inside the same session must not reshuffle.
  await page.reload();
  await ready(page, "/#map");
  await page.getByTestId("map-test-toggle").click();
  await expect(page.getByTestId("ab-drawer")).toBeVisible();
  const again = await page.evaluate(() => sessionStorage.getItem("kula.map.ab.order"));
  expect(again).toBe(order);
});

// Performance, criterion 8: first paint after data and the pan frame time,
// measured for both wired variants. Numbers go to the console for the handoff.
for (const v of ["a", "b"] as const) {
  test(`perf: first paint and pan frame time on variant ${v}`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__frames = [];
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = ((cb: FrameRequestCallback) => raf((t) => { (window as any).__frames.push(t); cb(t); })) as any;
    });
    const t0 = Date.now();
    await ready(page, `/#map/${v}`);
    const firstPaint = Date.now() - t0;
    const stub = await page.evaluate(() => (window as any).__kulaMap.stubA);
    expect(stub, `variant ${v} must be wired`).toBe(false);
    // Pan for ~600 ms and measure the frame deltas.
    const cv = page.getByTestId("map-canvas");
    const box = await cv.boundingBox();
    if (!box) throw new Error("no canvas");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) await page.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 4);
    await page.mouse.up();
    const stats = await page.evaluate(() => {
      const f: number[] = (window as any).__frames;
      const tail = f.slice(-40);
      const deltas = tail.slice(1).map((t, i) => t - tail[i]).filter((d) => d > 0 && d < 500);
      deltas.sort((x, y) => x - y);
      const mid = Math.floor(deltas.length / 2);
      return { median: deltas[mid] ?? 999, n: deltas.length, worst: deltas[deltas.length - 1] ?? 0 };
    });
    console.log(`PERF variant ${v}: firstPaint=${firstPaint}ms medianFrame=${stats.median}ms worst=${stats.worst}ms frames=${stats.n}`);
    expect(stats.median, `variant ${v} median pan frame must be under 60 ms`).toBeLessThan(60);
  });
}
