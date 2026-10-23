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

/** The harmonograph path in a 0–24 box, unique per name. */
export function harmonographPath(name: string): string {
  const r = RATIOS[hash(name, 1) % RATIOS.length];
  const detune = ((hash(name, 2) % 100) / 100) * 0.04;
  const p1 = ((hash(name, 3) % 628) / 100), p2 = ((hash(name, 4) % 628) / 100);
  const d = 0.018 + ((hash(name, 5) % 100) / 100) * 0.02;
  const pts: string[] = [];
  for (let i = 0; i <= 320; i++) {
    const t = i * 0.12, decay = Math.exp(-d * t);
    const x = 12 + 10 * decay * (0.62 * Math.sin(r[0] * t + p1) + 0.38 * Math.sin((r[1] + detune) * t));
    const y = 12 + 10 * decay * (0.62 * Math.sin((r[1] - detune) * t + p2) + 0.38 * Math.sin(r[0] * t + p1 / 2));
    pts.push(`${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join("");
}

export function AgentHarmonograph({ name, size = 28 }: { name: string; size?: number }) {
  const [a, b] = agentGradient(name);
  const id = `hg-${svgId(name)}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-figure data-testid={`agent-hg-${name}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <path d={harmonographPath(name)} fill="none" stroke={`url(#${id})`} strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
