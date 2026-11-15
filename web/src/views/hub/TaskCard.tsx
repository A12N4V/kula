// The task at hand (`kula task start`): its scope, workflow and the loop every
// agent runs on it, with the edit stage held by the fences. With no task, a
// short form starts one. Shown in the inspector when nothing is picked.

import { useState } from "react";
import { relTime, type AgentsInfo } from "../../api";
import { Chips } from "../../Autofill";
import type { Act } from "./data";

/** The agent loop over kula's MCP tools; the edit stage is the fenced one. */
export const LOOP: { tool: string; what: string; gate?: boolean }[] = [
  { tool: "workflows", what: "learn how" },
  { tool: "context_pack", what: "read" },
  { tool: "pre_edit", what: "before a change" },
  { tool: "edit", what: "the hook holds the fences", gate: true },
  { tool: "verify_edit", what: "after" },
  { tool: "remember", what: "keep what was learned" },
];

export function TaskCard({ info, act }: { info: AgentsInfo; act: Act }) {
  const t = info.task;
  const [title, setTitle] = useState("");
  const [wf, setWf] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  if (!t) {
    return (
      <form className="hub-task" aria-label="Start a task" onSubmit={(e) => { e.preventDefault(); if (title.trim()) act("task_start", { title: title.trim(), scope, workflow: wf }, "Task started").then(() => { setTitle(""); setScope([]); }).catch(() => {}); }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the agents are doing" aria-label="Task title" />
        <select className="input mono" value={wf} onChange={(e) => setWf(e.target.value)} aria-label="Workflow">
          <option value="">no workflow</option>
          {info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
        <Chips values={scope} onChange={setScope} placeholder="scope, empty for the whole repo" label="Scope" />
        <div className="hub-row end"><button className="btn sm primary" disabled={!title.trim()}>Start task</button></div>
      </form>
    );
  }
  const held = info.files.filter((f) => f.verdict.level === "locked" || f.verdict.level === "scope").length;
  const steps = info.workflow?.steps ?? [];
  return (
    <div className="hub-task" data-task={t.title}>
      <div className="hub-task-title">{t.title}</div>
      <div className="hub-chips">
        {info.workflow && <span className="tag accent">{info.workflow.name}</span>}
        {t.scope.length ? t.scope.slice(0, 5).map((s) => <span key={s} className="tag mono">{s}</span>) : <span className="tag">whole repo</span>}
        {t.scope.length > 5 && <span className="tag">+{t.scope.length - 5}</span>}
      </div>
      <ol className="hub-loop" aria-label="Agent loop">
        {LOOP.map((s, i) => (
          <li key={s.tool} className={s.gate ? "gate" : ""}>
            <span className="hub-loop-n mono">{String(i + 1).padStart(2, "0")}</span>
            <b className="mono">{s.tool}</b>
            <span className="muted">{s.gate ? (held ? `${held} files held` : "nothing fenced") : s.what}</span>
          </li>
        ))}
      </ol>
      {steps.length > 0 && <p className="hub-task-how muted" title={steps.join("\n")}>{steps.join(" · ")}</p>}
      <div className="hub-row">
        <span className="mono muted">{t.by} · {relTime(t.started)}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => act("task_done", {}, "Task done, fences lifted").catch(() => {})}>Finish task</button>
      </div>
    </div>
  );
}
