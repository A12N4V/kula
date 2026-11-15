// Deploy and schedules (H.8). Deploy launches a saved team on a goal, held to
// the flows its seats cover and a dollar cap; the run then paints in Live.
// The schedules card lists `[[schedule]]` runs with their next fire and a pause.

import { useEffect, useMemo, useState } from "react";
import { api, type FlowMap, type ScheduleInfo, type Team } from "../../api";
import { Icon, useToast } from "../../ui";

/** The plain path a glob starts with: "src/api/**" gives "src/api". */
export function globRoot(g: string): string {
  const i = g.search(/[*?[{]/);
  if (i < 0) return g.replace(/\/+$/, "");
  const head = g.slice(0, i);
  return head.slice(0, Math.max(0, head.lastIndexOf("/")));
}

/** Flows with a file under any seat's own scope, for preselection. */
export function flowsFor(team: Team, map: FlowMap | null): string[] {
  if (!map) return [];
  const roots = team.members.flatMap((m) => m.scope ?? []).filter((s) => !s.startsWith("@")).map(globRoot).filter(Boolean);
  if (roots.length === 0) return [];
  const under = (f: string) => roots.some((r) => f === r || f.startsWith(`${r}/`));
  return map.flows.filter((fl) => fl.files.some(under)).map((fl) => fl.id);
}

export function DeployDialog({ team, map, onClose, onDeployed }: { team: Team; map: FlowMap | null; onClose: () => void; onDeployed: (plan: string) => void }) {
  const toast = useToast();
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const pre = useMemo(() => flowsFor(team, map), [team, map]);
  const [flows, setFlows] = useState<Set<string>>(() => new Set(pre));
  const [busy, setBusy] = useState(false);
  useEffect(() => setFlows(new Set(pre)), [pre]);
  // Preselected first, then the rest, so the list reads as the team's ground.
  const listed = useMemo(() => {
    const all = map?.flows ?? [];
    const on = new Set(pre);
    return [...all.filter((f) => on.has(f.id)), ...all.filter((f) => !on.has(f.id))].slice(0, 24);
  }, [map, pre]);
  const cap = budget.trim() === "" ? null : Number(budget);
  const bad = cap !== null && (!Number.isFinite(cap) || cap <= 0);
  const go = () => {
    if (!goal.trim() || bad) return;
    setBusy(true);
    api.deploy({ team: team.name, goal: goal.trim(), flows: [...flows], budget: cap })
      .then((r) => { toast(`Deployed ${r.slices} ${r.slices === 1 ? "seat" : "seats"}`); onDeployed(r.plan); })
      .catch((e: Error) => toast(e.message, "err"))
      .finally(() => setBusy(false));
  };
  const flip = (id: string) => setFlows((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="scrim" onMouseDown={onClose}>
      <form className="palette hub-deploy" role="dialog" aria-label={`Deploy ${team.name}`} onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <div className="hub-deploy-head">
          <span className="hub-team-dot" style={{ "--team": team.color || "var(--line-2)" } as React.CSSProperties} />
          <h2>Deploy {team.name}</h2>
          <span className="mono muted">{team.members.length} {team.members.length === 1 ? "seat" : "seats"}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </div>
        <label className="hub-deploy-field">
          <span className="mono">Goal</span>
          <input className="input" autoFocus value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What the team should get done" aria-label="Goal" />
        </label>
        <div className="hub-deploy-field">
          <span className="mono">Flows <span className="muted">{flows.size ? `${flows.size} held` : "whole scope"}</span></span>
          {map === null
            ? <p className="muted">Reading the flow map</p>
            : listed.length === 0
              ? <p className="muted">No flows mapped</p>
              : <div className="hub-deploy-flows" role="group" aria-label="Target flows">{listed.map((f) => (
                  <button type="button" key={f.id} className={`hub-deploy-flow${flows.has(f.id) ? " on" : ""}`} aria-pressed={flows.has(f.id)} data-flow={f.id} onClick={() => flip(f.id)} title={f.id}>
                    <span className={`hub-flow-kind ${f.kind}`}>{f.kind[0]}</span>
                    <span className="mono">{f.route || f.entry.name}</span>
                  </button>
                ))}</div>}
        </div>
        <label className="hub-deploy-field">
          <span className="mono">Budget <span className="muted">USD, blank for none</span></span>
          <input className="input mono" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="2.00" aria-label="Budget" aria-invalid={bad} />
        </label>
        <div className="hub-row end">
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn sm primary" disabled={busy || !goal.trim() || bad}>{busy ? "Starting" : "Deploy"}</button>
        </div>
      </form>
    </div>
  );
}

const at = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** `[[schedule]]` runs with their next fire and a pause, polled while shown. */
export function SchedulesCard() {
  const toast = useToast();
  const [list, setList] = useState<ScheduleInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    let t: number | undefined;
    const load = () => api.schedules()
      .then((r) => { if (live) setList(r.schedules); })
      .catch(() => { if (live) setList([]); })
      .finally(() => { if (live) t = window.setTimeout(load, 15000); });
    load();
    return () => { live = false; window.clearTimeout(t); };
  }, []);
  const pause = (s: ScheduleInfo) => {
    const paused = !s.paused;
    setList((l) => l?.map((x) => (x.key === s.key ? { ...x, paused } : x)) ?? null);
    api.schedulePause(s.key, paused).catch((e: Error) => {
      toast(e.message, "err");
      setList((l) => l?.map((x) => (x.key === s.key ? { ...x, paused: s.paused } : x)) ?? null);
    });
  };
  if (!list || list.length === 0) return null;
  return (
    <section className="hub-sec hub-schedules" aria-label="Schedules">
      <h3>Schedules<span className="mono hub-sec-aside">{list.length}</span></h3>
      <ul>{list.map((s) => (
        <li key={s.key} data-schedule={s.key} className={s.paused ? "paused" : ""}>
          <div className="hub-sched-top">
            <span className="hub-sched-name">{s.key}</span>
            <span className="spacer" />
            <label className="hub-toggle" title={s.paused ? "Paused" : "Running on schedule"}>
              <input type="checkbox" checked={!s.paused} onChange={() => pause(s)} aria-label={`Run ${s.key}`} />
            </label>
          </div>
          <div className="mono muted">{s.team} · {s.goal}</div>
          <div className="mono hub-sched-when">
            <span>{s.cron || `on ${s.on}`}</span>
            <span className="spacer" />
            <span className="hub-sched-next">{s.paused ? "paused" : s.next ? `next ${at(s.next)}` : `on ${s.on}`}</span>
          </div>
          {s.error && <div className="err-text mono" title={s.error}>{s.error}</div>}
        </li>
      ))}</ul>
    </section>
  );
}
