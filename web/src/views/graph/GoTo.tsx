// The code canvas search: jump to a file, folder or symbol by name. Cmd+P focuses it.

import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyScore } from "../../nav";
import { Icon, Kind } from "../../ui";
import type { Model, Selection } from "./model";

type Hit = { key: string; label: string; at: string; kind: string; sel: Selection; score: number };

export function GoTo({ m, pick }: { m: Model; pick: (s: Selection) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const hits = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    const out: Hit[] = [];
    const add = (h: Omit<Hit, "score">, hay: string, bonus = 0) => { const sc = fuzzyScore(t, hay); if (sc > 0) out.push({ ...h, score: sc + bonus - hay.length * 0.05 }); };
    for (const d of m.dirs.values()) if (d.parent) add({ key: `d:${d.path}`, label: `${d.name}/`, at: d.path, kind: "dir", sel: { type: "dir", dir: d } }, d.path, 2);
    for (const f of m.files.values()) add({ key: `f:${f.id}`, label: f.name, at: f.path, kind: "file", sel: { type: "file", file: f } }, f.path, 4);
    for (const s of m.syms.values()) add({ key: `s:${s.id}`, label: s.name, at: `${s.file.path}:${s.line}`, kind: s.kind, sel: { type: "sym", sym: s } }, s.name);
    const seen = new Set<string>();
    return out.sort((a, b) => b.score - a.score).filter((h) => !seen.has(h.key) && seen.add(h.key)).slice(0, 12);
  }, [q, m]);
  useEffect(() => setI(0), [q]);

  const go = (h: Hit | undefined) => { if (!h) return; pick(h.sel); setOpen(false); setQ(""); input.current?.blur(); };

  return (
    <div className="ct-goto">
      <label className="ct-goto-box">
        <Icon.search />
        <input ref={input} value={q} placeholder="Go to a file or folder by name" spellCheck={false} aria-label="Go to"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === "Enter") go(hits[i]);
            else if (e.key === "Escape") { setQ(""); input.current?.blur(); }
          }} />
        <kbd>⌘P</kbd>
      </label>
      {open && hits.length > 0 && (
        <div className="ct-goto-list" role="listbox">
          {hits.map((h, n) => (
            <button key={h.key} role="option" aria-selected={n === i} className={n === i ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setI(n)} onClick={() => go(h)}>
              {h.kind === "dir" ? <span className="ct-ico"><Icon.folder /></span> : h.kind === "file" ? <span className="ct-ico"><Icon.file /></span> : <Kind kind={h.kind} size={14} />}
              <span className="ct-goto-label">{h.label}</span>
              <span className="ct-at">{h.at}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
