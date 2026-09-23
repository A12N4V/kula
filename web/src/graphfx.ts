// Canvas layers around sigma's WebGL renderer.
//   ground (under edges) – directory territories: padded hulls, one tint each
//   flow   (over edges)  – small dots travelling along calls, in call direction
//   marks  (over nodes)  – hub tiles with kind glyphs, focus rings, territory names
// Each layer is plain 2D, redrawn on sigma's afterRender; a rAF loop runs only
// while dots are moving.

import type Sigma from "sigma";
import type Graph from "graphology";

export interface OverlayOptions {
  /** Territory key for a node (a directory), or null for none. */
  group: (attrs: any) => string | null;
  /** Territory tint; null draws a neutral territory. */
  groupColor: (key: string) => string | null;
  groupLabel?: (key: string) => string;
  hub: (id: string, attrs: any) => boolean;
  glyph: (attrs: any) => string;
  reducedMotion?: boolean;
}

export interface OverlayState {
  territories: boolean;
  hubIcons: boolean;
  /** Curvature of the edge program (0 = straight), so dots ride the drawn edge. */
  curvature: number;
  focus: string | null;
  /** Directed edges that carry moving dots. */
  flows: [string, string][];
  /** Static rings: node → colour (changed symbols in Contrast, search hits…). */
  rings: Map<string, string>;
  /** Territory to emphasise (hovered legend row, focused node's directory). */
  activeGroup: string | null;
  /** Something is focused: fade territories so the neighbourhood reads first. */
  quiet: boolean;
  /** A single symbol is in focus: territories step aside entirely. */
  focusMode: boolean;
}

type Pt = { x: number; y: number };

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const rgb = (c: string) => {
  const m = c.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (c: string, a: number) => (c.startsWith("#") ? `rgba(${rgb(c).join(",")},${a})` : c);
const lum = (c: string) => { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000; };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, half: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x - half, y - half, half * 2, half * 2, r);
}

export function attachOverlay(sigma: Sigma, graph: Graph, opts: OverlayOptions) {
  const s = sigma as any;
  s.createCanvasContext("ground", { beforeLayer: "edges" });
  s.createCanvasContext("flow", { afterLayer: "edges" });
  s.createCanvasContext("marks", { afterLayer: "nodes" });
  const ground: CanvasRenderingContext2D = s.canvasContexts.ground;
  const flow: CanvasRenderingContext2D = s.canvasContexts.flow;
  const marks: CanvasRenderingContext2D = s.canvasContexts.marks;
  // Layers added after sigma's first resize start at 300×150; size them now.
  s.resize(true);
  const state: OverlayState = {
    territories: true, hubIcons: true, curvature: 0, focus: null, flows: [], rings: new Map(), activeGroup: null, quiet: false, focusMode: false,
  };
  let raf = 0;
  const t0 = performance.now();
  let alive = true;
  let theme = { bg: "#08080b", text: "#ece8e1", text2: "#a9a49c", text3: "#6d6a66", light: false };
  const readTheme = () => {
    const bg = css("--bg") || "#08080b";
    theme = { bg, text: css("--text"), text2: css("--text-2"), text3: css("--text-3"), light: lum(bg) > 140 };
  };
  readTheme();

  const dims = () => sigma.getDimensions();
  const vp = (id: string) => {
    const d: any = sigma.getNodeDisplayData(id);
    if (!d || d.hidden) return null;
    const p = sigma.framedGraphToViewport({ x: d.x, y: d.y });
    return { x: p.x, y: p.y, r: sigma.scaleSize(d.size), d };
  };

  // Territories are computed once per frame and shared by ground (fills) and marks (names).
  // Each is the union of discs around its members ("bubble set"): the tint sits only
  // where that directory's code is, so interleaved directories don't smear into one hull.
  let terr: { key: string; n: number; pts: { x: number; y: number; r: number }[]; top: Pt; rad: number; color: string | null }[] = [];

  function computeTerritories() {
    terr = [];
    if (!state.territories || state.focusMode) return;
    const acc = new Map<string, { x: number; y: number; r: number }[]>();
    graph.forEachNode((id, a) => {
      const k = opts.group(a);
      if (k == null) return;
      const p = vp(id);
      if (!p || p.d.dimmed) return;
      let l = acc.get(k);
      if (!l) acc.set(k, (l = []));
      l.push(p);
    });
    for (const [key, pts] of acc) {
      // Disc radius ≈ typical spacing between members (sampled nearest neighbours), so
      // neighbouring discs merge into one region instead of reading as polka dots.
      const sample = pts.length > 48 ? pts.filter((_, i) => i % Math.ceil(pts.length / 48) === 0) : pts;
      const nn: number[] = [];
      for (const a of sample) {
        let best = Infinity;
        for (const b of pts) if (a !== b) { const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (d < best) best = d; }
        if (best < Infinity) nn.push(Math.sqrt(best));
      }
      nn.sort((a, b) => a - b);
      const rad = Math.max(12, Math.min(56, (nn[Math.floor(nn.length * 0.75)] ?? 24) * 0.85));
      // Name sits on the group's centre of mass, not on an outlier.
      const top = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
      terr.push({ key, n: pts.length, pts, top, rad, color: opts.groupColor(key) });
    }
    terr.sort((a, b) => b.n - a.n);
  }

  function drawGround() {
    const { width: w, height: h } = dims();
    ground.clearRect(0, 0, w, h);
    computeTerritories();
    const k = theme.light ? 1.3 : 1;
    for (const t of terr) {
      const on = !state.quiet || state.activeGroup === t.key;
      const col = t.color ?? theme.text3;
      // One path of many discs, filled once: the non-zero rule paints their union evenly.
      ground.beginPath();
      for (const p of t.pts) { const r = t.rad + p.r * 0.6; ground.moveTo(p.x + r, p.y); ground.arc(p.x, p.y, r, 0, Math.PI * 2); }
      ground.fillStyle = rgba(col, (t.color ? 0.11 : 0.06) * k * (on ? 1 : 0.35));
      ground.fill();
    }
  }

  function drawMarks() {
    const { width: w, height: h } = dims();
    marks.clearRect(0, 0, w, h);

    // Hub tiles: rounded squares with a kind (or language) glyph.
    if (state.hubIcons) {
      graph.forEachNode((id, a) => {
        if (!opts.hub(id, a)) return;
        const p = vp(id);
        if (!p) return;
        const half = Math.max(6.5, p.r * 1.1);
        const fill = p.d.tile ?? p.d.color;
        roundRect(marks, p.x, p.y, half, Math.max(2, half * 0.28));
        marks.fillStyle = fill;
        marks.fill();
        marks.lineWidth = 1.5;
        marks.strokeStyle = theme.bg;
        marks.stroke();
        if (half >= 6 && !p.d.dimmed) {
          const g = opts.glyph(a);
          marks.font = `650 ${Math.round(half * (g.length > 1 ? 0.8 : 1.15))}px "Geist Mono Variable", ui-monospace, monospace`;
          marks.textAlign = "center";
          marks.textBaseline = "middle";
          marks.fillStyle = lum(fill) > 150 ? "#101014" : "#ffffff";
          marks.fillText(g, p.x, p.y + half * 0.04);
        }
      });
    }

    // Rings: focus in the text colour, others in their own colour.
    const ring = (id: string, color: string, width: number) => {
      const p = vp(id);
      if (!p) return;
      const hubbed = state.hubIcons && opts.hub(id, graph.getNodeAttributes(id));
      marks.lineWidth = width;
      marks.strokeStyle = color;
      if (hubbed) {
        const half = Math.max(6.5, p.r * 1.1) + 3.5;
        roundRect(marks, p.x, p.y, half, half * 0.3);
      } else {
        marks.beginPath();
        marks.arc(p.x, p.y, p.r + 3.5, 0, Math.PI * 2);
      }
      marks.stroke();
    };
    for (const [id, c] of state.rings) ring(id, c, 1.5);
    if (state.focus) ring(state.focus, theme.text, 2);

    // Territory names, largest first. Each tries a few spots around its group's centre and
    // takes the first that clears node labels, nodes and earlier names; none fits → skipped.
    if (terr.length) {
      type Box = [number, number, number, number];
      const hit = (a: Box, b: Box) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
      const obstacles: Box[] = [];
      const labelled: Set<string> = s.displayedNodeLabels ?? new Set();
      const lf = `500 11.5px "Geist Variable", system-ui, sans-serif`;
      marks.font = lf;
      graph.forEachNode((id, a) => {
        if (a.virtual) return;
        const p = vp(id);
        if (!p || p.d.dimmed) return;
        const r = Math.max(p.r, p.d.hubTile ? 6.5 : 0);
        obstacles.push([p.x - r, p.y - r, p.x + r, p.y + r]);
        if (labelled.has(id) && p.d.label) {
          const x0 = p.x + r + 4;
          obstacles.push([x0, p.y - 9, x0 + marks.measureText(p.d.label).width, p.y + 5]);
        }
      });
      const placed: Box[] = [];
      marks.font = `600 11.5px "Geist Mono Variable", ui-monospace, monospace`;
      marks.textAlign = "left";
      marks.textBaseline = "alphabetic";
      const spots: [number, number][] = [[0, 0]];
      for (const r of [22, 44, 70, 100]) for (let k = 0; k < 8; k++) spots.push([Math.round(Math.cos((k * Math.PI) / 4) * r * 1.6), Math.round(Math.sin((k * Math.PI) / 4) * r)]);
      for (const t of terr) {
        if (t.n < 2 && terr.length > 6) continue;
        const label = opts.groupLabel?.(t.key) ?? `${t.key}/`;
        const count = ` ${t.n}`;
        const lw = marks.measureText(label).width, cw = marks.measureText(count).width;
        let at: [number, number] | null = null;
        for (const [dx, dy] of spots) {
          const x = Math.max(6, Math.min(w - lw - cw - 6, t.top.x + dx - (lw + cw) / 2)), y = Math.max(14, Math.min(h - 6, t.top.y + dy + 4));
          const box: Box = [x - 3, y - 12, x + lw + cw + 3, y + 4];
          if (placed.some((b) => hit(box, b)) || obstacles.some((b) => hit(box, b))) continue;
          placed.push(box);
          at = [x, y];
          break;
        }
        if (!at) continue;
        const [x, y] = at;
        const on = !state.quiet || state.activeGroup === t.key;
        marks.globalAlpha = on ? 1 : 0.4;
        marks.lineWidth = 3;
        marks.lineJoin = "round";
        marks.strokeStyle = theme.bg;
        marks.strokeText(label + count, x, y);
        marks.fillStyle = t.color ?? theme.text2;
        marks.fillText(label, x, y);
        marks.fillStyle = theme.text3;
        marks.fillText(count, x + lw, y);
        marks.globalAlpha = 1;
      }
    }
  }

  function drawFlow(now: number) {
    const { width: w, height: h } = dims();
    flow.clearRect(0, 0, w, h);
    if (!state.flows.length || opts.reducedMotion) return;
    const t = (now - t0) / 1000;
    for (let i = 0; i < state.flows.length; i++) {
      const [a, b] = state.flows[i];
      const pa = vp(a), pb = vp(b);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      if (len < 8) continue;
      // Same quadratic control point as @sigma/edge-curve ((dy, −dx) on screen); 0 = straight.
      const cx = (pa.x + pb.x) / 2 + dy * state.curvature, cy = (pa.y + pb.y) / 2 - dx * state.curvature;
      const n = Math.max(1, Math.min(3, Math.round(len / 120)));
      flow.fillStyle = pb.d.tile ?? pb.d.color;
      for (let k = 0; k < n; k++) {
        const u = (t * (60 / Math.max(60, len)) + k / n + i * 0.137) % 1;
        const x = (1 - u) ** 2 * pa.x + 2 * (1 - u) * u * cx + u * u * pb.x;
        const y = (1 - u) ** 2 * pa.y + 2 * (1 - u) * u * cy + u * u * pb.y;
        flow.beginPath();
        flow.arc(x, y, 1.9, 0, Math.PI * 2);
        flow.fill();
      }
    }
  }

  const moving = () => state.flows.length > 0 && !opts.reducedMotion;
  const loop = (now: number) => {
    if (!alive) return;
    drawFlow(now);
    raf = moving() ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf && alive && moving()) raf = requestAnimationFrame(loop); };
  const onRender = () => { drawGround(); drawMarks(); if (!raf) drawFlow(performance.now()); };
  sigma.on("afterRender", onRender);

  return {
    set(next: Partial<OverlayState>) {
      Object.assign(state, next);
      onRender();
      kick();
    },
    /** Territories as last drawn, for hit-testing and legends. */
    territories: () => terr,
    retheme() { readTheme(); onRender(); },
    kill() {
      alive = false;
      cancelAnimationFrame(raf);
      sigma.off("afterRender", onRender);
    },
  };
}

export type Overlay = ReturnType<typeof attachOverlay>;

/** Node label with a background-coloured outline, legible over edges and territories. */
export function drawOutlinedLabel(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  if (!data.label) return;
  const size = settings.labelSize;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const x = data.x + (data.hubTile ? Math.max(6.5, data.size * 1.1) : data.size) + 4;
  const y = data.y + size / 3;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = css("--bg") || "#07070a";
  ctx.strokeText(data.label, x, y);
  ctx.fillStyle = data.dimmed ? css("--text-3") : settings.labelColor.color;
  ctx.fillText(data.label, x, y);
}

/** Hover: outline the node's own shape, then a bolder label. */
export function drawHover(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = css("--text") || "#fff";
  ctx.beginPath();
  if (data.hubTile) { const h = Math.max(6.5, data.size * 1.1) + 3; ctx.roundRect(data.x - h, data.y - h, h * 2, h * 2, h * 0.3); }
  else ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.stroke();
  drawOutlinedLabel(ctx, { ...data, size: data.size + (data.hubTile ? 1 : 3) }, { ...settings, labelWeight: "600" });
}
