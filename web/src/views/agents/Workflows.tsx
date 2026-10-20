// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Workflows tab: the list and the editor for kula.toml's work modes (module S1).

import { useEffect, useMemo, useState } from "react";
import type { AgentsInfo, GuardLevel, Workflow } from "../../api";
import { Mark } from "../../brands";
import { Chips } from "../../Autofill";
import { Empty, Icon } from "../../ui";
import { FlowCanvas, FlowSidebar } from "../../flow";
import { blank, takeStashedAdd, type Act, type Tab } from "./data";
import { SuggestionRow, TabStrip } from "./parts";
import { AddForm } from "./AddForm";

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];
const NATIVE: [string, string, string][] = [["claude", "Claude Code subagent", ".claude/agents/kula-"], ["cursor", "Cursor rule", ".cursor/rules/kula-"], ["gemini", "Gemini CLI command", ".gemini/commands/kula/"]];
export default function Workflows({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void; setTab?: (t: Tab) => void }) {
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
      <TabStrip label="Workflows" addLabel="New workflow" cur={isNew ? "" : sel}
        items={info.workflows.map((w) => ({ key: w.name, label: w.name, dot: info.workflow?.name === w.name, title: w.builtin ? `${w.about ?? "built in"} – double-click makes a renamed copy` : w.about || undefined }))}
        onPick={setSel} onAdd={() => { setDraft(null); setOrig(null); setAdding(true); }}
        onRename={(from, to) => act("workflow_rename", { workflow: from, name: to }, `${from} renamed to ${to}`).then(() => setSel(to)).catch(() => {})} />
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
      {!adding && draft ? <WorkflowGraph draft={draft} set={set} isNew={isNew} /> : null}
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

/**
 * The workflow as a flow (module A3): the steps chain left to right from the
 * entry tile, and the fences (scope, lock, hide, review) plus the docs hang
 * below the entry as attached sub-nodes. Selecting fills the sidebar; the
 * step tinker edits the same draft the form edits, so Save still writes
 * workflows_save to kula.toml exactly as before.
 */
function WorkflowGraph({ draft, set, isNew }: { draft: Workflow; set: (k: keyof Workflow, v: unknown) => void; isNew: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const steps = draft.steps ?? [];
  const fences: [string, string[] | undefined][] = [
    ["scope", draft.scope], ["lock", draft.lock], ["hide", draft.hide], ["review", draft.review], ["docs", draft.docs],
  ];
  // Identity-stable canvas props: the kit re-layouts whenever `nodes` changes
  // identity, and a re-layout during the click's React Flow echo would clear
  // the selection again. The draft is the only real input (selection lives in
  // its own state and rides the kit's controlled selection).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodes = useMemo(() => [
    { id: "wf-root", kind: "tile" as const, entry: true, title: draft.name || "workflow", subtitle: draft.about || undefined, color: "var(--accent)", hasSub: fences.some(([, v]) => v?.length), size: { w: 96, h: 128 } },
    ...steps.map((s, i) => ({
      id: `step:${i}`, kind: "tile" as const, title: s || `step ${i + 1}`,
      subtitle: `step ${i + 1}`, noOut: i === steps.length - 1, size: { w: 128, h: 128 },
    })),
    ...fences.flatMap(([level, vals]) => (vals?.length ? [{
      id: `fence:${level}`, kind: "circle" as const, sub: true, parent: "wf-root", title: level,
      subtitle: `${vals.length} path${vals.length === 1 ? "" : "s"}`, color: level === "docs" ? "var(--blue)" : "var(--yellow)", noOut: true,
    }] : [])),
  ], [draft]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edges = useMemo(() => [
    ...steps.map((_, i) => ({ id: `s:${i}`, source: i === 0 ? "wf-root" : `step:${i - 1}`, target: `step:${i}`, main: true })),
    ...fences.flatMap(([level]) => (draft[level as keyof Workflow] as string[] | undefined)?.length
      ? [{ id: `f:${level}`, source: "wf-root", target: `fence:${level}`, main: false }] : []),
  ], [draft]);
  const selStep = sel?.startsWith("step:") ? Number(sel.slice(5)) : -1;
  const selFence = sel?.startsWith("fence:") ? sel.slice(6) : "";
  const selVals = selFence ? (draft[selFence as keyof Workflow] as string[] | undefined) ?? [] : [];
  const sidebar = (
    <FlowSidebar
      title={selStep >= 0 ? `step ${selStep + 1}` : selFence ? selFence : draft.name || "workflow"}
      desc={selStep >= 0 ? "one instruction in the work mode's loop" : selFence ? (selFence === "docs" ? "files every agent reads first" : `agents may ${selFence === "scope" ? "change only this" : selFence === "lock" ? "read, never edit" : selFence === "hide" ? "never see this" : "edit this – a person checks"}`) : draft.about || "the steps, fences and docs of this work mode"}
      kv={selStep >= 0 ? [["position", `${selStep + 1} of ${steps.length}`], ["instruction", steps[selStep] || "–"]]
        : selFence ? [["paths", selVals.join(", ") || "–"], ["count", String(selVals.length)]]
        : [["steps", String(steps.length)], ["fences", fences.filter(([, v]) => v?.length).map(([k]) => k).join(", ") || "none"], ["memory", draft.memory || "write"], ["metric", draft.research?.metric || "–"]]}
      tinker={selStep >= 0 ? (
        <div className="row wf-tinker">
          <button className="btn sm ghost" disabled={selStep === 0} onClick={() => { const v = [...steps]; [v[selStep - 1], v[selStep]] = [v[selStep], v[selStep - 1]]; set("steps", v); }} aria-label="Move up"><Icon.up /> up</button>
          <button className="btn sm ghost" disabled={selStep === steps.length - 1} onClick={() => { const v = [...steps]; [v[selStep + 1], v[selStep]] = [v[selStep], v[selStep + 1]]; set("steps", v); }} aria-label="Move down"><Icon.down /> down</button>
          <button className="btn sm ghost danger" onClick={() => { set("steps", steps.filter((_, j) => j !== selStep)); setSel(null); }} aria-label="Remove step"><Icon.close /> remove</button>
        </div>
      ) : undefined}
      related={selFence ? selVals.map((v) => <span key={v} className="mono wf-rel">{v}</span>) : undefined}
    />
  );
  return (
    <div className="wf-graph" data-testid="workflow-canvas">
      <FlowCanvas nodes={nodes} edges={edges} selection={sel} onSelect={setSel}
        layoutKey={`wf-${draft.name || "new"}`} ns="agents-workflows" sidebar={sidebar} />
      {isNew && <div className="muted wf-graph-hint">the draft – Save writes it to kula.toml</div>}
    </div>
  );
}
