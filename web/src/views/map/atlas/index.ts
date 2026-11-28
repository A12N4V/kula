import type { Variant, VariantView, DrawOverlays, MapPick } from "../Map";
import type { MapModel } from "../model";
import { withAlpha, roundRect } from "../layout-common";
import { pickCode } from "../ab";
import {
  ATLAS_WORLD,
  getAtlasLayout,
  type AtlasLayout,
  type AtlasStation,
  ownerColor,
  flowRoute,
} from "./layout";

// –– Atlas (variant B): a treemap of code. Districts are domains, parcels are
// –– files, stations are dots pinned to their file's parcel. A selected flow
// –– is one bold route through parcels in call order.

const INK = "#efe6d5";
const DIM = "rgba(239, 230, 213, 0.55)";
const ACCENT = "#ff8a3d";
const BLACK = "#0a0a0a";

// Layout captured by the last draw – hit and fit see the same view state the
// user sees, and never rebuild the treemap themselves.
let lastLayout: AtlasLayout | null = null;
let lastModel: MapModel | null = null;

function drawStations(
  ctx: CanvasRenderingContext2D,
  stations: AtlasStation[],
  view: VariantView,
  overlays: DrawOverlays,
  selectedStation: string | null,
) {
  const r = Math.max(1.6, 3 / view.scale);
  for (const st of stations) {
    const sel = st.id === selectedStation;
    const live = !!overlays.live[st.id];
    // Base dot – cream, orange only when selected or live.
    ctx.fillStyle = sel || live ? ACCENT : DIM;
    ctx.beginPath();
    ctx.arc(st.x, st.y, sel ? r * 1.7 : r, 0, Math.PI * 2);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1 / view.scale;
      ctx.beginPath();
      ctx.arc(st.x, st.y, r * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (live) {
      ctx.strokeStyle = withAlpha(ACCENT, 0.7);
      ctx.lineWidth = 1 / view.scale;
      ctx.beginPath();
      ctx.arc(st.x, st.y, r * 2.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Fence mark – locked files are square, review files are dashed rings.
    const fence = overlays.fences[st.id];
    if (fence === "locked") {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1 / view.scale;
      const s = r * 2.2;
      ctx.strokeRect(st.x - s, st.y - s, s * 2, s * 2);
    } else if (fence === "review") {
      ctx.strokeStyle = withAlpha(INK, 0.8);
      ctx.setLineDash([2 / view.scale, 2 / view.scale]);
      ctx.beginPath();
      ctx.arc(st.x, st.y, r * 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Churn tick – a short spoke above the dot.
    if (overlays.churn[st.id]) {
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1.2 / view.scale;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y - r * 2);
      ctx.lineTo(st.x, st.y - r * 4);
      ctx.stroke();
    }
    // Owner chip – one muted colour dot per owned station.
    const owner = overlays.owners[st.id];
    if (owner) {
      ctx.fillStyle = ownerColor(owner);
      ctx.beginPath();
      ctx.arc(st.x + r * 2.6, st.y - r * 1.6, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, lay: AtlasLayout, model: MapModel, view: VariantView) {
  // District labels live in screen space so they stay readable at any zoom.
  const placed: { x: number; y: number; w: number }[] = [];
  ctx.textBaseline = "top";
  ctx.font = "600 11px ui-monospace, monospace";
  const domainLabel = (id: number) => model.domains.find((d) => d.id === id)?.label ?? `D${id}`;
  for (const d of lay.districts) {
    const sx = d.x * view.scale + view.ox;
    const sy = d.y * view.scale + view.oy;
    const sw = d.w * view.scale;
    if (sw < 40 || d.h * view.scale < 26 || sx > view.w || sy > view.h) continue;
    const dom = model.domains.find((x) => x.id === d.domain);
    const label = `${domainLabel(d.domain)} · ${dom?.flows.length ?? 0} flows`;
    const w = Math.min(ctx.measureText(label).width + 8, sw - 8);
    // Simple collision skip – keep labels from stacking on small districts.
    if (placed.some((p) => Math.abs(p.y - sy) < 14 && !(sx > p.x + p.w || sx + w < p.x))) continue;
    placed.push({ x: sx, y: sy, w });
    ctx.fillStyle = withAlpha(BLACK, 0.55);
    roundRect(ctx, sx + 3, sy + 3, w, 15, 4);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, sx + 3, sy + 3, w, 15, 4);
    ctx.clip();
    ctx.fillText(label, sx + 7, sy + 6);
    ctx.restore();
  }
  // Interchange names only when zoomed in enough to read them.
  if (view.scale < 1.4) return;
  ctx.font = "10px ui-monospace, monospace";
  for (const st of lay.stations) {
    const sx = st.x * view.scale + view.ox;
    const sy = st.y * view.scale + view.oy;
    if (sx < 0 || sy < 0 || sx > view.w || sy > view.h) continue;
    const ms = model.stations.find((s) => s.id === st.id);
    if (!ms || ms.degree < 2) continue;
    ctx.fillStyle = withAlpha(INK, 0.75);
    ctx.fillText(ms.name, sx + 5, sy + 3);
  }
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
) {
  if (pts.length < 2) return;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    // Right-angle rail segments through the parcel grid.
    const px = pts[i - 1];
    const p = pts[i];
    const midX = (px.x + p.x) / 2;
    ctx.lineTo(midX, px.y);
    ctx.lineTo(midX, p.y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // Waypoint dots so call order reads at a glance.
  ctx.fillStyle = ACCENT;
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hitStation(lay: AtlasLayout, wx: number, wy: number) {
  const r = 8;
  let best: AtlasStation | null = null;
  let bestD = r * r;
  for (const st of lay.stations) {
    const dx = st.x - wx;
    const dy = st.y - wy;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

function pointIn(x: number, y: number, r: { x: number; y: number; w: number; h: number }) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export const atlasVariant: Variant = {
  id: "b",

  draw(ctx, model, view, overlays, sel) {
    const lay = getAtlasLayout(model);
    lastLayout = lay;
    lastModel = model;

    // Districts and parcels: absolute black base, muted parcel fills, one
    // subtle gap between regions. Nothing glows.
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, ATLAS_WORLD.w, ATLAS_WORLD.h);
    for (const d of lay.districts) {
      ctx.fillStyle = withAlpha(ownerColor(String(d.domain)), 0.1);
      ctx.fillRect(d.x, d.y, d.w, d.h);
      for (const p of lay.parcels) {
        if (p.domain !== d.domain) continue;
        const isSel =
          (sel?.kind === "domain" && sel.id === String(d.domain)) ||
          (sel?.kind === "station" && lay.stationById.get(sel.id)?.file === p.file);
        ctx.fillStyle = isSel ? withAlpha(ACCENT, 0.25) : withAlpha(INK, 0.06);
        roundRect(ctx, p.x, p.y, p.w, p.h, 6);
        ctx.fill();
        // File size shows as area already; a hairline edge keeps it legible.
        ctx.strokeStyle = withAlpha(INK, 0.12);
        ctx.lineWidth = 0.5;
        roundRect(ctx, p.x, p.y, p.w, p.h, 6);
        ctx.stroke();
      }
      ctx.strokeStyle = withAlpha(INK, 0.25);
      ctx.lineWidth = 1;
      roundRect(ctx, d.x, d.y, d.w, d.h, 8);
      ctx.stroke();
    }

    // Cull to the visible world region before drawing thousands of dots.
    const vx = -view.ox / view.scale;
    const vy = -view.oy / view.scale;
    const vw = view.w / view.scale;
    const vh = view.h / view.scale;
    const vis = lay.stations.filter(
      (st) => st.x >= vx - 20 && st.x <= vx + vw + 20 && st.y >= vy - 20 && st.y <= vy + vh + 20,
    );

    // Selected flow – one bold route through parcels in call order.
    if (sel?.kind === "flow") drawRoute(ctx, flowRoute(lay, model, sel.id));

    drawStations(ctx, vis, view, overlays, sel?.kind === "station" ? sel.id : null);

    // World border, then labels in screen space.
    ctx.strokeStyle = withAlpha(INK, 0.3);
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(0, 0, ATLAS_WORLD.w, ATLAS_WORLD.h);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawLabels(ctx, lay, model, view);
    ctx.restore();
  },

  hit(sx, sy, view) {
    const lay = lastLayout;
    if (!lay) return null;
    // Hit sees screen coordinates; the treemap lives in world space.
    const x = (sx - view.ox) / view.scale;
    const y = (sy - view.oy) / view.scale;
    const st = hitStation(lay, x, y);
    if (st) return { kind: "station", id: st.id };
    // Smallest district containing the point wins.
    for (const d of lay.districts) {
      if (pointIn(x, y, d)) return { kind: "domain", id: String(d.domain) };
    }
    return null;
  },

  fit(pick, view, set) {
    const lay = lastLayout;
    if (!lay) return;
    const next = (patch: Partial<VariantView>): VariantView => ({ ...view, ...patch });
    if (pick.kind === "domain") {
      const d = lay.districts.find((x) => String(x.domain) === pick.id);
      if (!d) return;
      // Scale so the district fills most of the viewport.
      const scale = Math.min(1.6, Math.max(0.4, Math.min(view.w / (d.w * 1.15), view.h / (d.h * 1.15))));
      set(next({ scale, ox: view.w / 2 - (d.x + d.w / 2) * scale, oy: view.h / 2 - (d.y + d.h / 2) * scale }));
    } else if (pick.kind === "station") {
      const st = lay.stationById.get(pick.id);
      if (!st) return;
      set(next({ scale: 2.2, ox: view.w / 2 - st.x * 2.2, oy: view.h / 2 - st.y * 2.2 }));
    } else if (pick.kind === "flow") {
      const pts = flowRoute(lay, lastModel ?? ({} as MapModel), pick.id);
      if (!pts.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      const w = Math.max(x1 - x0, 200);
      const h = Math.max(y1 - y0, 160);
      const scale = Math.max(0.4, Math.min(2, Math.min(view.w / (w * 1.2), view.h / (h * 1.2))));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      set(next({ scale, ox: view.w / 2 - cx * scale, oy: view.h / 2 - cy * scale }));
    }
  },
};

export function atlasPickCode(p: MapPick): string {
  return pickCode(p);
}

export default atlasVariant;
