// The repository's own knowledge graph as a 1-bit, ordered-dithered object.
// Nodes sit in 3D, one cluster per directory on a Fibonacci sphere; they
// assemble out of noise, then turn slowly. Each frame is splatted into a
// low-resolution luminance buffer, thresholded against an 8×8 Bayer matrix
// and upscaled without smoothing – so it reads as print, not glow.

import { useEffect, useRef } from "react";
import type { GraphData } from "./api";
import { groupDirs } from "./colors";

const BAYER = (() => {
  // Recursive construction of the 8×8 Bayer index matrix, normalised to (0, 1).
  let m = [[0]];
  for (let n = 1; n < 8; n *= 2) {
    const next: number[][] = Array.from({ length: n * 2 }, () => Array(n * 2).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v; next[y][x + n] = v + 2; next[y + n][x] = v + 3; next[y + n][x + n] = v + 1;
      }
    m = next;
  }
  return m.map((r) => r.map((v) => (v + 0.5) / 64));
})();

type P3 = { x: number; y: number; z: number; w: number };

/** Place nodes: directory clusters on a sphere, members in a gaussian cloud around each. */
function scene(data: GraphData, max = 700) {
  const nodes = data.nodes.slice();
  const deg = new Map<number, number>();
  for (const e of data.edges) { deg.set(e.src, (deg.get(e.src) ?? 0) + 1); deg.set(e.dst, (deg.get(e.dst) ?? 0) + 1); }
  const pick = nodes.sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0)).slice(0, max);
  const groups = groupDirs(pick.map((n) => n.path), 0);
  const k = groups.sizes.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const centre = new Map(groups.sizes.map(([d], i) => {
    const y = 1 - (2 * (i + 0.5)) / k, r = Math.sqrt(1 - y * y), t = i * golden;
    return [d, { x: Math.cos(t) * r * 0.82, y: y * 0.82, z: Math.sin(t) * r * 0.82 }];
  }));
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const index = new Map<number, number>();
  const pts: P3[] = pick.map((n, i) => {
    index.set(n.id, i);
    const c = centre.get(groups.of(n.path))!;
    const size = groups.sizes.find(([d]) => d === groups.of(n.path))?.[1] ?? 1;
    const s = 0.035 + Math.sqrt(size) * 0.009;
    return { x: c.x + gauss() * s, y: c.y + gauss() * s, z: c.z + gauss() * s, w: Math.min(3, 1 + Math.sqrt(deg.get(n.id) ?? 0) * 0.35) };
  });
  const links: [number, number][] = [];
  for (const e of data.edges) {
    const a = index.get(e.src), b = index.get(e.dst);
    if (a != null && b != null && a !== b) links.push([a, b]);
  }
  const noise: P3[] = pts.map(() => ({ x: (rnd() - 0.5) * 2.6, y: (rnd() - 0.5) * 2.6, z: (rnd() - 0.5) * 2.6, w: 1 }));
  return { pts, links, noise };
}

export default function Dither({ data, pixel = 3, className, speed = 1, assemble = true }: {
  data: GraphData | null; pixel?: number; className?: string; speed?: number; assemble?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !data || !data.nodes.length) return;
    const ctx = cv.getContext("2d")!;
    const { pts, links, noise } = scene(data);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff9e6d";
    const n = parseInt(ink.replace("#", "").slice(0, 6), 16);
    const [ir, ig, ib] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let w = 0, h = 0, buf = new Float32Array(0), img: ImageData | null = null;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(8, Math.floor(r.width / pixel)); h = Math.max(8, Math.floor(r.height / pixel));
      cv.width = w; cv.height = h;
      buf = new Float32Array(w * h);
      img = ctx.createImageData(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const splat = (x: number, y: number, v: number, r: number) => {
      const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r));
      const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r));
      const rr = r * r;
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) {
          const d = (xx - x) ** 2 + (yy - y) ** 2;
          if (d < rr) buf[yy * w + xx] += v * (1 - d / rr);
        }
    };
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      // Assembly: noise → structure over 1.6s with an ease-out; then a slow turn.
      const u = !assemble || reduced ? 1 : Math.min(1, t / 1.6);
      const e = 1 - Math.pow(1 - u, 3);
      const ang = reduced ? 0.6 : 0.6 + t * 0.18 * speed;
      const ca = Math.cos(ang), sa = Math.sin(ang), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
      const scale = Math.min(w, h) * 0.62;
      buf.fill(0);
      const proj: { x: number; y: number; d: number }[] = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = noise[i];
        const x = q.x + (p.x - q.x) * e, y = q.y + (p.y - q.y) * e, z = q.z + (p.z - q.z) * e;
        const rx = x * ca + z * sa, rz = -x * sa + z * ca;
        const ry = y * ct - rz * st, rz2 = y * st + rz * ct;
        const persp = 1.9 / (1.9 + rz2);
        proj[i] = { x: w / 2 + rx * scale * persp, y: h / 2 + ry * scale * persp, d: Math.max(0.15, Math.min(1, 0.62 - rz2 * 0.55)) };
      }
      // Edges fade in behind the assembly; nearer means brighter.
      const le = Math.max(0, (e - 0.55) / 0.45);
      if (le > 0)
        for (const [a, b] of links) {
          const A = proj[a], B = proj[b];
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          const steps = Math.min(200, Math.ceil(len));
          const v = 0.16 * le * (A.d + B.d) * 0.5;
          for (let s = 0; s <= steps; s++) {
            const f = s / steps, x = Math.round(A.x + (B.x - A.x) * f), y = Math.round(A.y + (B.y - A.y) * f);
            if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] += v;
          }
        }
      for (let i = 0; i < pts.length; i++) splat(proj[i].x, proj[i].y, 0.9 * proj[i].d, 1.1 + pts[i].w * proj[i].d);
      // Ordered dither to 1 bit.
      const px = img!.data;
      for (let y = 0; y < h; y++) {
        const row = BAYER[y & 7];
        for (let x = 0; x < w; x++) {
          const on = buf[y * w + x] > row[x & 7];
          const o = (y * w + x) * 4;
          px[o] = ir; px[o + 1] = ig; px[o + 2] = ib; px[o + 3] = on ? 255 : 0;
        }
      }
      ctx.putImageData(img!, 0, 0);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [data, pixel, speed, assemble]);
  return <canvas ref={ref} className={`dither ${className ?? ""}`} aria-hidden="true" />;
}
