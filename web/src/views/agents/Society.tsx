// The society of teams: every team as a box, the teams that answer to it nested
// inside, its lead first and each member as a mark coloured by its workflow.
// Static and readable as text; click a team to edit it. Teams nest through
// kula.toml's `under`, so a team of teams is just more boxes.

import type { Team, Workflow } from "../../api";
import { AGENT_NAME } from "./data";
import { AgentMark } from "./parts";
import { workflowColor } from "./TeamOrg";
import { MiniGraph, type MiniEdge, type MiniNode } from "../MiniGraph";
import { cssVar } from "../GraphView";

/** Teams under each team, in kula.toml order; a team under a missing one is a root. */
export function nesting(teams: Team[]) {
  const names = new Set(teams.map((t) => t.name));
  const kids = new Map<string, Team[]>();
  const roots: Team[] = [];
  for (const t of teams) {
    const up = t.under && names.has(t.under) && t.under !== t.name ? t.under : "";
    if (up) (kids.get(up) ?? (kids.set(up, []), kids.get(up)!)).push(t);
    else roots.push(t);
  }
  return { roots, kids };
}

/** Teams in reading order with their depth, for the tab strip. */
export function societyOrder(teams: Team[]) {
  const { roots, kids } = nesting(teams);
  const out: { t: Team; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (list: Team[], depth: number) => {
    for (const t of list) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push({ t, depth });
      walk(kids.get(t.name) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  for (const t of teams) if (!seen.has(t.name)) out.push({ t, depth: 0 });
  return out;
}

export function Society({ teams, workflows, cur, active, onPick }: {
  teams: Team[]; workflows: Workflow[]; cur: string; active?: string; onPick: (name: string) => void;
}) {
  const { roots, kids } = nesting(teams);
  const count = (t: Team, seen = new Set<string>()): number => {
    if (seen.has(t.name)) return 0;
    seen.add(t.name);
    return t.members.length + (kids.get(t.name) ?? []).reduce((n, k) => n + count(k, seen), 0);
  };
  const box = (t: Team, depth: number, seen: Set<string>) => {
    if (seen.has(t.name)) return null;
    seen.add(t.name);
    const lead = t.members.find((m) => !m.reports_to) ?? t.members[0];
    const below = kids.get(t.name) ?? [];
    return (
      <div key={t.name} className={`soc-team ${t.name === cur ? "sel" : ""} ${t.name === active ? "on" : ""}`} data-depth={depth}>
        <button type="button" className="soc-head" onClick={() => onPick(t.name)} aria-pressed={t.name === cur}
          title={`${t.name}: ${t.members.length} agents${below.length ? `, ${below.length} team${below.length === 1 ? "" : "s"} under it` : ""}`}>
          <span className="soc-name">{t.name}</span>
          {lead && <span className="soc-lead"><AgentMark id={lead.agent} size={12} />{AGENT_NAME[lead.agent] ?? lead.agent}</span>}
          <span className="soc-members" aria-label={`${t.members.length} members`}>
            {t.members.map((m) => <i key={m.agent} style={{ background: workflowColor(workflows, m.workflow) }} title={`${AGENT_NAME[m.agent] ?? m.agent} · ${m.workflow || "no workflow"}`} />)}
          </span>
          {below.length > 0 && <span className="soc-n">{count(t)} agents</span>}
          {t.name === active && <span className="tag accent">at work</span>}
        </button>
        {below.length > 0 && <div className="soc-kids">{below.map((k) => box(k, depth + 1, seen))}</div>}
      </div>
    );
  };
  const seen = new Set<string>();
  return <div className="society" aria-label="Teams and the teams under them">{roots.map((t) => box(t, 0, seen))}</div>;
}

/**
 * The same society as a graph, drawn like the codebase map: each team a hub
 * tile with its members around it inside the team's territory, coloured by
 * workflow; teams joined to the team they answer to, members to their lead,
 * and hand-offs as edges with work moving along them. Click a team to edit it.
 */
export function SocietyGraph({ teams, workflows, cur, onPick }: {
  teams: Team[]; workflows: Workflow[]; cur: string; active?: string; onPick: (name: string) => void;
}) {
  const nodes: MiniNode[] = [], edges: MiniEdge[] = [];
  const names = new Set(teams.map((t) => t.name));
  const grey = cssVar("--text-3"), line = cssVar("--line-2"), accent = cssVar("--accent");
  for (const t of teams) {
    const below = teams.filter((k) => k.under === t.name).length;
    nodes.push({ id: `team:${t.name}`, label: t.name, color: cssVar("--text-2"), size: 9 + below * 2, group: t.name, hub: true, glyph: t.name.slice(0, 1).toUpperCase() });
    if (t.under && names.has(t.under) && t.under !== t.name) edges.push({ source: `team:${t.name}`, target: `team:${t.under}`, color: grey, size: 2.5 });
    for (const m of t.members) {
      const id = `seat:${t.name}/${m.agent}`;
      nodes.push({ id, label: `${AGENT_NAME[m.agent] ?? m.agent}${m.role ? ` · ${m.role}` : ""}`, color: workflowColor(workflows, m.workflow), size: m.reports_to ? 5 : 7, group: t.name });
      edges.push({ source: id, target: m.reports_to && t.members.some((x) => x.agent === m.reports_to) ? `seat:${t.name}/${m.reports_to}` : `team:${t.name}`, color: line });
      for (const o of m.hands_off ?? []) if (t.members.some((x) => x.agent === o)) edges.push({ source: id, target: `seat:${t.name}/${o}`, color: accent, flow: true });
    }
  }
  const seats = nodes.length - teams.length;
  return (
    <div className="soc-graph">
      <MiniGraph nodes={nodes} edges={edges} sel={cur ? `team:${cur}` : undefined} label={`Teams as a graph: ${teams.length} teams, ${seats} seats`}
        onPick={(id) => { const t = id.startsWith("team:") ? id.slice(5) : id.slice(5).split("/")[0]; onPick(t); }} />
      <div className="graph-legend">
        <span>{teams.length} teams · {seats} seats</span>
        <span><i className="gk under" />answers to</span>
        <span><i className="gk report" />reports to</span>
        <span><i className="gk hand" />hands off</span>
      </div>
    </div>
  );
}
