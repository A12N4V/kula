// Where a team's agents sit on its map (views/AgentMap.tsx): rows by who
// answers to whom, agents of one workflow side by side so they share a
// territory, and the colour each workflow's territory gets.

import type { Team, Workflow } from "../api";
import { hue } from "../colors";


type M = Team["members"][number];

/** The colour a workflow's territory gets: its place in the workflow list. */
export function workflowColor(workflows: Workflow[], name?: string) {
  if (!name) return "#867d73";
  const i = workflows.findIndex((w) => w.name === name);
  return i < 0 ? "#867d73" : hue(i);
}

/** Where each member sits: rows by depth in the hierarchy, agents of one workflow side by side. */
export function teamLayout(team: Team) {
  const members = team.members.filter((m) => m.agent.trim());
  const rows: M[][] = [];
  for (const m of members) (rows[depth(m, members)] ??= []).push(m);
  rows.forEach((r) => r?.sort((a, b) => (a.workflow ?? "").localeCompare(b.workflow ?? "") || a.agent.localeCompare(b.agent)));
  const at = new Map<string, { x: number; y: number }>();
  rows.forEach((r, d) => r?.forEach((m, i) => at.set(m.agent, { x: (i - (r.length - 1) / 2) * 1.7, y: -d * 1.5 })));
  return at;
}

function depth(m: M, all: M[]): number {
  let d = 0, cur = m.reports_to;
  while (cur && d <= all.length) { d++; cur = all.find((x) => x.agent === cur)?.reports_to; }
  return d;
}
