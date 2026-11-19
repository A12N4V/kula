// The code canvas tool window, docked in the shell's right sidebar: go to, what is
// picked, which links to draw and how strongly, and the names inside the pick.

import { useEffect, useMemo, useRef, useState } from "react";
import { Kind } from "../../ui";
import { KINDS, type KindId, type Link, type Model, type Selection, type Sym } from "./model";
import { Glyph } from "./icons";
import { STRENGTH, toggleIn, type Prefs } from "./state";

type Props = {
  m: Model; sel: Selection; p: Prefs; counts: Record<KindId, number>;
  set: (patch: Partial<Prefs>) => void;
  pick: (s: Selection) => void;
  open: (s: Sym | null) => void;
  rescan: () => void; busy: boolean;
};

const SHOWN = 400;

export function SelectedPanel({ m, sel, p, counts, set, pick, open, rescan, busy }: Props) {
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

  const [byUse, setByUse] = useState(false);
  const listed = useMemo(() => (byUse ? [...names].sort((a, b) => (m.into.get(b.id)?.length ?? 0) - (m.into.get(a.id)?.length ?? 0)) : names), [names, byUse, m]);
  const pct = (v: number | undefined, d: number) => Math.round((v ?? d) * 100);

  return (
    <div className="ct ct-side">
      <div className="ct-side-head">
        <div className={`ct-pick${sel ? " on" : ""}`}>
          <b title={title}>{title}</b>
          <span className="ct-sub" title={sub}>{sub}</span>
        </div>
        <Menu label="Selection actions" items={[
          { label: "Open source", off: !sel || sel.type === "dir", run: () => sel && sel.type !== "dir" && open(sel.type === "sym" ? sel.sym : null) },
          { label: "Clear selection", off: !sel, run: () => pick(null) },
          { label: "Reset filters", run: () => set({ on: KINDS.map((k) => k.id), bodyOn: KINDS.map((k) => k.id), strength: { ...STRENGTH }, bodyStrength: fill(0.4), only: false }) },
          { label: busy ? "Rescanning" : "Rescan repo", off: busy, run: rescan },
        ]} />
      </div>

      <div className="ct-side-scroll">

        <section className="ct-card">
          <h4><Glyph.funnel />Links<span className="spacer" /><span className="ct-h4-hint">click to show or hide</span></h4>
          <div className="ct-ibs ct-kinds" role="group" aria-label="Link kinds">
            {KINDS.map((k) => {
              const on = p.on.includes(k.id);
              const idle = !sel && (k.id === "in" || k.id === "importers");
              const G = Glyph[k.id];
              return (
                <button key={k.id} className={`ct-kind-top${idle ? " idle" : ""}`} aria-pressed={on} aria-label={k.label}
                  title={idle ? `${k.label}: pick something to split in from out` : k.label}
                  style={{ ["--c" as string]: `var(${k.color})` }} onClick={() => set({ on: toggleIn(p.on, k.id) })}>
                  <G /><span className="ct-num">{counts[k.id]}</span>
                </button>
              );
            })}
          </div>
          {KINDS.filter((k) => p.on.includes(k.id)).map((k) => (
            <div key={k.id} className="ct-kind" style={{ ["--c" as string]: `var(${k.color})` }}>
              <span className="ct-kind-name"><i className="ct-dot" />{k.label}</span>
              <Slider value={pct(p.strength[k.id], STRENGTH[k.id])} color={k.color} label={`${k.label} strength`} set={(v) => set({ strength: { ...p.strength, [k.id]: v } })} />
            </div>
          ))}
          {!p.on.length && <p className="ct-hint">All links hidden</p>}
        </section>

        <section className="ct-card">
          <h4><Glyph.eye />View</h4>
          <div className="ct-ibs ct-views" role="group" aria-label="View options">
            <Opt on={p.only} disabled={!sel} icon={<Glyph.link />} label="Connected" tip="Only files linked to the pick" set={(v) => set({ only: v })} />
            <Opt on={p.bodies} icon={<Glyph.rows />} label="Symbols" tip="Draw symbols inside files" set={(v) => set({ bodies: v })} />
            <Opt on={p.bodyOn.length > 0} icon={<Glyph.split />} label="Per symbol" tip="Split links per symbol when zoomed in" set={(v) => set({ bodyOn: v ? KINDS.map((k) => k.id) : [] })} />
          </div>
        </section>

        <section className="ct-card">
          <h4><Glyph.names />Names <span className="ct-num">{names.length || ""}</span><span className="spacer" />
            <Menu label="Name actions" items={[
              { label: byUse ? "Sort by line" : "Sort by uses", run: () => setByUse((x) => !x) },
            ]} />
          </h4>
          {!names.length && <p className="ct-hint">Pick a name to see its uses</p>}
          {listed.slice(0, SHOWN).map((s) => (
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
    </div>
  );
}

const fill = (v: number) => Object.fromEntries(KINDS.map((k) => [k.id, v])) as Record<KindId, number>;

/** An icon button that lights up while its option is on. */
function Opt({ on, icon, label, tip, set, disabled }: { on: boolean; icon: React.ReactNode; label: string; tip: string; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button className="ct-opt" aria-pressed={on} disabled={disabled} title={tip} onClick={() => set(!on)}>
      {icon}<span>{label}</span>
    </button>
  );
}

/** A thin track with a round knob and its value as a percent. */
function Slider({ value, set, color, label, disabled }: { value: number; set: (v: number) => void; color: string; label: string; disabled?: boolean }) {
  return (
    <span className="ct-slider">
      <input type="range" min={0} max={100} value={value} disabled={disabled} aria-label={label}
        style={{ ["--fill" as string]: `${value}%`, ["--c" as string]: `var(${color})` }}
        onChange={(e) => set(Number(e.target.value) / 100)} />
      <span className="ct-pct">{value}%</span>
    </span>
  );
}

/** A three dot button with a short list of actions. */
function Menu({ label, items }: { label: string; items: { label: string; run: () => void; off?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="ct-menu" ref={ref}>
      <button className="ct-ib" aria-label={label} aria-expanded={open} onClick={() => setOpen((x) => !x)}><Glyph.more /></button>
      {open && (
        <div className="ct-menu-list" role="menu">
          {items.map((it) => <button key={it.label} role="menuitem" disabled={it.off} onClick={() => { it.run(); setOpen(false); }}>{it.label}</button>)}
        </div>
      )}
    </div>
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
