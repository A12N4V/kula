// Research flow: one autoresearch run drawn as the loop it is. Solvers (the
// agents and people who tried) feed attempts; every attempt meets the gate –
// the fences, then the metric kula runs itself; what beats the frontier is
// kept as a record, and the next attempt starts from it. Under the flow, the
// files the run touched and the selected attempt. Selecting a solver, file or
// attempt lights its path through all of it.

import { useMemo, useState } from "react";
import { relTime, type Experiment, type ResearchRun } from "../../api";
import { BRANDS } from "../../brands";
import { AgentMark, num } from "./parts";
import { AGENT_NAME } from "./data";

type Verdict = "kept" | "reverted" | "failed" | "fenced";
type Focus = { solver?: string; file?: string; n?: number };

export const verdict = (e: Experiment): Verdict =>
  e.kept ? "kept" : e.note?.startsWith("rejected") ? "fenced" : e.value === null ? "failed" : "reverted";
const VERDICT_TEXT: Record<Verdict, string> = { kept: "kept", reverted: "reverted", failed: "failed", fenced: "fenced" };

/** `agent:claude` → claude, `user:arnav` → you:arnav. */
const solverId = (by: string) => by.replace(/^agent:/, "");
const SHORT: Record<string, string> = { claude: "Claude", cursor: "Cursor", codex: "Codex", gemini: "Gemini" };
const solverName = (id: string, long = false) => (id.startsWith("user:") ? id.slice(5) : (long ? AGENT_NAME[id] : SHORT[id]) ?? id);
const mark = (id: string) => (id.startsWith("user:") ? "you" : id);

/** How much `e` moved the frontier, in the good direction. */
const gain = (run: ResearchRun, e: Experiment) =>
  e.kept && e.value !== null && e.best_before !== null ? (run.goal === "max" ? e.value - e.best_before : e.best_before - e.value) : 0;

const ROW = 30;
const SHOW = 18;

export default function ResearchFlow({ run, scopeFiles, openFile, openCommit }: {
  run: ResearchRun; scopeFiles: string[]; openFile: (p: string) => void; openCommit: (sha: string) => void;
}) {
  const [focus, setFocus] = useState<Focus>({});
  const [all, setAll] = useState(false);
  const exps = run.experiments;
  const shown = all ? exps : exps.slice(-SHOW);
  const total = Math.abs(run.best - run.baseline) || 1;

  const solvers = useMemo(() => {
    const m = new Map<string, { id: string; tries: number; kept: number; fenced: number; gain: number; last: number }>();
    for (const e of exps) {
      const id = solverId(e.by);
      const s = m.get(id) ?? { id, tries: 0, kept: 0, fenced: 0, gain: 0, last: 0 };
      s.tries++; s.kept += +e.kept; s.fenced += +(verdict(e) === "fenced"); s.gain += gain(run, e); s.last = Math.max(s.last, e.at);
      m.set(id, s);
    }
    return [...m.values()].sort((a, b) => b.gain - a.gain || b.tries - a.tries);
  }, [exps, run]);

  const records = shown.filter((e) => e.kept);
  const files = useMemo(() => {
    const m = new Map<string, { path: string; v: Record<Verdict, number>; by: Set<string> }>();
    for (const p of scopeFiles) m.set(p, { path: p, v: { kept: 0, reverted: 0, failed: 0, fenced: 0 }, by: new Set() });
    for (const e of exps) for (const p of e.files) {
      const f = m.get(p) ?? { path: p, v: { kept: 0, reverted: 0, failed: 0, fenced: 0 }, by: new Set<string>() };
      f.v[verdict(e)]++; f.by.add(solverId(e.by)); m.set(p, f);
    }
    const n = (f: { v: Record<Verdict, number> }) => f.v.kept + f.v.reverted + f.v.failed + f.v.fenced;
    return [...m.values()].sort((a, b) => n(b) - n(a) || a.path.localeCompare(b.path)).map((f) => ({ ...f, n: n(f) }));
  }, [exps, scopeFiles]);
  const maxTouch = Math.max(1, ...files.map((f) => f.n));

  // What the focus lights: an attempt is "on" when it matches every part of the focus.
  const on = (e: Experiment) =>
    (!focus.solver || solverId(e.by) === focus.solver) && (!focus.file || e.files.includes(focus.file)) && (focus.n === undefined || e.n === focus.n);
  const anyFocus = !!(focus.solver || focus.file || focus.n !== undefined);
  const toggle = (f: Focus) => setFocus((cur) => (JSON.stringify(cur) === JSON.stringify({ ...cur, ...f }) ? {} : { ...cur, ...f }));
  const sel = focus.n !== undefined ? exps.find((e) => e.n === focus.n) : undefined;

  // The flow is laid out on fixed rows, so the wires need no measuring: x in
  // percent of the width, y in pixels, strokes kept crisp by non-scaling-stroke.
  const H = Math.max(solvers.length, shown.length, records.length + 1) * ROW + 8;
  const yOf = (i: number) => 4 + i * ROW + ROW / 2;
  const X = { solver: 19, tryIn: 25, tryOut: 61, gate: 66.5, rec: 72 };
  const sIdx = new Map(solvers.map((s, i) => [s.id, i]));
  const rIdx = new Map(records.map((e, i) => [e.n, i]));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; };

  return (
    <div className={`rf ${anyFocus ? "focused" : ""}`}>
      <div className="rf-cols mono" aria-hidden="true">
        <span style={{ left: 0 }}>solvers · {solvers.length}</span>
        <span style={{ left: `${X.tryIn}%` }}>attempts · {exps.length}{exps.length > SHOW && <button className="rf-more" onClick={() => setAll(!all)}>{all ? `last ${SHOW}` : "all"}</button>}</span>
        <span style={{ left: `${X.gate - 3}%` }}>gate</span>
        <span style={{ left: `${X.rec}%` }}>frontier · {exps.filter((e) => e.kept).length} records</span>
      </div>

      <div className="rf-stage" style={{ height: H }}>
        <svg className="rf-wires" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true" data-figure>
          {/* build on the best: the frontier feeds the next attempt */}
          <path d={`M${X.rec + 1},2 L${X.rec + 1},0.5 L1,0.5 L1,2`} className="rf-back" />
          {shown.map((e, i) => {
            const v = verdict(e), lit = on(e);
            const s = sIdx.get(solverId(e.by)) ?? 0;
            const cls = `rf-w ${v} ${anyFocus ? (lit ? "lit" : "dim") : ""}`;
            return (
              <g key={e.n} className={cls}>
                <path className="in" d={curve(X.solver, yOf(s), X.tryIn, yOf(i))} />
                <path d={`M${X.tryOut},${yOf(i)} L${X.gate},${yOf(i)}`} />
                {v === "kept" && <path d={curve(X.gate, yOf(i), X.rec, yOf(rIdx.get(e.n) ?? 0))} />}
              </g>
            );
          })}
        </svg>

        <div className="rf-col rf-solvers" style={{ width: `${X.solver}%` }}>
          {solvers.map((s) => (
            <button key={s.id} className={`rf-solver ${focus.solver === s.id ? "sel" : ""}`} style={{ height: ROW }}
              onClick={() => toggle({ solver: s.id, n: undefined })} aria-pressed={focus.solver === s.id}
              title={`${solverName(s.id, true)}: ${s.tries} tries, ${s.kept} kept${s.fenced ? `, ${s.fenced} stopped at a fence` : ""}`}>
              <AgentMark id={mark(s.id)} size={14} />
              <span className="rf-sname">{solverName(s.id)}</span>
              <span className="rf-share" title="share of the gain"><i style={{ width: `${(s.gain / total) * 100}%`, background: BRANDS[s.id]?.color ?? "var(--accent)" }} /></span>
              <span className="mono rf-snum">{s.kept}/{s.tries}</span>
            </button>
          ))}
        </div>

        <div className="rf-col rf-tries" style={{ left: `${X.tryIn}%`, width: `${X.tryOut - X.tryIn}%` }}>
          {shown.map((e) => {
            const v = verdict(e);
            return (
              <button key={e.n} className={`rf-try ${v} ${anyFocus ? (on(e) ? "lit" : "dim") : ""} ${focus.n === e.n ? "sel" : ""}`} style={{ height: ROW }}
                onClick={() => setFocus(focus.n === e.n ? {} : { n: e.n })} aria-pressed={focus.n === e.n}>
                <span className="mono rf-n">{e.n}</span>
                <AgentMark id={mark(solverId(e.by))} size={12} />
                <span className="rf-hyp">{e.hypothesis}</span>
                <span className="mono rf-files">{e.files.map((f) => f.split("/").pop()).join(" ")}</span>
              </button>
            );
          })}
        </div>

        <div className="rf-gate" style={{ left: `${X.gate - 1}%` }} title={`fences, then \`${run.metric}\` – ${run.goal === "max" ? "higher" : "lower"} is better`}>
          {shown.map((e, i) => {
            const v = verdict(e);
            return <span key={e.n} className={`rf-pin ${v} ${anyFocus && !on(e) ? "dim" : ""}`} style={{ top: yOf(i) - 5 }} title={`#${e.n} ${VERDICT_TEXT[v]}${e.value !== null ? ` – ${num(e.value)}` : ""}`} />;
          })}
        </div>

        <div className="rf-col rf-records" style={{ left: `${X.rec}%`, width: `${100 - X.rec}%` }}>
          {records.map((e) => {
            const g = gain(run, e);
            return (
              <button key={e.n} className={`rf-rec ${anyFocus ? (on(e) ? "lit" : "dim") : ""} ${e.value === run.best ? "best" : ""}`} style={{ height: ROW }}
                onClick={() => setFocus(focus.n === e.n ? {} : { n: e.n })}>
                <b className="mono">{num(e.value!)}</b>
                <span className="mono rf-gain">{run.goal === "max" ? "+" : "−"}{num(Math.abs(g))}</span>
                <AgentMark id={mark(solverId(e.by))} size={12} />
                <span className="mono rf-sha">{e.commit?.slice(0, 7)}</span>
                {e.value === run.best && <span className="tag accent">frontier</span>}
              </button>
            );
          })}
          <div className="rf-rec base" style={{ height: ROW }}><b className="mono">{num(run.baseline)}</b><span className="muted">baseline · {run.base?.slice(0, 7) || run.branch}</span></div>
        </div>
      </div>

      <div className="rf-legend">
        <span><i className="kept" />kept – the new frontier</span>
        <span><i className="reverted" />measured, not better – reverted</span>
        <span><i className="fenced" />touched a fence – reverted unrun</span>
        <span><i className="failed" />metric failed</span>
        <span className="rf-back-key">every attempt starts from the frontier</span>
        {anyFocus && <button className="btn sm ghost" onClick={() => setFocus({})}>Clear</button>}
      </div>

      <div className="rf-lower">
        <section className="rf-panel">
          <h3>files · {files.filter((f) => f.n).length} touched of {files.length}</h3>
          <div className="rf-flist">
            {files.map((f) => (
              <div key={f.path} className={`rf-file ${focus.file === f.path ? "sel" : ""} ${anyFocus && focus.file !== f.path && !(focus.solver && f.by.has(focus.solver)) && !(sel && sel.files.includes(f.path)) ? "dim" : ""}`}>
                <button className="mono rf-path" onClick={() => toggle({ file: f.path, n: undefined })} aria-pressed={focus.file === f.path} title={`light the attempts that touched ${f.path}`}>{f.path}</button>
                <span className="rf-heat" title={`${f.v.kept} kept, ${f.v.reverted} reverted, ${f.v.failed} failed, ${f.v.fenced} fenced`}>
                  {(["kept", "reverted", "failed", "fenced"] as Verdict[]).map((v) => f.v[v] ? <i key={v} className={v} style={{ width: `${(f.v[v] / maxTouch) * 100}%` }} /> : null)}
                </span>
                <span className="mono rf-fn">{f.n || "–"}</span>
                <span className="rf-by">{[...f.by].map((b) => <AgentMark key={b} id={mark(b)} size={12} />)}</span>
                <button className="btn sm ghost rf-open" onClick={() => openFile(f.path)} title="open in the code panel">open</button>
              </div>
            ))}
          </div>
        </section>

        <section className="rf-panel">
          {sel ? <Attempt e={sel} run={run} openFile={openFile} openCommit={openCommit} />
            : focus.solver ? <Solver s={solvers.find((s) => s.id === focus.solver)!} run={run} total={total} />
            : <Summary run={run} solvers={solvers.length} files={files.filter((f) => f.n).length} />}
        </section>
      </div>
    </div>
  );
}

function Attempt({ e, run, openFile, openCommit }: { e: Experiment; run: ResearchRun; openFile: (p: string) => void; openCommit: (s: string) => void }) {
  const v = verdict(e), g = gain(run, e);
  return (
    <div className="rf-detail">
      <h3>attempt {e.n} · <span className={`rf-v ${v}`}>{VERDICT_TEXT[v]}</span></h3>
      <div className="rf-dhyp">{e.hypothesis}</div>
      <dl className="rf-dl">
        <dt>by</dt><dd><AgentMark id={mark(solverId(e.by))} size={12} /> {solverName(solverId(e.by))} · {relTime(e.at)}</dd>
        <dt>measured</dt><dd className="mono">{e.value === null ? "–" : num(e.value)}{e.best_before !== null && <span className="muted"> against {num(e.best_before)}</span>}{e.kept && <b className="rf-up"> {run.goal === "max" ? "+" : "−"}{num(Math.abs(g))}</b>}</dd>
        {e.commit && <><dt>commit</dt><dd><button className="linkish mono" onClick={() => openCommit(e.commit!)}>{e.commit.slice(0, 10)}</button> <span className="muted">in History</span></dd></>}
        {e.note && <><dt>why</dt><dd className="muted">{e.note}</dd></>}
        <dt>files</dt><dd>{e.files.map((f) => <button key={f} className="linkish mono rf-dfile" onClick={() => openFile(f)}>{f}</button>)}</dd>
      </dl>
    </div>
  );
}

function Solver({ s, run, total }: { s: { id: string; tries: number; kept: number; fenced: number; gain: number; last: number }; run: ResearchRun; total: number }) {
  return (
    <div className="rf-detail">
      <h3><AgentMark id={mark(s.id)} size={12} /> {solverName(s.id, true)}</h3>
      <dl className="rf-dl">
        <dt>tries</dt><dd className="mono">{s.tries} · {s.kept} kept · {s.tries ? Math.round((s.kept / s.tries) * 100) : 0}% hit rate</dd>
        <dt>gain</dt><dd className="mono">{num(s.gain)} of {num(total)} <span className="muted">({Math.round((s.gain / total) * 100)}% of the run's improvement)</span></dd>
        <dt>fences</dt><dd>{s.fenced ? <span className="rf-v fenced">{s.fenced} stopped at a fence</span> : <span className="muted">never crossed one</span>}</dd>
        <dt>last</dt><dd className="muted">{relTime(s.last)} on {run.branch}</dd>
      </dl>
    </div>
  );
}

function Summary({ run, solvers, files }: { run: ResearchRun; solvers: number; files: number }) {
  const n = (v: Verdict) => run.experiments.filter((e) => verdict(e) === v).length;
  return (
    <div className="rf-detail">
      <h3>run · {run.branch}</h3>
      <dl className="rf-dl">
        <dt>started</dt><dd>{relTime(run.started)} by {solverName(solverId(run.by))} <span className="muted mono">from {run.base?.slice(0, 7)}</span></dd>
        <dt>attempts</dt><dd className="mono">{n("kept")} kept · {n("reverted")} reverted · {n("fenced")} fenced · {n("failed")} failed</dd>
        <dt>solvers</dt><dd className="mono">{solvers} on {files} file{files === 1 ? "" : "s"}</dd>
        <dt>verifier</dt><dd className="mono">{run.metric}</dd>
      </dl>
      <p className="muted rf-hint">Pick a solver, attempt or file to trace it through the loop.</p>
    </div>
  );
}
