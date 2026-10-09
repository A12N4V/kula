// Harmonographs: an agent's mark is the figure two damped pendulums draw.
//
//   x(t) = e^(-d·t) · (sin(f1·t + p1) + sin(f2·t + p2)) / 2
//   y(t) = e^(-d·t) · (sin(f3·t + p3) + sin(f4·t + p4)) / 2
//
// The name seeds near-integer frequency ratios (so the figure closes into a
// readable knot rather than noise), a slight detune, the phases and the
// damping. Same name, same figure; the space of figures is effectively
// unbounded. `live` makes the pen keep swinging: the figure redraws itself
// while the agent works, and holds still under prefers-reduced-motion.

const RATIOS = [1, 2, 3, 4, 5, 3 / 2, 4 / 3, 5 / 4, 5 / 3, 7 / 4];

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const cache = new Map<string, string>();

/** The figure for a seed, as an SVG path in a 24×24 box; fewer `turns` read better small. */
export function harmonograph(seed: string, turns = 14): string {
  const steps = turns * 64;
  const hit = cache.get(`${seed}|${turns}`);
  if (hit) return hit;
  const r = rng(seed);
  // x and y each swing near a small whole-number ratio (1:2, 2:3, 3:4 ...), a
  // second, weaker pendulum adds the lobes, a hair of detune makes the figure
  // precess, and damping winds it inward to the centre
  const pairs = [[1, 2], [2, 3], [3, 4], [1, 3], [3, 5], [2, 5], [1, 1], [4, 5]];
  const [a1, b1] = pairs[Math.floor(r() * pairs.length)];
  const [a2, b2] = pairs[Math.floor(r() * pairs.length)];
  const det = () => (r() - 0.5) * 0.03;
  const f = [a1 + det(), b1 + det(), a2 + det(), b2 + det()];
  const p = Array.from({ length: 4 }, () => r() * 2 * Math.PI);
  // keep x and y a quarter-swing apart, or a 1:1 pair collapses to a line
  p[1] = p[0] + Math.PI / 2 + (r() - 0.5) * 0.8;
  const w = 0.2 + r() * 0.25; // weight of the second pendulum
  const T = 2 * Math.PI * turns;
  const d = (0.8 + r() * 0.6) / T; // ends at a third to a half of the first swing
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T;
    const e = Math.exp(-d * t);
    pts.push([
      e * ((1 - w) * Math.sin(f[0] * t + p[0]) + w * Math.sin(f[2] * t + p[2])),
      e * ((1 - w) * Math.sin(f[1] * t + p[1]) + w * Math.sin(f[3] * t + p[3])),
    ]);
  }
  // fit the figure to the box, keeping its proportions
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = 21 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const ox = 12 - ((x0 + x1) / 2) * k, oy = 12 - ((y0 + y1) / 2) * k;
  let s = "";
  pts.forEach(([x, y], i) => { s += `${i ? "L" : "M"}${(ox + x * k).toFixed(2)} ${(oy + y * k).toFixed(2)}`; });
  cache.set(`${seed}|${turns}`, s);
  return s;
}

/** An agent's mark. `live` keeps the pendulums swinging. */
export function Harmonograph({ seed, size = 24, live, className }: { seed: string; size?: number; live?: boolean; className?: string }) {
  return (
    <svg data-figure="harmonograph" className={`hgraph ${live ? "live" : ""} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={harmonograph(seed, size < 24 ? 4 : size < 48 ? 8 : 14)} pathLength={1} fill="none" stroke="var(--accent)" strokeWidth={size < 20 ? 0.8 : 1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={0.95} />
    </svg>
  );
}
