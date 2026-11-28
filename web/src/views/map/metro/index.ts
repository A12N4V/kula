// Variant A · Metro. A transit map of the program: each flow a coloured
// octilinear line through its stations, shared stations interchange rings,
// domains soft-tinted districts behind the lines.
//
// Semantic zoom (detail changes, the map never does):
//   scale < 0.45  – districts only, sized with flow counts
//   0.45 – 1.1    – lines and interchanges, flow labels
//   > 1.1         – station names, branch and loop marks, layer dots
// Layout comes from layout.ts, cached per model; draw only reads it.

import type { Variant, MapPick, VariantView, DrawOverlays } from "../Map";
import type { MapModel } from "../model";
import { hashSeed, roundRect, withAlpha } from "../layout-common";
import { metroLayout, type MetroLayout } from "./layout";

// Canvas twin of the map palette: canvas 2D cannot read var() colours, so the
// hues are hardcoded here. Keep in sync by hand with layout-common.ts
// (FLOW_COLORS :8, LAYER_COLORS :15) and tokens.css :64-69, where the light
// mode overrides live – a palette change there must be mirrored here.
const FLOW_HEX = ["#ff6a14", "#00d2dc", "#1fd66a", "#ffc414", "#a45bff", "#2e8bff", "#ff3d8e", "#ff463a"];
// LAYER_HEX shares its hues with FLOW_HEX on purpose: one palette, two roles.
const LAYER_HEX: Record<string, string> = {
  entry: "#ff6a14", handler: "#00d2dc", logic: "#1fd66a", data: "#ffc414", io: "#2e8bff", test: "#a45bff",
};
const FONT_UI = "13px 'Jost Variable', sans-serif";
const FONT_MONO = "11px 'JetBrains Mono Variable', monospace";

const Z_DISTRICT = 0.45; // below: districts only
const Z_DETAIL = 1.1; // above: station names and marks

const layoutCache = new WeakMap<MapModel, MetroLayout>();
function layoutFor(model: MapModel): MetroLayout {
  let l = layoutCache.get(model);
  if (!l) {
    l = metroLayout(model, { w: 1600, h: 1000 });
    layoutCache.set(model, l);
  }
  return l;
}

/** Polyline hit: squared distance from p to every leg. */
function distToPoly(p: { x: number; y: number }, poly: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Label collision avoidance: candidates sorted by degree desc then id, drawn
 * top-left to bottom-right; a label that would overlap an already placed one
 * is dropped, so the busiest stations always keep their names.
 */
function placeLabels(cands: { id: string; x: number; y: number; degree: number; text: string }[]): Set<string> {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const keep = new Set<string>();
  for (const c of [...cands].sort((a, b) => b.degree - a.degree || Number(a.id.slice(1)) - Number(b.id.slice(1)))) {
    const w = c.text.length * 6.2 + 12;
    const box = { x0: c.x + 8, y0: c.y - 8, x1: c.x + 8 + w, y1: c.y + 6 };
    if (placed.some((r) => !(box.x1 < r.x0 || box.x0 > r.x1 || box.y1 < r.y0 || box.y0 > r.y1))) continue;
    placed.push(box);
    keep.add(c.id);
  }
  return keep;
}

function drawMetro(ctx: CanvasRenderingContext2D, model: MapModel, view: VariantView, overlays: DrawOverlays, sel: MapPick | null) {
  const lay = layoutFor(model);
  const px = view.scale * (devicePixelRatio || 1);
  const text = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#f0ebe3";
  const line2 = getComputedStyle(document.documentElement).getPropertyValue("--line-2").trim() || "#332d28";
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#050505";
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--map-orange").trim() || "#ff6a14";
  ctx.save();
  ctx.setTransform(px, 0, 0, px, view.ox * (devicePixelRatio || 1), view.oy * (devicePixelRatio || 1));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, lay.world.w, lay.world.h);

  // visible world rect, for culling
  const vx0 = -view.ox / view.scale, vy0 = -view.oy / view.scale;
  const vx1 = vx0 + view.w / view.scale, vy1 = vy0 + view.h / view.scale;
  const vis = (x: number, y: number, m = 60) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  // districts: soft tints, one hue per domain, stable by hash of the label
  const tintOf = (id: number) => {
    const idx = model.domains.findIndex((d) => d.id === id);
    return FLOW_HEX[((hashSeed(String(id)) + idx) % FLOW_HEX.length + FLOW_HEX.length) % FLOW_HEX.length];
  };
  for (const d of lay.domains) {
    if (d.x > vx1 || d.x + d.w < vx0 || d.y > vy1 || d.y + d.h < vy0) continue;
    ctx.fillStyle = withAlpha(tintOf(d.id), 0.08);
    roundRect(ctx, d.x, d.y, d.w, d.h, 8);
    ctx.fill();
    ctx.strokeStyle = line2;
    ctx.lineWidth = 1;
    roundRect(ctx, d.x, d.y, d.w, d.h, 8);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.font = FONT_UI;
    ctx.fillText(`${d.label} · ${d.flows}`, d.x + 10, d.y + 18);
  }

  const flowIdx = new Map(model.flows.map((f, i) => [f.id, i] as [string, number]));
  if (view.scale >= Z_DISTRICT) {
    // lines
    for (const f of lay.flows) {
      if (f.poly.length < 2) continue;
      if (!f.poly.some((p) => vis(p.x, p.y, 120))) continue;
      const selected = sel?.kind === "flow" && sel.id === f.id;
      ctx.strokeStyle = selected ? accent : withAlpha(FLOW_HEX[(flowIdx.get(f.id) ?? 0) % FLOW_HEX.length], 0.85);
      ctx.lineWidth = selected ? 5 : 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(f.poly[0].x, f.poly[0].y);
      for (const p of f.poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // flow label at mid zoom, at the line's first interchange or start
      if (view.scale >= Z_DISTRICT && view.scale < Z_DETAIL) {
        const st = model.flows.find((x) => x.id === f.id);
        if (st && vis(f.poly[0].x, f.poly[0].y)) {
          ctx.fillStyle = text;
          ctx.font = FONT_UI;
          ctx.fillText(st.label, f.poly[0].x + 8, f.poly[0].y - 6);
        }
      }
    }
  }

  // stations
  const labels = view.scale >= Z_DETAIL
    ? placeLabels(lay.stations.filter((s) => vis(s.x, s.y)).map((s) => ({ id: s.id, x: s.x, y: s.y, degree: s.degree, text: s.name })))
    : new Set<string>();
  for (const s of lay.stations) {
    if (!vis(s.x, s.y)) continue;
    const interchange = s.degree >= 2;
    if (view.scale < Z_DISTRICT && !interchange) continue;
    const r = interchange ? 6 + Math.min(4, s.degree - 1) : 4;
    if (interchange) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = text;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      const st = model.stations.find((x) => x.id === s.id);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = st ? (LAYER_HEX[st.layer] ?? "#1fd66a") : "#1fd66a";
      ctx.fill();
      ctx.strokeStyle = bg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // overlays: fence ring, live halo, churn tick, owner dot
    if (overlays.show.fences && overlays.fences[s.id]) {
      ctx.strokeStyle = "#ffc414";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (overlays.show.live && overlays.live[s.id]) {
      ctx.strokeStyle = withAlpha("#ff6a14", Math.min(1, 0.25 + overlays.live[s.id]));
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (overlays.show.churn && overlays.churn[s.id]) {
      ctx.fillStyle = "#ff463a";
      ctx.fillRect(s.x - 2, s.y - r - 10, 4, 4);
    }
    if (overlays.show.owners && overlays.owners[s.id]) {
      ctx.fillStyle = "#2e8bff";
      ctx.beginPath();
      ctx.arc(s.x + r + 7, s.y - r - 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sel?.kind === "station" && sel.id === s.id) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // branch and loop marks at detail zoom
    if (view.scale >= Z_DETAIL && s.branch) {
      ctx.fillStyle = text;
      ctx.font = FONT_MONO;
      ctx.fillText(s.branch === "loop" ? "⟲" : "⑂", s.x - r - 12, s.y + 4);
    }
    if (labels.has(s.id)) {
      ctx.fillStyle = text;
      ctx.font = FONT_MONO;
      ctx.fillText(s.name, s.x + r + 8, s.y + 4);
    }
  }
  ctx.restore();
}

function hitMetro(x: number, y: number, view: VariantView, model: MapModel | null): MapPick | null {
  if (!model) return null;
  const lay = layoutFor(model);
  const wx = (x - view.ox) / view.scale;
  const wy = (y - view.oy) / view.scale;
  let best: { d: number; pick: MapPick } | null = null;
  for (const s of lay.stations) {
    const d = Math.hypot(s.x - wx, s.y - wy);
    if (d < 12 && (!best || d < best.d)) best = { d, pick: { kind: "station", id: s.id } };
  }
  if (best) return best.pick;
  for (const f of lay.flows) {
    if (f.poly.length < 2) continue;
    if (distToPoly({ x: wx, y: wy }, f.poly) < 6) return { kind: "flow", id: f.id };
  }
  for (const d of lay.domains) {
    if (wx >= d.x && wx <= d.x + d.w && wy >= d.y && wy <= d.y + d.h) return { kind: "domain", id: String(d.id) };
  }
  return null;
}

function fitMetro(pick: MapPick, view: VariantView, set: (v: VariantView) => void, model: MapModel | null) {
  if (!model) return;
  const lay = layoutFor(model);
  if (pick.kind === "domain") {
    const d = lay.domains.find((x) => String(x.id) === pick.id);
    if (!d) return;
    const s = Math.min(view.w / (d.w + 80), view.h / (d.h + 80));
    set({ w: view.w, h: view.h, scale: s, ox: view.w / 2 - (d.x + d.w / 2) * s, oy: view.h / 2 - (d.y + d.h / 2) * s });
    return;
  }
  if (pick.kind === "flow") {
    const f = lay.flows.find((x) => x.id === pick.id);
    if (!f || f.poly.length < 2) return;
    const xs = f.poly.map((p) => p.x), ys = f.poly.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const s = Math.max(0.2, Math.min(2.5, Math.min(view.w / (x1 - x0 + 120), view.h / (y1 - y0 + 120))));
    set({ w: view.w, h: view.h, scale: s, ox: view.w / 2 - cx * s, oy: view.h / 2 - cy * s });
    return;
  }
  const st = lay.stations.find((x) => x.id === pick.id);
  if (!st) return;
  const s = 2.2;
  set({ w: view.w, h: view.h, scale: s, ox: view.w / 2 - st.x * s, oy: view.h / 2 - st.y * s });
}

/** Pure view fit for tests: the view fitMetro would set for pick, or null. */
function fitView(pick: MapPick, model: MapModel | null, view: VariantView): VariantView | null {
  let out: VariantView | null = null;
  fitMetro(pick, view, (v) => { out = v; }, model);
  return out;
}

export const metroVariant: Variant = {
  id: "a",
  draw: drawMetro,
  hit(x, y, view) { return hitMetro(x, y, view, null); },
  fit(pick, view, set) { fitMetro(pick, view, set, null); },
};

/**
 * The variant needs the model for hit and fit, which the Variant interface
 * does not pass. Map.tsx wires it once: metroVariantFor(model) returns a
 * variant bound to that model. metroVariant above stays for the interface's
 * sake and returns null picks without a model.
 */
export function metroVariantFor(model: MapModel): Variant {
  return {
    id: "a",
    draw: drawMetro,
    hit: (x, y, view) => hitMetro(x, y, view, model),
    fit: (pick, view, set) => fitMetro(pick, view, set, model),
  };
}

// Test and probe hook: pure functions only, assigned once at module load.
// The spec draws and hit-tests in the page through these; nothing here is
// written per frame (critic: prod code must not carry a per-frame global).
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__kulaMetro = {
    build: metroLayout,
    draw: drawMetro,
    hit: hitMetro,
    fitView,
    labels: placeLabels,
  };
}

export { layoutFor, placeLabels };
