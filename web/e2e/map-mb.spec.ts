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

test("variant: draw renders pixels, hit and fit answer picks", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  await page.addScriptTag({ content: readFileSync(BUNDLE, "utf8") });
  const r = await page.evaluate(() => {
    const atlas = (window as any).__atlas;
    const model = (window as any).__kulaMap.model;
    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(1440 / ATLASW(), 900 / ATLASH());
    const view = { w: 1440, h: 900, scale, ox: (1440 - ATLASW() * scale) / 2, oy: (900 - ATLASH() * scale) / 2 };
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: {} };
    function ATLASW() { return 1600; }
    function ATLASH() { return 1000; }
    atlas.atlasVariant.draw(ctx, model, view, overlays, null);
    const data = ctx.getImageData(0, 0, 1440, 900).data;
    let inked = 0;
    for (let i = 0; i < data.length; i += 40) if (data[i + 3] > 0) inked++;
    // hit: a station dot answers station, open space answers its district.
    const st = atlas.getAtlasLayout(model).stations[0];
    const sx = st.x * view.scale + view.ox;
    const sy = st.y * view.scale + view.oy;
    const hitStation = atlas.atlasVariant.hit(sx, sy, view);
    const far = atlas.getAtlasLayout(model).districts[0];
    const hitDomain = atlas.atlasVariant.hit(far.x * view.scale + view.ox + 1, far.y * view.scale + view.oy + 1, view);
    return { inked, hitStation, hitDomain, stationCount: atlas.getAtlasLayout(model).stations.length };
  });
  expect(r.stationCount).toBeGreaterThan(0);
  expect(r.inked).toBeGreaterThan(1000);
  expect(r.hitStation?.kind).toBe("station");
  expect(r.hitDomain?.kind).toBe("domain");
});

test("screenshots: atlas, route, district zoom", async ({ page }) => {
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
    // 1 – whole world.
    out["map-mb-atlas"] = snap(null, base, null);
    // 2 – a selected flow with several steps, fitted to its route.
    const flows = (model.flows as any[]).slice().sort((a, b) => b.steps.length - a.steps.length);
    const flow = flows[0];
    out["map-mb-route"] = snap({ kind: "flow", id: flow.id }, base, null);
    // 3 – semantic zoom: fit the largest district.
    const lay = atlas.getAtlasLayout(model);
    const d = lay.districts[0];
    const scale = Math.min(W / (d.w * 1.15), H / (d.h * 1.15));
    const zoom = { w: W, h: H, scale, ox: W / 2 - (d.x + d.w / 2) * scale, oy: H / 2 - (d.y + d.h / 2) * scale };
    out["map-mb-district"] = snap(null, zoom, null);
    // 4 – overlays: fences, live heat, churn, owners on some stations.
    const ov = { fences: {}, live: {}, churn: {}, owners: {}, show: {} };
    lay.stations.slice(0, 12).forEach((s: any, i: number) => {
      if (i % 4 === 0) ov.fences[s.id] = "locked";
      if (i % 4 === 1) ov.fences[s.id] = "review";
      if (i % 4 === 2) ov.live[s.id] = 2.5;
      if (i % 4 === 3) ov.churn[s.id] = 7;
    });
    const first = Object.values(model.domains[0].files)[0] ?? "";
    ov.owners[lay.stations[0].id] = "dev-1";
    void first;
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
