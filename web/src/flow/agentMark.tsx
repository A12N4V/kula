// Each agent's own mark: a damped harmonograph whose frequencies, phases and
// damping come from a hash of the agent's name, drawn in the agent's own
// two-hue gradient. The same gradient runs along every wire the agent owns,
// so an agent's reach reads at a glance and no two agents look alike.

const hash = (s: string, seed = 0) => { let h = 2166136261 ^ seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The agent's gradient: two hues ~110–170° apart, from its name. */
export function agentGradient(name: string): [string, string] {
  const h1 = hash(name) % 360;
  const h2 = (h1 + 110 + (hash(name, 7) % 60)) % 360;
  return [`oklch(0.78 0.15 ${h1})`, `oklch(0.70 0.17 ${h2})`];
}

/** A safe id for SVG defs. */
export const svgId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

const RATIOS: [number, number][] = [[2, 3], [3, 4], [3, 5], [4, 5], [1, 2], [2, 5], [5, 6]];

type Pt = [x: number, y: number, depth: number];

/** A three-pendulum harmonograph traced in 3D – x, y and z each a pair of
 *  damped sines with frequencies, phases and damping from the name – then
 *  turned to one fixed angle (also from the name) and projected with a light
 *  perspective into a 0–24 box. depth runs 0 (back) to 1 (front). */
export function harmonograph3d(name: string, n = 900): Pt[] {
  const r = RATIOS[hash(name, 1) % RATIOS.length], rz = RATIOS[hash(name, 8) % RATIOS.length];
  const detune = ((hash(name, 2) % 100) / 100) * 0.03;
  const ph = (k: number) => (hash(name, k) % 628) / 100;
  const d = 0.012 + ((hash(name, 5) % 100) / 100) * 0.014;
  const yaw = ph(9), pitch = 0.35 + ((hash(name, 10) % 70) / 100);
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const raw: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 150, e = Math.exp(-d * t);
    const x = e * (0.6 * Math.sin(r[0] * t + ph(3)) + 0.4 * Math.sin((r[1] + detune) * t + ph(11)));
    const y = e * (0.6 * Math.sin((r[1] - detune) * t + ph(4)) + 0.4 * Math.sin(r[0] * t + ph(12)));
    const z = e * (0.6 * Math.sin((rz[0] + detune / 2) * t + ph(13)) + 0.4 * Math.sin(rz[1] * t + ph(14)));
    // yaw about y, then pitch about x – one camera, one angle
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y1 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    const f = 1 / (1 - 0.28 * z2);
    raw.push([x1 * f, y1 * f, z2]);
  }
  let [x0, x9, y0, y9, z0, z9] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y, z] of raw) { x0 = Math.min(x0, x); x9 = Math.max(x9, x); y0 = Math.min(y0, y); y9 = Math.max(y9, y); z0 = Math.min(z0, z); z9 = Math.max(z9, z); }
  const k = 21 / Math.max(x9 - x0, y9 - y0, 1e-6), ox = 12 - ((x0 + x9) / 2) * k, oy = 12 - ((y0 + y9) / 2) * k;
  return raw.map(([x, y, z]) => [ox + x * k, oy + y * k, (z - z0) / Math.max(z9 - z0, 1e-6)]);
}

const fmt = (p: Pt[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");

/** The harmonograph as one path in a 0–24 box, unique per name. */
export function harmonographPath(name: string, n = 420): string {
  return fmt(harmonograph3d(name, n));
}

const oklch = (c: string) => c.match(/[\d.]+/g)!.map(Number) as [number, number, number];

/** The colour at `s` (0–1) along the curve: the gradient's hues flow along
 *  the trace (out to a third hue and back), and lightness follows depth so
 *  the near loops read in front. */
function flowColor(a: [number, number, number], b: [number, number, number], s: number, depth: number) {
  const dh = ((b[2] - a[2] + 540) % 360) - 180;
  const w = 0.5 - 0.5 * Math.cos(s * Math.PI * 3); // a → b → a → b along the flow
  const h = (a[2] + dh * w + 360) % 360;
  const l = 0.58 + 0.26 * depth, c = a[1] + (b[1] - a[1]) * w;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/** The harmonograph as short segments, each in its own flow colour. */
export function harmonographSegments(name: string, n = 2400, per = 24): { d: string; stroke: string; opacity: number }[] {
  const pts = harmonograph3d(name, n);
  const [a, b] = agentGradient(name).map(oklch);
  const out = [];
  for (let i = 0; i < pts.length - 1; i += per) {
    const seg = pts.slice(i, Math.min(i + per + 1, pts.length));
    const depth = seg.reduce((m, p) => m + p[2], 0) / seg.length;
    out.push({ d: fmt(seg), stroke: flowColor(a, b, i / pts.length, depth), opacity: 0.45 + 0.55 * depth });
  }
  return out;
}

export function AgentHarmonograph({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-figure data-testid={`agent-hg-${name}`}>
      {harmonographSegments(name, 360, 12).map((g, i) => (
        <path key={i} d={g.d} fill="none" stroke={g.stroke} strokeOpacity={g.opacity} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
