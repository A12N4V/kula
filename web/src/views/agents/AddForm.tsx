// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// AddForm: the one add flow for agents and teams (module R1). A single "+ Agent"
// or "+ Team" control – in the agents tab strip, the roster header and the
// Workspace HUD – opens this compact form in place, never a modal stack: the
// defaults are prefilled from agents/templates.ts, validation is inline
// (required and unique name), Enter creates, Esc cancels, and the caller
// selects and reveals the new item. No hidden second step – the full editors
// open afterwards on the created item, not before it exists.

import { useMemo, useState } from "react";
import type { AgentsInfo, Team, Workflow } from "../../api";
import { Icon } from "../../ui";
import { Chips } from "../../Autofill";
import { MODELS, blank } from "./data";
import { TEAM_TEMPLATES, teamFrom } from "./templates";
import { seatName } from "./parts";
import { seatKey } from "../../roster";

const clean = (s: string) => s.replace(/[^\w-]/g, "");

type TeamProps = { kind: "team"; info: AgentsInfo; onCreate: (t: Team) => void; onCancel?: () => void };
type AgentProps = { kind: "agent"; info: AgentsInfo; onCreate: (wf: Workflow) => void; onCancel?: () => void };

export function AddForm(props: TeamProps | AgentProps) {
  const { kind, info, onCancel } = props;
  const taken = kind === "team" ? info.teams.map((t) => t.name) : info.workflows.map((w) => w.name);
  const base = kind === "team" ? "new-team" : "new-workflow";
  const free = (b: string) => { let n = b, i = 2; while (taken.includes(n)) n = `${b}-${i++}`; return n; };
  return kind === "team"
    ? <TeamAddForm info={info} base={base} free={free} onCreate={props.onCreate as (t: Team) => void} onCancel={onCancel} />
    : <AgentAddForm info={info} base={base} free={free} onCreate={props.onCreate as (wf: Workflow) => void} onCancel={onCancel} />;
}

/** Shared chrome: kind headline, name field with inline validation, submit row. */
function FormShell({ title, err, children, onCreate, onCancel, ok }: {
  title: string; err: string | null; children: React.ReactNode; onCancel?: () => void;
  onCreate: () => void; ok: boolean;
}) {
  return (
    <form className="ag-add-form" data-testid="ag-add-form" onSubmit={(e) => { e.preventDefault(); onCreate(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onCancel?.(); return; }
        // Enter creates – explicit, because the Autofill pop inside the form
        // eats the browser's implicit submit; text inputs only, and never when
        // a child (the fence Chips) already consumed the key.
        if (e.key === "Enter" && ok && !e.defaultPrevented && e.target instanceof HTMLInputElement && e.target.type === "text") { e.preventDefault(); onCreate(); }
      }}>
      <div className="ag-add-kind">{title}</div>
      {children}
      {err && <div className="ag-add-err" role="alert">{err}</div>}
      <div className="row ag-add-actions">
        {onCancel && <button type="button" className="btn sm ghost" data-testid="ag-add-cancel" onClick={onCancel}>Cancel</button>}
        <span className="spacer" />
        <button type="submit" className="btn sm primary" data-testid="ag-add-create" disabled={!ok}>Create</button>
      </div>
      <div className="muted ag-meta">enter creates · esc cancels</div>
    </form>
  );
}

/** A new agent = a work mode in kula.toml: name, what it is (role line), and
    its fence. Start-from prefills everything else from an existing workflow;
    model is a seat property and lives with the team, not the mode. */
function AgentAddForm({ info, base, free, onCreate, onCancel }: {
  info: AgentsInfo; base: string; free: (b: string) => string;
  onCreate: (wf: Workflow) => void; onCancel?: () => void;
}) {
  const [name, setName] = useState(() => free(base));
  const [about, setAbout] = useState("");
  const [scope, setScope] = useState<string[]>(["src/**"]);
  // "start from" carries the rest of an existing workflow (fences, steps,
  // docs, memory) into the new one – the old chip row, now one field.
  const [carry, setCarry] = useState<Workflow | null>(null);
  const err = !name.trim() ? "give the agent a name" : info.workflows.some((w) => w.name === name) ? `${name} already exists` : null;
  const from = (wfName: string) => {
    setCarry(wfName ? info.workflows.find((w) => w.name === wfName) ?? null : null);
    const w = info.workflows.find((x) => x.name === wfName);
    if (w) { setAbout(w.about ?? ""); setScope(w.scope ?? []); }
  };
  const make = () => {
    if (err) return;
    onCreate({ ...(carry ?? blank()), name, about, scope, memory: carry?.memory || "write" });
  };
  return (
    <FormShell title="New agent – a work mode in kula.toml" err={err} onCreate={make} ok={!err} onCancel={onCancel}>
      <label className="mi-field"><span>name</span>
        <input className="input mono" data-testid="ag-add-name" value={name} autoFocus onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(clean(e.target.value))} placeholder="db-migrate" aria-label="Agent name" />
      </label>
      <label className="mi-field"><span>role</span>
        <input className="input" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="One line: what this agent does" aria-label="Role" />
      </label>
      <div className="mi-field"><span>fence</span>
        <Chips values={scope} onChange={setScope} placeholder="agents may change only this, e.g. src/**" label="Fence scope" />
      </div>
      <label className="mi-field"><span>start from</span>
        <select className="input" value={carry?.name ?? ""} onChange={(e) => from(e.target.value)} aria-label="Start from workflow">
          <option value="">blank – scope only</option>
          {info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}{w.builtin ? " (built in)" : ""}</option>)}
        </select>
      </label>
    </FormShell>
  );
}

/** A new team: name, the starting shape (template), and its seats – each a
    named generic agent run by whichever agent is connected here. */
function TeamAddForm({ info, base, free, onCreate, onCancel }: {
  info: AgentsInfo; base: string; free: (b: string) => string;
  onCreate: (t: Team) => void; onCancel?: () => void;
}) {
  const connected = info.connections.filter((c) => c.mcp).map((c) => c.id);
  const loops = info.workflows.filter((w) => w.research?.metric).map((w) => w.name);
  const [pick, setPick] = useState(TEAM_TEMPLATES[0]);
  const [loop, setLoop] = useState(loops[0] ?? "autoresearch");
  const [team, setTeam] = useState<Team>(() => teamFrom(TEAM_TEMPLATES[0], free(base), connected, loops[0] ?? "autoresearch"));
  const err = !team.name.trim() ? "give the team a name" : info.teams.some((t) => t.name === team.name) ? `${team.name} already exists` : null;
  const set = (x: Partial<Team>) => setTeam((t) => ({ ...t, ...x }));
  const setM = (i: number, m: Partial<Team["members"][number]>) =>
    setTeam((t) => {
      const was = t.members[i] && (t.members[i].name || t.members[i].agent);
      let members = t.members.map((x, j) => (j === i ? { ...x, ...m } : x));
      // seats point at each other by key – renaming a seat carries its
      // reports_to / hands_off references along, or the server refuses the
      // team ("points at Zeno, which is not another member")
      if (m.name !== undefined && was) {
        const key = m.name || "";
        members = members.map((x, j) =>
          j === i ? x : { ...x, reports_to: x.reports_to === was ? key : x.reports_to, hands_off: x.hands_off?.map((h) => (h === was ? key : h)) });
      }
      return { ...t, members };
    });
  const addSeat = () => setTeam((t) => {
    const lead = t.members.find((m) => !m.reports_to);
    const names = t.members.map((m) => seatName(m));
    let n = "agent-1", i = 2; while (names.includes(n)) n = `agent-${i++}`;
    return { ...t, members: [...t.members, { name: n, agent: "", role: "", workflow: "", reports_to: lead ? seatKey(lead) : "" }] };
  });
  const missing = useMemo(() => [...new Set(team.members.map((m) => m.workflow))].filter((w) => w && !info.workflows.some((x) => x.name === w)), [team, info.workflows]);
  const make = () => { if (!err) onCreate(team); };
  return (
    <FormShell title="New team" err={err} onCreate={make} ok={!err} onCancel={onCancel}>
      <label className="mi-field"><span>name</span>
        <input className="input mono" data-testid="ag-add-name" value={team.name} autoFocus onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => set({ name: clean(e.target.value) })} aria-label="Team name" />
      </label>
      <label className="mi-field"><span>shape</span>
        <select className="input" value={pick.id}
          onChange={(e) => { const t = TEAM_TEMPLATES.find((x) => x.id === e.target.value) ?? TEAM_TEMPLATES[0]; setPick(t); setTeam(teamFrom(t, free(t.id), connected, loop)); }}
          aria-label="Team template">
          {TEAM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.title} – {t.about}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>about</span>
        <input className="input" value={team.about ?? ""} onChange={(e) => set({ about: e.target.value })} placeholder="One line: what this team does" aria-label="Team about" />
      </label>
      <div className="mi-field"><span>members</span>
        <div className="ag-add-seats" data-testid="ag-add-seats">
          <datalist id="ag-add-models">{[...new Set(Object.values(MODELS).flat())].map((x) => <option key={x} value={x} />)}</datalist>
          {team.members.map((m, i) => (
            <div key={i} className="ag-add-seat">
              <input className="input mono" value={m.name ?? ""} onChange={(e) => setM(i, { name: clean(e.target.value) })} aria-label={`Seat ${i + 1} name`} />
              <select className="input" value={m.workflow ?? ""} onChange={(e) => setM(i, { workflow: e.target.value })} aria-label={`Seat ${i + 1} workflow`}>
                <option value="">no workflow</option>
                {info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
              </select>
              <input className="input" value={m.role ?? ""} onChange={(e) => setM(i, { role: e.target.value })} placeholder="role" aria-label={`Seat ${i + 1} role`} />
              <input className="input mono" list="ag-add-models" value={m.model ?? ""} placeholder="model" onChange={(e) => setM(i, { model: e.target.value.trim() })} aria-label={`Seat ${i + 1} model`} />
              <button type="button" className="btn sm ghost icon-only danger" disabled={team.members.length <= 1}
                onClick={() => set({ members: team.members.filter((_, j) => j !== i).map((x) => ({ ...x, reports_to: x.reports_to === seatKey(m) ? "" : x.reports_to, hands_off: x.hands_off?.filter((h) => h !== seatKey(m)) })) })}
                aria-label={`Remove seat ${i + 1}`}><Icon.close /></button>
            </div>
          ))}
          <button type="button" className="btn sm ghost" onClick={addSeat}><Icon.plus /> seat</button>
        </div>
      </div>
      {pick.seats.some((s) => s.workflow === "@loop") && (
        <label className="mi-field"><span>loop</span>
          {loops.length
            ? <select className="input" value={loop} onChange={(e) => { setLoop(e.target.value); setTeam(teamFrom(pick, team.name, connected, e.target.value)); }} aria-label="Research loop">{loops.map((l) => <option key={l}>{l}</option>)}</select>
            : <span className="muted">no loop yet – the built-in autoresearch is used until one is set up in Research</span>}
        </label>
      )}
      {!!missing.length && <div className="muted ag-meta">seats name workflows that do not exist yet ({missing.join(", ")}) – the full editor shows the same warning</div>}
    </FormShell>
  );
}
