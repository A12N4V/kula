// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Teams tab: several agents, each in a workflow, reporting to each other –
// shown as a static org chart, edited in place and keyboard-first (module T1).

import { useEffect, useMemo, useState } from "react";
import { api, type AgentsInfo, type Team } from "../../api";
import { Icon, useToast } from "../../ui";
import { AGENT_IDS, AGENT_NAME, type Act, type Tab } from "./data";
import { TEAM_TEMPLATES, teamFrom, type TeamTemplate } from "./templates";
import { AgentMark, Card, TabStrip, fenceSummary } from "./parts";
import { Society, SocietyGraph, societyOrder } from "./Society";
import { TeamOrg, teamProblems, workflowColor } from "./TeamOrg";

export default function Teams({ info, act, setTab }: { info: AgentsInfo; act: Act; setTab?: (t: Tab) => void }) {
  const [picking, setPicking] = useState(info.teams.length === 0);
  const [teams, setTeams] = useState<Team[]>(info.teams);
  const [view, setView] = useState<"boxes" | "graph">(() => { try { return localStorage.getItem("kula.teams.view") === "boxes" ? "boxes" : "graph"; } catch { return "graph"; } });
  const pickView = (v: "boxes" | "graph") => { setView(v); try { localStorage.setItem("kula.teams.view", v); } catch { /* */ } };
  const [cur, setCur] = useState(() => Math.max(0, info.teams.findIndex((t) => t.name === info.team?.name)));
  useEffect(() => setTeams(info.teams), [info]);
  const dirty = JSON.stringify(teams) !== JSON.stringify(info.teams);
  const t = teams[cur];
  // renaming a team carries the teams under it along
  const set = (x: Partial<Team>) => {
    const was = teams[cur]?.name;
    setTeams(teams.map((y, j) => (j === cur ? { ...y, ...x } : x.name !== undefined && y.under === was ? { ...y, under: x.name } : y)));
  };
  // a new team is saved at once, so its tab is real; edits after that wait for Save
  const create = (t: Team) => {
    const next = [...info.teams, t];
    act("teams_save", { teams: next }, `${t.name} created`).then(() => { setCur(next.length - 1); setPicking(false); }).catch(() => {});
  };
  const rename = (from: string, to: string) => {
    if (teams.some((x) => x.name === to)) return;
    const next = teams.map((y) => (y.name === from ? { ...y, name: to } : y.under === from ? { ...y, under: to } : y));
    act("teams_save", { teams: next }, `${from} renamed to ${to}`).catch(() => {});
  };
  const nest = (name: string, under: string) => setTeams(teams.map((y) => (y.name === name ? { ...y, under } : y)));
  const editor = (
    <>
      <TabStrip label="Teams" addLabel="New team from a template" cur={picking ? "" : String(cur)}
        items={societyOrder(teams).map(({ t: x, depth }) => ({ key: String(teams.indexOf(x)), label: x.name || "unnamed", depth, dot: info.team?.name === x.name, fixed: !info.teams.some((y) => y.name === x.name) }))}
        onPick={(k) => { setCur(Number(k)); setPicking(false); }} onAdd={() => setPicking(true)} onRename={(k, to) => rename(teams[Number(k)].name, to)} />
      {picking ? <TeamPicker info={info} create={create} cancel={teams.length ? () => setPicking(false) : undefined} setTab={setTab} />
        : t ? <TeamEditor key={cur} team={t} all={teams} info={info} on={info.team?.name === t.name} saved={info.teams.some((x) => x.name === t.name)} dirty={dirty}
        set={set} remove={() => { setTeams(teams.filter((_, j) => j !== cur).map((y) => (y.under === t.name ? { ...y, under: t.under ?? "" } : y))); setCur(0); }} act={act} /> : <div className="muted ag-empty">No teams.</div>}
    </>
  );
  return (
    <Card title="Teams" sub="kula.toml" className="ag-wide team-card"
      right={<>{dirty && <button className="btn sm ghost" onClick={() => setTeams(info.teams)}>Revert</button>}<button className="btn sm primary" disabled={!dirty} onClick={() => act("teams_save", { teams }, "Teams saved").catch(() => {})}>Save</button></>}>
      {teams.length > 1 && (
        <div className="soc-view">
          <button className={`btn sm graph-toggle ${view === "graph" ? "on" : ""}`} aria-pressed={view === "graph"} onClick={() => pickView(view === "graph" ? "boxes" : "graph")}
            title="Show the teams as a graph beside the editor, or as nested boxes"><Icon.graph /> Graph {view === "graph" ? "on" : "off"}</button>
        </div>
      )}
      {teams.length > 1 && view === "graph" ? (
        <div className="team-split">
          <SocietyGraph teams={teams} workflows={info.workflows} cur={t?.name ?? ""} active={info.team?.name} onPick={(n) => setCur(Math.max(0, teams.findIndex((x) => x.name === n)))} />
          <div className="team-side">
            {editor}
          </div>
        </div>
      ) : (
        <>
          {teams.length > 1 && <Society teams={teams} workflows={info.workflows} cur={t?.name ?? ""} active={info.team?.name} onPick={(n) => { setCur(Math.max(0, teams.findIndex((x) => x.name === n))); setPicking(false); }} onNest={nest} />}
          {editor}
        </>
      )}
    </Card>
  );
}

function TeamEditor({ team: t, all, info, on, saved, dirty, set, remove, act }: {
  team: Team; all: Team[]; info: AgentsInfo; on: boolean; saved: boolean; dirty: boolean; set: (t: Partial<Team>) => void; remove: () => void; act: Act;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const problems = useMemo(() => teamProblems(t), [t]);
  const perMember: Record<string, string[]> = {};
  for (const p of problems) {
    const who = /(^| )(\S+?):/.exec(p)?.[2];
    if (who) (perMember[who] ??= []).push(p);
  }
  const k = t.members.findIndex((m) => m.agent === sel);
  const setM = (i: number, m: Partial<Team["members"][number]>) => {
    const before = t.members[i].agent;
    let members = t.members.map((x, j) => (j === i ? { ...x, ...m } : x));
    if (m.agent !== undefined && m.agent !== before) {
      members = members.map((x) => ({ ...x, reports_to: x.reports_to === before ? m.agent : x.reports_to, hands_off: x.hands_off?.map((h) => (h === before ? m.agent! : h)) }));
      setSel(m.agent);
    }
    set({ members });
  };
  const move = (i: number, dir: 1 | -1) => {
    const j = i + dir;
    if (j < 0 || j >= t.members.length) return;
    const members = [...t.members];
    [members[i], members[j]] = [members[j], members[i]];
    set({ members });
  };
  const drop = (i: number) => {
    const gone = t.members[i].agent;
    set({ members: t.members.filter((_, j) => j !== i).map((x) => ({ ...x, reports_to: x.reports_to === gone ? "" : x.reports_to, hands_off: x.hands_off?.filter((h) => h !== gone) })) });
    setSel(null);
  };
  const addAgent = () => {
    const agent = AGENT_IDS.find((a) => !t.members.some((m) => m.agent === a)) ?? `agent-${t.members.length + 1}`;
    set({ members: [...t.members, { agent, workflow: "", reports_to: t.members.find((m) => !m.reports_to)?.agent ?? "" }] });
    setSel(agent);
  };
  const saveTeams = () => {
    setErr(null);
    act("teams_save", { teams: all }, "Teams saved").catch((e: Error) => setErr(e.message));
  };
  const used = [...new Set(t.members.map((m) => m.workflow ?? ""))];
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => { if (!confirmStop) return; const id = setTimeout(() => setConfirmStop(false), 3000); return () => clearTimeout(id); }, [confirmStop]);
  return (
    <div className="team-stage">
      <div className="team-graph">
        <TeamOrg team={t} info={info} selected={sel} onSelect={setSel} problems={perMember}
          onReport={(a, to) => setM(t.members.findIndex((m) => m.agent === a), { reports_to: to })}
          onHand={(a, to) => { const m = t.members.find((x) => x.agent === a)!; const h = m.hands_off ?? []; setM(t.members.indexOf(m), { hands_off: h.includes(to) ? h.filter((x) => x !== to) : [...h, to] }); }} />
        <div className="map-legend">
          {used.map((w) => <span key={w}><i style={{ background: workflowColor(info.workflows, w) }} />{w || "no workflow"}</span>)}
          <span><i className="k-line" />answers to</span><span><i className="k-dash" />hands off</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={addAgent}><Icon.plus /> agent</button>
          {on
            ? <button className="btn sm" onClick={() => (confirmStop ? (setConfirmStop(false), act("team_stop", {}, `${t.name} stood down`).catch(() => {})) : setConfirmStop(true))}>{confirmStop ? "Confirm stand down" : "Stand down"}</button>
            : <button className="btn sm primary" disabled={dirty || !saved} title={dirty ? "Save first" : "Each agent works in its own workflow"} onClick={() => act("team_start", { name: t.name }, `${t.name} at work`).catch(() => {})}><Icon.play /> Put to work</button>}
        </div>
      </div>
      <aside className="map-inspector">
        {k >= 0 ? <MemberDetail team={t} k={k} info={info} setM={(m) => setM(k, m)} drop={() => drop(k)} move={(d) => move(k, d)} close={() => setSel(null)} /> : (
          <>
            <div className="mi-kind">team{on && <span className="tag accent">at work</span>}</div>
            <input className="input mono mi-title" value={t.name} onChange={(e) => set({ name: e.target.value.replace(/[^\w-]/g, "") })} aria-label="Team name" />
            <input className="input" value={t.about ?? ""} onChange={(e) => set({ about: e.target.value })} placeholder="about" aria-label="Team about" />
            <label className="mi-field"><span>answers to team</span>
              <select className="input" value={t.under ?? ""} onChange={(e) => set({ under: e.target.value })} aria-label="Answers to team">
                <option value="">none – a top-level team</option>
                {all.filter((x) => x.name !== t.name && !within(all, x.name, t.name)).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
              </select>
            </label>
            <label className="mi-field"><span>team prompt</span>
              <textarea className="input" rows={6} value={t.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} placeholder="every member gets this first" aria-label="Team prompt" />
            </label>
            <div className="mi-hint muted">j / k select a member, enter edits it</div>
            {problems.length > 0 && <div className="team-err" role="alert">{problems.join(" · ")}</div>}
            <div className="row">
              <button className="btn sm primary" disabled={!dirty || problems.length > 0} onClick={saveTeams}>Save</button>
              <span className="spacer" /><button className="btn sm ghost danger" onClick={remove}>Delete team</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** An agent's place and prompt, with the instructions kula will hand it. */
function MemberDetail({ team, k, info, setM, drop, move, close }: { team: Team; k: number; info: AgentsInfo; setM: (m: Partial<Team["members"][number]>) => void; drop: () => void; move: (dir: 1 | -1) => void; close: () => void }) {
  const m = team.members[k];
  const others = team.members.filter((_, j) => j !== k).map((x) => x.agent).filter(Boolean);
  const known = AGENT_IDS.includes(m.agent);
  const [preview, setPreview] = useState<string | null>(null);
  const toast = useToast();
  const show = () => api.agentAction<{ text: string }>("team_prompt", { teams: [team], agent: m.agent }).then((r) => setPreview(r.text)).catch((e) => toast(e.message, "err"));
  useEffect(() => { if (preview !== null) show(); }, [JSON.stringify(team)]); // keep an open preview current
  return (
    <>
      <div className="mi-kind"><AgentMark id={m.agent} size={13} /> agent<span className="spacer" /><button className="btn sm ghost icon-only" onClick={close} aria-label="Back to the team"><Icon.close /></button></div>
      <div className="mi-row">
        <select className="input" value={known ? m.agent : "other"} onChange={(e) => setM({ agent: e.target.value === "other" ? "aider" : e.target.value })} aria-label="Agent">
          {AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAME[a]}</option>)}<option value="other">other…</option>
        </select>
        {!known && <input className="input mono" value={m.agent} onChange={(e) => setM({ agent: e.target.value })} aria-label="Agent name" />}
      </div>
      <label className="mi-field"><span>workflow</span>
        <select className="input" value={m.workflow ?? ""} onChange={(e) => setM({ workflow: e.target.value })} aria-label="Workflow" style={{ borderLeft: `3px solid ${workflowColor(info.workflows, m.workflow)}` }}>
          <option value="">none – kula.toml's fences</option>{info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>role</span><input className="input" value={m.role ?? ""} onChange={(e) => setM({ role: e.target.value })} aria-label="Role" /></label>
      <label className="mi-field"><span>answers to</span>
        <select className="input" value={m.reports_to ?? ""} onChange={(e) => setM({ reports_to: e.target.value })} aria-label="Answers to">
          <option value="">nobody – leads</option>{others.map((o) => <option key={o} value={o}>{AGENT_NAME[o] ?? o}</option>)}
        </select>
      </label>
      <div className="mi-field"><span>hands off to</span>
        <div className="team-hands">
          {others.map((o) => {
            const on = (m.hands_off ?? []).includes(o);
            return <button key={o} className={`chip-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setM({ hands_off: on ? (m.hands_off ?? []).filter((h) => h !== o) : [...(m.hands_off ?? []), o] })}><AgentMark id={o} size={12} /> {AGENT_NAME[o] ?? o}</button>;
          })}
        </div>
      </div>
      <label className="mi-field"><span>system prompt</span>
        <textarea className="input" rows={5} value={m.prompt ?? ""} onChange={(e) => setM({ prompt: e.target.value })} aria-label="System prompt" />
      </label>
      <div className="row">
        <button className="btn sm ghost" onClick={() => move(-1)} aria-label="Move member up" disabled={k === 0}><Icon.up /> up</button>
        <button className="btn sm ghost" onClick={() => move(1)} aria-label="Move member down" disabled={k === team.members.length - 1}><Icon.down /> down</button>
        <button className="btn sm ghost" onClick={() => (preview === null ? show() : setPreview(null))}>{preview === null ? "Full instructions" : "Hide"}</button>
        <span className="spacer" /><button className="btn sm ghost danger" onClick={drop}>Remove</button>
      </div>
      <SeatFacts agent={m.agent} wfName={m.workflow} info={info} />
      {preview !== null && <pre className="code team-preview">{preview}</pre>}
    </>
  );
}

/** Whether team `name` sits somewhere under team `top` (so `top` cannot answer to it). */
function within(all: Team[], name: string, top: string) {
  let cur = all.find((x) => x.name === name)?.under, hops = 0;
  while (cur && hops++ < all.length) {
    if (cur === top) return true;
    cur = all.find((x) => x.name === cur)?.under;
  }
  return false;
}

/** Pick a starting shape: each template drawn as the org it makes, seats filled by the agents connected here. */
function TeamPicker({ info, create, cancel, setTab }: { info: AgentsInfo; create: (t: Team) => void; cancel?: () => void; setTab?: (t: Tab) => void }) {
  const connected = info.connections.filter((c) => c.mcp).map((c) => c.id);
  const loops = info.workflows.filter((w) => w.research?.metric).map((w) => w.name);
  const [pick, setPick] = useState<TeamTemplate>(TEAM_TEMPLATES[0]);
  const [loop, setLoop] = useState(loops[0] ?? "autoresearch");
  const free = (base: string) => { let n = base, i = 2; while (info.teams.some((t) => t.name === n)) n = `${base}-${i++}`; return n; };
  const [name, setName] = useState(free(TEAM_TEMPLATES[0].id));
  const team = teamFrom(pick, name, connected, loop);
  const missing = [...new Set(team.members.map((m) => m.workflow))].filter((w) => w && !info.workflows.some((x) => x.name === w));
  return (
    <div className="tpl">
      <div className="tpl-grid" role="radiogroup" aria-label="Team templates">
        {TEAM_TEMPLATES.map((x) => {
          const preview = teamFrom(x, x.id, connected, loop);
          return (
            <button key={x.id} role="radio" aria-checked={pick.id === x.id} className={`tpl-card ${pick.id === x.id ? "on" : ""}`}
              onClick={() => { setPick(x); setName(free(x.id)); }}>
              <b>{x.title}</b>
              <span className="tpl-about">{x.about}</span>
              <span className="tpl-seats">
                {preview.members.map((m, i) => (
                  <span key={i} className="tpl-seat" style={{ marginLeft: m.reports_to ? 14 : 0, borderLeftColor: workflowColor(info.workflows, m.workflow) }}>
                    <AgentMark id={m.agent} size={11} /> {m.role} <i className="mono">{m.workflow}</i>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <form className="tpl-form" onSubmit={(e) => { e.preventDefault(); create(team); }}>
        <label className="mi-field"><span>name</span><input className="input mono" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} aria-label="Team name" /></label>
        {pick.seats.some((s) => s.workflow === "@loop") && (
          <label className="mi-field"><span>loop to attack</span>
            {loops.length
              ? <select className="input" value={loop} onChange={(e) => setLoop(e.target.value)} aria-label="Research loop">{loops.map((l) => <option key={l}>{l}</option>)}</select>
              : <span className="muted">no loop yet – <button type="button" className="linkish" onClick={() => setTab?.("research")}>set one up in Research</button>; the built-in autoresearch is used until then</span>}
          </label>
        )}
        <div className="tpl-note muted">
          Seats are filled by {connected.length ? `the agents connected here (${connected.map((c) => AGENT_NAME[c] ?? c).join(", ")})` : "Claude, Cursor, Codex and Gemini in turn – connect agents in Connect"}; change any seat after.
          {missing.length > 0 && <> Needs the workflow {missing.join(", ")}.</>}
        </div>
        <div className="row">
          {cancel && <button type="button" className="btn sm ghost" onClick={cancel}>Cancel</button>}
          <span className="spacer" />
          <button className="btn sm primary" disabled={!name || info.teams.some((t) => t.name === name)}>Create {name}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * The seat inspector (module A2): what this seat's workflow fences, the scope
 * the seat is narrowed to, and the skills the agent behind the seat carries –
 * read-only facts beside the editable member fields.
 */
function SeatFacts({ agent, wfName, info }: { agent: string; wfName?: string; info: AgentsInfo }) {
  const w = info.workflows.find((x) => x.name === wfName);
  const fences = w ? fenceSummary(w) : [];
  const scope = info.workflows.find((x) => x.name === wfName)?.scope ?? [];
  const skills = (info.skills ?? []).filter((s) => s.targets[agent]);
  const strays = (info.skill_strays ?? []).filter((s) => s.agent === agent);
  const conn = info.connections.find((c) => c.id === agent);
  return (
    <div className="seat-facts" aria-label={`What ${AGENT_NAME[agent] ?? agent} sees in this seat`}>
      <h3 className="seat-h">what this seat sees</h3>
      <dl className="rf-dl seat-dl">
        <dt>workflow</dt><dd>{w ? <span className="mono">{w.name}</span> : <span className="muted">none – kula.toml's fences</span>}</dd>
        <dt>fences</dt><dd>{fences.length ? fences.map((f) => <span key={f.t} className={`guard-tag ${f.l}`}>{f.t}</span>) : <span className="muted">no extra fences</span>}</dd>
        <dt>scope</dt><dd>{scope.length ? <span className="mono">{scope.join(", ")}</span> : <span className="muted">whole repository</span>}</dd>
        <dt>skills</dt><dd>{skills.length || strays.length ? <span className="mono">{[...skills.map((s) => s.name), ...strays.map((s) => `${s.name} (stray)`)].join(", ")}</span> : <span className="muted">no skills carried</span>}</dd>
        <dt>wiring</dt><dd>{conn ? <span>{conn.mcp ? <span className="tag ok">connected</span> : <span className="tag">not wired</span>} {conn.hook ? <span className="tag ok">hook</span> : <span className="tag">no hook</span>}</span> : <span className="muted">not a connected agent</span>}</dd>
      </dl>
    </div>
  );
}
