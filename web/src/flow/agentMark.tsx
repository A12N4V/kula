// Each agent's own mark: a damped harmonograph whose frequencies, phases and
// damping come from a hash of the agent's name, drawn in the agent's own
// two-hue gradient. The same gradient runs along every wire the agent owns,
// so an agent's reach reads at a glance and no two agents look alike.
//
// Marks are colour-coded by kind (fuse 5): agents read blue, teams read
// orange, research reads green–teal. The hue pair is still hashed per name,
// but inside the kind's band, so marks stay unique yet read as a kind at a
// glance. A saved logo (the logo studio, `logo_save`) replaces the hashed
// mark wherever that name is shown.

/** The mark's kind – which colour family it belongs to. */
export type MarkFamily = "agent" | "team" | "research";

/** Hue bands per family: agent blue (190–250), team orange (15–45),
 *  research green–teal (120–170). */
const BANDS: Record<MarkFamily, [number, number]> = { agent: [190, 250], team: [15, 45], research: [120, 170] };

const hash = (s: string, seed = 0) => { let h = 2166136261 ^ seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The mark's gradient: two hues hashed per name inside the family's band,
 *  kept far enough apart to read as a two-colour flow. */
export function agentGradient(name: string, family: MarkFamily = "agent"): [string, string] {
  const [lo, hi] = BANDS[family];
  const w = hi - lo;
  const h1 = lo + (hash(name) % w);
  let h2 = lo + (hash(name, 7) % w);
  if (Math.abs(h2 - h1) < 25) h2 = lo + Math.min(w - 1, ((h2 - lo) + 30) % w);
  return [`oklch(0.78 0.15 ${h1})`, `oklch(0.70 0.17 ${h2})`];
}

/** A safe id for SVG defs. */
export const svgId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

const RATIOS: [number, number][] = [[2, 3], [3, 4], [3, 5], [4, 5], [1, 2], [2, 5], [5, 6]];

type Pt = [x: number, y: number, depth: number];

/** Overrides for a drawn mark – all default to the name-hash values, so a
 *  mark with no opts is identical to the plain hashed one. */
export interface MarkOpts {
  /** Reroll: shifts every hash, a different curve from the same name. */
  seed?: number;
  /** Camera yaw (radians) – the studio's yaw dial. */
  yaw?: number;
  /** Camera pitch (radians) – the studio's pitch dial. */
  pitch?: number;
  /** Project flat (2) or with depth (3, the default). */
  dims?: 2 | 3;
}

/** A three-pendulum harmonograph traced in 3D – x, y and z each a pair of
 *  damped sines with frequencies, phases and damping from the name – then
 *  turned to one angle (yaw and pitch, from the name or the opts) and
 *  projected with a light perspective into a 0–24 box. depth runs 0 (back)
 *  to 1 (front). */
export function harmonograph3d(name: string, n = 900, opts?: MarkOpts): Pt[] {
  const seed = opts?.seed ?? 0;
  const r = RATIOS[hash(name, 1 + seed) % RATIOS.length], rz = RATIOS[hash(name, 8 + seed) % RATIOS.length];
  const detune = ((hash(name, 2 + seed) % 100) / 100) * 0.03;
  const ph = (k: number) => (hash(name, k + seed) % 628) / 100;
  const d = 0.012 + ((hash(name, 5 + seed) % 100) / 100) * 0.014;
  const yaw = opts?.yaw ?? ph(9), pitch = opts?.pitch ?? 0.35 + ((hash(name, 10) % 70) / 100);
  const flat = opts?.dims === 2;
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const raw: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 150, e = Math.exp(-d * t);
    const x = e * (0.6 * Math.sin(r[0] * t + ph(3)) + 0.4 * Math.sin((r[1] + detune) * t + ph(11)));
    const y = e * (0.6 * Math.sin((r[1] - detune) * t + ph(4)) + 0.4 * Math.sin(r[0] * t + ph(12)));
    const z = e * (0.6 * Math.sin((rz[0] + detune / 2) * t + ph(13)) + 0.4 * Math.sin(rz[1] * t + ph(14)));
    // yaw about y, then pitch about x – one camera, one angle
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y1 = flat ? y : cp * y - sp * z1;
    const z2 = sp * y + cp * z1;
    const f = flat ? 1 : 1 / (1 - 0.28 * z2);
    raw.push([x1 * f, y1 * f, flat ? 0.5 : z2]);
  }
  let [x0, x9, y0, y9, z0, z9] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y, z] of raw) { x0 = Math.min(x0, x); x9 = Math.max(x9, x); y0 = Math.min(y0, y); y9 = Math.max(y9, y); z0 = Math.min(z0, z); z9 = Math.max(z9, z); }
  const k = 21 / Math.max(x9 - x0, y9 - y0, 1e-6), ox = 12 - ((x0 + x9) / 2) * k, oy = 12 - ((y0 + y9) / 2) * k;
  return raw.map(([x, y, z]) => [ox + x * k, oy + y * k, (z - z0) / Math.max(z9 - z0, 1e-6)]);
}

/** The pose a name's mark starts at – the studio's dials open on it, so the
 *  preview matches the hashed mark until the user turns a dial. */
export function markPose(name: string): { yaw: number; pitch: number } {
  return { yaw: (hash(name, 9) % 628) / 100, pitch: 0.35 + ((hash(name, 10) % 70) / 100) };
}

const fmt = (p: Pt[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");

/** The harmonograph as one path in a 0–24 box, unique per name. */
export function harmonographPath(name: string, n = 420, opts?: MarkOpts): string {
  return fmt(harmonograph3d(name, n, opts));
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
export function harmonographSegments(name: string, n = 2400, per = 24, family: MarkFamily = "agent", opts?: MarkOpts): { d: string; stroke: string; opacity: number }[] {
  const pts = harmonograph3d(name, n, opts);
  const [a, b] = agentGradient(name, family).map(oklch);
  const out = [];
  for (let i = 0; i < pts.length - 1; i += per) {
    const seg = pts.slice(i, Math.min(i + per + 1, pts.length));
    const depth = seg.reduce((m, p) => m + p[2], 0) / seg.length;
    out.push({ d: fmt(seg), stroke: flowColor(a, b, i / pts.length, depth), opacity: 0.45 + 0.55 * depth });
  }
  return out;
}

// Saved logos. One module-level cache keyed `kind:name`; a mark asks for its
// saved logo and renders that instead of the hashed curve once the list is
// in. The cache is filled by one GET /api/agent/logos per page load, and a
// save updates it at once, so every mark of that name flips together.

export interface LogoParams { dims: 2 | 3; yaw: number; pitch: number; density: number; seed: number }
export interface LogoEntry { kind: MarkFamily; name: string; svg: string; params: LogoParams }

const logoCache = new Map<string, LogoEntry>();
const logoMissing = new Set<string>();
const logoWaiters = new Set<() => void>();
let logoFetched = false;

const logoKey = (kind: MarkFamily, name: string) => `${kind}:${name}`;

/** The saved logo for a kind and name, once the list has resolved; null
 *  means "not saved" (or not yet known). */
export function getLogo(kind: MarkFamily, name: string): LogoEntry | null {
  const k = logoKey(kind, name);
  if (logoCache.has(k)) return logoCache.get(k)!;
  if (!logoFetched && !logoMissing.has("all")) fetchLogos();
  return null;
}

async function fetchLogos() {
  if (logoFetched) return;
  logoFetched = true;
  try {
    const r = await fetch("/api/agent/logos", { headers: { "x-kula-token": sessionStorage.getItem("kula.token") ?? "" } });
    if (!r.ok) throw new Error(String(r.status));
    for (const e of await r.json() as LogoEntry[]) if (e && e.kind && e.name && e.svg) logoCache.set(logoKey(e.kind, e.name), e);
  } catch { /* offline or before B2 – the hashed marks stay */ }
  logoMissing.add("all");
  for (const w of logoWaiters) w();
}

/** A save (from the studio) flips every mark of that name at once. */
export function putLogo(entry: LogoEntry) {
  logoCache.set(logoKey(entry.kind, entry.name), entry);
  for (const w of logoWaiters) w();
}

import { useEffect, useState } from "react";

/** React on the saved-logo cache: re-renders the mark when its logo arrives
 *  or changes. */
export function useLogo(kind: MarkFamily, name: string): LogoEntry | null {
  const [v, setV] = useState<LogoEntry | null>(() => logoCache.get(logoKey(kind, name)) ?? null);
  useEffect(() => {
    const cur = getLogo(kind, name);
    if (cur !== v) setV(cur);
    const w = () => setV(logoCache.get(logoKey(kind, name)) ?? null);
    logoWaiters.add(w);
    return () => { logoWaiters.delete(w); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, name]);
  return v;
}

/** The saved logo's svg at `size`, or null when there is none. */
export function SavedLogo({ entry, size }: { entry: LogoEntry; size: number }) {
  return <span style={{ display: "inline-flex", width: size, height: size }} className="logo-saved" dangerouslySetInnerHTML={{ __html: entry.svg }} />;
}

export function AgentHarmonograph({ name, size = 28, family = "agent", kind }: { name: string; size?: number; family?: MarkFamily; kind?: MarkFamily }) {
  const logo = useLogo(kind ?? family, name);
  if (logo) return <SavedLogo entry={logo} size={size} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-figure data-testid={`agent-hg-${name}`}>
      {harmonographSegments(name, 360, 12, family).map((g, i) => (
        <path key={i} d={g.d} fill="none" stroke={g.stroke} strokeOpacity={g.opacity} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
