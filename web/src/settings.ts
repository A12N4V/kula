// Viewer preferences: one small store, persisted per browser, read with a hook.

import { useSyncExternalStore } from "react";

export type ColorBy = "directory" | "cluster" | "kind" | "churn";

export interface Settings {
  theme: "system" | "dark" | "light";
  density: "compact" | "comfortable";
  colorBy: ColorBy;
  /** Directory depth used for territories and colours; 0 = pick automatically. */
  dirDepth: 0 | 1 | 2 | 3;
  territories: boolean;
  hubIcons: boolean;
  /** Share of nodes (by degree) drawn as hub tiles. */
  hubShare: number;
  labels: "few" | "normal" | "many";
  curved: boolean;
  imports: boolean;
  flow: boolean;
  /** User colour overrides, keyed by directory path. */
  dirColors: Record<string, string>;
}

export const DEFAULTS: Settings = {
  theme: "system",
  density: "compact",
  colorBy: "directory",
  dirDepth: 0,
  territories: true,
  hubIcons: true,
  hubShare: 0.05,
  labels: "normal",
  curved: false,
  imports: true,
  flow: true,
  dirColors: {},
};

const KEY = "kula.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const legacy = localStorage.getItem("kula-theme");
    const s = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    if (!raw && (legacy === "dark" || legacy === "light")) s.theme = legacy;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

/** Theme and density live on <html> so CSS (and canvas code reading CSS vars) sees them before React re-renders. */
function apply(s: Settings) {
  const el = document.documentElement;
  if (s.theme === "system") delete el.dataset.theme; else el.dataset.theme = s.theme;
  el.dataset.density = s.density;
}

let current = load();
apply(current);
const subs = new Set<() => void>();

export const settings = {
  get: () => current,
  set(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    apply(current);
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private window */ }
    subs.forEach((f) => f());
  },
  reset(keys?: (keyof Settings)[]) {
    const patch: Partial<Settings> = {};
    for (const k of keys ?? (Object.keys(DEFAULTS) as (keyof Settings)[])) (patch as any)[k] = DEFAULTS[k];
    settings.set(patch);
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => { subs.delete(f); };
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

// Directories the graph is currently showing, so Settings can offer their colours.
let dirs: { list: [string, number, string][]; depth: number } = { list: [], depth: 0 };
const dirSubs = new Set<() => void>();
export const knownDirs = {
  get: () => dirs,
  set(next: typeof dirs) { dirs = next; dirSubs.forEach((f) => f()); },
  subscribe(f: () => void) { dirSubs.add(f); return () => { dirSubs.delete(f); }; },
};
export const useKnownDirs = () => useSyncExternalStore(knownDirs.subscribe, knownDirs.get);
