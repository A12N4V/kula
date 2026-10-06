// Autofill for anything that names code: note and memory targets, scope and
// fence patterns, and [[symbol]] links inside note text. Before you type it
// offers what is near you – the file in the code panel or the symbol you just
// inspected, the symbols that file defines and its sibling files – and while
// you type it ranks matches by how close they are to where you have been.
// Tab takes the ghost completion; ↑↓ ↵ pick from the list.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { api, type Node } from "./api";
import { useCode } from "./CodePanel";
import { recent, subscribe, targetOf, type Place } from "./near";
import { Icon, Kind } from "./ui";

type Opt = { value: string; label: string; hint: string; kind: string; group: string };

const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);

/** The place the user is at now: the code panel's file, else the last one visited. */
export function useHere(): Place | null {
  const code = useCode();
  const list = useSyncExternalStore(subscribe, recent);
  if (code.target) return { path: code.target.path, name: code.target.name, kind: code.target.kind, id: code.target.id };
  return list[0] ?? null;
}

/** Files and symbols near `here`, fetched once per file. */
function useNearby(here: Place | null) {
  const [near, setNear] = useState<{ path: string; symbols: Node[]; siblings: Node[] } | null>(null);
  useEffect(() => {
    if (!here?.path) { setNear(null); return; }
    let live = true;
    api.near(here.path).then((r) => live && setNear({ path: here.path, symbols: r.symbols, siblings: r.siblings })).catch(() => {});
    return () => { live = false; };
  }, [here?.path]);
  return near;
}

const optOf = (n: Node, group: string, as: "target" | "pattern" | "name"): Opt => ({
  value: as === "target" ? targetOf(n) : as === "pattern" ? (n.kind === "file" ? n.path : `${n.path}:${n.name}`) : n.name,
  label: n.kind === "file" ? n.path.slice(n.path.lastIndexOf("/") + 1) : n.name,
  hint: n.kind === "file" ? dirOf(n.path) || "./" : `${n.path}:${n.start_line}`,
  kind: n.kind,
  group,
});

/** Suggestions for `text`: near-you first when empty, ranked search hits otherwise. */
function useOptions(text: string, as: "target" | "pattern" | "name", open: boolean) {
  const here = useHere();
  const near = useNearby(open ? here : null);
  const places = useSyncExternalStore(subscribe, recent);
  const [hits, setHits] = useState<Node[]>([]);
  const q = text.replace(/^(symbol|file):/, "").trim();
  useEffect(() => {
    if (!open || q.length < 2 || q === "repo") { setHits([]); return; }
    const t = setTimeout(() => api.search(q.split(":").pop() || q).then(setHits).catch(() => setHits([])), 110);
    return () => clearTimeout(t);
  }, [q, open]);
  return useMemo<Opt[]>(() => {
    if (!open) return [];
    const seen = new Set<string>();
    const out: Opt[] = [];
    const add = (o: Opt) => { if (!seen.has(o.value) && o.value !== text) { seen.add(o.value); out.push(o); } };
    if (q.length < 2) {
      if (as === "target") add({ value: "repo", label: "repo", hint: "the whole repository", kind: "repo", group: "Anywhere" });
      if (here) {
        const h = { path: here.path, name: here.name, kind: here.kind } as Place;
        add({ value: as === "target" ? targetOf(h) : as === "pattern" ? (h.name && h.kind !== "file" ? `${h.path}:${h.name}` : h.path) : h.name ?? h.path,
          label: h.name && h.kind !== "file" ? h.name : h.path.slice(h.path.lastIndexOf("/") + 1), hint: h.path, kind: h.kind ?? "file", group: "You are here" });
        if (near?.path === here.path) {
          if (as !== "name") add({ value: as === "target" ? `file:${here.path}` : here.path, label: here.path.slice(here.path.lastIndexOf("/") + 1), hint: dirOf(here.path), kind: "file", group: "You are here" });
          if (as === "pattern" && dirOf(here.path)) add({ value: `${dirOf(here.path)}**`, label: `${dirOf(here.path)}**`, hint: "this directory", kind: "dir", group: "You are here" });
          near.symbols.slice(0, 8).forEach((n) => add(optOf(n, `In ${here.path.slice(here.path.lastIndexOf("/") + 1)}`, as)));
          if (as !== "name") near.siblings.slice(0, 6).forEach((n) => add(optOf(n, "Beside it", as)));
        }
      }
      places.slice(1, 6).forEach((p) => add({ value: as === "target" ? targetOf(p) : as === "pattern" ? (p.name && p.kind !== "file" ? `${p.path}:${p.name}` : p.path) : p.name ?? p.path,
        label: p.name && p.kind !== "file" ? p.name : p.path, hint: p.path, kind: p.kind ?? "file", group: "Recent" }));
      return out;
    }
    // Closer to where you are ranks higher: same file, same directory, visited.
    const d = here ? dirOf(here.path) : "";
    const score = (n: Node) => (here && n.path === here.path ? 0 : d && n.path.startsWith(d) ? 1 : places.some((p) => p.path === n.path) ? 2 : 3);
    // A path-like query names files: offer the files its hits live in.
    if (as !== "name" && /[/.]/.test(q)) {
      [...new Set(hits.map((n) => n.path))].filter((p) => p.includes(q)).sort((a, b) => Number(!a.startsWith(q)) - Number(!b.startsWith(q)) || a.length - b.length).slice(0, 5)
        .forEach((p) => add({ value: as === "target" ? `file:${p}` : p, label: p.slice(p.lastIndexOf("/") + 1), hint: dirOf(p) || "./", kind: "file", group: "Files" }));
    }
    hits.filter((n) => n.kind !== "package" && (as !== "name" || n.kind !== "file")).sort((a, b) => score(a) - score(b))
      .slice(0, 10).forEach((n) => add(optOf(n, score(n) < 2 ? "Near you" : "Matches", as)));
    return out;
  }, [open, q, as, here, near, places, hits, text]);
}

function OptList({ opts, at, pick, setAt }: { opts: Opt[]; at: number; pick: (o: Opt) => void; setAt: (i: number) => void }) {
  return (
    <div className="af-pop" role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {opts.map((o, i) => (
        <div key={o.value}>
          {(i === 0 || opts[i - 1].group !== o.group) && <div className="af-grp">{o.group}</div>}
          <div role="option" aria-selected={i === at} className={`af-opt ${i === at ? "on" : ""}`} onMouseEnter={() => setAt(i)} onClick={() => pick(o)}>
            {o.kind === "repo" || o.kind === "dir" ? <span className="af-ico">{o.kind === "repo" ? <Icon.box /> : <Icon.doc />}</span> : <Kind kind={o.kind} size={16} />}
            <span className="af-label mono">{o.label}</span>
            <span className="af-hint">{o.hint}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shared keyboard handling: returns true when the key was ours. */
function nav(e: KeyboardEvent, opts: Opt[], at: number, setAt: (i: number) => void, pick: (o: Opt) => void, close: () => void, tab?: Opt) {
  if (e.key === "Tab" && !e.shiftKey && (tab || opts[at])) { e.preventDefault(); pick(tab ?? opts[at]); return true; }
  if (!opts.length) return false;
  if (e.key === "ArrowDown") { e.preventDefault(); setAt(Math.min(opts.length - 1, at + 1)); return true; }
  if (e.key === "ArrowUp") { e.preventDefault(); setAt(Math.max(0, at - 1)); return true; }
  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); pick(opts[at]); return true; }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return true; }
  return false;
}

/**
 * A one-line field that names code. `as` sets what a pick writes:
 * target (`file:a.rs`, `symbol:a.rs:f`, `repo`), pattern (`src/a.rs`, `src/**`, `a.rs:f`) or name.
 */
export function CodeField({ value, onChange, onPick, placeholder, as = "target", className = "", label, autoFocus, onEnter }: {
  value: string; onChange: (v: string) => void; onPick?: (v: string) => void; placeholder?: string; as?: "target" | "pattern" | "name";
  className?: string; label?: string; autoFocus?: boolean; onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const opts = useOptions(value, as, open);
  useEffect(() => setAt(0), [value, opts.length]);
  // The ghost completes to the best option that extends what you typed; Tab takes it.
  const lead = value ? opts.find((o) => o.value.startsWith(value) && o.value !== value) : undefined;
  const ghost = lead ? lead.value.slice(value.length) : "";
  const pick = (o: Opt) => { onChange(o.value); onPick?.(o.value); setOpen(false); };
  return (
    <div className={`af ${className}`}>
      <div className="af-field">
        <input className="input mono" value={value} placeholder={placeholder} aria-label={label ?? placeholder} spellCheck={false} autoComplete="off" autoFocus={autoFocus}
          role="combobox" aria-expanded={open && opts.length > 0} aria-autocomplete="list"
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (open && nav(e, opts, at, setAt, pick, () => setOpen(false), lead)) return; if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }} />
        {open && ghost && <span className="af-ghost mono" aria-hidden="true"><span>{value}</span>{ghost}<kbd>tab</kbd></span>}
      </div>
      {open && opts.length > 0 && <OptList opts={opts} at={at} pick={pick} setAt={setAt} />}
    </div>
  );
}

/** Chips of patterns (globs, paths, symbol names), with autofill for the next one. */
export function Chips({ values, onChange, placeholder, as = "pattern", label }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; as?: "pattern" | "name"; label?: string }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => { const t = v.trim().replace(/,$/, ""); if (t && !values.includes(t)) onChange([...values, t]); setDraft(""); };
  return (
    <div className="chips">
      {values.map((v) => (
        <span key={v} className="chip-x mono">{v}<button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>×</button></span>
      ))}
      <CodeField value={draft} as={as} placeholder={values.length ? "" : placeholder} label={label} className="chips-in"
        onChange={(v) => (v.endsWith(",") ? add(v) : setDraft(v))} onPick={add} onEnter={() => add(draft)} />
    </div>
  );
}

/**
 * A textarea that completes [[links]]: type `[[` and pick a symbol or file;
 * the note renders it as a link into the graph.
 */
export function LinkArea({ value, onChange, placeholder, onSubmit, className = "", minHeight, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void; className?: string; minHeight?: number; label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [at, setAt] = useState(0);
  const [closed, setClosed] = useState(false);
  const before = value.slice(0, caret);
  const m = before.match(/\[\[([^\]\n]{0,60})$/);
  const open = !!m && !closed;
  const opts = useOptions(m ? m[1] : "", "name", open);
  useEffect(() => { setAt(0); }, [m?.[1], opts.length]);
  const pick = (o: Opt) => {
    if (!m) return;
    const start = caret - m[0].length;
    const after = value.slice(caret).replace(/^[^\]\s]*\]\]/, "");
    const ins = `[[${o.value}]]`;
    onChange(value.slice(0, start) + ins + after);
    const pos = start + ins.length;
    requestAnimationFrame(() => { ref.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const sync = () => setCaret(ref.current?.selectionStart ?? 0);
  return (
    <div className={`af af-area ${className}`}>
      <textarea ref={ref} className="textarea" style={minHeight ? { minHeight } : undefined} value={value} placeholder={placeholder} aria-label={label ?? placeholder}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); setClosed(false); }}
        onKeyUp={sync} onClick={sync} onBlur={() => setClosed(true)} onFocus={() => setClosed(false)}
        onKeyDown={(e) => {
          if (open && nav(e, opts, at, setAt, pick, () => setClosed(true))) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
        }} />
      {open && opts.length > 0 && <OptList opts={opts} at={at} pick={pick} setAt={setAt} />}
    </div>
  );
}

/** "Writing about src/a.rs" – where the autofill thinks you are, with a one-click fill. */
export function HereHint({ onUse, as = "target", children }: { onUse: (v: string) => void; as?: "target"; children?: ReactNode }) {
  const here = useHere();
  if (!here) return null;
  const v = as === "target" ? targetOf(here) : here.path;
  return (
    <button className="here-hint" onClick={() => onUse(v)} title="Use where you are as the target">
      <span className="eyebrow">near</span><span className="mono">{here.name && here.kind !== "file" ? `${here.name}` : here.path}</span>{children}
    </button>
  );
}
