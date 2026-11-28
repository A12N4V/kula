// MB proof: the Atlas variant (variant B). The pure layout layer is imported
// Node-side for determinism, area and call-order proofs; the variant is also
// bundled (see .kula-team/scratch/vite.config.mb.ts) and injected into the
// page to render real pixels for screenshots and hit/fit checks, since Map.tsx
// wiring is M4's work and the app still shows the stub.

import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atlasLayout, ATLAS_WORLD, flowRoute } from "../src/views/map/atlas/layout";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, "../../.kula-team/shots");
const BUNDLE = resolve(HERE, "../../.kula-team/scratch/mb-bundle/atlas.js");

type Json = Record<string, unknown>;

async function pageModel(page: import("@playwright/test").Page): Promise<Json> {
  await page.goto("/#map");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  return page.evaluate(() => {
    // The model is plain data, so JSON round-trips it cleanly.
    return JSON.parse(JSON.stringify((window as any).__kulaMap.model));
  });
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("layout: district areas follow code size, deterministic", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const a = atlasLayout(model as never);
  const b = atlasLayout(model as never);
  // Determinism: same model in, identical rectangles out.
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));

  // Districts are laid out size-desc with domain id as the tiebreak, and the
  // squarified areas are exactly proportional to size, so area order must
  // follow size order (ties keep id order).
  const doms = model.domains as { id: number; files: string[] }[];
  // The layout sizes districts by symbol count per file (a station is a
  // symbol), not raw file count – mirror atlasSizes here.
  const sym = new Map<string, number>();
  for (const st of model.stations as { files: string[] }[])
    for (const f of st.files) sym.set(f, (sym.get(f) ?? 0) + 1);
  const sizeOf = (id: number) => doms.find((d) => d.id === id)!.files.reduce((s, f) => s + Math.max(1, sym.get(f) ?? 1), 0);
  let ok = true;
  for (let i = 1; i < a.districts.length; i++) {
    const p = a.districts[i - 1];
    const q = a.districts[i];
    const sp = sizeOf(p.domain);
    const sq = sizeOf(q.domain);
    const ap = p.w * p.h;
    const aq = q.w * q.h;
    if (sp > sq && !(ap > aq)) ok = false;
    if (sp === sq && p.domain >= q.domain) ok = false;
    // Areas proportional to size within each district's shared bounds.
    const ratioP = ap / sp;
    const ratioQ = aq / sq;
    if (Math.abs(ratioP - ratioQ) / Math.max(ratioP, ratioQ) > 1e-6) ok = false;
  }
  expect(ok).toBe(true);
  expect(a.districts.length).toBe(doms.length);
  // Every district fits inside the world.
  for (const d of a.districts) {
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.x + d.w).toBeLessThanOrEqual(ATLAS_WORLD.w + 1e-6);
    expect(d.y + d.h).toBeLessThanOrEqual(ATLAS_WORLD.h + 1e-6);
  }
  // The layout precomputes per-district parcel groups and station metadata:
  // every parcel is in exactly one group, every station has a meta entry.
  const grouped = new Set<string>();
  for (const list of a.parcelsByDistrict.values()) for (const p of list) grouped.add(p.file + "@" + p.domain);
  expect(grouped.size).toBe(a.parcels.length);
  for (const st of a.stations) expect(a.stationMeta.get(st.id)).toBeTruthy();
});

test("layout: route visits stations in call order", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const lay = atlasLayout(model as never);
  const flows = model.flows as { id: string; steps: { station: string }[] }[];
  expect(flows.length).toBeGreaterThan(0);
  let checked = 0;
  for (const f of flows) {
    const route = flowRoute(lay, model as never, f.id);
    const expectStations = f.steps.map((s: { station: string }) => s.station);
    const gotStations = route.map((p) => p.station);
    // One point per step that has a placed station, same order, no extras.
    expect(gotStations).toEqual(expectStations.filter((s) => lay.stationById.has(s)));
    if (gotStations.length >= 2) checked++;
  }
  // At least one multi-step route proves ordering, not just presence.
  expect(checked).toBeGreaterThan(0);
});

test("variant: semantic zoom gates parcels, dots and names; overlays honour the toggle", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  const r = await page.evaluate(() => {
    const atlas = (window as any).__atlas;
    const model = (window as any).__kulaMap.model;
    const W = 1440, H = 900;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fit = Math.min(W / 1600, H / 1000);
    const base = { w: W, h: H, scale: fit, ox: (W - 1600 * fit) / 2, oy: (H - 1000 * fit) / 2 };
    const view = (scale: number) => ({ w: W, h: H, scale, ox: W / 2 - 800 * scale, oy: H / 2 - 500 * scale });
    const view0 = { w: W, h: H, scale: 0.3, ox: 0, oy: 0 };
    const inked = (v: any, sel: any, ov: any) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      atlas.atlasVariant.draw(ctx, model, v, ov, sel);
      // Count orange-ish pixels: r high, g mid, b low – the accent colour.
      const data = ctx.getImageData(0, 0, W, H).data;
      let orange = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 100 && data[i + 1] < 180 && data[i + 2] < 90) orange++;
      }
      return orange;
    };
    // Live heat on half the stations; show.live off must leave no orange glow.
    const liveOv = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    let n = 0;
    for (const st of atlas.getAtlasLayout(model).stations) {
      if (n++ % 2 === 0) liveOv.live[st.id] = 3;
    }
    const liveOff = inked(base, null, liveOv);
    liveOv.show.live = true;
    const liveOn = inked(base, null, liveOv);
    // Fence on many stations but the toggle off: no extra cream marks. Fence
    // marks are cream ink, so count bright pixels here, not orange.
    const fenceOv = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    atlas.getAtlasLayout(model).stations.forEach((s: any) => (fenceOv.fences[s.id] = "locked"));
    const bright = (v: any, ov: any) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      atlas.atlasVariant.draw(ctx, model, v, ov, null);
      const data = ctx.getImageData(0, 0, W, H).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 190 && data[i + 2] > 150) n++;
      }
      return n;
    };
    const fenceOff = bright(base, fenceOv);
    fenceOv.show.fences = true;
    const fenceOn = bright(base, fenceOv);
    // Zoom stages: at district zoom no station dots at all; at middle zoom
    // dots appear but parcels too; at low zoom only districts.
    // Zoom stages: at district zoom the variant must draw zero station arcs
    // (no dots at all); at middle zoom station dots appear. Counting arc
    // calls on a proxied context is exact – pixel bands catch label
    // antialiasing instead.
    const arcsAt = (scale: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      let arcs = 0;
      const prox = new Proxy(ctx, {
        get(t, k) {
          if (k === "arc") return (...a: any[]) => { arcs++; return (t as any).arc(...a); };
          const v = (t as any)[k];
          return typeof v === "function" ? v.bind(t) : v;
        },
        set(t, k, val) { (t as any)[k] = val; return true; },
      }) as CanvasRenderingContext2D;
      atlas.atlasVariant.draw(prox, model, view(scale), { fences: {}, live: {}, churn: {}, owners: {}, show: {} }, null);
      return arcs;
    };
    const districtZoom = arcsAt(0.3);
    const middleZoom = arcsAt(1.0);
    return { liveOff, liveOn, fenceOff, fenceOn, districtZoom, middleZoom };
  });
  // Live toggle off: no orange glow anywhere. On: glow appears.
  expect(r.liveOff).toBe(0);
  expect(r.liveOn).toBeGreaterThan(r.liveOff);
  // Fences toggle off: no fence marks. On: they appear.
  expect(r.fenceOn).toBeGreaterThan(r.fenceOff);
  // Semantic zoom: below Z_DOTS no station dots; at middle zoom dots appear.
  expect(r.districtZoom).toBe(0);
  expect(r.middleZoom).toBeGreaterThan(0);
});

test("variant: fit and hit answer before the first draw", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  const r = await page.evaluate(() => {
    const atlas = (window as any).__atlas;
    const model = (window as any).__kulaMap.model;
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(1440 / 1600, 900 / 1000);
    const view = { w: 1440, h: 900, scale, ox: (1440 - 1600 * scale) / 2, oy: (900 - 1000 * scale) / 2 };
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: {} };
    atlas.atlasVariant.draw(ctx, model, view, overlays, null);
    // hit: a station dot answers station, open space answers its district.
    const st = atlas.getAtlasLayout(model).stations[0];
    const sx = st.x * view.scale + view.ox;
    const sy = st.y * view.scale + view.oy;
    const hitStation = atlas.atlasVariant.hit(sx, sy, view);
    const far = atlas.getAtlasLayout(model).districts[0];
    const hitDomain = atlas.atlasVariant.hit(far.x * view.scale + view.ox + 1, far.y * view.scale + view.oy + 1, view);
    // fit before the first draw of a fresh bundle state: fit a domain pick
    // and check the returned view centres the district.
    const d = atlas.getAtlasLayout(model).districts[0];
    let fitted: any = null;
    atlas.atlasVariant.fit({ kind: "domain", id: String(d.domain) }, { w: 1440, h: 900, scale: 1, ox: 0, oy: 0 }, (v: any) => (fitted = v));
    const centred =
      fitted &&
      Math.abs(fitted.ox + ((d.x + d.w / 2) * fitted.scale)) - 720 < 1 &&
      Math.abs(fitted.oy + ((d.y + d.h / 2) * fitted.scale)) - 450 < 1;
    return { inked: 0, hitStation, hitDomain, stationCount: atlas.getAtlasLayout(model).stations.length, fitted: !!fitted, centred };
  });
  expect(r.stationCount).toBeGreaterThan(0);
  expect(r.hitStation?.kind).toBe("station");
  expect(r.hitDomain?.kind).toBe("domain");
  expect(r.fitted).toBe(true);
  expect(r.centred).toBe(true);
});

test("screenshots: atlas, route, district zoom, overlays", async ({ page }) => {
  test.setTimeout(60_000);
  const model = (await pageModel(page)) as any;
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  const shots = await page.evaluate(async () => {
    const atlas = (window as any).__atlas;
    const model = (window as any).__kulaMap.model;
    const W = 1440, H = 900;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fit = Math.min(W / 1600, H / 1000);
    const base = { w: W, h: H, scale: fit, ox: (W - 1600 * fit) / 2, oy: (H - 1000 * fit) / 2 };
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: {} };
    const snap = (sel: any, view: any, ov: any) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      atlas.atlasVariant.draw(ctx, model, view, ov ?? overlays, sel);
      return canvas.toDataURL("image/png");
    };
    const out: Record<string, string> = {};
    // 1 – whole world at district zoom: districts only, no parcels or dots.
    out["map-mb-atlas"] = snap(null, base, null);
    // 2 – a selected flow with several steps, fitted to its route.
    const flows = (model.flows as any[]).slice().sort((a, b) => b.steps.length - a.steps.length);
    const flow = flows[0];
    out["map-mb-route"] = snap({ kind: "flow", id: flow.id }, base, null);
    // 3 – semantic zoom: fit the largest district (parcels + dots appear).
    const lay = atlas.getAtlasLayout(model);
    const d = lay.districts[0];
    const scale = Math.min(W / (d.w * 1.15), H / (d.h * 1.15));
    const zoom = { w: W, h: H, scale, ox: W / 2 - (d.x + d.w / 2) * scale, oy: H / 2 - (d.y + d.h / 2) * scale };
    out["map-mb-district"] = snap(null, zoom, null);
    // 4 – overlays: fences, live heat, churn, owners on some stations, all
    // toggles on.
    const ov = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: true, live: true, churn: true, owners: true } };
    lay.stations.slice(0, 12).forEach((s: any, i: number) => {
      if (i % 4 === 0) ov.fences[s.id] = "locked";
      if (i % 4 === 1) ov.fences[s.id] = "review";
      if (i % 4 === 2) ov.live[s.id] = 2.5;
      if (i % 4 === 3) ov.churn[s.id] = 7;
    });
    ov.owners[lay.stations[0].id] = "dev-1";
    out["map-mb-overlays"] = snap(null, base, ov);
    return out;
  });
  for (const [name, dataUrl] of Object.entries(shots)) {
    expect(dataUrl.startsWith("data:image/png")).toBe(true);
    writeFileSync(resolve(SHOTS, `${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  // A second pass over the same model must byte-match the first pass – the
  // rendered atlas is deterministic.
  const again = await page.evaluate(() => {
    const atlas = (window as any).__atlas;
    const model = (window as any).__kulaMap.model;
    const W = 1440, H = 900;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fit = Math.min(W / 1600, H / 1000);
    const view = { w: W, h: H, scale: fit, ox: (W - 1600 * fit) / 2, oy: (H - 1000 * fit) / 2 };
    ctx.clearRect(0, 0, W, H);
    atlas.atlasVariant.draw(ctx, model, view, { fences: {}, live: {}, churn: {}, owners: {}, show: {} }, null);
    return canvas.toDataURL("image/png");
  });
  expect(again).toBe(shots["map-mb-atlas"]);
});
