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
import { blank, takeStashedAdd, type Act, type Tab } from "./data";
import { SuggestionRow } from "./parts";
import { AddForm } from "./AddForm";

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];
const NATIVE: [string, string, string][] = [["claude", "Claude Code subagent", ".claude/agents/kula-"], ["cursor", "Cursor rule", ".cursor/rules/kula-"], ["gemini", "Gemini CLI command", ".gemini/commands/kula/"]];
export default function Workflows({ info, act, onGraph, onWorkspace }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void; setTab?: (t: Tab) => void; onWorkspace?: (agent?: string) => void }) {
  const [sel, setSel] = useState<string>(info.workflow?.name ?? info.workflows[0]?.name ?? "");
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const cur = info.workflows.find((w) => w.name === sel);
  useEffect(() => { if (cur) { setDraft({ ...blank(), ...cur, memory: cur.memory || "write" }); setOrig(cur.name); } }, [sel, info]);
  // A workflow created from the map's Library rail lands here selected (see
  // workspace.tsx stashNewItem).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("kula.agents.new");
      if (!raw) return;
      sessionStorage.removeItem("kula.agents.new");
      const { kind, name } = JSON.parse(raw) as { kind: string; name: string };
      if (kind === "agent" && name) setSel(name);
    } catch { /* private mode */ }
  }, []);
  const own = info.workflows.filter((w) => !w.builtin);
  const dirty = !!draft && !!cur && JSON.stringify({ ...blank(), ...cur, memory: cur.memory || "write", builtin: undefined }) !== JSON.stringify({ ...draft, builtin: undefined });
  const isNew = orig === null;
  // The one add flow (module R1): the strip's + opens the compact AddForm –
  // name, role, fence, start-from – instead of a half-built draft editor.
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (takeStashedAdd() === "agent") { setDraft(null); setOrig(null); setAdding(true); } }, []);

  const save = async () => {
    if (!draft) return;
    const next = [...own.filter((w) => w.name !== orig && w.name !== draft.name), { ...draft, builtin: undefined, memory: draft.memory === "write" ? "" : draft.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${draft.name} to kula.toml`).catch(() => {});
    setSel(draft.name);
  };
  const createFrom = async (wf: Workflow) => {
    const next = [...own.filter((w) => w.name !== wf.name), { ...wf, builtin: undefined, memory: wf.memory === "write" ? "" : wf.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${wf.name} to kula.toml`).catch(() => {});
    setAdding(false);
    setSel(wf.name);
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
    <div className="wf-tabs">
      {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
      {/* the agents as a list – one row each, the editor opens under the list */}
      <div className="wf-list" role="tablist" aria-label="Workflows" aria-orientation="vertical">
        {info.workflows.map((w) => (
          <button key={w.name} role="tab" aria-selected={!isNew && sel === w.name} className={`wf-row ${!isNew && sel === w.name ? "on" : ""}`} onClick={() => { setAdding(false); setSel(w.name); }} data-testid={`wf-row-${w.name}`}>
            <span className={`wf-dot ${info.workflow?.name === w.name ? "live" : ""}`} title={info.workflow?.name === w.name ? "in use now" : undefined} />
            <span className="wf-row-main"><span className="mono wf-row-name">{w.name}</span><span className="wf-row-about">{w.about || <span className="muted">no role yet</span>}</span></span>
            <span className="wf-row-tags">
              {(w.scope ?? []).slice(0, 2).map((p) => <span key={p} className="tag mono">{p}</span>)}
              <span className="muted wf-row-n">{w.steps?.length ?? 0} steps</span>
              <span className="tag">{w.builtin ? "built in" : "kula.toml"}</span>
            </span>
          </button>
        ))}
        <button className="wf-row wf-add" aria-label="New workflow" onClick={() => { setDraft(null); setOrig(null); setAdding(true); }} data-testid="wf-add"><Icon.plus /><span>New agent</span></button>
      </div>
      {adding && <AddForm kind="agent" info={info} onCreate={createFrom} onCancel={() => setAdding(false)} />}
      {!adding && isNew && draft && (
        <div className="wf-from">
          <span className="muted">start from</span>
          {info.workflows.map((w) => (
            <button key={w.name} className="chip-toggle" title={w.about} onClick={() => setDraft({ ...blank(), ...w, name: `${w.name}-copy`, builtin: undefined, memory: w.memory || "write" })}>{w.name}</button>
          ))}
          <button className="chip-toggle" onClick={() => setDraft(blank())}>blank</button>
        </div>
      )}
      {draft ? (
        <section className="card wf-edit">
          <div className="card-head">
            <h2>{isNew ? "New workflow" : draft.name}</h2>
            {!isNew && (cur?.builtin ? <span className="tag">built in – saving overrides it in kula.toml</span> : BUILTIN.includes(orig!) ? <span className="tag accent">overrides the built-in</span> : <span className="tag">kula.toml</span>)}
            <span className="spacer" />
            {!isNew && <button className="btn sm ghost" onClick={() => onGraph(orig!)}><Icon.graph /> Preview fences</button>}
            {!isNew && onWorkspace && <button className="btn sm" onClick={() => onWorkspace(orig!)} data-testid="wf-use-workspace"><Icon.workspace /> Use on Workspace</button>}
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
