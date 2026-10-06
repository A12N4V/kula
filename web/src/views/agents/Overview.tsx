// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Overview tab: the task at hand, what needs a person, and the state of
// workflows, research and teams at a glance (module S1).

import { relTime, type AgentsInfo, type GuardLevel } from "../../api";
import { Icon } from "../../ui";
import type { Act } from "./data";
import type { Tab } from "./data";
import { AgentMark, Card, Loop, RunSummary, SuggestionRow, StartTask, WorkflowTile } from "./parts";
import { AGENT_NAME } from "./data";

export default function Overview({ info, act, setTab, onGraph, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; onGraph: (wf?: string) => void; open: (t: string) => void }) {
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const by = (l: GuardLevel) => fenced.filter((f) => f.verdict.level === l).length;
  const stale = info.memories.filter((m) => m.stale);
  const wf = info.workflow;
  return (
    <>
      <div className="ag-strip">
        <Kpi n={info.workflows.length} label="workflows" onClick={() => setTab("workflows")} />
        <Kpi n={info.rules.length} label="fence rules" onClick={() => setTab("fences")} />
        <Kpi n={by("locked")} label="locked files" tone={by("locked") ? "locked" : ""} onClick={() => onGraph()} />
        <Kpi n={by("hidden")} label="hidden files" tone={by("hidden") ? "hidden" : ""} onClick={() => onGraph()} />
        <Kpi n={by("review")} label="pending review" tone={by("review") ? "review" : ""} onClick={() => setTab("fences")} />
        <Kpi n={info.memories.length} label="memories" onClick={() => setTab("memory")} />
        <Kpi n={stale.length} label="stale" tone={stale.length ? "review" : ""} onClick={() => setTab("memory")} />
      </div>

      <div className="ag-grid">
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

        <Card title="Autoresearch" right={<button className="btn sm ghost" onClick={() => setTab("research")}>Open <Icon.arrow /></button>}>
          {info.research[0] ? <RunSummary run={info.research[0]} /> : (
            <div className="stack">
              <div className="row"><button className="btn sm primary" onClick={() => setTab("research")}><Icon.flask /> Set up a loop</button></div>
            </div>
          )}
        </Card>

        <Card title="Team" sub={info.team ? `${info.team.name} · since ${relTime(info.team.started)}` : undefined} right={<button className="btn sm ghost" onClick={() => setTab("teams")}>{info.teams.length ? "Edit" : "Set up"} <Icon.arrow /></button>}>
          {info.team ? (
            <div className="team-mini">
              {(info.teams.find((t) => t.name === info.team!.name)?.members ?? []).map((m, i) => (
                <div key={i} className="row"><AgentMark id={m.agent} /><b>{AGENT_NAME[m.agent] ?? m.agent}</b><span className="tag accent">{m.workflow || "no workflow"}</span><span className="muted">{m.role}</span></div>
              ))}
            </div>
          ) : <div className="muted ag-meta">{info.teams.length ? `${info.teams.length} saved – none at work` : "No teams."}</div>}
        </Card>

        <Card title="Workflows" right={<button className="btn sm ghost" onClick={() => setTab("workflows")}>Edit <Icon.arrow /></button>} className="ag-wide">
          <div className="wf-grid">
            {info.workflows.map((w) => <WorkflowTile key={w.name} w={w} active={info.workflow?.name === w.name} onPreview={() => onGraph(w.name)} />)}
          </div>
        </Card>
      </div>
    </>
  );
}

function Kpi({ n, label, tone = "", onClick }: { n: number; label: string; tone?: string; onClick?: () => void }) {
  return <button className="kpi-cell" onClick={onClick}><b className={tone ? `lv-${tone}` : ""}>{n}</b><span>{label}</span></button>;
}

