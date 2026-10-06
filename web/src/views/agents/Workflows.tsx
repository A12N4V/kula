// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Workflows tab: the list and the editor for kula.toml's work modes (module S1).

import { useEffect, useState } from "react";
import type { AgentsInfo, GuardLevel, Workflow } from "../../api";
import { Mark } from "../../brands";
import { Chips } from "../../Autofill";
import { Empty, Icon } from "../../ui";
import { blank, type Act } from "./data";
import { SuggestionRow, WorkflowTile, useListNav } from "./parts";

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];
const NATIVE: [string, string, string][] = [["claude", "Claude Code subagent", ".claude/agents/kula-"], ["cursor", "Cursor rule", ".cursor/rules/kula-"], ["gemini", "Gemini CLI command", ".gemini/commands/kula/"]];
export default function Workflows({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void }) {
  const [sel, setSel] = useState<string>(info.workflow?.name ?? info.workflows[0]?.name ?? "");
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const cur = info.workflows.find((w) => w.name === sel);
  useEffect(() => { if (cur) { setDraft({ ...blank(), ...cur, memory: cur.memory || "write" }); setOrig(cur.name); } }, [sel, info]);
  const nav = useListNav(info.workflows.length, (i) => setSel(info.workflows[i].name), sel);
  const own = info.workflows.filter((w) => !w.builtin);
  const dirty = !!draft && !!cur && JSON.stringify({ ...blank(), ...cur, memory: cur.memory || "write", builtin: undefined }) !== JSON.stringify({ ...draft, builtin: undefined });
  const isNew = orig === null;

  const save = async () => {
    if (!draft) return;
    const next = [...own.filter((w) => w.name !== orig && w.name !== draft.name), { ...draft, builtin: undefined, memory: draft.memory === "write" ? "" : draft.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${draft.name} to kula.toml`).catch(() => {});
    setSel(draft.name);
  };
  const remove = async () => {
    if (!draft || !orig) return;
    const builtin = BUILTIN.includes(orig);
    if (!confirm(builtin ? `Reset ${orig} to kula's built-in?` : `Delete the ${orig} workflow from kula.toml?`)) return;
    await act("workflows_save", { workflows: own.filter((w) => w.name !== orig) }, builtin ? "Reset to built-in" : "Deleted").catch(() => {});
    if (!builtin) setSel(info.workflows[0]?.name ?? "");
  };
  const set = (k: keyof Workflow, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const sugg = info.suggestions.filter((s) => s.kind === "workflow");

  return (
    <div className="wf-split">
      <div className="wf-list">
        {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
        <div {...nav.props}>
          {info.workflows.map((w, i) => <WorkflowTile key={w.name} w={w} idx={i} sel={nav.sel === i && !isNew} active={info.workflow?.name === w.name} on={sel === w.name && !isNew} onClick={() => setSel(w.name)} />)}
        </div>
        <button className="btn sm wf-new" onClick={() => { setDraft(blank()); setOrig(null); setSel(""); }}><Icon.plus /> New workflow</button>
      </div>
      {draft ? (
        <section className="card wf-edit">
          <div className="card-head">
            <h2>{isNew ? "New workflow" : draft.name}</h2>
            {!isNew && (cur?.builtin ? <span className="tag">built in – saving overrides it in kula.toml</span> : BUILTIN.includes(orig!) ? <span className="tag accent">overrides the built-in</span> : <span className="tag">kula.toml</span>)}
            <span className="spacer" />
            {!isNew && <button className="btn sm ghost" onClick={() => onGraph(orig!)}><Icon.graph /> Preview fences</button>}
          </div>
          <div className="ag-body wf-form">
            <label><span>name</span><input className="input mono" value={draft.name} onChange={(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))} placeholder="db-migrate" /></label>
            <label><span>about</span><input className="input" value={draft.about ?? ""} onChange={(e) => set("about", e.target.value)} placeholder="One line: what this kind of work is" /></label>
            <label className="wf-prompt"><span>prompt</span><textarea className="input" rows={2} value={draft.prompt ?? ""} onChange={(e) => set("prompt", e.target.value)} placeholder="system prompt for every agent in this workflow" aria-label="System prompt" /></label>
            <div className="wf-fence-grid">
              <FenceField level="open" label="scope" hint="agents may change only this" values={draft.scope ?? []} onChange={(v) => set("scope", v)} />
              <FenceField level="locked" label="lock" hint="read, never edit" values={draft.lock ?? []} onChange={(v) => set("lock", v)} />
              <FenceField level="hidden" label="hide" hint="never shown" values={draft.hide ?? []} onChange={(v) => set("hide", v)} />
              <FenceField level="review" label="review" hint="editable, a person checks" values={draft.review ?? []} onChange={(v) => set("review", v)} />
            </div>
            <label><span>memory</span>
              <div className="seg">
                {(["write", "read", "off"] as const).map((m) => <button key={m} type="button" className={(draft.memory || "write") === m ? "on" : ""} onClick={() => set("memory", m)}>{m === "write" ? "recall + remember" : m === "read" ? "recall only" : "off"}</button>)}
              </div>
            </label>
            <div className="wf-steps">
              <span className="wf-lbl">steps</span>
              <ol>
                {(draft.steps ?? []).map((s, i) => (
                  <li key={i}>
                    <span className="loop-n">{String(i + 1).padStart(2, "0")}</span>
                    <input className="input" value={s} onChange={(e) => set("steps", draft.steps!.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Step ${i + 1}`} />
                    <button className="btn sm ghost icon-only" disabled={i === 0} onClick={() => { const v = [...draft.steps!]; [v[i - 1], v[i]] = [v[i], v[i - 1]]; set("steps", v); }} aria-label="Move up"><Icon.up /></button>
                    <button className="btn sm ghost icon-only" disabled={i === draft.steps!.length - 1} onClick={() => { const v = [...draft.steps!]; [v[i + 1], v[i]] = [v[i], v[i + 1]]; set("steps", v); }} aria-label="Move down"><Icon.down /></button>
                    <button className="btn sm ghost icon-only danger" onClick={() => set("steps", draft.steps!.filter((_, j) => j !== i))} aria-label="Remove step"><Icon.close /></button>
                  </li>
                ))}
              </ol>
              <button className="btn sm ghost" onClick={() => set("steps", [...(draft.steps ?? []), ""])}><Icon.plus /> Add step</button>
            </div>
            <label><span>docs</span><Chips values={draft.docs ?? []} onChange={(v) => set("docs", v)} placeholder="files to read first, e.g. docs/ARCHITECTURE.md" label="Docs" /></label>
            <div className={`wf-research ${draft.research ? "on" : ""}`}>
              <label className="toggle"><input type="checkbox" checked={!!draft.research} onChange={(e) => set("research", e.target.checked ? { metric: "", goal: "min" } : null)} /> <Icon.flask /> autoresearch loop – kula runs a metric and keeps only what improves it</label>
              {draft.research && (
                <div className="wf-research-grid">
                  <label><span>metric</span><input className="input mono" value={draft.research.metric} onChange={(e) => set("research", { ...draft.research!, metric: e.target.value })} placeholder="a command whose last number is the result, e.g. cargo bench 2>&1 | grep -o '[0-9.]* ms' | tail -1" aria-label="Metric" /></label>
                  <label><span>better</span>
                    <div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={(draft.research!.goal || "min") === g ? "on" : ""} onClick={() => set("research", { ...draft.research!, goal: g })}>{g === "min" ? "lower" : "higher"}</button>)}</div>
                  </label>
                  <label><span>budget</span><input className="input mono" type="number" min={0} value={draft.research.budget ?? 0} onChange={(e) => set("research", { ...draft.research!, budget: Math.max(0, Number(e.target.value) || 0) })} aria-label="Budget" title="experiments before it stops; 0 for no limit" /></label>
                </div>
              )}
            </div>
            {!isNew && !dirty && (
              <div className="wf-native">
                <span className="wf-lbl">use it in</span>
                <div className="wf-native-row">
                  {NATIVE.map(([id, label, dir]) => {
                    const done = info.connections.find((c) => c.id === id)?.workflows.includes(orig!);
                    return (
                      <button key={id} className={`btn sm ${done ? "ghost" : ""}`} title={`${dir}${orig}`} onClick={() => act("workflow_install", { workflow: orig, targets: [id] }, `${orig} installed as a ${label}`).catch(() => {})}>
                        <Mark id={id} size={14} /> {label}{done && <Icon.check />}
                      </button>
                    );
                  })}
                  <code className="wf-run" title="any other harness">kula run -w {orig} -- &lt;agent&gt;</code>
                </div>
              </div>
            )}
            <div className="row wf-actions">
              {!isNew && (BUILTIN.includes(orig!) ? !cur?.builtin : true) && <button className="btn sm ghost danger" onClick={remove}>{BUILTIN.includes(orig!) ? "Reset to built-in" : "Delete"}</button>}
              <span className="spacer" />
              {!isNew && !dirty && !info.task && <StartIn wf={orig!} act={act} />}
              <button className="btn sm primary" disabled={!draft.name || (!dirty && !isNew)} onClick={save}>{isNew ? "Create" : "Save"}</button>
            </div>
          </div>
        </section>
      ) : <Empty title="Pick a workflow" />}
    </div>
  );
}

function FenceField({ level, label, hint, values, onChange }: { level: GuardLevel; label: string; hint: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className={`ff ff-${level}`}>
      <div className="ff-head"><span className={`guard-tag ${level}`}>{label}</span><span className="muted">{hint}</span></div>
      <Chips values={values} onChange={onChange} placeholder="globs, paths or symbols" label={label} />
    </div>
  );
}

function StartIn({ wf, act }: { wf: string; act: Act }) {
  const [title, setTitle] = useState("");
  return (
    <form className="row start-in" onSubmit={(e) => { e.preventDefault(); act("task_start", { title, workflow: wf }, `Task started in ${wf}`).catch(() => {}); }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Start a task in ${wf}…`} aria-label="Task title" />
      <button className="btn sm" disabled={!title.trim()}><Icon.play /> Start</button>
    </form>
  );
}
