// The team sidebar (module U16): everything the old Teams editor kept, opened
// beside the canvas from the header's Details toggle. The same pane mechanism
// as the agent sidebar – data-pane, PaneControls (full screen · close) and a
// Grip on its free edge, portaled to body so it cannot drift with the scroll.
// The agents from the Agents tab list as small cards: + adds the agent's
// workflow as a seat (team_add_member), − removes it (team_remove_member);
// team settings (name, lead, nesting, delete) sit below.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../ui";
import { Grip, PaneControls } from "../../resize";
import { agentGradient, AgentHarmonograph } from "../../flow/agentMark";
import { seatKey, titleFor } from "../../roster";
import type { AgentsInfo, Team } from "../../api";
import type { Act } from "./data";
import type { Member } from "./TeamCanvas";
import { memberKey } from "./TeamCanvas";

export default function TeamSidebar({ team, all, info, member, act, onSet, onAdd, onRemove, onPickMember, onDelete, onClose }: {
  team: Team; all: Team[]; info: AgentsInfo; member: string | null; act: Act;
  onSet: (x: Partial<Team>) => void;
  onAdd: (workflow: string, agent?: string) => void;
  onRemove: (workflow: string) => void;
  onPickMember: (k: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.querySelector<HTMLElement>(`[data-testid="team-side-toggle"]`);
    ref.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); opener.current?.focus(); };
  }, []);
  const inTeam = new Set(team.members.map((m) => m.workflow).filter(Boolean));
  const leadKey = team.members.find((m) => !m.reports_to)?.name;
  const memberObj = team.members.find((m) => memberKey(m) === member) ?? null;
  return createPortal(
    <aside className="ag-side tc-side" data-pane data-testid="team-side" tabIndex={-1} ref={ref} aria-label={`Team ${team.name}`}>
      <Grip id="team-side" edge="left" min={300} max={820} label="Resize team panel" />
      <header className="ag-side-head">
        <span className="mono muted">team · kula.toml</span>
        <h2>{team.name || "unnamed"}</h2>
        <PaneControls onClose={onClose} closeLabel="Close team" closeTitle="Close  esc" testId="team-side" />
      </header>
      <div className="ag-side-scroll">
        {/* members first: click one to edit it */}
        {memberObj ? (
          <MemberEdit team={team} m={memberObj} info={info} act={act} onSet={onSet} onClose={() => onPickMember(null)} />
        ) : (
          <>
            <section className="tc-side-members" aria-label="Members">
              <h3 className="tc-side-h">members · {team.members.length}</h3>
              {team.members.length === 0 && <div className="muted tc-side-empty">No members yet – add agents below.</div>}
              {team.members.map((m) => {
                const k = memberKey(m);
                const [a, b] = agentGradient(k);
                return (
                  <button key={k} className="tc-mcard" data-testid={`tc-member-${k}`} onClick={() => onPickMember(k)}
                    style={{ ["--tc-a" as string]: a, ["--tc-b" as string]: b }}>
                    <AgentHarmonograph name={k} size={22} />
                    <span className="tc-mcard-name mono">{m.name || m.agent || "any agent"}</span>
                    <span className="tc-mcard-sub">{m.reports_to ? titleFor(m.role || "member") : "lead"}{m.workflow ? ` · ${m.workflow}` : ""}</span>
                    <span className="spacer" />
                    <span className="tc-mcard-x" title={`Remove ${m.name || m.agent} from the team`} aria-label={`Remove ${m.name || m.agent}`}
                      onClick={(e) => { e.stopPropagation(); onRemove(m.workflow || k); }}><Icon.minus /></span>
                  </button>
                );
              })}
            </section>
            <section className="tc-side-agents" aria-label="Agents in this repository">
              <h3 className="tc-side-h">agents · add to the team</h3>
              {info.workflows.map((w) => (
                <div key={w.name} className="tc-acard" data-testid={`tc-agent-${w.name}`}>
                  <AgentHarmonograph name={w.name} size={20} />
                  <span className="tc-mcard-name mono">{w.name}</span>
                  <span className="tc-mcard-sub">{w.builtin ? "built in" : "kula.toml"}</span>
                  <span className="spacer" />
                  {inTeam.has(w.name)
                    ? <button className="btn sm ghost icon-only" data-testid={`team-add-${w.name}`} aria-pressed="true" title={`${w.name} is in the team – remove it`} onClick={() => onRemove(w.name)}><Icon.minus /></button>
                    : <button className="btn sm ghost icon-only" data-testid={`team-add-${w.name}`} aria-pressed="false" title={`Add ${w.name} to the team`} onClick={() => onAdd(w.name)}><Icon.plus /></button>}
                </div>
              ))}
            </section>
            <section className="tc-side-settings" aria-label="Team settings">
              <h3 className="tc-side-h">team settings</h3>
              <label className="mi-field"><span>name</span>
                <input className="input mono" value={team.name} onChange={(e) => onSet({ name: e.target.value.replace(/[^\w-]/g, "") })} aria-label="Team name" />
              </label>
              <label className="mi-field"><span>about</span>
                <input className="input" value={team.about ?? ""} onChange={(e) => onSet({ about: e.target.value })} placeholder="one line" aria-label="Team about" />
              </label>
              <label className="mi-field"><span>lead</span>
                <select className="input" value={leadKey ?? ""} onChange={(e) => {
                  const target = e.target.value;
                  if (!target) return;
                  // the chosen member leads: the seat's answers-to clears, the
                  // previous lead now answers to it
                  onSet({ members: team.members.map((m) => (memberKey(m) === target ? { ...m, reports_to: "" } : !m.reports_to ? { ...m, reports_to: target } : m)) });
                }} aria-label="Team lead">
                  <option value="">nobody</option>
                  {team.members.map((m) => <option key={memberKey(m)} value={memberKey(m)}>{m.name || m.agent || "any agent"}</option>)}
                </select>
              </label>
              <label className="mi-field"><span>answers to team</span>
                <select className="input" value={team.under ?? ""} onChange={(e) => onSet({ under: e.target.value })} aria-label="Answers to team">
                  <option value="">none – a top-level team</option>
                  {all.filter((x) => x.name !== team.name && !within(all, x.name, team.name)).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                </select>
              </label>
              <label className="mi-field"><span>team prompt</span>
                <textarea className="input" rows={4} value={team.prompt ?? ""} onChange={(e) => onSet({ prompt: e.target.value })} placeholder="every member gets this first" aria-label="Team prompt" />
              </label>
              <div className="row">
                <button className="btn sm ghost danger" data-testid="team-delete" onClick={onDelete}><Icon.close /> Delete team</button>
              </div>
            </section>
          </>
        )}
      </div>
    </aside>,
    document.body,
  );
}

/** One member's fields – the old MemberDetail, kept whole. */
function MemberEdit({ team, m, info, act, onSet, onClose }: {
  team: Team; m: Member; info: AgentsInfo; act: Act; onSet: (x: Partial<Team>) => void; onClose: () => void;
}) {
  const k = memberKey(m);
  const setM = (x: Partial<Member>) => onSet({ members: team.members.map((y) => (memberKey(y) === k ? { ...y, ...x } : y)) });
  const others = team.members.filter((y) => memberKey(y) !== k).map(memberKey).filter(Boolean);
  return (
    <section className="tc-member-edit" aria-label={`Edit ${m.name || m.agent}`}>
      <div className="mi-kind"><AgentHarmonograph name={k} size={16} /> {m.reports_to ? titleFor(m.role || "member") : "lead"}<span className="spacer" />
        <button className="btn sm ghost icon-only" onClick={onClose} aria-label="Back to the team"><Icon.close /></button>
      </div>
      <label className="mi-field"><span>name</span>
        <input className="input mono" value={m.name ?? ""} placeholder={m.agent} onChange={(e) => setM({ name: e.target.value.replace(/[^\w -]/g, "") })} aria-label="Seat name" />
      </label>
      <label className="mi-field"><span>workflow</span>
        <select className="input" value={m.workflow ?? ""} onChange={(e) => setM({ workflow: e.target.value })} aria-label="Workflow">
          <option value="">none – kula.toml's fences</option>{info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>role</span><input className="input" value={m.role ?? ""} onChange={(e) => setM({ role: e.target.value })} aria-label="Role" /></label>
      <label className="mi-field"><span>answers to</span>
        <select className="input" value={m.reports_to ?? ""} onChange={(e) => setM({ reports_to: e.target.value })} aria-label="Answers to">
          <option value="">nobody – leads</option>{others.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>system prompt</span>
        <textarea className="input" rows={4} value={m.prompt ?? ""} onChange={(e) => setM({ prompt: e.target.value })} aria-label="System prompt" />
      </label>
      <div className="row">
        <button className="btn sm ghost" onClick={() => act("team_prompt", { teams: [team], agent: k }, "").catch(() => {})}>Preview prompt</button>
        <span className="spacer" />
        <button className="btn sm ghost danger" onClick={() => { onSet({ members: team.members.filter((y) => memberKey(y) !== k) }); onClose(); }}>Remove seat</button>
      </div>
    </section>
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
