// Research flow: one autoresearch run drawn as the loop it is. Solvers (the
// agents and people who tried) feed attempts; every attempt meets the gate –
// the fences, then the metric kula runs itself; what beats the frontier is
// kept as a record, and the next attempt starts from it. Under the flow, the
// files the run touched and the selected attempt. Selecting a solver, file or
// attempt lights its path through all of it.

import { useMemo, useState } from "react";
import { relTime, type Experiment, type ResearchRun } from "../../api";
import { BRANDS } from "../../brands";
import { AgentMark, ListFilter, num, useFilterList } from "./parts";
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
  // j/k walk the attempts; enter pins one to the detail panel; / filters them.
  const tries = useFilterList(shown.length, (i) => { const e = vis[i]; if (e) toggleFocus(e.n); }, `${run.workflow}:${run.started}:${all}`);
  function toggleFocus(n: number) { setFocus((f) => (f.n === n ? {} : { n })); }

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
  const vis = tries.filter ? shown.filter((e) => (`#${e.n} ${e.hypothesis} ${e.files.join(" ")} ${solverName(solverId(e.by))}`).toLowerCase().includes(tries.filter.toLowerCase())) : shown;
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
  const H = Math.max(solvers.length, vis.length, records.length + 1) * ROW + 8;
  const yOf = (i: number) => 4 + i * ROW + ROW / 2;
  const X = { solver: 19, tryIn: 25, tryOut: 61, gate: 66.5, rec: 72 };
  const sIdx = new Map(solvers.map((s, i) => [s.id, i]));
  const rIdx = new Map(records.map((e, i) => [e.n, i]));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; };

  return (
    <div className={`rf ${anyFocus ? "focused" : ""}`}>
      <div className="rf-filter"><ListFilter inputRef={tries.inputRef} value={tries.filter} onChange={tries.setFilter} label="Filter attempts" placeholder="/ filter attempts" /></div>
      <RunTimeline run={run} onPick={(n) => toggleFocus(n)} picked={focus.n} />
      <div className="rf-cols mono" aria-hidden="true">
        <span style={{ left: 0 }}>solvers · {solvers.length}</span>
        <span style={{ left: `${X.tryIn}%` }}>attempts · {exps.length}{exps.length > SHOW && <button className="rf-more" onClick={() => setAll(!all)}>{all ? `last ${SHOW}` : "all"}</button>}</span>
        <span style={{ left: `${X.gate - 3}%` }}>gate</span>
        <span style={{ left: `${X.rec}%` }}>frontier · {exps.filter((e) => e.kept).length} records</span>
      </div>

      <div className="rf-stage" style={{ height: H }}>
        <svg className="rf-wires" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {/* build on the best: the frontier feeds the next attempt */}
          <path d={`M${X.rec + 1},2 L${X.rec + 1},0.5 L1,0.5 L1,2`} className="rf-back" />
          {vis.map((e, i) => {
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

        <div className="rf-col rf-tries" style={{ left: `${X.tryIn}%`, width: `${X.tryOut - X.tryIn}%` }} {...tries.props}>
          {vis.map((e, i) => {
            const v = verdict(e);
            return (
              <button key={e.n} className={`rf-try ${v} ${anyFocus ? (on(e) ? "lit" : "dim") : ""} ${focus.n === e.n ? "sel" : ""} ${tries.sel === i ? "kb-sel" : ""}`} style={{ height: ROW }} data-idx={i} id={`list-item-${i}`}
                onClick={() => setFocus(focus.n === e.n ? {} : { n: e.n })} aria-pressed={focus.n === e.n} tabIndex={-1}>
                <span className="mono rf-n">{e.n}</span>
                <AgentMark id={mark(solverId(e.by))} size={12} />
                <span className="rf-hyp">{e.hypothesis}</span>
                <span className="mono rf-files">{e.files.map((f) => f.split("/").pop()).join(" ")}</span>
              </button>
            );
          })}
        </div>

        <div className="rf-gate" style={{ left: `${X.gate - 1}%` }} title={`fences, then \`${run.metric}\` – ${run.goal === "max" ? "higher" : "lower"} is better`}>
          {vis.map((e, i) => {
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

      <table className="rf-legend-table" aria-label="Run legend">
        <thead><tr><th scope="col">state</th><th scope="col" className="num">attempts</th><th scope="col" className="num">{run.metric}</th><th scope="col">meaning</th></tr></thead>
        <tbody>
          {(["kept", "reverted", "fenced", "failed"] as Verdict[]).map((v) => {
            const vs = exps.filter((e) => verdict(e) === v);
            return (
              <tr key={v} className={`rf-lg-${v}`}>
                <th scope="row"><i className={v} />{VERDICT_TEXT[v]}</th>
                <td className="num mono">{vs.length}</td>
                <td className="num mono">{vs.length ? vs.map((e) => (e.value === null ? "–" : num(e.value))).join(" · ") : "–"}</td>
                <td>{v === "kept" ? "the new frontier – the next attempt starts from it"
                  : v === "reverted" ? "measured, not better – reverted"
                  : v === "fenced" ? "touched a fence – reverted unrun"
                  : "the metric did not run"}</td>
              </tr>
            );
          })}
          <tr className="rf-lg-base"><th scope="row"><i className="base" />baseline</th><td className="num mono">–</td><td className="num mono">{num(run.baseline)}</td><td>measured on {run.base?.slice(0, 7) || run.branch} before any attempt</td></tr>
        </tbody>
      </table>
      <div className="rf-legend">
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

/**
 * The run on a time axis (module A2): every attempt as a mark at the moment it
 * was measured, its metric value as an exact number on a value scale, kept
 * attempts joined into the frontier step line, baseline dashed. Clicking a
 * mark pins the attempt in the detail panel.
 */
function RunTimeline({ run, onPick, picked }: { run: ResearchRun; onPick: (n: number) => void; picked?: number }) {
  const W = 1200, H = 130, padX = 46, padT = 16, padB = 26;
  const timed = run.experiments.filter((e) => e.at > 0);
  const t0 = Math.min(run.started, ...timed.map((e) => e.at));
  const t1 = Math.max(...timed.map((e) => e.at), run.started + 1);
  const vals = [run.baseline, ...run.experiments.map((e) => e.value).filter((v): v is number => v !== null)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (t: number) => padX + ((t - t0) / (t1 - t0)) * (W - 2 * padX);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const lab = (v: number) => (padT + (1 - (v - lo) / span) * (H - padT - padB));
  const tick = (v: number) => ({ v, at: y(v) });
  const ticks = [hi, lo].map(tick);
  return (
    <div className="rf-time">
      <svg className="rf-time-svg" data-figure viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${run.workflow} run timeline: ${run.experiments.length} attempts from ${t0 ? new Date(t0).toISOString().slice(0, 16).replace("T", " ") : "start"} to ${new Date(t1).toISOString().slice(0, 16).replace("T", " ")}, metric ${run.metric} from ${num(lo)} to ${num(hi)}`}>
        {/* value scale: exact numbers, Grafana style */}
        {ticks.map(({ v, at }) => (
          <g key={v}>
            <line x1={padX} x2={W - padX} y1={at} y2={at} className="rf-t-grid" />
            <text x={padX - 6} y={at + 3} className="rf-t-val" textAnchor="end">{num(v)}</text>
          </g>
        ))}
        <line x1={padX} x2={W - padX} y1={y(run.baseline)} y2={y(run.baseline)} className="rf-t-base" />
        {run.experiments.filter((e) => e.at > 0).map((e) => {
          const v = verdict(e), lit = picked === e.n;
          return e.value === null ? (
            <rect key={e.n} className={`rf-t-mark ${v} ${lit ? "lit" : ""}`} x={x(e.at) - 4} y={H - padB - 8} width={8} height={8}
              onClick={() => onPick(e.n)} tabIndex={-1}><title>#{e.n} {e.hypothesis} – {VERDICT_TEXT[v]}{e.note ? ` – ${e.note}` : ""}</title></rect>
          ) : (
            <g key={e.n} className={`rf-t-mark ${v} ${lit ? "lit" : ""}`} onClick={() => onPick(e.n)}>
              <title>#{e.n} {e.hypothesis} – {VERDICT_TEXT[v]} – {num(e.value)} at {new Date(e.at).toISOString().slice(11, 16).replace("T", " ")}</title>
              {v === "kept" && <path className="rf-t-step" d={`M${x(e.at)},${y(e.best_before ?? e.value)} L${x(e.at)},${y(e.value)}`} />}
              <circle cx={x(e.at)} cy={y(e.value)} r={4} />
              <text x={x(e.at)} y={y(e.value) - 7} className="rf-t-val" textAnchor="middle">{num(e.value)}</text>
            </g>
          );
        })}
        {run.experiments.filter((e) => e.at > 0 && verdict(e) === "kept").map((e, i, kept) => {
          const prev = kept[i - 1];
          return prev ? <line key={e.n} className="rf-t-front" x1={x(prev.at)} x2={x(e.at)} y1={y(prev.value!)} y2={y(e.value!)} /> : null;
        })}
        <text x={padX} y={H - 8} className="rf-t-when" textAnchor="start">{new Date(t0).toISOString().slice(0, 16).replace("T", " ")}</text>
        <text x={W - padX} y={H - 8} className="rf-t-when" textAnchor="end">{new Date(t1).toISOString().slice(0, 16).replace("T", " ")}</text>
      </svg>
    </div>
  );
}
