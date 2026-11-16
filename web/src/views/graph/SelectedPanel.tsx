// Right pane of the code canvas: what is picked, which links to draw and how
// strongly, and the names inside the pick with where each is defined and used.

import { useEffect, useMemo, useState } from "react";
import { Icon, Kind } from "../../ui";
import { KINDS, type KindId, type Link, type Model, type Selection, type Sym } from "./model";
import type { Prefs } from "./state";

type Props = {
  m: Model; sel: Selection; p: Prefs; counts: Record<KindId, number>;
  set: (patch: Partial<Prefs>) => void;
  pick: (s: Selection) => void;
  open: (s: Sym | null) => void;
};

const SHOWN = 400;

export function SelectedPanel({ m, sel, p, counts, set, pick, open }: Props) {
  const [name, setName] = useState<Sym | null>(null);
  useEffect(() => { setName(sel?.type === "sym" ? sel.sym : null); }, [sel]);

  const title = !sel ? m.root.name : sel.type === "dir" ? `${sel.dir.name}/` : sel.type === "file" ? sel.file.name : sel.sym.name;
  const sub = !sel ? "Nothing picked" : sel.type === "dir" ? sel.dir.path || "." : sel.type === "file" ? sel.file.path : `${sel.sym.file.path}:${sel.sym.line}`;
  const names: Sym[] = useMemo(() => {
    if (!sel) return [];
    if (sel.type === "sym") return sel.sym.file.syms;
    if (sel.type === "file") return sel.file.syms;
    const out: Sym[] = [];
    const walk = (d: typeof sel.dir) => { for (const f of d.files) out.push(...f.syms.filter((s) => s.kind !== "method")); d.dirs.forEach(walk); };
    walk(sel.dir);
    return out;
  }, [sel]);

  return (
    <aside className="ct-side" aria-label="Selected">
      <div className="ct-side-head">
        <div className="ct-side-title">
          <span className="ct-cap">Selected</span>
          <b title={title}>{title}</b>
          <span className="ct-sub" title={sub}>{sub}</span>
        </div>
        {sel && sel.type !== "dir" && <button className="btn sm ghost" onClick={() => open(sel.type === "sym" ? sel.sym : null)} title="Open source" aria-label="Open source"><Icon.doc /></button>}
        {sel && <button className="btn sm ghost" onClick={() => pick(null)} aria-label="Clear selection" title="Clear (Esc)"><Icon.close /></button>}
      </div>

      <div className="ct-side-scroll">
        <section className="ct-sec">
          <label className="ct-line">
            <span>Show only connected files</span>
            <button className={`switch${p.only ? " on" : ""}`} role="switch" aria-checked={p.only} aria-label="Show only connected files" disabled={!sel} onClick={() => set({ only: !p.only })}><i /></button>
          </label>
          <label className="ct-line">
            <span>Bodies</span>
            <button className={`switch${p.bodies ? " on" : ""}`} role="switch" aria-checked={p.bodies} aria-label="Show symbol bodies" onClick={() => set({ bodies: !p.bodies })}><i /></button>
          </label>
        </section>

        <section className="ct-sec">
          <h4>Links</h4>
          {KINDS.map((k) => {
            const on = p.on.includes(k.id);
            const idle = !sel && (k.id === "in" || k.id === "importers");
            return (
              <div key={k.id} className={`ct-kind${on ? "" : " off"}${idle ? " idle" : ""}`}>
                <button className="ct-kind-top" aria-pressed={on} onClick={() => set({ on: on ? p.on.filter((x) => x !== k.id) : [...p.on, k.id] })} title={idle ? "Pick something to split in from out" : undefined}>
                  <i className="ct-swatch" style={{ background: `var(${k.color})` }} />
                  <span className={`ct-box${on ? " on" : ""}`}>{on && <Icon.check />}</span>
                  <span className="ct-kind-name">{k.label}</span>
                  <span className="ct-num">{counts[k.id]}</span>
                </button>
                <input type="range" min={0} max={100} value={Math.round((p.strength[k.id] ?? 0.6) * 100)} disabled={!on}
                  aria-label={`${k.label} strength`} style={{ ["--fill" as string]: `${Math.round((p.strength[k.id] ?? 0.6) * 100)}%`, ["--c" as string]: `var(${k.color})` }}
                  onChange={(e) => set({ strength: { ...p.strength, [k.id]: Number(e.target.value) / 100 } })} />
              </div>
            );
          })}
        </section>

        <section className="ct-sec">
          <h4>Names <span className="ct-num">{names.length}</span></h4>
          {!sel && <p className="ct-hint">Pick a file or folder to list its names</p>}
          {names.slice(0, SHOWN).map((s) => (
            <div key={s.id}>
              <button className={`ct-name-row${name === s ? " on" : ""}`} onClick={() => (name === s ? setName(null) : pick({ type: "sym", sym: s }))} title={`${s.file.path}:${s.line}`}>
                <Kind kind={s.kind} size={14} />
                <span className="ct-name-txt">{s.name}</span>
                <span className="ct-num">{(m.into.get(s.id)?.length ?? 0) || ""}</span>
              </button>
              {name === s && <Where m={m} s={s} pick={pick} open={open} />}
            </div>
          ))}
          {names.length > SHOWN && <p className="ct-hint">{names.length - SHOWN} more, use Go to</p>}
        </section>
      </div>
    </aside>
  );
}

/** Where a name is defined, who uses it and what it uses. */
function Where({ m, s, pick, open }: { m: Model; s: Sym; pick: (s: Selection) => void; open: (s: Sym) => void }) {
  const ends = (ls: Link[] | undefined, side: "src" | "dst") => {
    const seen = new Map<number, { label: string; at: string; go: () => void }>();
    for (const l of ls ?? []) {
      const id = l[side];
      if (seen.has(id)) continue;
      const sym = m.syms.get(id), file = m.files.get(id);
      if (sym) seen.set(id, { label: sym.name, at: `${sym.file.path}:${sym.line}`, go: () => pick({ type: "sym", sym }) });
      else if (file) seen.set(id, { label: file.name, at: file.path, go: () => pick({ type: "file", file }) });
    }
    return [...seen.values()];
  };
  const users = ends(m.into.get(s.id), "src");
  const uses = ends(m.out.get(s.id), "dst");
  return (
    <div className="ct-where">
      <button className="ct-def" onClick={() => open(s)} title="Open source"><span className="ct-cap">Defined</span><span>{s.file.path}:{s.line}</span></button>
      <List title="Used by" items={users} />
      <List title="Uses" items={uses} />
    </div>
  );
}

function List({ title, items }: { title: string; items: { label: string; at: string; go: () => void }[] }) {
  return (
    <div className="ct-refs">
      <span className="ct-cap">{title} <span className="ct-num">{items.length}</span></span>
      {items.length === 0 && <span className="ct-hint">None</span>}
      {items.slice(0, 60).map((it) => (
        <button key={it.at + it.label} className="ct-ref" onClick={it.go} title={it.at}><span>{it.label}</span><span className="ct-at">{it.at}</span></button>
      ))}
    </div>
  );
}
