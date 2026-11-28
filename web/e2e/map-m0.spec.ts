// M0 proof: two variants only (Atlas · Metro), old URLs redirect, the header
// is one row at 1440 and 1024, the canvas fills down to the status bar,
// domains are recomputed with plain-word labels and no domain holds more than
// 35% of flows, containment attaches `from_json` to `McpDef`, compare splits
// Atlas | Metro, resize redraws without a reload, and the drawer
// counterbalances the variants.

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

test("atlas and metro both render, not the stub", async ({ page }) => {
  await ready(page, "/#map/atlas");
  let r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    return { stub: k.stubA, variant: k.variant, stations: k.layout.stations.length, hook: !!k.hooks?.atlas };
  });
  expect(r.stub, "atlas must not be the stub").toBe(false);
  expect(r.variant).toBe("atlas");
  expect(r.stations).toBeGreaterThan(0);
  expect(r.hook, "__kulaMap.hooks.atlas must be published").toBe(true);

  await ready(page, "/#map/metro");
  r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    return { stub: k.stubA, variant: k.variant, stations: k.layout.stations.length, hook: !!k.hooks?.metro };
  });
  expect(r.stub, "metro must not be the stub").toBe(false);
  expect(r.variant).toBe("metro");
  expect(r.stations).toBeGreaterThan(0);
  expect(r.hook, "__kulaMap.hooks.metro must be published").toBe(true);
});

test("legacy URLs redirect: a and c to atlas, b to metro", async ({ page }) => {
  for (const [from, to] of [["a", "atlas"], ["b", "metro"], ["c", "atlas"]] as const) {
    await ready(page, `/#map/${from}`);
    expect(new URL(page.url()).hash, `#map/${from} must redirect`).toBe(`#map/${to}`);
  }
});

test("the variant toggle switches variant and URL, Atlas first", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const labels = await page.locator(".map-seg-btn").allTextContents();
  expect(labels.map((s) => s.trim())).toEqual(["Atlas", "Metro"]);
  await page.getByTestId("variant-metro").click();
  await page.waitForFunction(() => (window as any).__kulaMap?.variant === "metro");
  expect(new URL(page.url()).hash).toBe("#map/metro");
});

test("a bare #map shows the remembered variant", async ({ page }) => {
  await ready(page, "/#map/metro"); // leaves the remember flag on metro
  await ready(page, "/#map");
  const variant = await page.evaluate(() => (window as any).__kulaMap.variant);
  expect(variant).toBe("metro");
  expect(new URL(page.url()).hash).toBe("#map/metro");
});

test("the header is one row at 1440 and at 1024", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const oneRow = () =>
    page.evaluate(() => {
      const kids = [...document.querySelectorAll(".map-header > *")].map((e) => e.getBoundingClientRect().top);
      return Math.max(...kids) - Math.min(...kids);
    });
  expect(await oneRow(), "one row at 1440").toBeLessThanOrEqual(8);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);
  expect(await oneRow(), "one row at 1024").toBeLessThanOrEqual(8);
  // Below 1200 the overlay toggles collapse into one Overlays menu.
  expect(await page.getByTestId("overlays-menu").count()).toBe(1);
  expect(await page.getByTestId("overlay-fences").isVisible()).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  expect(await page.locator(".map-overlays").first().isVisible()).toBe(true);
});

test("the canvas fills down to the shell body bottom", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const gap = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="map-canvas"]')!.getBoundingClientRect();
    const s = document.querySelector(".k-body")!.getBoundingClientRect();
    return Math.round(s.bottom - c.bottom);
  });
  expect(gap, "canvas bottom must equal the shell body bottom").toBe(0);
});

test("resize redraws without a reload", async ({ page }) => {
  await ready(page, "/#map/atlas");
  await page.evaluate(() => ((window as any).__m0NoReload = true));
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForFunction(() => {
    const k = (window as any).__kulaMap;
    const c = document.querySelector('[data-testid="map-canvas"]');
    // The app shell caps the map column, so assert tracking, not a width.
    return !!(window as any).__m0NoReload && k?.view?.w === c?.clientWidth && c && c.clientWidth < 1140;
  });
  expect(await page.evaluate(() => (window as any).__m0NoReload)).toBe(true);
});

test("no domain holds more than 35% of flows; labels are plain words", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const r = await page.evaluate(() => {
    const m = (window as any).__kulaMap.model;
    const worst = Math.max(...m.domains.map((d: any) => d.flows.length)) / m.flows.length;
    return { worst, n: m.domains.length, labels: m.domains.map((d: any) => d.label) };
  });
  expect(r.worst, `largest domain share must be under 35% (got ${(r.worst * 100).toFixed(0)}%)`).toBeLessThan(0.35);
  expect(r.n).toBeGreaterThan(1);
  expect(r.labels.some((l: string) => /^(Guard|Index)$/.test(l)), "plain-word labels expected").toBe(true);
});

test("containment attaches from_json to McpDef", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const r = await page.evaluate(() => {
    const m = (window as any).__kulaMap.model;
    const k = m.containers.find((c: any) => c.name === "McpDef");
    return {
      kind: k?.kind, members: k?.members?.length ?? 0,
      fromJson: k?.members?.some((x: any) => /from_json/i.test(x.name)) ?? false,
      station: m.stations.find((s: any) => s.container === k?.id)?.id,
    };
  });
  expect(r.kind, "McpDef must be a container").toBe("class");
  expect(r.members).toBeGreaterThan(0);
  expect(r.fromJson, "from_json must be a member of McpDef").toBe(true);
  expect(r.station, "a station must point at the McpDef container").toBeTruthy();
});

test("compare splits Atlas | Metro with both panes drawn", async ({ page }) => {
  await ready(page, "/#map/atlas");
  await page.getByTestId("map-compare").click();
  await page.waitForFunction(() => {
    const k = (window as any).__kulaMap;
    return k?.varB && k?.varB !== k?.varA && k?.view2?.w > 0;
  });
  const r = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    return { a: k.varA.id, b: k.varB.id, ids: [k.variant, k.other], canvas2: !!document.querySelector('[data-testid="map-canvas-2"]') };
  });
  expect(r.a === "b" || r.b === "a", "the two panes must be atlas and metro").toBe(true);
  expect(r.ids).toContain("atlas");
  expect(r.ids).toContain("metro");
  expect(r.canvas2, "compare must mount a second canvas").toBe(true);
});

test("the drawer counterbalances the two variants", async ({ page }) => {
  await ready(page, "/#map/atlas");
  const order = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const o1 = k.sessionOrder();
    const o2 = k.sessionOrder(); // stable within one session
    return { o1, o2, parity: localStorage.getItem("kula.map.ab.sessions") };
  });
  expect(order.o1.length).toBe(2);
  expect(order.o1).toContain("atlas");
  expect(order.o1).toContain("metro");
  expect(order.o2).toEqual(order.o1);
  expect(order.parity, "a durable session counter must exist").toBeTruthy();
});
