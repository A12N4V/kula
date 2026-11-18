// Shared pieces of the Query views: props, a radio toggle, a symbol picker,
// and a saved value. Frames come from ../widget.
import { useEffect, useRef, useState, type ComponentType } from "react";
import { api, type Node } from "../../api";
import type { Go, Target } from "../../nav";
import { Icon, Kind } from "../../ui";
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

/** Search the map and pick one symbol. */
export function SymbolPicker({ value, pick, placeholder = "Find a symbol" }: { value: Node | null; pick: (n: Node) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Node[]>([]);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = q.trim();
    if (!s) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => api.search(s).then((h) => { if (live) { setHits(h.filter((n) => n.kind !== "package" && !/^(dep|pkg):/.test(n.path)).slice(0, 12)); setAt(0); } }).catch(() => {}), 120);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as globalThis.Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);
  const choose = (n: Node) => { pick(n); setQ(""); setOpen(false); };
  return (
    <div className="qv-pick" ref={box}>
      <Icon.search />
      <input className="input qv-pick-in" value={q} placeholder={value ? value.name : placeholder} aria-label={placeholder}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && hits[at]) { e.preventDefault(); choose(hits[at]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && hits.length > 0 && (
        <div className="qv-pick-menu" role="listbox">
          {hits.map((n, i) => (
            <div key={n.id} role="option" aria-selected={i === at} className={`w-row${i === at ? " on" : ""}`} onMouseEnter={() => setAt(i)} onMouseDown={(e) => { e.preventDefault(); choose(n); }}>
              <Kind kind={n.kind} community={n.community} size={14} />
              <span className="grow mono">{n.name}</span>
              <span className="dim mono">{n.path}:{n.start_line}</span>
            </div>
          ))}
        </div>
      )}
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
