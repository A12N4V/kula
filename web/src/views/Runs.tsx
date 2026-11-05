import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime, type AgentsInfo, type ResearchRun } from "../api";
import { Icon } from "../ui";
import { Harmonograph } from "../harmonograph";
import type { Go } from "../nav";

export type RunState = "running" | "review" | "paused";
/** One agent run, whatever started it: a solo task, a team, or a research loop. */
export type Run = {
  id: string; kind: "Solo" | "Team" | "Research"; task: string; seat: string; fence?: string;
  state: RunState; started: number; details: [string, ReactNode][]; research?: ResearchRun;
};

const fmt = (n: number) => (Number.isFinite(n) ? String(+n.toFixed(4)) : "–");

// The server keeps no run history: what runs is what /api/agents reports as
// in force now (the task, the team) plus the research loops it keeps on disk.
export function toRuns(a: AgentsInfo): Run[] {
  const out: Run[] = [];
  if (a.task) out.push({
    id: "task", kind: "Solo", task: a.task.title, seat: a.task.by, fence: a.task.scope.join(", ") || undefined,
    state: "running", started: a.task.started,
    details: [["Workflow", a.task.workflow || "–"], ["Scope", a.task.scope.join(", ") || "Whole repository"]],
  });
  if (a.team) {
    const t = a.teams.find((x) => x.name === a.team!.name);
    out.push({
      id: `team:${a.team.name}`, kind: "Team", task: t?.about || a.team.name, seat: a.team.by,
      fence: a.team.name, state: "running", started: a.team.started,
      details: [["Team", a.team.name], ["Members", t ? String(t.members.length) : "–"], ["Seats", t?.members.map((m) => m.name || m.workflow || m.agent).filter(Boolean).join(", ") || "–"]],
    });
  }
  for (const r of a.research) {
    const better = r.goal === "min" ? r.best < r.baseline : r.best > r.baseline;
    out.push({
      id: `research:${r.workflow}:${r.started}`, kind: "Research", task: `${r.workflow}: ${r.goal || "track"} ${r.metric}`,
      seat: r.by, fence: r.branch, state: r.active ? "running" : better ? "review" : "paused", started: r.started, research: r,
      details: [["Metric", r.metric], ["Baseline", fmt(r.baseline)], ["Best", fmt(r.best)], ["Budget", `${r.experiments.length} / ${r.budget} experiments`], ["Branch", r.branch], ["Base", r.base]],
    });
  }
  return out.sort((x, y) => Number(y.state === "running") - Number(x.state === "running") || y.started - x.started);
}

export function useRuns(version: number) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.agents().then((a) => { setInfo(a); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load, version]);
  const runs = useMemo(() => (info ? toRuns(info) : []), [info]);
  return { info, err, runs, load };
}

export function RunBadge({ state }: { state: RunState }) {
  return <span className={`run-state ${state}`}><i />{state === "running" ? "Running" : state === "review" ? "Review" : "Paused"}</span>;
}

/** The runs widget: one hairline row per run; a row opens its details inline (or in the host's sidebar). */
export default function Runs({ version, go, selected, onSelect }: { version: number; go: Go; selected?: string | null; onSelect?: (r: Run | null) => void }) {
  const { info, err, runs, load } = useRuns(version);
  const [own, setOwn] = useState<string | null>(null);
  const sel = selected !== undefined ? selected : own;
  const pick = (r: Run) => { const next = sel === r.id ? null : r; if (onSelect) onSelect(next); else setOwn(next?.id ?? null); };
  const picked = onSelect ? null : runs.find((r) => r.id === sel) ?? null;
  const active = runs.filter((r) => r.state === "running").length;

  return (
    <section className="card widget runs" data-testid="runs">
      <div className="card-head">
        <span className="w-ico"><Icon.runs /></span><h2>Runs</h2>
        {info && <span className="muted tnum">{runs.length}{active ? ` · ${active} active` : ""}</span>}
        <span className="spacer" />
        <button className="btn sm" data-testid="run-launch" onClick={() => go("agents", { tab: "teams" })}><Icon.plus /> New run</button>
      </div>
      {err && !info ? <div className="card-empty">Could not load runs. <button className="btn sm ghost" onClick={load}>Retry</button></div>
        : !info ? <div className="card-empty" aria-busy="true">loading…</div>
        : !runs.length ? <div className="card-empty">No runs yet. Put a team to work and its run shows up here.</div>
        : <div role="grid" aria-label="Runs">
            {runs.map((r) => (
              <div key={r.id} role="row" tabIndex={0} data-run={r.id} className={`run-row ${sel === r.id ? "on" : ""}`} onClick={() => pick(r)} onKeyDown={(e) => e.key === "Enter" && pick(r)}>
                <Harmonograph seed={r.seat || r.id} size={18} live={r.state === "running"} />
                <span className="run-task">{r.task}</span>
                <span className="run-meta muted">{r.kind} · {relTime(r.started)}</span>
                <RunBadge state={r.state} />
              </div>
            ))}
          </div>}
      {picked && <RunDetail run={picked} go={go} />}
    </section>
  );
}

export function RunDetail({ run, go }: { run: Run; go: Go }) {
  return (
    <div className="run-detail" data-testid="run-detail">
      <div className="row" style={{ gap: 8 }}><RunBadge state={run.state} /><span className="muted">started {relTime(run.started)} by {run.seat}</span></div>
      <dl className="kv">{run.details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {run.research && run.research.experiments.length > 0 && <div className="run-exp">
        {run.research.experiments.slice().reverse().map((e) => (
          <div key={e.n} className="run-exp-row"><span className="tnum muted">{e.n}</span><span className="grow">{e.hypothesis}</span><span className="tnum">{e.value == null ? "–" : fmt(e.value)}</span>{e.kept && <span className="tag">kept</span>}</div>
        ))}
      </div>}
      <button className="btn sm ghost" onClick={() => go("agents", { tab: run.kind === "Research" ? "research" : "teams" })}><Icon.agents /> Open in Agents</button>
    </div>
  );
}
