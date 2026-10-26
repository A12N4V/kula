// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Research tab: autoresearch loops as portfolio cards – the loop's own
// harmonograph on top (green–teal family, one hue pair per name), mono eyebrow,
// light display title, italic serif description, accent tags. Template cards
// start a custom loop; a card opens the loop's editor panel; built-in loops
// delete as a hide and come back through "restore". The loop editor is the
// same structure view as before: files against the fenced rest, metric and
// goal, budget used, the experiment flow (ResearchFlow) over the
// metric-over-time chart.

import { useEffect, useState } from "react";
import { type AgentsInfo, type Workflow } from "../../api";
import { Chips } from "../../Autofill";
import { Icon, StatTable } from "../../ui";
import { blank, type Act } from "./data";
import { num, pct, RunChart } from "./parts";
import { AgentHarmonograph } from "../../flow/agentMark";
import { CardArt } from "./AgentCard";
import { LOOP_TEMPLATES, BUILTIN_LOOPS, metricFor, type LoopTemplate } from "./templates";
import { GLYPHS, IconPicker, LoopIcon } from "./loopicon";
import ResearchFlow from "./ResearchFlow";
import type { Go } from "../../nav";

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
  // The open loop's editor (null = the card grid only); a template id or
  // "blank" opens the new-loop form, prefilled when a template was picked.
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState<LoopTemplate | "blank" | null>(loops.length === 0 ? "blank" : null); // eslint-disable-line react-hooks/exhaustive-deps -- empty state opens the form once
  const w = loops.find((x) => x.name === sel);
  // Built-in loops the user hid come back here (research_template_save with
  // the mirrored built-in definition lifts the disabled entry).
  const hidden = Object.values(BUILTIN_LOOPS).filter((b) => !info.workflows.some((w) => w.name === b.name));
  const restore = (name: string) => {
    const b = BUILTIN_LOOPS[name];
    if (!b) return;
    act("research_template_save", { workflows: [{ ...blank(), ...b }] }, `${name} restored`).catch(() => {});
  };
  return (
    <div className="rs">
      <div className="rs-head">
        <h2 className="rs-title">Research</h2>
        <span className="mono rs-count">{loops.length} loop{loops.length === 1 ? "" : "s"}</span>
        {info.research.some((r) => r.active) && <span className="tag accent">a loop is running</span>}
        <span className="spacer" />
        {hidden.length > 0 && <span className="rs-restore" data-testid="rs-restore">
          {hidden.map((b) => (
            <button key={b.name} className="btn sm ghost" onClick={() => restore(b.name)} title="the built-in loop was hidden – bring it back">
              <Icon.refresh />restore {b.name}
            </button>
          ))}
        </span>}
      </div>

      {sel && w ? <LoopPanel key={w.name} w={w} info={info} act={act} open={open} go={go}
        onClose={() => setSel(null)} onDelete={() => { setSel(null); }} onRenamed={setSel} /> : null}
      {adding !== null && <NewLoop key={adding === "blank" ? "blank" : adding.id} info={info} act={act} tpl={adding === "blank" ? null : adding}
        done={(n) => { setAdding(null); setSel(n); }} cancel={() => setAdding(null)} />}
      <section className="rs-sec" aria-label="Research loops">
        <h3 className="rs-eyebrow mono">loops</h3>
        <div className="rs-grid">
          {loops.map((x) => <LoopCard key={x.name} w={x} info={info} onOpen={() => setSel(x.name)} />)}
          <button className="card ag-card ag-card-add rs-card" data-testid="rs-card-add" onClick={() => setAdding("blank")} aria-label="New research loop">
            <span className="card__art ag-card-add-art" aria-hidden="true"><Icon.plus /></span>
            <span className="card__body">
              <span className="card__meta">new</span>
              <span className="card__t">New loop</span>
              <span className="card__d">any command whose last printed number is the score</span>
              <span className="card__fmt">from scratch</span>
            </span>
          </button>
        </div>
      </section>
      <section className="rs-sec" aria-label="Loop templates">
        <h3 className="rs-eyebrow mono">start from a template</h3>
        <div className="rs-grid" role="list" data-testid="rs-templates">
          {LOOP_TEMPLATES.map((t) => <TemplateCard key={t.id} t={t} stack={info.stack ?? []} onUse={() => setAdding(t)} />)}
        </div>
        <div className="loop rs-pipeline">
          {RESEARCH_LOOP.map((st, i) => (
            <div key={st.tool} className={`loop-step ${st.gate ? "gate" : ""}`}>
              {i > 0 && <span className="loop-arrow" aria-hidden="true" />}
              <span className="loop-n">{String(i + 1).padStart(2, "0")}</span><b className="mono">{st.tool}</b><span>{st.what}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The loop as a portfolio card: its harmonograph on top (research family –
 *  green to teal, one hue pair hashed from the loop's name), mono eyebrow with
 *  where it lives and whether it runs, a light display title, one line of
 *  description in italic serif, accent tags. Clicking opens the loop's editor;
 *  clicking the art opens the logo studio (module U17), like agent cards. */
function LoopCard({ w, info, onOpen }: { w: Workflow; info: AgentsInfo; onOpen: () => void }) {
  const run = info.research.find((r) => r.workflow === w.name && r.active) ?? info.research.find((r) => r.workflow === w.name);
  const tags = [
    (w.research!.goal || "min") === "min" ? "↓ lower" : "↑ higher",
    w.research!.budget ? `${w.research!.budget} tries` : "",
    (w.scope?.length ?? 0) ? `${w.scope!.length} file glob${w.scope!.length === 1 ? "" : "s"}` : "whole repo",
    run ? (run.active ? "running" : `best ${num(run.best)}`) : "not started",
  ].filter(Boolean);
  return (
    <button className="card ag-card rs-card" data-testid={`rs-card-${w.name}`} onClick={onOpen} aria-haspopup="dialog">
      <span className="card__art" aria-hidden="true"><CardArt name={w.name} family="research" /></span>
      <span className="card__body">
        <span className="card__meta">
          <span className="mono">{w.builtin ? "built in" : "kula.toml"}</span>
          {run?.active && <span className="rs-live">running</span>}
        </span>
        <span className="card__t">{w.name}</span>
        <span className="card__d">{w.about || w.prompt || "an autoresearch loop"}</span>
        <span className="card__fmt">{tags.join(" · ")}</span>
      </span>
    </button>
  );
}

/** A template card: the same layout, its own hue pair hashed from the
 *  template's id. Off-stack templates are dimmed but still usable – the
 *  metric is editable in the form. */
function TemplateCard({ t, stack, onUse }: { t: LoopTemplate; stack: string[]; onUse: () => void }) {
  const m = metricFor(t, stack);
  return (
    <button className={`card ag-card rs-card rs-tpl ${m.fits ? "" : "off"}`} data-testid={`rs-tpl-${t.id}`} onClick={onUse}
      title={m.fits ? undefined : `no command for ${stack.join(", ") || "this stack"} – edit the metric`}>
      <span className="card__art" aria-hidden="true"><CardArt name={t.id} family="research" /></span>
      <span className="card__body">
        <span className="card__meta"><span className="mono">template</span><span>{t.goal === "min" ? "↓ lower" : "↑ higher"}</span></span>
        <span className="card__t">{t.title}</span>
        <span className="card__d">{t.about}</span>
        <span className="card__fmt">{[t.budget ? `${t.budget} tries` : "", m.cmd ? "metric ready" : "your command"].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
}

/** One loop, read as a structure: head, files vs fenced, metric, history. */
function LoopPanel({ w, info, act, open, go, onClose, onDelete, onRenamed }: { w: Workflow; info: AgentsInfo; act: Act; onDelete: () => void; onClose: () => void; onRenamed: (next: string) => void } & Links) {
  const runs = info.research.filter((r) => r.workflow === w.name);
  const run = runs.find((r) => r.active) ?? runs[0];
  const scope = info.research_scope?.[w.name];
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"" | "start" | "stop" | "delete">("");
  useEffect(() => { if (!confirm) return; const id = setTimeout(() => setConfirm(""), 3000); return () => clearTimeout(id); }, [confirm]);
  const save = (x: Partial<Workflow>) => {
    // research_template_save upserts one workflow and keeps every other
    // custom agent in kula.toml (B2) – the old full-list save clobbered them.
    return act("research_template_save", { workflows: [{ ...w, ...x, builtin: undefined }] }, `${w.name} saved`).catch(() => {});
  };
  const del = () => {
    if (confirm !== "delete") { setConfirm("delete"); return; }
    setConfirm("");
    act("research_template_delete", { name: w.name }, w.builtin ? `${w.name} hidden – restore brings it back` : `${w.name} deleted`).then(onDelete).catch(() => {});
  };
  const used = run ? `${run.experiments.length}${run.budget > 0 ? ` of ${run.budget}` : ""}` : "0";
  return (
    <div className="research" data-testid="rs-open">
      <div className="r-head">
        <AgentHarmonograph name={w.name} size={28} family="research" />
        <b className="mono r-name">{w.name}</b>
        {run?.active ? <span className="tag accent">running</span> : run ? <span className="tag">finished</span> : <span className="tag">not started</span>}
        {run && <span className="mono r-branch">{run.branch}</span>}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onClose} aria-label="Close loop">Close</button>
        <button className="btn sm ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? "Close editor" : "Edit loop"}</button>
        <button className="btn sm ghost danger" onClick={del} data-testid="rs-delete">{confirm === "delete" ? (w.builtin ? "Confirm hide" : "Confirm delete") : w.builtin ? "Hide" : "Delete"}</button>
        {run?.active
          ? <button className="btn sm" onClick={() => (confirm === "stop" ? (setConfirm(""), act("research_stop", {}, `${w.name} stopped`).catch(() => {})) : setConfirm("stop"))}>{confirm === "stop" ? "Confirm stop" : "Stop"}</button>
          : <button className="btn sm primary" onClick={() => (confirm === "start" ? (setConfirm(""), act("research_start", { workflow: w.name }, `${w.name} running – baseline measured`).catch(() => {})) : setConfirm("start"))}><Icon.play />{confirm === "start" ? "Confirm start" : "Start"}</button>}
      </div>
      <StatTable className="r-stats" label={`${w.name} at a glance`} rows={[
        { label: "Metric", value: <span className="mono r-metric">{w.research!.metric}</span>, note: w.research!.goal === "max" ? "higher is better" : "lower is better" },
        { label: "Budget used", value: used },
        ...(run ? [
          { label: "Baseline", value: num(run.baseline) },
          { label: "Best", value: num(run.best), tone: "accent" },
          { label: "Better by", value: `${pct(run).toFixed(1)}%` },
        ] : []),
      ]} />
      {editing && (
        <div className="r-edit">
          <MetricEdit w={w} save={save} />
          <LoopSettings w={w} save={save} act={act} onRenamed={onRenamed} />
        </div>
      )}
      {run ? <>
        <RunChart run={run} w={1200} h={110} />
        <ResearchFlow run={run} scopeFiles={scope?.files ?? []} openFile={(p) => open(`file:${p}`)} openCommit={(sha) => go?.("history", { sha })} />
      </> : (
        <div className="r-files">
          <div className="r-col" style={{ borderTop: "2px solid var(--accent)" }}>
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

function LoopSettings({ w, save, act, onRenamed }: { w: Workflow; save: (x: Partial<Workflow>) => Promise<unknown>; act: Act; onRenamed: (next: string) => void }) {
  const [prompt, setPrompt] = useState(w.prompt ?? "");
  const [scope, setScope] = useState<string[]>(w.scope ?? []);
  const [icon, setIcon] = useState(w.research?.icon ?? "");
  const [name, setName] = useState(w.name);
  const dirty = prompt !== (w.prompt ?? "") || JSON.stringify(scope) !== JSON.stringify(w.scope ?? []) || icon !== (w.research?.icon ?? "");
  const renameDirty = name !== w.name && /^[a-zA-Z][\w-]*$/.test(name);
  const rename = () => {
    if (!renameDirty) return;
    act("workflow_rename", { workflow: w.name, name }, `${w.name} renamed to ${name}`)
      .then(() => onRenamed(name))
      .catch(() => {});
  };
  return (
    <>
      <div className="mi-kind">loop</div>
      <div className="mi-field rs-rename">
        <span>name</span>
        <input className="input mono mi-title" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} aria-label="Loop name" data-testid="rs-rename-input" />
        <button className="btn sm ghost" disabled={!renameDirty} onClick={rename} data-testid="rs-rename">Rename</button>
      </div>
      <div className="mi-field"><span>icon</span><IconPicker value={icon} name={w.name} onChange={setIcon} /></div>
      <label className="mi-field"><span>system prompt</span><textarea className="input" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
      <div className="mi-field"><span>may edit</span><Chips values={scope} onChange={setScope} placeholder="src/index/**, tokenize" label="Scope" /></div>
      {w.steps?.length ? <ol className="ag-steps">{w.steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : null}
      <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!dirty} onClick={() => save({ prompt, scope, ...(w.research ? { research: { ...w.research, icon: icon || undefined } } : {}) })}>Save</button></div>
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

/** The new-loop form: opened from a template card (prefilled) or the "+" card.
 *  Saves through research_template_save, which upserts one workflow and keeps
 *  every other custom agent in kula.toml. */
function NewLoop({ info, act, tpl, done, cancel }: { info: AgentsInfo; act: Act; tpl: LoopTemplate | null; done: (name: string) => void; cancel?: () => void }) {
  const stack = info.stack ?? [];
  const start = tpl ?? LOOP_TEMPLATES.find((t) => metricFor(t, stack).fits) ?? LOOP_TEMPLATES[LOOP_TEMPLATES.length - 1];
  const free = (base: string) => { let n = base, i = 2; while (info.workflows.some((w) => w.name === n && w.research?.metric)) n = `${base}-${i++}`; return n; };
  const [name, setName] = useState(free(start.id));
  const [metric, setMetric] = useState(metricFor(start, stack).cmd);
  const [goal, setGoal] = useState<"min" | "max">(start.goal);
  const [budget, setBudget] = useState(start.budget);
  const [scope, setScope] = useState<string[]>(start.scope);
  const [prompt, setPrompt] = useState(start.prompt);
  const [icon, setIcon] = useState(GLYPHS[start.id] ? start.id : "");
  const save = () => {
    const b = info.workflows.find((w) => w.name === name) ?? { ...blank(), name, about: start.about };
    const w: Workflow = { ...blank(), ...b, builtin: undefined, scope, prompt, steps: b.steps?.length ? b.steps : info.workflows.find((x) => x.name === "autoresearch")?.steps ?? [], research: { metric, goal, budget, ...(icon ? { icon } : {}) } };
    act("research_template_save", { workflows: [w] }, `${name} saved`).then(() => done(name)).catch(() => {});
  };
  return (
    <form className="tpl-form rs-form" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="rs-form">
      <div className="mi-kind">new loop{tpl ? <span className="muted"> – from {tpl.title}</span> : null}{cancel && <><span className="spacer" /><button type="button" className="btn sm ghost icon-only" onClick={cancel} aria-label="Cancel"><Icon.close /></button></>}</div>
      <div className="rs-form-head">
        <AgentHarmonograph name={name || "new-loop"} size={64} family="research" />
        <input className="input mono mi-title" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} aria-label="Loop name" />
      </div>
      <div className="mi-field"><span>icon</span><IconPicker value={icon} name={name} onChange={setIcon} /></div>
      <label className="mi-field"><span>metric – the last number it prints</span><textarea className="input mono" rows={3} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="cmd whose last number is the score" aria-label="Metric command" /></label>
      <div className="row"><div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={goal === g ? "on" : ""} onClick={() => setGoal(g)}>{g === "min" ? "lower" : "higher"}</button>)}</div>
        <input className="input mono research-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} aria-label="Budget" title="experiments before it stops; 0 for no limit" /><span className="muted">tries</span></div>
      <div className="mi-field"><span>may edit – the rest is fenced</span><Chips values={scope} onChange={setScope} placeholder="src/**" label="Scope" /></div>
      <label className="mi-field"><span>system prompt</span><textarea className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
      <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!name || !metric.trim()}>Create {name}</button></div>
    </form>
  );
}
