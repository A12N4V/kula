// The agent sidebar: everything the old workflow editor had, opened from a
// card instead of a list row. Now a desktop window (ui/Window) – drag,
// resize, minimise, remembered per agent id. Esc or close returns focus to
// the card that opened it.

import { useEffect, useRef, useState } from "react";
import { Chips } from "../../Autofill";
import { Icon } from "../../ui";
import { Window } from "../../ui/Window";
import type { GuardLevel, Workflow } from "../../api";
import { Mark } from "../../brands";
import type { Act } from "./data";

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];
const NATIVE: [string, string, string][] = [["claude", "Claude Code subagent", ".claude/agents/kula-"], ["cursor", "Cursor rule", ".cursor/rules/kula-"], ["gemini", "Gemini CLI command", ".gemini/commands/kula/"]];

export default function AgentSidebar({ wf, orig, info, isNew, dirty, act, onGraph, onWorkspace, onSet, onSave, onRemove, onClose }: {
  wf: Workflow; orig: string | null; info: import("../../api").AgentsInfo; isNew: boolean; dirty: boolean;
  act: Act;
  onGraph: (wf: string) => void; onWorkspace: (agent?: string) => void;
  onSet: (k: keyof Workflow, v: unknown) => void;
  onSave: () => void; onRemove: () => void; onClose: () => void;
}) {
  // Esc closes the sidebar (the window's own Esc first unwinds full screen)
  // – and focus goes back to the card that opened it.
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.querySelector<HTMLElement>(`[data-testid="ag-card-${CSS.escape(orig ?? wf.name)}"]`);
    ref.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      opener.current?.focus();
    };
  }, []);
  const draft = wf, cur = info.workflows.find((w) => w.name === orig);
  const set = onSet;
  const title = isNew ? "New workflow" : draft.name;
  return (
    <Window id={`agent-sidebar-${orig ?? wf.name}`} title={title} icon={<Icon.gear />} width={480} height={640}
      testId="ag-side" onClose={onClose} className="ag-side-win">
      <span className="mono muted">{isNew ? "new agent" : cur?.builtin ? "built in – saving overrides it in kula.toml" : BUILTIN.includes(orig ?? "") ? "overrides the built-in" : "kula.toml"}</span>
      <div className="ag-side-scroll" ref={ref} tabIndex={-1} aria-label={`Edit ${draft.name}`}>
        <section className="card wf-edit">
          <div className="ag-body wf-form">
            <label><span>name</span><input className="input mono" value={draft.name} onChange={(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))} placeholder="db-migrate" /></label>
            <label><span>role</span><input className="input" value={draft.about ?? ""} onChange={(e) => set("about", e.target.value)} placeholder="One line: what this kind of work is" /></label>
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
            <label><span>skills</span><Chips values={draft.docs ?? []} onChange={(v) => set("docs", v)} placeholder="files to read first, e.g. docs/ARCHITECTURE.md" label="Docs" /></label>
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
            <div className={`wf-research ${draft.research ? "on" : ""}`}>
              <label className="toggle"><input type="checkbox" checked={!!draft.research} onChange={(e) => set("research", e.target.checked ? { metric: "", goal: "min" } : null)} /> <Icon.flask /> autoresearch loop – kula runs a metric and keeps only what improves it</label>
              {draft.research && (
                <div className="wf-research-grid">
                  <label><span>metric</span><input className="input mono" value={draft.research.metric} onChange={(e) => set("research", { ...draft.research!, metric: e.target.value })} placeholder="a command whose last number is the result" aria-label="Metric" /></label>
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
                  <code className="wf-run" title="any other harness">kula run -w {orig} -- {"<agent>"}</code>
                </div>
              </div>
            )}
            <div className="row wf-actions">
              {!isNew && <button className="btn sm ghost" onClick={() => onGraph(orig!)}><Icon.graph /> Preview fences</button>}
              {!isNew && onWorkspace && <button className="btn sm" onClick={() => onWorkspace(orig!)} data-testid="wf-use-workspace"><Icon.workspace /> Use on Workspace</button>}
              <span className="spacer" />
              {!isNew && !dirty && !info.task && <StartIn wf={orig!} act={act} />}
              {!isNew && (BUILTIN.includes(orig ?? "") ? !cur?.builtin : true) && <button className="btn sm ghost danger" onClick={onRemove}>{BUILTIN.includes(orig ?? "") ? "Reset to built-in" : "Delete"}</button>}
              <button className="btn sm primary" disabled={!draft.name || (!dirty && !isNew)} onClick={onSave}>{isNew ? "Create" : "Save"}</button>
            </div>
          </div>
        </section>
      </div>
    </Window>
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

function FenceField({ level, label, hint, values, onChange }: { level: GuardLevel; label: string; hint: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className={`ff ff-${level}`}>
      <div className="ff-head"><span className={`guard-tag ${level}`}>{label}</span><span className="muted">{hint}</span></div>
      <Chips values={values} onChange={onChange} placeholder="globs, paths or symbols" label={label} />
    </div>
  );
}
