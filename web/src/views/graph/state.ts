// What the code canvas remembers between visits: which links are on and how
// strong, merged and split per symbol, folded folders, hidden files and the filter. Kept in localStorage.

import { useEffect, useState } from "react";
import { KINDS, type KindId } from "./model";

export type Prefs = {
  on: KindId[];
  strength: Record<KindId, number>;
  bodies: boolean;
  /** kinds whose links split per symbol when zoomed in, and how strong those split links are */
  bodyOn: KindId[];
  bodyStrength: Record<KindId, number>;
  only: boolean;
  shut: string[];
  hidden: string[];
  filter: string;
};

const KEY = "kula.canvas.v2";
/** Calls out and imports are dense, so they start faint; a pick lights them up. */
export const STRENGTH: Record<KindId, number> = { out: 0.12, in: 0.6, imports: 0.08, importers: 0.6, types: 0.3 };
const DEFAULTS: Prefs = {
  on: KINDS.map((k) => k.id),
  strength: { ...STRENGTH },
  bodies: true,
  bodyOn: KINDS.map((k) => k.id),
  bodyStrength: Object.fromEntries(KINDS.map((k) => [k.id, 0.4])) as Record<KindId, number>,
  only: false,
  shut: [],
  hidden: [],
  filter: "",
};

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return raw ? { ...DEFAULTS, ...raw, strength: { ...DEFAULTS.strength, ...raw.strength }, bodyStrength: { ...DEFAULTS.bodyStrength, ...raw.bodyStrength } } : DEFAULTS;
  } catch { return DEFAULTS; }
}

export function usePrefs() {
  const [p, setP] = useState<Prefs>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ } }, [p]);
  const set = (patch: Partial<Prefs>) => setP((x) => ({ ...x, ...patch }));
  return [p, set] as const;
}

export const toggleIn = <T,>(list: T[], v: T, on?: boolean) => {
  const has = list.includes(v);
  const want = on ?? !has;
  return want === has ? list : want ? [...list, v] : list.filter((x) => x !== v);
};
