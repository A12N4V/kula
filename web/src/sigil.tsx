import type { ReactElement } from "react";

// Sigils: a geometric mark for every agent, generated – no vendor logos.
//
// A sigil is decoded from one integer in mixed radix, so every index below
// SIGILS is a distinct combination (not a random draw that might repeat):
//   frame (6) × motif (8) × symmetry (4) × core (2) = 384 marks.
// `sigilFor(name)` hashes a name onto that space with a stride coprime to it,
// so a team's agents spread out instead of clustering on similar marks.
// Everything is drawn in currentColor plus --accent, so it follows the theme.

const FRAMES = 6, MOTIFS = 8, SYMS = [3, 4, 5, 6], CORES = 2;
export const SIGILS = FRAMES * MOTIFS * SYMS.length * CORES;

const C = 12; // centre of the 24×24 box
const f = (n: number) => +n.toFixed(2);
const polar = (r: number, a: number): [number, number] => [f(C + r * Math.sin(a)), f(C - r * Math.cos(a))];
const poly = (n: number, r: number, rot = 0) =>
  Array.from({ length: n }, (_, i) => polar(r, rot + (i * 2 * Math.PI) / n).join(",")).join(" ");

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The sigil index for a name: stable, spread evenly over all SIGILS. */
export function sigilFor(name: string) {
  return (hash(name.toLowerCase()) * 101) % SIGILS; // 101 is coprime to 384
}

function frame(k: number) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" as const };
  switch (k) {
    case 0: return <circle cx={C} cy={C} r={10.5} {...p} />;
    case 1: return <rect x={2} y={2} width={20} height={20} rx={4} {...p} />;
    case 2: return <polygon points={poly(6, 10.8)} {...p} />;
    case 3: return <polygon points={poly(4, 11)} {...p} />;
    case 4: return <polygon points={poly(3, 11.2, Math.PI)} transform={`translate(0 1.4)`} {...p} />;
    default: return <circle cx={C} cy={C} r={10.5} {...p} strokeDasharray="2.2 1.6" />;
  }
}

function motif(k: number, n: number) {
  const acc = { fill: "var(--accent)" };
  const line = { stroke: "var(--accent)", strokeWidth: 1.4, strokeLinecap: "round" as const, fill: "none" };
  const step = (2 * Math.PI) / n;
  const each = (draw: (a: number, i: number) => ReactElement) => Array.from({ length: n }, (_, i) => draw(i * step, i));
  switch (k) {
    case 0: // dots on a ring
      return each((a, i) => { const [x, y] = polar(6, a); return <circle key={i} cx={x} cy={y} r={1.5} {...acc} />; });
    case 1: // spokes
      return each((a, i) => { const [x1, y1] = polar(2.5, a); const [x2, y2] = polar(7, a); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} {...line} />; });
    case 2: // petals
      return each((a, i) => <ellipse key={i} cx={C} cy={C - 4.2} rx={1.5} ry={3.4} transform={`rotate(${f((a * 180) / Math.PI)} ${C} ${C})`} {...acc} />);
    case 3: // inner polygon + vertex dots
      return [<polygon key="p" points={poly(n, 6)} {...line} />, ...each((a, i) => { const [x, y] = polar(6, a); return <circle key={i} cx={x} cy={y} r={1.1} {...acc} />; })];
    case 4: // chevrons pointing out
      return each((a, i) => <polyline key={i} points={`${C - 1.8},${C - 4.5} ${C},${C - 6.8} ${C + 1.8},${C - 4.5}`} transform={`rotate(${f((a * 180) / Math.PI)} ${C} ${C})`} {...line} />);
    case 5: // arcs (a broken ring)
      return each((a, i) => {
        const [x1, y1] = polar(6.2, a + step * 0.12); const [x2, y2] = polar(6.2, a + step * 0.7);
        return <path key={i} d={`M${x1} ${y1} A6.2 6.2 0 0 1 ${x2} ${y2}`} {...line} />;
      });
    case 6: // orbit: small squares
      return each((a, i) => { const [x, y] = polar(6.4, a); return <rect key={i} x={x - 1.3} y={y - 1.3} width={2.6} height={2.6} transform={`rotate(${f((a * 180) / Math.PI)} ${x} ${y})`} {...acc} />; });
    default: // star
      return [<polygon key="s" points={Array.from({ length: n * 2 }, (_, i) => polar(i % 2 ? 2.8 : 7, (i * Math.PI) / n).join(",")).join(" ")} {...line} />];
  }
}

/** A generated agent mark. `seed` is a name or an index below SIGILS. */
export function Sigil({ seed, size = 24, title, className }: { seed: string | number; size?: number; title?: string; className?: string }) {
  let i = typeof seed === "number" ? ((seed % SIGILS) + SIGILS) % SIGILS : sigilFor(seed);
  const core = i % CORES; i = Math.floor(i / CORES);
  const n = SYMS[i % SYMS.length]; i = Math.floor(i / SYMS.length);
  const m = i % MOTIFS; i = Math.floor(i / MOTIFS);
  const fr = i % FRAMES;
  return (
    <svg className={`sigil ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {frame(fr)}
      {/* a triangle's incircle is small: shrink the inside onto its centroid */}
      <g transform={fr === 4 ? `translate(${C} ${C + 1.4}) scale(0.62) translate(${-C} ${-C})` : undefined}>
        {motif(m, n)}
        {core ? <circle cx={C} cy={C} r={1.8} fill="currentColor" /> : <circle cx={C} cy={C} r={1.6} fill="none" stroke="currentColor" strokeWidth={1} />}
      </g>
    </svg>
  );
}
