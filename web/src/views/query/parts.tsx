// Shared pieces of the Query views: props, a radio toggle, a symbol picker,
// and a saved value. Frames come from ../widget.
import { useState, type ComponentType } from "react";
import type { Go, Target } from "../../nav";
import "./query.css";

export { IB, WEmpty, Widget } from "../widget";

export type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

/** A value kept in localStorage; private mode just forgets it. */
export function useSaved<T extends string | number>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); if (s !== null) return (typeof def === "number" ? Number(s) : s) as T; } catch {}
    return def;
  });
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, String(x)); } catch {} }];
}

/** A radio toggle (.seg): toggles over tabs. */
export function Seg<T extends string | number>({ label, value, set, opts, className }: {
  label: string; value: T; set: (v: T) => void; opts: { id: T; label: string; icon?: ComponentType }[]; className?: string;
}) {
  return (
    <div className={`seg qv-seg${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={label}>
      {opts.map((o) => (
        <button key={String(o.id)} role="radio" aria-label={o.label} aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => set(o.id)}>
          {o.icon && <o.icon />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The last path segment and the folder it sits in. */
export const splitPath = (p: string) => { const i = p.lastIndexOf("/"); return { base: p.slice(i + 1), dir: i > 0 ? p.slice(0, i) : "" }; };

/** Group items by a key, keeping first seen order. */
export function groupBy<T, K>(xs: T[], key: (x: T) => K): [K, T[]][] {
  const m = new Map<K, T[]>();
  for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return [...m];
}
