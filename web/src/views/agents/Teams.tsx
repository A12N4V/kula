// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Teams tab (module U16): a tab bar across the top – one tab per team, a "+"
// tab to create one (inline name, Enter saves via team_save) – and below it
// the team as a map canvas (TeamCanvas): members as agent squares with their
// harmonograph, the lead on top, edges from the lead, drag to arrange (saved
// with team_layout). The Details toggle opens TeamSidebar: the agents from the
// Agents tab as small cards with + / −, and the team settings.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentsInfo, Team } from "../../api";
import { Icon, useToast } from "../../ui";
import { takeStashedAdd, type Act, type Tab } from "./data";
import { Card, TabStrip } from "./parts";
import TeamCanvas, { CanvasHead } from "./TeamCanvas";
import TeamSidebar from "./TeamSidebar";

export default function Teams({ info, act, setTab }: { info: AgentsInfo; act: Act; setTab?: (t: Tab) => void }) {
  void setTab; // the tab bar owns navigation now; the prop stays for the caller's shape
  const [teams, setTeams] = useState<Team[]>(info.teams);
  const [cur, setCur] = useState(() => Math.max(0, info.teams.findIndex((t) => t.name === info.team?.name)));
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [side, setSide] = useState(false);
  const [member, setMember] = useState<string | null>(null);
  const tabrow = useRef<HTMLDivElement>(null);
  // TabStrip is shared and does not carry per-item testids; the tabs are ours
  // to name (team-tab-<team name>), so the strip's buttons get them here.
  const teamNames = JSON.stringify(teams.map((t) => t.name));
  useEffect(() => {
    tabrow.current?.querySelectorAll<HTMLButtonElement>(".team-tabs [role=tab]").forEach((b: HTMLButtonElement) => {
      b.setAttribute("data-testid", `team-tab-${b.textContent?.trim() || "unnamed"}`);
    });
  }, [teamNames, cur, adding]);
  const toast = useToast();
  // A team created from the map's Library rail lands here selected: the rail
  // stashes its name just before navigating (see workspace.tsx stashNewItem).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("kula.agents.new");
      if (!raw) return;
      sessionStorage.removeItem("kula.agents.new");
      const { kind, name } = JSON.parse(raw) as { kind: string; name: string };
      if (kind === "team") { const i = teams.findIndex((t) => t.name === name); if (i >= 0) setCur(i); }
    } catch { /* private mode */ }
    // An add entry point elsewhere (roster header, Workspace HUD) opens the
    // "+" tab's inline form.
    if (takeStashedAdd() === "team") setAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Follow the server only when its teams change: the 5 s agents poll hands
  // back a new `info` every time, and must not wipe edits not saved yet.
  const serverTeams = JSON.stringify(info.teams);
  useEffect(() => { if (!dirty) setTeams(info.teams); }, [serverTeams]);
  const empty = (x: unknown): boolean => x === "" || (Array.isArray(x) && x.length === 0) || (x !== null && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0);
  const norm = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(norm).join(",")}]`
      : v !== null && typeof v === "object"
        ? `{${Object.entries(v as object).filter(([, x]) => !empty(x)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${norm(x)}`).join(",")}}`
        : JSON.stringify(v ?? null);
  const dirty = norm(teams) !== norm(info.teams);
  const t = teams[cur];
  // renaming a team carries the teams under it along
  const set = (x: Partial<Team>) => {
    const was = teams[cur]?.name;
    setTeams(teams.map((y, j) => (j === cur ? { ...y, ...x } : x.name !== undefined && y.under === was ? { ...y, under: x.name } : y)));
  };
  // Settings save on their own action the moment they change – the canvas and
  // the sidebar are one source of truth, nothing waits for a Save button.
  const saveTeam = (next: Team, ok = `${next.name} saved`) => {
    setTeams(all => all.map((y) => (y.name === next.name ? next : y)));
    act("team_save", { team: next }, ok).catch((e: Error) => toast(e.message, "err"));
  };
  const create = (name: string) => {
    const team: Team = { name, members: [] };
    act("team_save", { team }, `${name} created`).then(() => {
      setTeams((prev) => [...prev.filter((x) => x.name !== name), team]);
      setCur(teams.length);
      setAdding(false);
      setNewName("");
      setSide(true);
    }).catch((e: Error) => toast(e.message, "err"));
  };
  const remove = (name: string) => {
    act("team_delete", { name }, `${name} deleted`).catch((e: Error) => toast(e.message, "err"));
    // deleting the active team selects another tab, never a blank canvas
    const rest = teams.filter((x) => x.name !== name);
    setTeams(rest);
    setCur((c) => (teams[c]?.name === name ? Math.max(0, c - 1) : c));
    setMember(null);
  };
  const addMember = (workflow: string, agent?: string) => {
    if (!t) return;
    act("team_add_member", { name: t.name, workflow, ...(agent ? { agent } : {}) }, `${workflow} joined ${t.name}`).then(() => {
      setTeams((prev) => prev.map((y, j) => (j === cur && !y.members.some((m) => m.workflow === workflow) ? { ...y, members: [...y.members, { agent: agent ?? "any", workflow }] } : y)));
    }).catch((e: Error) => toast(e.message, "err"));
  };
  const removeMember = (workflow: string) => {
    if (!t) return;
    act("team_remove_member", { name: t.name, workflow }, `${workflow} left ${t.name}`).then(() => {
      setTeams((prev) => prev.map((y, j) => (j === cur ? { ...y, members: y.members.filter((m) => m.workflow !== workflow) } : y)));
      setMember(null);
    }).catch((e: Error) => toast(e.message, "err"));
  };
  const layout = (positions: Record<string, [number, number]>) => {
    if (!t) return;
    setTeams((prev) => prev.map((y, j) => (j === cur ? { ...y, positions } : y)));
    act("team_layout", { name: t.name, positions }, "Layout saved").catch(() => {});
  };
  // The members the canvas knows, with the connected agent filled in when a
  // seat has none: the sidebar's add flow names the seat after its workflow.
  const shown: Team | undefined = useMemo(() => t && ({
    ...t,
    members: t.members.map((m) => ({ ...m, agent: m.agent || "any", workflow: m.workflow ?? "" })),
  }), [t]);
  return (
    <Card title="Teams" sub="kula.toml" className="ag-wide team-card">
      {/* the strip is shared (parts.tsx); the + tab is ours – same look, with a testid */}
      <div className="tc-tabrow" ref={tabrow}>
        <TabStrip label="Teams" addLabel="New team" cur={adding ? "" : String(cur)}
          items={teams.map((x, i) => ({ key: String(i), label: x.name || "unnamed", dot: info.team?.name === x.name }))}
          onPick={(k) => { setCur(Number(k)); setMember(null); }} />
        <button className={`team-tab-add${adding ? " on" : ""}`} data-testid="team-tab-add" aria-label="New team" title="New team"
          onClick={() => { setAdding(true); setNewName(""); }}><Icon.plus /></button>
      </div>
      {adding ? (
        <div className="tc-add" data-testid="team-add-form">
          <input className="input mono" autoFocus data-testid="team-add-name" value={newName} placeholder="team name – e.g. research-crew"
            aria-label="New team name"
            onChange={(e) => setNewName(e.target.value.replace(/[^\w-]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && newName && !teams.some((x) => x.name === newName)) create(newName); if (e.key === "Escape") setAdding(false); }} />
          <span className="tc-add-hint muted">Enter saves the team · Esc cancels</span>
          {teams.some((x) => x.name === newName) && <span className="team-err" role="alert">that name already exists</span>}
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : shown ? (
        <div className={`tc-stage${side ? " tc-with-side" : ""}`}>
          <div className="tc-main">
            <CanvasHead team={shown} live={info.team?.name === shown.name} sideOpen={side} onSide={() => setSide((v) => !v)}
              onWork={() => act("team_start", { name: shown.name }, `${shown.name} at work`).catch((e: Error) => toast(e.message, "err"))}
              onStop={() => act("team_stop", {}, `${shown.name} stood down`).catch(() => {})} />
            <TeamCanvas team={shown} info={info} live={info.team?.name === shown.name} onMove={layout} onOpen={(k) => { setSide(true); setMember(k); }} />
          </div>
          {side && <TeamSidebar team={shown} all={teams} info={info} member={member} act={act} onSet={set}
            onAdd={addMember} onRemove={removeMember} onPickMember={setMember}
            onDelete={() => remove(shown.name)} onClose={() => { setSide(false); setMember(null); }} />}
        </div>
      ) : (
        <div className="muted ag-empty">No teams yet – use the + tab above.</div>
      )}
    </Card>
  );
}
