// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// The team as an org flow on the shared flow canvas (module A3): the lead
// enters on the left, members flow right under whoever they answer to, hand
// -offs ride labelled dashed edges, and each workflow draws a group frame
// around its seats. The right sidebar explains the selection (role, scope,
// fences, memory) and tinkers: change answers-to, toggle hand-offs – the same
// onReport / onHand callbacks the drag gesture used to call, so edits still
// land in kula.toml through the existing teams_save path.

import { useMemo } from "react";
import type { Team, Workflow } from "../../api";
import { hue } from "../../colors";
import { AGENT_NAME } from "./data";
import { SeatMark, keyName, seatName } from "./parts";
import { seatKey, titleFor } from "../../roster";
import { FlowCanvas, FlowSidebar } from "../../flow";

/** The colour a workflow's badge gets: its place in the workflow list. */
export function workflowColor(workflows: Workflow[], name?: string) {
  if (!name) return "#867d73";
  const i = workflows.findIndex((w) => w.name === name);
  return i < 0 ? "#867d73" : hue(i);
}

type Member = Team["members"][number];

/** Members in reading order: roots first (array order), each member's reports under it. */
export function orgRows(members: Member[]): { m: Member; depth: number; orphan: boolean }[] {
  const known = new Set(members.map((m) => seatKey(m)).filter(Boolean));
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
      walk(kids.get(seatKey(m)) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** Local validation, shown inline before the server ever sees it: cycles and references to members that do not exist. */
export function teamProblems(t: Team): string[] {
  const known = new Set(t.members.map((m) => seatKey(m)).filter(Boolean));
  const out: string[] = [];
  for (const m of t.members) {
    if (!seatKey(m).trim()) { out.push("a member has no name"); continue; }
    if (m.reports_to && !known.has(m.reports_to)) out.push(`${seatKey(m)} answers to ${m.reports_to}, who is not on the team`);
    for (const h of m.hands_off ?? []) if (h && !known.has(h)) out.push(`${seatKey(m)} hands off to ${h}, who is not on the team`);
  }
  for (const m of t.members) {
    const seen = new Set([seatKey(m)]);
    let cur = m.reports_to;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      cur = t.members.find((x) => seatKey(x) === cur)?.reports_to;
    }
    if (cur) { out.push(`${seatKey(m)}: answers-to forms a cycle`); break; }
  }
  return out;
}

const seatId = (k: string) => `seat:${k}`;

export function TeamOrg({ team, info, selected, onSelect, problems, onReport, onHand, live }: {
  team: Team; info: { workflows: Workflow[] }; live?: boolean; selected: string | null; onSelect: (agent: string | null) => void;
  problems: Record<string, string[]>;
  /** Rewiring: this member now answers to `to` (or leads when `to` is ""). */
  onReport?: (agent: string, to: string) => void;
  /** Hand work off to them, or stop. */
  onHand?: (agent: string, to: string) => void;
}) {
  // a member cannot answer to someone who (eventually) answers to it
  const under = (a: string, top: string) => { let c = team.members.find((x) => seatKey(x) === a)?.reports_to, n = 0; while (c && n++ < 50) { if (c === top) return true; c = team.members.find((x) => seatKey(x) === c)?.reports_to; } return false; };
  const rows = useMemo(() => orgRows(team.members), [team.members]);

  const nodes = rows.map(({ m, orphan }) => {
    const key = seatKey(m);
    const errs = problems[key] ?? [];
    const others = team.members.map(seatKey).filter((k) => k && k !== key);
    return {
      id: seatId(key),
      kind: "tile" as const,
      title: seatName(m) || "unnamed",
      subtitle: titleFor(m.role || (m.reports_to ? "member" : "lead")),
      color: workflowColor(info.workflows, m.workflow),
      entry: !m.reports_to,
      hasSub: !!m.hands_off?.length,
      // Explicit size: kit layout + React Flow visibility both need it.
      size: { w: 232, h: 152 },
      // The card rides inside the tile box; the canvas owns the click, the
      // classes keep the DOM contract the tests and the drag gestures had.
      icon: (
        <div className={`org-card${selected === key ? " sel" : ""}`} data-org={key}
          role="option" aria-selected={selected === key} draggable="true">
          <span className="org-name"><SeatMark m={m} size={16} live={live} />{seatName(m) || "unnamed"}</span>
          <span className="org-role">{titleFor(m.role || (m.reports_to ? "member" : "lead"))}<span className="org-runner"> · {m.agent ? AGENT_NAME[m.agent] ?? m.agent : "any agent"}</span></span>
          <span className="org-wf"><i style={{ background: workflowColor(info.workflows, m.workflow) }} />{m.workflow || "no workflow"}</span>
          {!!m.scope?.length && <span className="org-scope">scope: {m.scope.join(", ")}</span>}
          {m.prompt && <span className="org-scope" title="has its own system prompt">own prompt</span>}
          {!!m.hands_off?.length && m.hands_off.map((h) =>
            <span key={h} className="org-hand">hands off <span aria-hidden="true">→</span> {keyName(team.members, h)}</span>)}
          {orphan && m.reports_to && <span className="org-err">answers to {m.reports_to}, who is not a member</span>}
          {errs.map((e) => <span key={e} className="org-err">{e}</span>)}
          {others.length > 0 && <span className="org-hint muted" aria-hidden="true">pick in the sidebar to rewire</span>}
        </div>
      ),
    };
  });

  const edges = [
    // answers-to: the main org flow, lead to member
    ...rows.flatMap(({ m }) => (m.reports_to && rows.some((r) => seatKey(r.m) === m.reports_to)
      ? [{ id: `rep:${seatKey(m)}`, source: seatId(m.reports_to), target: seatId(seatKey(m)), main: true }] : [])),
    // hand-offs: dashed, labelled
    ...rows.flatMap(({ m }) => (m.hands_off ?? []).filter((h) => rows.some((r) => seatKey(r.m) === h)).map((h) => ({
      id: `hand:${seatKey(m)}:${h}`, source: seatId(seatKey(m)), target: seatId(h), main: false, label: "hands off",
    }))),
  ];

  // Each workflow draws a group frame around its seats.
  const groups = [...new Set(team.members.map((m) => m.workflow ?? ""))].filter((w) => w).map((w) => ({
    id: `wf:${w}`, label: w, members: team.members.filter((m) => m.workflow === w).map((m) => seatId(seatKey(m))),
  }));

  const sel = selected ? team.members.find((m) => seatKey(m) === selected) : undefined;
  const others = sel ? team.members.map(seatKey).filter((k) => k && k !== selected) : [];
  const sidebar = (
    <FlowSidebar
      title={sel ? seatName(sel) || "unnamed" : team.name || "team"}
      desc={sel
        ? `${titleFor(sel.role || (sel.reports_to ? "member" : "lead"))} · ${sel.agent ? AGENT_NAME[sel.agent] ?? sel.agent : "any agent"}`
        : team.about || "the seats, who answers to whom, and who hands what off"}
      kv={sel ? [
        ["role", titleFor(sel.role || (sel.reports_to ? "member" : "lead"))],
        ["runs on", sel.agent ? AGENT_NAME[sel.agent] ?? sel.agent : "any agent"],
        ["workflow", sel.workflow || "none – kula.toml's fences"],
        ["answers to", sel.reports_to ? keyName(team.members, sel.reports_to) : "nobody – leads"],
        ["hands off to", (sel.hands_off ?? []).map((h) => keyName(team.members, h)).join(", ") || "nobody"],
        ["scope", sel.scope?.length ? sel.scope.join(", ") : "whole repo"],
        ["memory", sel.prompt ? "own system prompt" : "team prompt"],
      ] : [
        ["members", String(team.members.length)],
        ["workflows", [...new Set(team.members.map((m) => m.workflow ?? ""))].filter(Boolean).join(", ") || "none"],
        ["problems", String(Object.values(problems).flat().length)],
      ]}
      tinker={sel && onReport ? (
        <div className="org-tinker">
          <label className="mi-field"><span>answers to</span>
            <select className="input" value={sel.reports_to ?? ""} onChange={(e) => onReport(selected!, e.target.value)} aria-label="Answers to">
              <option value="">nobody – leads</option>
              {others.filter((o) => o === "" || !under(selected!, o)).map((o) => <option key={o} value={o}>{keyName(team.members, o)}</option>)}
            </select>
          </label>
          <div className="mi-field"><span>hands off to</span>
            <div className="team-hands">
              {others.map((o) => {
                const on = (sel.hands_off ?? []).includes(o);
                return <button key={o} type="button" className={`chip-toggle ${on ? "on" : ""}`} aria-pressed={on}
                  onClick={() => onHand?.(selected!, o)}>{keyName(team.members, o)}</button>;
              })}
            </div>
          </div>
        </div>
      ) : undefined}
      related={sel ? (sel.scope?.length ? sel.scope.map((s) => <span key={s} className="mono org-rel">{s}</span>) : <span className="muted">no scope fence – the whole repo</span>) : undefined}
    />
  );

  return (
    <div className="org" role="listbox" aria-label={`Team ${team.name} members`}>
      <FlowCanvas nodes={nodes} edges={edges} groups={groups}
        selection={selected ? seatId(selected) : null}
        onSelect={(id) => onSelect(id ? id.slice("seat:".length) : null)}
        layoutKey={`team-${team.name}-${team.members.length}`} ns="agents-teams"
        sidebar={sidebar} testId="org-canvas" />
    </div>
  );
}