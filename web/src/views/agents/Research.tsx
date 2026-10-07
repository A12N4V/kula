// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Research tab: autoresearch loops shown as a static structure – editable
// files against the fenced rest, metric and goal, budget used, the experiment
// flow from solvers through the gate to the frontier (ResearchFlow), over the
// metric-over-time chart.

import { useEffect, useState } from "react";
import { type AgentsInfo, type Workflow } from "../../api";
import { Chips } from "../../Autofill";
import { Icon } from "../../ui";
import { blank, type Act } from "./data";
import { Card, num, pct, RunChart } from "./parts";
import ResearchFlow from "./ResearchFlow";
import type { Go } from "../../nav";
import { workflowColor } from "./TeamOrg";

const RESEARCH_LOOP: { tool: string; what: string; gate?: boolean }[] = [
  { tool: "research", what: "baseline, best, what failed" },
  { tool: "hypothesis", what: "one idea" },
  { tool: "edit", what: "only the scope", gate: true },
  { tool: "experiment", what: "kula runs the metric" },
  { tool: "keep · revert", what: "a commit, or nothing" },
  { tool: "remember", what: "why it worked" },
];

type Links = { open: (t: string) => void; go?: Go };

export default function ResearchTab({ info, act, open, go }: { info: AgentsInfo; act: Act } & Links) {
  const loops = info.workflows.filter((w) => w.research?.metric);
  const [cur, setCur] = useState(loops[0]?.name ?? "");
  const [adding, setAdding] = useState(loops.length === 0);
  const w = loops.find((x) => x.name === cur) ?? loops[0];
  return (
    <Card title="Research" sub={w ? `${loops.length} loop${loops.length > 1 ? "s" : ""}` : undefined} className="ag-wide team-card"
      right={<button className="btn sm ghost" onClick={() => setAdding(true)}><Icon.plus /> loop</button>}>
      {loops.length > 1 && (
        <div className="team-tabs" role="tablist" aria-label="Loops">
          {loops.map((x) => <button key={x.name} role="tab" aria-selected={x.name === w?.name} className={x.name === w?.name ? "on" : ""} onClick={() => { setCur(x.name); setAdding(false); }}>{x.name}{info.research.some((r) => r.workflow === x.name && r.active) && <i className="dot ok" title="running" />}</button>)}
        </div>
      )}
      {adding || !w ? <NewLoop info={info} act={act} done={(n) => { setCur(n); setAdding(false); }} cancel={loops.length ? () => setAdding(false) : undefined} />
        : <LoopPanel key={w.name} w={w} info={info} act={act} open={open} go={go} />}
    </Card>
  );
}

/** One loop, read as a structure: head, files vs fenced, metric, history. */
function LoopPanel({ w, info, act, open, go }: { w: Workflow; info: AgentsInfo; act: Act } & Links) {
  const runs = info.research.filter((r) => r.workflow === w.name);
  const run = runs.find((r) => r.active) ?? runs[0];
  const scope = info.research_scope?.[w.name];
  const color = workflowColor(info.workflows, w.name);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"" | "start" | "stop">("");
  useEffect(() => { if (!confirm) return; const id = setTimeout(() => setConfirm(""), 3000); return () => clearTimeout(id); }, [confirm]);
  const save = (x: Partial<Workflow>) => {
    const own = info.workflows.filter((y) => !y.builtin && y.name !== w.name);
    return act("workflows_save", { workflows: [...own, { ...w, ...x, builtin: undefined }] }, `${w.name} saved`).catch(() => {});
  };
  const used = run ? `${run.experiments.length}${run.budget > 0 ? ` of ${run.budget}` : ""}` : "0";
  return (
    <div className="research">
      <div className="r-head">
        <b className="mono r-name">{w.name}</b>
        {run?.active ? <span className="tag accent">running</span> : run ? <span className="tag">finished</span> : <span className="tag">not started</span>}
        {run && <span className="mono r-branch">{run.branch}</span>}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? "Close editor" : "Edit loop"}</button>
        {run?.active
          ? <button className="btn sm" onClick={() => (confirm === "stop" ? (setConfirm(""), act("research_stop", {}, `${w.name} stopped`).catch(() => {})) : setConfirm("stop"))}>{confirm === "stop" ? "Confirm stop" : "Stop"}</button>
          : <button className="btn sm primary" onClick={() => (confirm === "start" ? (setConfirm(""), act("research_start", { workflow: w.name }, `${w.name} running – baseline measured`).catch(() => {})) : setConfirm("start"))}><Icon.play />{confirm === "start" ? "Confirm start" : "Start"}</button>}
      </div>
      <div className="r-kpis">
        <span><b className="mono">{w.research!.metric}</b> metric</span>
        <span><b>{w.research!.goal === "max" ? "higher" : "lower"}</b> is better</span>
        <span><b>{used}</b> budget used</span>
        {run && <span><b>{num(run.baseline)}</b> baseline</span>}
        {run && <span><b className="lv-open">{num(run.best)}</b> best</span>}
        {run && <span><b>{pct(run).toFixed(1)}%</b></span>}
      </div>
      {editing && (
        <div className="r-edit">
          <MetricEdit w={w} save={save} />
          <LoopSettings w={w} save={save} />
        </div>
      )}
      {run ? <>
        <RunChart run={run} w={1200} h={110} />
        <ResearchFlow run={run} scopeFiles={scope?.files ?? []} openFile={(p) => open(`file:${p}`)} openCommit={(sha) => go?.("history", { sha })} />
      </> : (
        <div className="r-files">
          <div className="r-col" style={{ borderTop: `2px solid ${color}` }}>
            <h3>may edit{scope ? ` – ${scope.files.length} file${scope.files.length === 1 ? "" : "s"}` : ""}</h3>
            {scope?.files.length
              ? scope.files.map((f) => <div key={f} className="r-file mono">{f}</div>)
              : (w.scope?.length ? w.scope.map((s) => <div key={s} className="r-file mono">{s}</div>) : <div className="muted r-file">no scope: the whole repo is in play</div>)}
          </div>
          <div className="r-col">
            <h3>fenced – {scope?.fenced ?? 0} file{scope?.fenced === 1 ? "" : "s"} read only</h3>
            <div className="muted r-file">everything outside the scope: read only; an experiment that touches it is reverted unrun</div>
            {!!w.lock?.length && <div className="r-file">locks {w.lock.join(", ")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function LoopSettings({ w, save }: { w: Workflow; save: (x: Partial<Workflow>) => Promise<unknown> }) {
  const [prompt, setPrompt] = useState(w.prompt ?? "");
  const [scope, setScope] = useState<string[]>(w.scope ?? []);
  const dirty = prompt !== (w.prompt ?? "") || JSON.stringify(scope) !== JSON.stringify(w.scope ?? []);
  return (
    <>
      <div className="mi-kind">loop</div>
      <div className="mi-title mono">{w.name}</div>
      <label className="mi-field"><span>system prompt</span><textarea className="input" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
      <div className="mi-field"><span>may edit</span><Chips values={scope} onChange={setScope} placeholder="src/index/**, tokenize" label="Scope" /></div>
      {w.steps?.length ? <ol className="ag-steps">{w.steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : null}
      <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!dirty} onClick={() => save({ prompt, scope })}>Save</button></div>
    </>
  );
}

function MetricEdit({ w, save }: { w: Workflow; save: (x: Partial<Workflow>) => Promise<unknown> }) {
  const [r, setR] = useState(w.research!);
  const dirty = JSON.stringify(r) !== JSON.stringify(w.research);
  return (
    <div className="stack">
      <input className="input mono" value={r.metric} onChange={(e) => setR({ ...r, metric: e.target.value })} aria-label="Metric command" />
      <div className="row">
        <div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={(r.goal || "min") === g ? "on" : ""} onClick={() => setR({ ...r, goal: g })}>{g === "min" ? "lower" : "higher"}</button>)}</div>
        <input className="input mono research-budget" type="number" min={0} value={r.budget ?? 0} onChange={(e) => setR({ ...r, budget: Math.max(0, Number(e.target.value) || 0) })} aria-label="Budget" title="budget: experiments, 0 for no limit" />
        <span className="spacer" /><button className="btn sm primary" disabled={!dirty} onClick={() => save({ research: r })}>Save</button>
      </div>
    </div>
  );
}

function NewLoop({ info, act, done, cancel }: { info: AgentsInfo; act: Act; done: (name: string) => void; cancel?: () => void }) {
  const own = info.workflows.filter((w) => !w.builtin);
  const taken = info.workflows.filter((w) => w.research?.metric).map((w) => w.name);
  const [name, setName] = useState(taken.includes("autoresearch") ? `research-${taken.length + 1}` : "autoresearch");
  const [metric, setMetric] = useState("");
  const [goal, setGoal] = useState<"min" | "max">("min");
  const [budget, setBudget] = useState(20);
  const [scope, setScope] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const auto = info.workflows.find((w) => w.name === "autoresearch");
  const save = () => {
    const b = info.workflows.find((w) => w.name === name) ?? { ...blank(), name, about: auto?.about ?? "" };
    const w: Workflow = { ...blank(), ...b, builtin: undefined, scope, prompt, steps: b.steps?.length ? b.steps : auto?.steps ?? [], research: { metric, goal, budget } };
    act("workflows_save", { workflows: [...own.filter((x) => x.name !== name), w] }, `${name} saved`).then(() => done(name)).catch(() => {});
  };
  return (
    <div className="team-stage">
      <div className="team-graph">
        <div className="loop">
          {RESEARCH_LOOP.map((st, i) => (
            <div key={st.tool} className={`loop-step ${st.gate ? "gate" : ""}`}>
              {i > 0 && <span className="loop-arrow" aria-hidden="true" />}
              <span className="loop-n">{String(i + 1).padStart(2, "0")}</span><b className="mono">{st.tool}</b><span>{st.what}</span>
            </div>
          ))}
        </div>
      </div>
      <form className="map-inspector" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="mi-kind">new loop{cancel && <><span className="spacer" /><button type="button" className="btn sm ghost icon-only" onClick={cancel} aria-label="Cancel"><Icon.close /></button></>}</div>
        <input className="input mono mi-title" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} aria-label="Workflow name" />
        <label className="mi-field"><span>benchmark</span><input className="input mono" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="cmd whose last number is the score" aria-label="Metric command" /></label>
        <div className="row"><div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={goal === g ? "on" : ""} onClick={() => setGoal(g)}>{g === "min" ? "lower" : "higher"}</button>)}</div>
          <input className="input mono research-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} aria-label="Budget" title="budget" /></div>
        <div className="mi-field"><span>may edit</span><Chips values={scope} onChange={setScope} placeholder="src/index/**" label="Scope" /></div>
        <label className="mi-field"><span>system prompt</span><textarea className="input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
        <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!name || !metric.trim()}>Save loop</button></div>
      </form>
    </div>
  );
}
