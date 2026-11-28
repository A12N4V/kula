// Shared drawing and layout helpers for the map variants: colours, geometry
// and small deterministic utilities. No layout policy lives here – each
// variant owns its own – only the pieces every variant needs identically.

import type { MapModel } from "./model";

/** Flow line colours, in a stable order from the map palette (tokens.css). */
export const FLOW_COLORS = [
  "var(--map-orange)", "var(--map-cyan)", "var(--map-green)", "var(--map-yellow)",
  "var(--map-violet)", "var(--map-blue)", "var(--map-pink)", "var(--map-red)",
];
export const flowColor = (i: number) => FLOW_COLORS[i % FLOW_COLORS.length];

/** Layer colours, one per layer in LAYERS order. */
export const LAYER_COLORS: Record<string, string> = {
  entry: "var(--map-orange)",
  handler: "var(--map-cyan)",
  logic: "var(--map-green)",
  data: "var(--map-yellow)",
  io: "var(--map-blue)",
  test: "var(--map-violet)",
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Deterministic hash of a string – layout seeds, never randomness. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function withAlpha(color: string, a: number): string {
  const m = color.match(/^#(..)(..)(..)$/);
  if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  return color;
}

/** The cream ink and warm line colours, read once from CSS variables. */
export function inks(): { text: string; line: string; line2: string; bg: string; accent: string } {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue("--text").trim() || "#f0ebe3",
    line: cs.getPropertyValue("--line").trim() || "#24201d",
    line2: cs.getPropertyValue("--line-2").trim() || "#332d28",
    bg: cs.getPropertyValue("--bg").trim() || "#050505",
    accent: cs.getPropertyValue("--map-orange").trim() || "#ff6a14",
  };
}

/** District grid for the stub: domains by size desc, wrapped rows. Deterministic. */
export function domainGrid(model: MapModel, w: number, h: number, pad = 24): { id: number; x: number; y: number; w: number; h: number }[] {
  const ds = [...model.domains].sort((a, b) => b.size - a.size || a.id - b.id);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ds.length * (w / Math.max(h, 1)))));
  const cw = (w - pad * 2) / cols;
  const rows = Math.max(1, Math.ceil(ds.length / cols));
  const ch = (h - pad * 2) / rows;
  return ds.map((d, i) => ({ id: d.id, x: pad + (i % cols) * cw, y: pad + Math.floor(i / cols) * ch, w: cw - 12, h: ch - 12 }));
}
