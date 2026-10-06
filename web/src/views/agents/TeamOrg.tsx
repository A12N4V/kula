// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// The team as a static org chart: the lead on top, members indented under
// whoever they answer to, orthogonal elbow connectors, hand-offs as labelled
// directed tags. Nothing animates; hierarchy, workflow, scope and hand-offs
// read in the DOM text without hovering. Replaces the sigma team map.

import type { Team, Workflow } from "../../api";
import { hue } from "../../colors";
import { AGENT_NAME } from "./data";
import { AgentMark } from "./parts";

/** The colour a workflow's badge gets: its place in the workflow list. */
export function workflowColor(workflows: Workflow[], name?: string) {
  if (!name) return "#867d73";
  const i = workflows.findIndex((w) => w.name === name);
  return i < 0 ? "#867d73" : hue(i);
}

type Member = Team["members"][number];

/** Members in reading order: roots first (array order), each member's reports under it. */
export function orgRows(members: Member[]): { m: Member; depth: number; orphan: boolean }[] {
  const known = new Set(members.map((m) => m.agent).filter(Boolean));
  const kids = new Map<string, Member[]>();
  const roots: Member[] = [];
  for (const m of members) {
    const p = m.reports_to && known.has(m.reports_to) ? m.reports_to : "";
    const list = p ? kids.get(p) ?? (kids.set(p, []), kids.get(p)!) : roots;
    list.push(m);
  }
  const out: { m: Member; depth: number; orphan: boolean }[] = [];
  const walk = (list: Member[], depth: number) => {
    for (const m of list) {
      const orphan = !!m.reports_to && !known.has(m.reports_to);
      out.push({ m, depth, orphan });
      walk(kids.get(m.agent) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** Local validation, shown inline before the server ever sees it: cycles and references to members that do not exist. */
export function teamProblems(t: Team): string[] {
  const known = new Set(t.members.map((m) => m.agent).filter(Boolean));
  const out: string[] = [];
  for (const m of t.members) {
    if (!m.agent.trim()) { out.push("a member has no agent"); continue; }
    if (m.reports_to && !known.has(m.reports_to)) out.push(`${m.agent} answers to ${m.reports_to}, who is not on the team`);
    for (const h of m.hands_off ?? []) if (h && !known.has(h)) out.push(`${m.agent} hands off to ${h}, who is not on the team`);
  }
  for (const m of t.members) {
    const seen = new Set([m.agent]);
    let cur = m.reports_to;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      cur = t.members.find((x) => x.agent === cur)?.reports_to;
    }
    if (cur) { out.push(`${m.agent}: answers-to forms a cycle`); break; }
  }
  return out;
}

export function TeamOrg({ team, info, selected, onSelect, problems }: {
  team: Team; info: { workflows: Workflow[] }; selected: string | null; onSelect: (agent: string | null) => void;
  problems: Record<string, string[]>;
}) {
  const rows = orgRows(team.members);
  const k = Math.max(0, rows.findIndex((r) => r.m.agent === selected));
  const focus = (dir: 1 | -1) => {
    const next = rows[(k + dir + rows.length) % rows.length];
    onSelect(next.m.agent);
    document.querySelector<HTMLElement>(`[data-org="${CSS.escape(next.m.agent)}"]`)?.focus();
  };
  return (
    <div className="org" role="listbox" aria-label={`Team ${team.name} members`} aria-activedescendant={selected ? undefined : undefined}
      onKeyDown={(e) => {
        if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); focus(1); }
        else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); focus(-1); }
      }}>
      {rows.map(({ m, depth, orphan }) => {
        const errs = problems[m.agent] ?? [];
        return (
          <div key={m.agent} className="org-row" style={{ paddingLeft: depth * 22 }}>
            {depth > 0 && <span className="org-elbow" aria-hidden="true" />}
            <button type="button" role="option" aria-selected={selected === m.agent} data-org={m.agent} tabIndex={0}
              className={`org-card ${selected === m.agent ? "sel" : ""}`}
              onClick={() => onSelect(selected === m.agent ? null : m.agent)}>
              <span className="org-name"><AgentMark id={m.agent} size={14} />{AGENT_NAME[m.agent] ?? (m.agent || "unnamed")}</span>
              <span className="org-role">{m.role || (m.reports_to ? "member" : "lead")}</span>
              <span className="org-wf"><i style={{ background: workflowColor(info.workflows, m.workflow) }} />{m.workflow || "no workflow"}</span>
              {!!m.scope?.length && <span className="org-scope">scope: {m.scope.join(", ")}</span>}
              {m.prompt && <span className="org-scope" title="has its own system prompt">own prompt</span>}
              {!!m.hands_off?.length && m.hands_off.map((h) =>
                <span key={h} className="org-hand">hands off <span aria-hidden="true">→</span> {AGENT_NAME[h] ?? h}</span>)}
              {orphan && m.reports_to && <span className="org-err">answers to {m.reports_to}, who is not a member</span>}
              {errs.map((e) => <span key={e} className="org-err">{e}</span>)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
