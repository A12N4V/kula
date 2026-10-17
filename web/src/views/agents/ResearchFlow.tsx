// Research flow: one autoresearch run drawn as the loop it is (module A2,
// rebuilt on the shared flow canvas in A3). The loop reads as a left-to-right
// pipeline – solvers feed attempts, every attempt meets the gate (the fences,
// then the metric kula runs itself), what beats the frontier is kept as a
// record, and the frontier loops back to start the next attempt. The actual
// solvers, attempts and records hang below their stages as attached sub-nodes;
// selecting one lights its path everywhere. Under the canvas, the attempt list
// (keyboard-first, `/` filters), the timeline, the files the run touched and
// the selected attempt.

import { useMemo, useState } from "react";
import { relTime, type Experiment, type ResearchRun } from "../../api";
import { BRANDS } from "../../brands";
import { AgentMark, ListFilter, num, useFilterList } from "./parts";
import { AGENT_NAME } from "./data";
import { FlowCanvas, FlowSidebar } from "../../flow";

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

  // The pipeline on the canvas: stages left to right, the loop's actual items
  // hanging below each stage. Selecting a node focuses it, like clicking used to.
  const stage = (id: string, title: string, sub: number, entry = false) => ({
    id, kind: "wide" as const, title, subtitle: sub ? `${sub} below` : undefined, entry, size: { w: 160, h: 64 },
  });
  const nodes = [
    stage("st:solvers", "solvers", solvers.length, true),
    stage("st:attempts", "attempts", vis.length),
    stage("st:gate", "gate", 0),
    stage("st:frontier", "frontier", records.length),
    ...solvers.map((s) => ({
      id: `solver:${s.id}`, kind: "circle" as const, sub: true, parent: "st:solvers",
      title: solverName(s.id), subtitle: `${s.kept}/${s.tries} kept`,
      color: BRANDS[s.id]?.color ?? "var(--accent)",
    })),
    ...vis.map((e) => ({
      id: `try:${e.n}`, kind: "circle" as const, sub: true, parent: "st:attempts",
      title: `#${e.n}`, subtitle: `${e.hypothesis.slice(0, 40)} – ${VERDICT_TEXT[verdict(e)]}`,
      color: verdict(e) === "kept" ? "var(--accent)" : verdict(e) === "fenced" ? "var(--red)" : "var(--text-2)",
      dim: anyFocus && !on(e),
    })),
    ...records.map((e) => ({
      id: `rec:${e.n}`, kind: "circle" as const, sub: true, parent: "st:frontier",
      title: num(e.value!), subtitle: `#${e.n} ${e.commit?.slice(0, 7) ?? ""}`,
      color: "var(--accent)", dim: anyFocus && !on(e),
    })),
  ];
  const edges = [
    { id: "p1", source: "st:solvers", target: "st:attempts", main: true },
    { id: "p2", source: "st:attempts", target: "st:gate", main: true },
    { id: "p3", source: "st:gate", target: "st:frontier", main: true },
    // every attempt starts from the frontier: the loop runs back
    { id: "loop", source: "st:frontier", target: "st:solvers", main: false, label: "builds on the best" },
  ];
  const canvasSel = focus.n !== undefined ? `try:${focus.n}`
    : focus.solver ? `solver:${focus.solver}` : null;
  const onCanvasSel = (id: string | null) => {
    if (!id) { if (anyFocus) toggleFocus(-1); setFocus({}); return; }
    if (id.startsWith("try:")) { const n = Number(id.slice(4)); setFocus((f) => (f.n === n ? {} : { n })); }
    else if (id.startsWith("solver:")) toggle({ solver: id.slice(7), n: undefined });
    else if (id.startsWith("rec:")) { const n = Number(id.slice(4)); setFocus((f) => (f.n === n ? {} : { n })); }
  };
  const canvasSidebar = (
    <FlowSidebar
      title={sel ? `attempt ${sel.n}` : focus.solver ? solverName(focus.solver, true) : `${run.workflow} run`}
      desc={sel ? sel.hypothesis : focus.solver ? `${solvers.find((s) => s.id === focus.solver)?.tries ?? 0} tries on ${run.branch}` : `${exps.length} attempts · frontier ${num(run.best)}`}
      kv={sel ? [
        ["by", solverName(solverId(sel.by))],
        ["verdict", VERDICT_TEXT[verdict(sel)]],
        ["measured", sel.value === null ? "–" : num(sel.value)],
        ["files", sel.files.join(", ") || "–"],
      ] : focus.solver ? [
        ["kept", `${solvers.find((s) => s.id === focus.solver)?.kept ?? 0}/${solvers.find((s) => s.id === focus.solver)?.tries ?? 0}`],
        ["gain", num(solvers.find((s) => s.id === focus.solver)?.gain ?? 0)],
      ] : [
        ["metric", run.metric],
        ["baseline", num(run.baseline)],
        ["best", num(run.best)],
        ["attempts", String(exps.length)],
      ]}
    />
  );

  return (
    <div className={`rf ${anyFocus ? "focused" : ""}`}>
      <div className="rf-filter"><ListFilter inputRef={tries.inputRef} value={tries.filter} onChange={tries.setFilter} label="Filter attempts" placeholder="/ filter attempts" /></div>
      <RunTimeline run={run} onPick={(n) => toggleFocus(n)} picked={focus.n} />

      <div className="rf-canvas" data-testid="research-canvas">
        <FlowCanvas nodes={nodes} edges={edges} selection={canvasSel} onSelect={onCanvasSel}
          layoutKey={`research-${run.workflow}`} ns="agents-research" sidebar={canvasSidebar} />
      </div>

      <div className="rf-list mono">
        <div className="rf-tries" {...tries.props}>
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