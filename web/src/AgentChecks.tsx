// The agent checks, for people: what to know before editing a symbol, and what
// an edit actually moved. The same answers agents get over MCP (src/agent.rs),
// read from its structured *_refs.

import { useEffect, useState } from "react";
import { api, type AgentRef, type Verify } from "./api";
import { useCode } from "./CodePanel";

/** One located symbol; the location opens in the code panel. */
function Row({ r, note, tone }: { r: { name: string; path: string; line?: number }; note?: string; tone?: "bad" | "warn" }) {
  const code = useCode();
  return (
    <div className={`ac-ref ${tone ?? ""}`} onClick={() => code.open({ path: r.path, line: r.line || undefined })} role="button">
      <span className="nm">{r.name}{note && <span className="muted"> {note}</span>}</span>
      <span className="p mono">{r.path}{r.line ? `:${r.line}` : ""}</span>
    </div>
  );
}

function List({ title, refs, note, tone, empty, max = 12 }: {
  title: string; refs: AgentRef[]; note?: (r: AgentRef) => string | undefined; tone?: "bad" | "warn"; empty?: string; max?: number;
}) {
  if (!refs.length && !empty) return null;
  return (
    <>
      <div className="section-title">{title} <span className="count">{refs.length}</span></div>
      {!refs.length && <div className="muted ac-empty">{empty}</div>}
      {refs.slice(0, max).map((r) => <Row key={`${r.path}:${r.line}:${r.name}:${r.detail ?? ""}`} r={r} note={note?.(r)} tone={tone} />)}
      {refs.length > max && <div className="muted ac-empty">and {refs.length - max} more</div>}
    </>
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
  const fenced = v.guard_violations ?? [];
  const state = v.dangling_refs.length || fenced.length ? "bad" : v.recheck_refs.length ? "warn" : "ok";
  return (
    <div className={`verify ${state}`}>
      <button className="verify-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dot ${state === "ok" ? "ok" : state === "warn" ? "warn" : "bad"}`} />
        <b>Graph check</b>
        <span className="muted">
          {moved === 0 ? "no symbol moved" : <><span className="add">+{s.added}</span> <span className="del">−{s.removed}</span> <span className="mod">~{s.modified}</span></>}
          {v.dangling_refs.length > 0 && <> · <span className="del">{v.dangling_refs.length} broken caller{v.dangling_refs.length > 1 ? "s" : ""}</span></>}
          {v.recheck_refs.length > 0 && <> · {v.recheck_refs.length} to re-read</>}
          {fenced.length > 0 && <> · <span className="del">{fenced.length} fenced file{fenced.length > 1 ? "s" : ""} changed</span></>}
        </span>
        <span className="spacer" />
        {busy && <span className="muted">…</span>}
      </button>
      {open && (
        <div className="verify-body">
          {fenced.length > 0 && (
            <>
              <div className="section-title">Fenced code changed <span className="count">{fenced.length}</span></div>
              {fenced.map(([path, v]) => <Row key={path} r={{ name: path.split("/").pop() ?? path, path }} note={`${v.level} · ${v.reason}`} tone="bad" />)}
            </>
          )}
          <List title="Callers left dangling" refs={v.dangling_refs} note={(r) => `called ${r.detail}, which is gone`} tone="bad" empty="None: every call still resolves." max={8} />
          <List title="Callers of changed code, in other files" refs={v.recheck_refs} note={(r) => `calls ${r.detail}`} tone="warn" max={8} />
          <List title="Symbols changed" refs={v.changed_refs} note={(r) => r.detail} max={8} />
        </div>
      )}
    </div>
  );
}
