// Encodings for the graph: one variable per channel.
//   hue      – directory (default), cluster, kind or churn, chosen in Settings
//   size     – degree
//   shape    – hubs become square tiles carrying a kind/language glyph
//   ground   – directory territories behind the nodes

import type { ColorBy, Settings } from "./settings";

export function isLight() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "light" : window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}

// Nine categorical hues after Tableau 10 (tested for mutual distinctness), lifted
// for the dark theme. Grey is held back for "everything else".
const DARK = ["#6f9bd1", "#f0994a", "#6fb466", "#e66a6c", "#bf8cb2", "#7fc4be", "#e9cd5a", "#ffa7b1", "#b08a72"];
const LIGHT = ["#4e79a7", "#e0781a", "#4e9a45", "#d14f51", "#9c6590", "#4f9e98", "#b3931a", "#e07f8b", "#8a664f"];
const REST = { dark: "#8e8a85", light: "#9a948b" };
export const palette = () => (isLight() ? LIGHT : DARK);
export const hue = (i: number) => { const p = palette(); return p[((i % p.length) + p.length) % p.length]; };
/** Palette slot `i`, or grey once the categorical hues run out. */
export const rankHue = (i: number) => (i < palette().length ? palette()[i] : isLight() ? REST.light : REST.dark);

const KIND_DARK: Record<string, string> = { function: "#6aa5dc", method: "#5fbdbb", class: "#b597df", interface: "#d8bf62", file: "#9a968f" };
const KIND_LIGHT: Record<string, string> = { function: "#2f6db0", method: "#1d8583", class: "#7f56b3", interface: "#8f720c", file: "#7a756c" };
export const kindColor = (k: string) => (isLight() ? KIND_LIGHT : KIND_DARK)[k] ?? "#888888";

/** 0 → neutral, 1 → hot. Log-scaled by the caller. */
export function churnColor(t: number) {
  const stops = isLight()
    ? [[176, 170, 160], [214, 160, 40], [200, 70, 40]]
    : [[92, 90, 88], [226, 178, 70], [240, 104, 82]];
  const u = Math.max(0, Math.min(1, t)) * 2;
  const [a, b] = u < 1 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const f = u < 1 ? u : u - 1;
  return "#" + a.map((x, i) => Math.round(x + (b[i] - x) * f).toString(16).padStart(2, "0")).join("");
}

export const GLYPH: Record<string, string> = { function: "ƒ", method: "m", class: "C", interface: "I", file: "·" };
export const LANG_GLYPH: Record<string, string> = { typescript: "TS", tsx: "TX", javascript: "JS", python: "PY", rust: "RS", go: "GO" };

/** Directory of `path`, cut to `depth` segments ("src/index/mod.rs", 1 → "src"). */
export function dirOf(path: string, depth: number) {
  const parts = path.split("/");
  parts.pop();
  return parts.length ? parts.slice(0, depth).join("/") : ".";
}

export interface Groups {
  /** Fixed depth, or 0 when the split is adaptive. */
  depth: number;
  /** Directory → stable index into the palette (largest first). */
  index: Map<string, number>;
  /** Directory → member count, largest first. */
  sizes: [string, number][];
  of: (path: string) => string;
  /** Display name: "src/index/" for a directory, "src/server.rs" for a file split out of one. */
  label: (key: string) => string;
}

const dirname = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "." : p.slice(0, i); };
const inside = (dir: string, prefix: string) => prefix === "." || dir === prefix || dir.startsWith(prefix + "/");

/**
 * Directory territories. Fixed depth cuts every path at `depth` segments.
 * Adaptive (0) starts from the top-level directories and keeps splitting the
 * largest one into its subdirectories while that makes the map more even –
 * so a repo that is 60% `src/` shows `src/index`, `src/server`… instead.
 */
export function groupDirs(paths: string[], depth: number): Groups {
  let of: (p: string) => string;
  const byFile = new Set<string>();
  if (depth > 0) {
    of = (p) => dirOf(p, depth);
  } else {
    const dirs = paths.map(dirname);
    let prefixes = [...new Set(dirs.map((d) => (d === "." ? "." : d.split("/")[0])))];
    const owner = (d: string) => {
      let best = ".";
      for (const p of prefixes) if (inside(d, p) && (best === "." || p.length > best.length)) best = p;
      return best;
    };
    const MAX = 12;
    for (let guard = 0; guard < 24; guard++) {
      const count = new Map<string, number>();
      for (const d of dirs) { const o = owner(d); count.set(o, (count.get(o) ?? 0) + 1); }
      // Split the largest group that dominates (≥ 30%) and still has subdirectories.
      let split = false;
      for (const [big, n] of [...count].sort((a, b) => b[1] - a[1])) {
        if (n / Math.max(1, dirs.length) < 0.3) break;
        const kids = new Set<string>();
        for (const d of dirs) {
          if (owner(d) !== big || d === big) continue;
          const rest = big === "." ? d : d.slice(big.length + 1);
          kids.add((big === "." ? "" : big + "/") + rest.split("/")[0]);
        }
        const direct = dirs.some((d) => d === big);
        const after = prefixes.length - 1 + kids.size + (direct ? 1 : 0);
        if (kids.size === 0 || kids.size + (direct ? 1 : 0) < 2 || after > MAX) continue;
        prefixes = prefixes.filter((p) => p !== big || direct).concat([...kids]);
        split = true;
        break;
      }
      if (!split) break;
    }
    // A directory that still dominates but has no subdirectories left (a flat
    // `src/`) splits into its files – in flat layouts, files are the modules.
    const count = new Map<string, number>();
    for (const d of dirs) { const o = owner(d); count.set(o, (count.get(o) ?? 0) + 1); }
    for (const [big, n] of [...count].sort((a, b) => b[1] - a[1])) {
      if (n / Math.max(1, dirs.length) < 0.3) break;
      const files = new Set(paths.filter((p) => owner(dirname(p)) === big && dirname(p) === big));
      if (files.size >= 2 && prefixes.length - 1 + files.size <= MAX + 4) byFile.add(big);
    }
    of = (p) => { const o = owner(dirname(p)); return byFile.has(o) && dirname(p) === o ? p : o; };
  }
  const counts = new Map<string, number>();
  for (const p of paths) { const k = of(p); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const sizes = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const memo = new Map<string, string>();
  const cached = (p: string) => { let v = memo.get(p); if (v === undefined) memo.set(p, (v = of(p))); return v; };
  const files = new Set(paths.filter((p) => byFile.has(dirname(p))));
  return { depth, index: new Map(sizes.map(([k], i) => [k, i])), sizes, of: cached, label: (k) => (files.has(k) ? k : k === "." ? "./" : `${k}/`) };
}

export function dirColor(dir: string, groups: Groups, s: Settings) {
  return s.dirColors[dir] ?? rankHue(groups.index.get(dir) ?? 99);
}

export interface Colorer {
  node: (n: { kind: string; path: string; community: number }) => string;
  mode: ColorBy;
}

export function makeColorer(s: Settings, groups: Groups, churn: Record<string, number>): Colorer {
  // Absolute scale with a floor: 20+ commits in 90 days is hot in any repo, so a
  // young repo where everything changed once doesn't light up uniformly.
  const max = Math.max(20, ...Object.values(churn));
  switch (s.colorBy) {
    case "cluster":
      return { mode: "cluster", node: (n) => hue(n.community) };
    case "kind":
      return { mode: "kind", node: (n) => kindColor(n.kind) };
    case "churn":
      return { mode: "churn", node: (n) => churnColor(Math.log1p(churn[n.path] ?? 0) / Math.log1p(max)) };
    default:
      return { mode: "directory", node: (n) => dirColor(groups.of(n.path), groups, s) };
  }
}

/** Colour `c` at opacity `a`, pre-blended onto `bg` (WebGL edge programs ignore alpha). */
export function blend(c: string, a: number, bg: string) {
  const hex = (x: string) => {
    const n = parseInt(x.replace("#", "").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (!c.startsWith("#")) return c;
  const [r, g, b] = hex(c);
  const [R, G, B] = bg.startsWith("#") ? hex(bg) : [8, 8, 11];
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`;
}
