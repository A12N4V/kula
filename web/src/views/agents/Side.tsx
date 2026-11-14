// Agents: how AI agents work in this repository, and everything you can change
// about it. Every edit here writes the same files the CLI does.

// The two cards that sit beside the agent canvas (P3.14): the task at hand
// and what needs a person. The roster, loops and tiles they used to share a
// page with now live on the canvas and in their own tabs.

import { relTime, type AgentsInfo, type GuardLevel } from "../../api";
import { Icon } from "../../ui";
import type { Act, Tab } from "./data";
import { Card, Loop, SuggestionRow, StartTask } from "./parts";

export function NowCard({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void }) {
  const by = (l: GuardLevel) => info.files.filter((f) => f.verdict.level === l).length;
  const wf = info.workflow;
  return (
<Card title={info.task ? "Now" : "Start a task"} sub={info.task ? `${info.task.by} · ${relTime(info.task.started)}` : undefined} className="ag-now">
  {info.task ? (
    <>
      <div className="ag-task-title">{info.task.title}</div>
      <div className="ag-chips">
        {wf && <span className="tag accent"><Icon.workflow />&nbsp;{wf.name}</span>}
        {info.task.scope.length ? info.task.scope.slice(0, 6).map((s) => <span key={s} className="tag mono">{s}</span>) : <span className="tag">whole repository</span>}
        {info.task.scope.length > 6 && <span className="tag">+{info.task.scope.length - 6}</span>}
      </div>
      <Loop wf={wf} locked={by("locked") + info.files.filter((f) => f.verdict.level === "scope").length} />
      {wf?.steps?.length ? (
        <ol className="ag-steps">{wf.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      ) : null}
      <div className="row">
        <button className="btn sm" onClick={() => onGraph()}><Icon.fence /> See it on the graph</button>
        <span className="spacer" />
        <button className="btn sm" onClick={() => act("task_done", {}, "Task done – its fences are lifted")}>Finish task</button>
      </div>
    </>
  ) : <StartTask info={info} act={act} />}
</Card>
  );
}

export function NeedsCard({ info, act, setTab, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; open: (t: string) => void }) {
  const stale = info.memories.filter((m) => m.stale);
  return (
<Card title="Needs you" className="ag-needs">
  {info.suggestions.length === 0 && stale.length === 0 && info.docs.every((d) => d.current || !d.synced) && info.connections.some((c) => c.mcp) ? (
    <div className="muted ag-empty">Nothing waiting.</div>
  ) : null}
  {info.suggestions.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
  {stale.slice(0, 4).map((m) => (
    <div key={m.id} className="need">
      <span className="tag yellow">stale</span>
      <button className="ag-target mono" onClick={() => open(m.target)}>{m.target.replace(/^(symbol|file):/, "")}</button>
      <span className="need-what">{m.body}</span>
      <button className="btn sm" onClick={() => act("confirm", { id: m.id }, "Still true – re-anchored")}>Still true</button>
    </div>
  ))}
  {stale.length > 4 && <button className="btn sm ghost" onClick={() => setTab("memory")}>{stale.length - 4} more stale memories <Icon.arrow /></button>}
  {info.docs.filter((d) => d.synced && !d.current).map((d) => (
    <div key={d.path} className="need">
      <span className="tag yellow">outdated</span><span className="mono">{d.path}</span><span className="need-what">the brief no longer matches kula.toml</span>
      <button className="btn sm" onClick={() => act("docs_sync", {}, "Brief synced")}>Sync</button>
    </div>
  ))}
  {!info.connections.some((c) => c.mcp) && (
    <div className="need"><span className="tag">setup</span><span className="need-what">No agent is connected yet.</span><button className="btn sm primary" onClick={() => setTab("connect")}>Connect</button></div>
  )}
</Card>
  );
}
