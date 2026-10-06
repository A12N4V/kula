// Conway's Game of Life, set in the same 3px dither cells as the console's
// graph. It starts from kula's mark – the 7×7 ring around a centre node – with
// a soup and a few gliders around it, and reseeds from the mark whenever the
// field dies out or settles. Paused while the tab is hidden; a still frame when
// the system asks for reduced motion.
import { useEffect, useRef } from "react";
import { BASE, N } from "./mark";

const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

export default function Life({ pixel = 3, className, rate = 9 }: { pixel?: number; className?: string; rate?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const css = getComputedStyle(c);
    const live = css.getPropertyValue("--life-on").trim() || "#e8e2d9";
    const young = css.getPropertyValue("--life-new").trim() || "#f97f3a";
    let w = 0, h = 0, cells = new Uint8Array(0), next = new Uint8Array(0), age = new Uint8Array(0);
    let still = 0, raf = 0, last = 0, gen = 0;

    const stamp = (ox: number, oy: number, pts: number[][]) => {
      for (const [x, y] of pts) { const i = ((oy + y + h) % h) * w + ((ox + x + w) % w); cells[i] = 1; age[i] = 0; }
    };
    const markPts: number[][] = [];
    BASE.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "#") markPts.push([x, y]); }));
    const seed = () => {
      cells.fill(0); age.fill(0);
      // A soup around the mark so the field is busy from the first frame.
      for (let i = 0; i < w * h; i++) if (Math.random() < 0.16) { cells[i] = 1; age[i] = 3; }
      stamp(Math.floor(w / 2 - N / 2), Math.floor(h / 2 - N / 2), markPts);
      const gliders = Math.max(2, Math.floor((w * h) / 2600));
      for (let k = 0; k < gliders; k++) {
        const x = Math.floor(Math.random() * w), y = Math.floor(Math.random() * h);
        const flip = k % 2 ? -1 : 1;
        stamp(x, y, GLIDER.map(([a, b]) => [a * flip, b]));
      }
      still = 0;
    };
    const resize = () => {
      const r = c.getBoundingClientRect();
      w = Math.max(8, Math.floor(r.width / pixel)); h = Math.max(8, Math.floor(r.height / pixel));
      c.width = w * pixel; c.height = h * pixel;
      cells = new Uint8Array(w * h); next = new Uint8Array(w * h); age = new Uint8Array(w * h);
      seed(); draw();
    };
    const step = () => {
      let changed = 0, alive = 0;
      for (let y = 0; y < h; y++) {
        const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
        for (let x = 0; x < w; x++) {
          const xm = (x - 1 + w) % w, xp = (x + 1) % w;
          const n = cells[ym + xm] + cells[ym + x] + cells[ym + xp] + cells[y0 + xm] + cells[y0 + xp] + cells[yp + xm] + cells[yp + x] + cells[yp + xp];
          const was = cells[y0 + x], now = n === 3 || (was && n === 2) ? 1 : 0;
          next[y0 + x] = now;
          if (now !== was) changed++;
          alive += now;
          age[y0 + x] = now ? (was ? Math.min(255, age[y0 + x] + 1) : 0) : 0;
        }
      }
      [cells, next] = [next, cells];
      gen++;
      // Every few seconds a glider comes in from a corner, so it never goes quiet.
      if (gen % 36 === 0) stamp(gen % 72 ? 1 : w - 4, gen % 72 ? 1 : h - 4, gen % 72 ? GLIDER : GLIDER.map(([a, b]) => [2 - a, 2 - b]));
      still = changed < 3 ? still + 1 : 0;
      if (alive < (w * h) / 400 || still > 12) seed();
    };
    const draw = () => {
      g.clearRect(0, 0, c.width, c.height);
      for (let i = 0; i < w * h; i++) {
        if (!cells[i]) continue;
        g.fillStyle = age[i] < 2 ? young : live;
        g.fillRect((i % w) * pixel, Math.floor(i / w) * pixel, pixel - 1, pixel - 1);
      }
    };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < 1000 / rate) return;
      last = t; step(); draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [pixel, rate]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
