// Visual effects layered around sigma's WebGL renderer:
//   under the edges – cluster nebulae, cluster names (semantic zoom), node glows
//   over the edges  – call-flow particles and the pulsing focus halo
// Everything is plain canvas 2D drawn in viewport space, synced to sigma's
// render loop, with a rAF loop only while something is animating.

import type Sigma from "sigma";
import type Graph from "graphology";

export interface FxOptions {
  /** Node attribute holding the cluster id (for nebulae). */
  clusterOf?: (attrs: any) => number | null;
  clusterLabel?: (id: number) => string | undefined;
  clusterColor?: (id: number) => string;
  /** Nodes that should carry a soft glow (hubs, changes…). */
  glow?: (id: string, attrs: any) => number; // 0 = none, 1 = normal, 2 = strong
  reducedMotion?: boolean;
}

export interface FxState {
  focus: string | null;
  /** Directed edges to animate particles along ([src, dst]). */
  flows: [string, string][];
  /** Extra nodes that pulse (e.g. search hits, changed symbols). */
  pulse: Set<string>;
  /** When set, only these nodes keep their glow. */
  dimOthers: Set<string> | null;
}

const hexToRgb = (c: string) => {
  const m = c.trim().replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (c: string, a: number) => {
  if (!c.startsWith("#")) return c;
  const [r, g, b] = hexToRgb(c);
  return `rgba(${r},${g},${b},${a})`;
};

// Same curvature as @sigma/edge-curve's default so particles ride the drawn curve.
const CURVATURE = 0.25;

export function attachFx(sigma: Sigma, graph: Graph, opts: FxOptions) {
  const s = sigma as any;
  s.createCanvasContext("fxUnder", { beforeLayer: "edges" });
  s.createCanvasContext("fxOver", { afterLayer: "edges" });
  const under: CanvasRenderingContext2D = s.canvasContexts.fxUnder;
  const over: CanvasRenderingContext2D = s.canvasContexts.fxOver;
  const state: FxState = { focus: null, flows: [], pulse: new Set(), dimOthers: null };
  // Additive light on dark backgrounds; multiply ink on light ones.
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#000000";
  const [br, bgc, bb] = hexToRgb(bg.startsWith("#") ? bg : "#000000");
  const light = (br * 299 + bgc * 587 + bb * 114) / 1000 > 140;
  const blend: GlobalCompositeOperation = light ? "multiply" : "lighter";
  let raf = 0;
  let t0 = performance.now();
  let alive = true;

  const size = () => {
    const d = sigma.getDimensions();
    return { w: d.width, h: d.height };
  };
  const vp = (id: string) => {
    const d = sigma.getNodeDisplayData(id);
    if (!d || d.hidden) return null;
    const p = sigma.framedGraphToViewport({ x: d.x, y: d.y });
    return { x: p.x, y: p.y, r: sigma.scaleSize(d.size), color: d.color };
  };

  function drawUnder() {
    const { w, h } = size();
    under.clearRect(0, 0, w, h);
    const ratio = sigma.getCamera().ratio;

    // 1. Nebulae: a soft territory per cluster, at its centroid.
    if (opts.clusterOf) {
      const acc = new Map<number, { x: number; y: number; n: number; xs: number[]; ys: number[] }>();
      graph.forEachNode((id, a) => {
        const c = opts.clusterOf!(a);
        if (c == null) return;
        const p = vp(id);
        if (!p) return;
        const e = acc.get(c) ?? { x: 0, y: 0, n: 0, xs: [], ys: [] };
        e.x += p.x; e.y += p.y; e.n++; e.xs.push(p.x); e.ys.push(p.y);
        acc.set(c, e);
      });
      const big = [...acc.entries()].filter(([, e]) => e.n >= 4).sort((a, b) => b[1].n - a[1].n).slice(0, 24);
      under.globalCompositeOperation = blend;
      for (const [c, e] of big) {
        const cx = e.x / e.n, cy = e.y / e.n;
        // Radius: RMS spread of members, so the glow hugs the cluster.
        let v = 0;
        for (let i = 0; i < e.n; i++) v += (e.xs[i] - cx) ** 2 + (e.ys[i] - cy) ** 2;
        const r = Math.max(40, Math.sqrt(v / e.n) * 1.6);
        const col = opts.clusterColor?.(c) ?? "#888888";
        const g = under.createRadialGradient(cx, cy, 0, cx, cy, r);
        const dim = state.dimOthers ? 0.35 : 1;
        g.addColorStop(0, rgba(col, 0.13 * dim));
        g.addColorStop(0.55, rgba(col, 0.05 * dim));
        g.addColorStop(1, rgba(col, 0));
        under.fillStyle = g;
        under.beginPath();
        under.arc(cx, cy, r, 0, Math.PI * 2);
        under.fill();
      }
      under.globalCompositeOperation = "source-over";

      // 2. Semantic zoom: cluster names appear when you step back.
      if (opts.clusterLabel && ratio > 0.55 && !state.focus) {
        const alpha = Math.min(1, (ratio - 0.55) / 0.35);
        under.textAlign = "center";
        under.textBaseline = "middle";
        for (const [c, e] of big.slice(0, 14)) {
          const label = opts.clusterLabel(c);
          if (!label) continue;
          const cx = e.x / e.n, cy = e.y / e.n;
          under.font = `600 ${Math.round(11 + Math.min(7, Math.sqrt(e.n) * 0.7))}px "Geist Variable", system-ui, sans-serif`;
          const text = label.toUpperCase().split("").join(String.fromCharCode(8202)); // hair-space tracking
          under.lineWidth = 4;
          under.strokeStyle = light ? `rgba(246,244,240,${0.8 * alpha})` : `rgba(6,6,9,${0.7 * alpha})`;
          under.strokeText(text, cx, cy);
          under.fillStyle = rgba(opts.clusterColor?.(c) ?? "#ffffff", 0.75 * alpha);
          under.fillText(text, cx, cy);
        }
      }
    }

    // 3. Node glows: a luminous halo under important nodes.
    if (opts.glow) {
      under.globalCompositeOperation = blend;
      graph.forEachNode((id, a) => {
        const k = opts.glow!(id, a);
        if (!k) return;
        if (state.dimOthers && !state.dimOthers.has(id)) return;
        const p = vp(id);
        if (!p) return;
        const r = p.r * (k === 2 ? 4.2 : 3);
        const g = under.createRadialGradient(p.x, p.y, p.r * 0.6, p.x, p.y, r);
        g.addColorStop(0, rgba(p.color, k === 2 ? 0.45 : 0.28));
        g.addColorStop(1, rgba(p.color, 0));
        under.fillStyle = g;
        under.beginPath();
        under.arc(p.x, p.y, r, 0, Math.PI * 2);
        under.fill();
      });
      under.globalCompositeOperation = "source-over";
    }
  }

  function drawOver(now: number) {
    const { w, h } = size();
    over.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000;

    // Particles travel along each flow edge in call direction.
    if (state.flows.length && !opts.reducedMotion) {
      over.globalCompositeOperation = blend;
      for (let i = 0; i < state.flows.length; i++) {
        const [a, b] = state.flows[i];
        const pa = vp(a), pb = vp(b);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy);
        if (len < 4) continue;
        // Same quadratic control point as the edge-curve shader. It computes
        // mid + (-dy, dx)·curvature in WebGL's y-up space, i.e. (dy, -dx) on screen.
        const cx = (pa.x + pb.x) / 2 + dy * CURVATURE;
        const cy = (pa.y + pb.y) / 2 - dx * CURVATURE;
        const n = Math.max(1, Math.min(4, Math.round(len / 90)));
        for (let k = 0; k < n; k++) {
          const u = (t * 0.45 + k / n + i * 0.137) % 1;
          const x = (1 - u) ** 2 * pa.x + 2 * (1 - u) * u * cx + u * u * pb.x;
          const y = (1 - u) ** 2 * pa.y + 2 * (1 - u) * u * cy + u * u * pb.y;
          const g = over.createRadialGradient(x, y, 0, x, y, 7);
          g.addColorStop(0, rgba(pb.color, 0.95));
          g.addColorStop(0.35, rgba(pb.color, 0.45));
          g.addColorStop(1, rgba(pb.color, 0));
          over.fillStyle = g;
          over.beginPath();
          over.arc(x, y, 7, 0, Math.PI * 2);
          over.fill();
        }
      }
      over.globalCompositeOperation = "source-over";
    }

    // Pulsing rings: focus + any pulse set.
    const ringFor = (id: string, strength: number, phase: number) => {
      const p = vp(id);
      if (!p) return;
      const cycle = opts.reducedMotion ? 0.5 : ((t * 0.8 + phase) % 1);
      const r = p.r + 4 + cycle * 22 * strength;
      over.strokeStyle = rgba(p.color, (1 - cycle) * 0.7);
      over.lineWidth = 1.6;
      over.beginPath();
      over.arc(p.x, p.y, r, 0, Math.PI * 2);
      over.stroke();
    };
    if (state.focus) { ringFor(state.focus, 1.2, 0); ringFor(state.focus, 1.2, 0.5); }
    let i = 0;
    for (const id of state.pulse) ringFor(id, 0.8, (i++ * 0.21) % 1);
  }

  const animating = () => !!state.focus || state.flows.length > 0 || state.pulse.size > 0;
  const loop = (now: number) => {
    if (!alive) return;
    drawOver(now);
    raf = animating() ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf && alive) raf = requestAnimationFrame(loop); };

  const onRender = () => { drawUnder(); if (!raf) drawOver(performance.now()); };
  sigma.on("afterRender", onRender);

  return {
    set(next: Partial<FxState>) {
      Object.assign(state, next);
      drawUnder();
      if (animating()) kick(); else drawOver(performance.now());
    },
    redraw: onRender,
    kill() {
      alive = false;
      cancelAnimationFrame(raf);
      sigma.off("afterRender", onRender);
    },
  };
}

/** Label with a dark outline: legible on top of glows and edges. */
export function drawOutlinedLabel(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  if (!data.label) return;
  const size = settings.labelSize;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const x = data.x + data.size + 4;
  const y = data.y + size / 3;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#07070a";
  ctx.strokeText(data.label, x, y);
  ctx.fillStyle = settings.labelColor.color;
  ctx.fillText(data.label, x, y);
}
