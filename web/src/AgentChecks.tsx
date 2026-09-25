// The agent checks, for people: what to know before editing a symbol, and what
// an edit actually moved. The same answers agents get over MCP (src/agent.rs).

import { useEffect, useState } from "react";
import { api, type PreEdit, type Verify } from "./api";
import { useCode } from "./CodePanel";

/** Rows arrive as "name (path:line)" or "name (path)"; the location opens in the code panel. */
function Ref({ text, tone }: { text: string; tone?: "bad" | "warn" }) {
  const code = useCode();
  const m = text.match(/^(.*?)\s*\(([^()]+?)(?::(\d+))?\)(.*)$/);
  const [label, path, line, rest] = m ? [m[1], m[2], m[3] ? Number(m[3]) : undefined, m[4]] : [text, "", undefined, ""];
  return (
    <div className={`ac-ref ${tone ?? ""}`} onClick={() => path && code.open({ path, line })} role={path ? "button" : undefined}>
      <span className="nm">{label}{rest && <span className="muted">{rest}</span>}</span>
      {path && <span className="p mono">{path}{line ? `:${line}` : ""}</span>}
    </div>
  );
}

function List({ title, items, tone, empty, max = 12 }: { title: string; items: string[]; tone?: "bad" | "warn"; empty?: string; max?: number }) {
  if (!items.length && !empty) return null;
  return (
    <>
      <div className="section-title">{title} <span className="count">{items.length}</span></div>
      {!items.length && <div className="muted ac-empty">{empty}</div>}
      {items.slice(0, max).map((t) => <Ref key={t} text={t} tone={tone} />)}
      {items.length > max && <div className="muted ac-empty">and {items.length - max} more</div>}
    </>
  );
}

/** Inspector tab: everything to know before changing this symbol. */
export function PreEditPanel({ id }: { id: number }) {
  const [p, setP] = useState<PreEdit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setP(null); setErr(null); api.preEdit(id).then(setP).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="muted ac-empty">{err}</div>;
  if (!p) return <div className="muted ac-empty">Reading callers, tests and history…</div>;
  return (
    <div className="ac">
      <div className="stat-row">
        <div className="stat"><b className={`risk ${p.risk}`}>{p.risk}</b><span>risk</span></div>
        <div className="stat"><b>{p.dependents}</b><span>dependents</span></div>
        <div className="stat"><b>{p.tests.length}</b><span>tests reach it</span></div>
      </div>
      <ol className="ac-advice">{p.advice.map((a) => a.replace(/call verify_edit to see/, "the Graph check in Changes shows")).map((a) => <li key={a}>{a}</li>)}</ol>
      <List title="Direct callers" items={p.direct_callers} />
      <List title="Tests that reach it" items={p.tests} empty="None through the call graph." tone={p.tests.length ? undefined : "warn"} />
      {p.co_changes.length > 0 && (
        <>
          <div className="section-title">Changes together with <span className="count">{p.co_changes.length}</span></div>
          {p.co_changes.map(([f, n]) => <Ref key={f} text={`${n} shared commits (${f})`} />)}
        </>
      )}
      {p.notes.length > 0 && (<><div className="section-title">Notes</div>{p.notes.map((n) => <div key={n} className="note">{n}</div>)}</>)}
    </div>
  );
}

/** Changes view: the working tree's graph against HEAD. */
export function VerifyPanel({ version }: { version: string }) {
  const [v, setV] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let on = true;
    setBusy(true);
    const t = window.setTimeout(() => api.verify().then((r) => { if (on) setV(r); }).catch(() => {}).finally(() => on && setBusy(false)), 250);
    return () => { on = false; clearTimeout(t); };
  }, [version]);
  if (!v) return <div className="verify muted">{busy ? "Checking the graph against HEAD…" : ""}</div>;
  const s = v.summary;
  const moved = s.added + s.removed + s.modified;
  const state = v.dangling.length ? "bad" : v.recheck.length ? "warn" : "ok";
  return (
    <div className={`verify ${state}`}>
      <button className="verify-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dot ${state === "ok" ? "ok" : state === "warn" ? "warn" : "bad"}`} />
        <b>Graph check</b>
        <span className="muted">
          {moved === 0 ? "no symbol moved" : <><span className="add">+{s.added}</span> <span className="del">−{s.removed}</span> <span className="mod">~{s.modified}</span></>}
          {v.dangling.length > 0 && <> · <span className="del">{v.dangling.length} broken caller{v.dangling.length > 1 ? "s" : ""}</span></>}
          {v.recheck.length > 0 && <> · {v.recheck.length} to re-read</>}
        </span>
        <span className="spacer" />
        {busy && <span className="muted">…</span>}
      </button>
      {open && (
        <div className="verify-body">
          <List title="Callers left dangling" items={v.dangling} tone="bad" empty="None: every call still resolves." max={8} />
          <List title="Callers of changed code, in other files" items={v.recheck} tone="warn" max={8} />
          <List title="Symbols changed" items={v.changed} max={8} />
        </div>
      )}
    </div>
  );
}
