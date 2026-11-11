// Motion primitives: count-up numbers, staggered reveal and a Bayer dither
// dissolve between states. Each collapses to its end state under
// prefers-reduced-motion (and under automation, so tests read final values).
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { BAYER } from "./Dither";

export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up from 0 (or its last value) on change; ease-out, 600ms. */
export function CountUp({ value, ms = 600 }: { value: number; ms?: number }) {
  const still = reduced() || navigator.webdriver;
  const [n, setN] = useState(() => (still ? value : 0));
  const from = useRef(n);
  useEffect(() => {
    if (still) { setN(value); from.current = value; return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (value - a) * e);
      setN(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, still]);
  return <span className="tnum">{n.toLocaleString()}</span>;
}

/** Children reveal in order: each direct child gets --i for a staggered CSS entrance. */
export function Stagger({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`k-stagger ${className}`}>
      {Children.toArray(children).filter(Boolean).map((c, i) => <div key={i} className="k-stagger-item" style={{ ["--i" as string]: i }}>{c}</div>)}
    </div>
  );
}

/**
 * A 1-bit dissolve: when `k` changes, a canvas over the content fills with
 * Bayer-ordered cells in the panel colour and clears them by threshold, so the
 * new state appears through the dither (240ms).
 */
export function DitherDissolve({ k, children, className = "", pixel = 4 }: { k: string | number; children: ReactNode; className?: string; pixel?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const c = ref.current;
    if (!c || reduced()) return;
    const g = c.getContext("2d");
    if (!g) return;
    const w = Math.ceil(c.clientWidth / pixel), h = Math.ceil(c.clientHeight / pixel);
    c.width = w; c.height = h;
    const col = getComputedStyle(c).getPropertyValue("--panel").trim() || "#0c0b0a";
    const t0 = performance.now(); let raf = 0;
    const draw = (t: number) => {
      const p = Math.min(1, (t - t0) / 240);
      g.clearRect(0, 0, w, h); g.fillStyle = col;
      for (let y = 0; y < h; y++) { const row = BAYER[y & 7]; for (let x = 0; x < w; x++) if (row[x & 7] > p) g.fillRect(x, y, 1, 1); }
      if (p < 1) raf = requestAnimationFrame(draw); else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); g.clearRect(0, 0, w, h); };
  }, [k, pixel]);
  return (
    <div className={`k-dissolve ${className}`}>
      {children}
      <canvas ref={ref} aria-hidden="true" className="k-dissolve-fx" />
    </div>
  );
}
