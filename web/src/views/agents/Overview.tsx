
// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Overview tab: the control plane (module A2). One roster row per agent – what
// it is wired to, what it can see, what it has done and where it sits – then
// loops and teams as compact rows with status; every cell links to the tab
// that owns it. The task, what needs a person, the workflow tiles and the
// state tables below stay.

import { relTime, type AgentsInfo, type Connection, type GuardLevel } from "../../api";
import { Icon, StatTable } from "../../ui";
import type { Act } from "./data";
import type { Tab } from "./data";
import { AgentMark, Card, Loop, ListFilter, RunSummary, SuggestionRow, StartTask, WorkflowTile, useFilterList } from "./parts";
import { AGENT_NAME } from "./data";

/** One agent's row in the roster, computed from what /api/agents actually reports. */
type RosterRow = {
  c: Connection;
  skills: number; strays: number;
  attempts: { kept: number; total: number } | null;
  seats: number;
  last: number | null;
  fenceHits: null; // not reported per agent by the runtime – shown as "–", never faked
};

export default function Overview({ info, act, setTab, onGraph, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; onGraph: (wf?: string) => void; open: (t: string) => void }) {
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const by = (l: GuardLevel) => fenced.filter((f) => f.verdict.level === l).length;
  const stale = info.memories.filter((m) => m.stale);
  const wf = info.workflow;

  const roster: RosterRow[] = info.connections.map((c) => {
    const skills = (info.skills ?? []).filter((s) => s.targets[c.id]).length;
    const strays = (info.skill_strays ?? []).filter((s) => s.agent === c.id).length;
    const exps = info.research.flatMap((r) => r.experiments).filter((e) => e.by === `agent:${c.id}`);
    const kept = exps.filter((e) => e.kept).length;
    const last = info.memories.filter((m) => m.author === `agent:${c.id}`).map((m) => m.created).reduce<number | null>((a, v) => (a === null || v > a ? v : a), null);
    return { c, skills, strays, attempts: exps.length ? { kept, total: exps.length } : null, seats: info.teams.filter((t) => t.members.some((m) => m.agent === c.id)).length, last, fenceHits: null };
  });
  const { filter, setFilter, inputRef, props: rosterNav, sel } = useFilterList(roster.length, (i) => setTab("connect"));
  const visible = roster.filter((r) => (AGENT_NAME[r.c.id] ?? r.c.id).toLowerCase().includes(filter.toLowerCase()));
  const loops = info.workflows.filter((w) => w.research?.metric);

  return (
    <>
      <Card title="Roster" sub="every agent, what it may do, what it has done"
        right={<ListFilter inputRef={inputRef} value={filter} onChange={setFilter} label="Filter roster" />}>
        <div className="roster" role="grid" aria-label="Agent roster" {...rosterNav}>
          <div className="roster-head" role="row" aria-hidden="true">
            <span>agent</span><span>wired</span><span>skills</span><span>mcp</span><span>last seen</span><span>fence hits</span><span>research</span><span>seats</span>
          </div>
          {visible.map((r, vi) => (
            <button key={r.c.id} role="row" tabIndex={-1} data-idx={vi} id={`list-item-${vi}`}
              className={`roster-row ${sel === vi ? "kb-sel" : ""} ${vi % 2 ? "odd" : ""}`}
              onClick={() => setTab("connect")} title="open Connect for this agent">
              <span className="roster-agent" role="gridcell"><AgentMark id={r.c.id} size={16} /><b>{AGENT_NAME[r.c.id] ?? r.c.name}</b></span>
              <span className="roster-wired" role="gridcell">
                <span className={`tag ${r.c.mcp ? "ok" : ""}`}>{r.c.mcp ? "connected" : "not wired"}</span>
                <span className={`tag ${r.c.hook ? "ok" : ""}`}>{r.c.hook ? "hook" : "no hook"}</span>
              </span>
              <span className="roster-num" role="gridcell" title="skills this agent carries" onClick={(e) => { e.stopPropagation(); setTab("skills"); }}>
                {r.skills}{r.strays ? ` +${r.strays} stray` : ""}<Icon.arrow />
              </span>
              <span className="roster-num" role="gridcell" title={r.c.files.filter((f) => f.includes("mcp")).join(", ") || "no MCP config"} onClick={(e) => { e.stopPropagation(); setTab("connect"); }}>
                {r.c.mcp ? r.c.files.filter((f) => f.includes("mcp")).length : 0}
              </span>
              <span className="roster-num" role="gridcell" title={r.last ? "latest memory kept by this agent" : "no activity recorded yet"}>
                {r.last ? relTime(r.last) : "–"}
              </span>
              <span className="roster-num" role="gridcell" title="fence hits are not reported per agent yet – shown only as totals in Fences" onClick={(e) => { e.stopPropagation(); setTab("fences"); }}>–</span>
              <span className="roster-num" role="gridcell" title="research attempts kept / total by this agent" onClick={(e) => { e.stopPropagation(); setTab("research"); }}>
                {r.attempts ? `${r.attempts.kept}/${r.attempts.total}` : "–"}
              </span>
              <span className="roster-num" role="gridcell" title="teams this agent holds a seat on" onClick={(e) => { e.stopPropagation(); setTab("teams"); }}>{r.seats}</span>
            </button>
          ))}
          {!visible.length && <div className="muted ag-empty">No agent matches “{filter}”.</div>}
          <div className="muted ag-meta roster-hint">j / k move · enter opens Connect · / filters{sel >= 0 ? " · esc clears" : ""}</div>
        </div>
      </Card>

      <div className="ag-grid ag-control">
        <Card title="Loops" sub={loops.length ? undefined : "none yet"} className="ag-col-card"
          right={<button className="btn sm ghost" onClick={() => setTab("research")}>Open <Icon.arrow /></button>}>
          {loops.map((w) => {
            const run = info.research.find((r) => r.workflow === w.name);
            return (
              <button key={w.name} className="loop-row" onClick={() => setTab("research")} title={`open ${w.name} in Research`}>
                <b className="mono">{w.name}</b>
                {run?.active ? <span className="tag accent">running</span> : run ? <span className="tag">finished</span> : <span className="tag">not started</span>}
                {run && <span className="muted mono">{run.experiments.filter((e) => e.kept).length}/{run.experiments.length} kept · best {run.best}</span>}
                <span className="muted">{w.research!.metric}</span>
              </button>
            );
          })}
          {!loops.length && <div className="muted ag-empty">No loop is measuring anything – set one up in Research.</div>}
        </Card>

        <Card title="Teams" sub={info.team ? `${info.team.name} at work` : info.teams.length ? `${info.teams.length} saved – none at work` : undefined}
          right={<button className="btn sm ghost" onClick={() => setTab("teams")}>{info.teams.length ? "Open" : "Set up"} <Icon.arrow /></button>}>
          {info.teams.map((t) => (
            <button key={t.name} className="loop-row" onClick={() => setTab("teams")} title={`open ${t.name} in Teams`}>
              <b className="mono">{t.name}</b>
              {info.team?.name === t.name ? <span className="tag accent">at work</span> : <span className="tag">saved</span>}
              <span className="muted">{t.members.length} seat{t.members.length === 1 ? "" : "s"} · {[...new Set(t.members.map((m) => AGENT_NAME[m.agent] ?? m.agent))].join(", ")}</span>
            </button>
          ))}
          {!info.teams.length && <div className="muted ag-empty">No teams.</div>}
        </Card>

        <Card title="At a glance" className="ag-col-card">
          <StatTable className="ag-stats" label="Agents at a glance" rows={[
        { label: "Workflows", value: info.workflows.length, onClick: () => setTab("workflows") },
        { label: "Research loops", value: loops.length, note: info.research.some((r) => r.active) ? "one running" : undefined, onClick: () => setTab("research") },
        { label: "Teams", value: info.teams.length, note: info.team ? `${info.team.name} at work` : undefined, onClick: () => setTab("teams") },
        { label: "Skills", value: info.skills?.length ?? 0, note: info.skills?.some((s) => Object.values(s.targets).some((t) => t === "missing" || t === "differs")) ? "out of sync" : undefined, tone: info.skills?.some((s) => Object.values(s.targets).some((t) => t === "missing" || t === "differs")) ? "review" : "", onClick: () => setTab("skills") },
        { label: "Fence rules", value: info.rules.length, onClick: () => setTab("fences") },
        { label: "Locked files", value: by("locked"), tone: by("locked") ? "locked" : "", onClick: () => onGraph() },
        { label: "Hidden files", value: by("hidden"), tone: by("hidden") ? "hidden" : "", onClick: () => onGraph() },
        { label: "Pending review", value: by("review"), tone: by("review") ? "review" : "", onClick: () => setTab("fences") },
        { label: "Memories", value: info.memories.length, note: stale.length ? `${stale.length} stale` : undefined, tone: stale.length ? "review" : "", onClick: () => setTab("memory") },
      ]} />
        </Card>
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

        <Card title="Workflows" right={<button className="btn sm ghost" onClick={() => setTab("workflows")}>Edit <Icon.arrow /></button>} className="ag-wide">
          <div className="wf-grid">
            {info.workflows.map((w) => <WorkflowTile key={w.name} w={w} active={info.workflow?.name === w.name} onPreview={() => onGraph(w.name)} />)}
          </div>
        </Card>
      </div>
    </>
  );
}
