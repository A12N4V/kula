// The loader: kula's mark as an endless recursive zoom, set in type.
//
// The mark is a 7×7 ring around a centre node, and every lit cell of it is the
// whole mark again, so the camera can fall into it forever. We zoom about the
// fixed point f = P/(N−1) of the centre cell P (the point that sits at the same
// place in P's copy of the mark as in the mark itself; for the centre, the
// middle), and after a ×7 zoom the frame is exactly where it started. Each
// character cell reads the mark's coverage under it (a summed-area table),
// recursing while its pixels are larger than the cell, and the coverage is
// ordered-dithered onto a character ramp.

import { useEffect, useRef } from "react";
import { BASE, N } from "./mark";

const RAMP = " .:-=+*#%@";
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const NOISE = "01/\\<>[]{}=+*#";

const bits = new Uint8Array(N * N);
BASE.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") bits[y * N + x] = 1; }));
// Summed-area table for O(1) coverage of any window.
const sat = new Float32Array((N + 1) * (N + 1));
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
  sat[(y + 1) * (N + 1) + x + 1] = bits[y * N + x] + sat[y * (N + 1) + x + 1] + sat[(y + 1) * (N + 1) + x] - sat[y * (N + 1) + x];
const area = (x0: number, y0: number, x1: number, y1: number) => {
  const c = (v: number) => Math.max(0, Math.min(N, v));
  const [a, b, c2, d] = [c(x0), c(y0), c(x1), c(y1)];
  if (c2 <= a || d <= b) return 0;
  // Fractional window: bilinear SAT lookup.
  const S = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const at = (i: number, j: number) => sat[Math.min(N, j) * (N + 1) + Math.min(N, i)];
    return at(xi, yi) * (1 - fx) * (1 - fy) + at(xi + 1, yi) * fx * (1 - fy) + at(xi, yi + 1) * (1 - fx) * fy + at(xi + 1, yi + 1) * fx * fy;
  };
  return S(c2, d) - S(a, d) - S(c2, b) + S(a, b);
};

// The centre node: the self that contains the whole.
const P = [(N - 1) / 2, (N - 1) / 2];
const F = [P[0] / (N - 1), P[1] / (N - 1)];

/** Coverage of the recursive mark over a cw×ch window centred on (u, v), in unit mark coordinates. */
function lum(u: number, v: number, cw: number, ch: number): number {
  // Outside the mark: it is pixel P of a larger copy of itself; climb out.
  for (let up = 0; up < 3 && (u < 0 || v < 0 || u >= 1 || v >= 1); up++) {
    u = (u + P[0]) / N; v = (v + P[1]) / N; cw /= N; ch /= N;
  }
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  for (let depth = 0; depth < 8; depth++) {
    const x = u * N, y = v * N, w = cw * N, h = ch * N;
    // Pixels at or below the cell's size: read their coverage and stop.
    if (w >= 1 || h >= 1) return area(x - w / 2, y - h / 2, x + w / 2, y + h / 2) / (w * h);
    const xi = Math.floor(x), yi = Math.floor(y);
    if (!bits[yi * N + xi]) return 0;
    u = x - xi; v = y - yi; cw = w; ch = h;
  }
  return 1;
}

export default function AsciiMark({ className, period = 3.6 }: { className?: string; period?: number }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const pre = ref.current;
    if (!pre) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Measure one character of the loader's own font.
    const probe = document.createElement("span");
    probe.textContent = "M".repeat(20);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    pre.appendChild(probe);
    const charW = probe.getBoundingClientRect().width / 20 || 6;
    pre.removeChild(probe);
    const lineH = parseFloat(getComputedStyle(pre).lineHeight) || 10;
    let cols = 0, rows = 0;
    const size = () => {
      const r = pre.parentElement!.getBoundingClientRect();
      cols = Math.max(16, Math.floor(r.width / charW));
      rows = Math.max(8, Math.floor(r.height / lineH));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(pre.parentElement!);

    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const t0 = performance.now();
    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps is plenty for type
      last = now;
      const t = reduced ? 0.35 * period : (now - t0) / 1000;
      // Hold on the whole mark, then fall into its centre; the landing is the same frame.
      const c = (t / period) % 1, hold = 0.38;
      const k = c < hold ? 0 : (c - hold) / (1 - hold);
      const z = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const s = Math.pow(N, z);
      // The view: the whole mark plus a margin at s = 1, shrinking about F.
      const aspect = (cols * charW) / (rows * lineH);
      const vh = 1.3 / s, vw = vh * aspect;
      const cx = F[0] + (0.5 - F[0]) / s, cy = F[1] + (0.5 - F[1]) / s;
      const cw = vw / cols, ch = vh / rows;
      // A scan band sweeps down once per level: characters inside it are still being decoded.
      const band = c < hold ? -1 : ((c - hold) / (1 - hold)) * 1.4 - 0.2;
      let out = "";
      for (let j = 0; j < rows; j++) {
        const v = cy - vh / 2 + (j + 0.5) * ch;
        const near = Math.abs(j / rows - band) < 0.035;
        for (let i = 0; i < cols; i++) {
          const u = cx - vw / 2 + (i + 0.5) * cw;
          const L = Math.min(1, lum(u, v, cw, ch) * 1.6);
          if (near && L > 0.05 && rnd() < 0.55) { out += NOISE[(rnd() * NOISE.length) | 0]; continue; }
          const q = Math.min(RAMP.length - 1, Math.floor(L * (RAMP.length - 1) + BAYER4[(j & 3) * 4 + (i & 3)]));
          out += RAMP[q];
        }
        out += "\n";
      }
      pre.textContent = out;
      if (reduced) cancelAnimationFrame(raf);
    };
    // The first frame is drawn synchronously: a backgrounded headless page can
    // have its rAFs throttled, and reduced motion gets exactly one frame.
    frame(performance.now() + 34);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [period]);
  return <pre ref={ref} className={`ascii-mark ${className ?? ""}`} aria-hidden="true" />;
}

export type LoadStep = { id: string; label: string; weight: number };

/**
 * The graph's loading screen: blocks the view until the map is ready, and says
 * truthfully where it is – the server's index phases, then fetch and layout.
 */
export function GraphLoader({ steps, at, frac, detail, leaving }: {
  steps: LoadStep[]; at: number; frac: number; detail?: string; leaving?: boolean;
}) {
  const total = steps.reduce((a, s) => a + s.weight, 0) || 1;
  const before = steps.slice(0, at).reduce((a, s) => a + s.weight, 0);
  const pct = Math.min(1, (before + (steps[at]?.weight ?? 0) * Math.max(0, Math.min(1, frac))) / total);
  return (
    <div className={`graph-loader ${leaving ? "leaving" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label="Loading the graph">
      <div className="gl-field"><AsciiMark /></div>
      <div className="gl-meter">
        <div className="gl-row">
          <span className="gl-step">{steps[at]?.label ?? "Ready"}</span>
          {detail && <span className="gl-detail">{detail}</span>}
          <span className="spacer" />
          <span className="gl-pct">{String(Math.round(pct * 100)).padStart(3, " ")}%</span>
        </div>
        <div className="gl-bar">
          <i style={{ transform: `scaleX(${pct})` }} />
          {steps.slice(1).map((_, k) => {
            const x = steps.slice(0, k + 1).reduce((a, s) => a + s.weight, 0) / total;
            return <b key={k} style={{ left: `${x * 100}%` }} />;
          })}
        </div>
        <div className="gl-steps">
          {steps.map((s, k) => (
            <span key={s.id} className={k < at ? "done" : k === at ? "on" : ""} style={{ flexGrow: s.weight }}>{s.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
