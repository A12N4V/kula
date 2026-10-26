// The team sidebar (module U18): the team editor, opened beside the canvas
// from the header's Details toggle. A desktop window (ui/Window), like the agent
// sidebar. Settings and Limits & domains come first (the audit: the
// editor a team needs is at the top), members follow, and "add to team" is a
// search box over the repository's agents – research loops never appear here.
// Member rows are divs with two sibling buttons (open, remove), never a
// button inside a button.

import { useEffect, useMemo, useRef, useState } from "react";
import { Chips } from "../../Autofill";
import { Icon } from "../../ui";
import { Window } from "../../ui/Window";
import { AgentHarmonograph } from "../../flow/agentMark";
import { seatKey, titleFor } from "../../roster";
import { AGENT_IDS, AGENT_NAME, MODELS, type Act } from "./data";
import { keyName } from "./parts";
import type { AgentsInfo, RawRule, Team } from "../../api";
import type { Member } from "./TeamCanvas";
import { memberKey } from "./TeamCanvas";

/** The lead is the first seat that answers to no one – the canvas draws it on top. */
const leadSeat = (team: Team) => { const l = team.members.find((m) => !m.reports_to); return l ? memberKey(l) : null; };

export default function TeamSidebar({ team, all, info, member, act, onSet, onAdd, onRemove, onPickMember, onDelete, onClose }: {
  team: Team; all: Team[]; info: AgentsInfo; member: string | null; act: Act;
  onSet: (x: Partial<Team>) => void;
  onAdd: (workflow: string, agent?: string) => void;
  onRemove: (workflow: string) => void;
  onPickMember: (k: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
  // The open member is held by its seat key, but editing the service (or the
  // name) changes that key: pin the seat's index once, on open, so the editor
  // stays mounted while its seat is renamed underneath it.
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  useEffect(() => {
    setPinnedIdx(member === null ? null : team.members.findIndex((m) => memberKey(m) === member));
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberObj = pinnedIdx != null && pinnedIdx >= 0 ? team.members[pinnedIdx] : null;
  return (
    <Window id={`team-sidebar-${team.name}`} title={team.name || "unnamed"} icon={<Icon.team />} width={440} height={620}
      testId="team-side" onClose={onClose} className="ag-side-win">
      <span className="mono muted">team · kula.toml</span>
      <div className="ag-side-scroll" ref={ref} tabIndex={-1} aria-label={`Team ${team.name}`}>
        {memberObj ? (
          <MemberEdit team={team} idx={pinnedIdx} info={info} act={act} onSet={onSet} onClose={() => onPickMember(null)} />
        ) : (
          <>
            {/* settings first, then the limits the team runs under */}
            <TeamSettings team={team} all={all} onSet={onSet} onDelete={onDelete} />
            <LimitsDomains team={team} info={info} onSet={onSet} />
            <section className="tc-side-members" aria-label="Members">
              <h3 className="tc-side-h">members · {team.members.length}</h3>
              {team.members.length === 0 && <div className="muted tc-side-empty">No members yet – search below.</div>}
              {team.members.map((m) => {
                const k = memberKey(m);
                return (
                  // a row, not a button: two sibling buttons inside one div
                  <div key={k} className="tc-mcard" data-testid={`tc-member-${k}`}>
                    <button className="tc-mrow-open" onClick={() => onPickMember(k)} aria-label={`Edit ${m.name || m.workflow || m.agent}`}>
                      <AgentHarmonograph name={k} size={22} family="team" />
                      <span className="tc-mcard-name mono">{m.name || m.workflow || m.agent || "any agent"}</span>
                      <span className="tc-mcard-sub">{memberKey(m) === leadSeat(team) ? "lead" : titleFor(m.role || "member")}</span>
                    </button>
                    <button className="btn sm ghost icon-only" data-testid={`tc-member-x-${k}`} title={`Remove ${m.name || m.agent} from the team`}
                      aria-label={`Remove ${m.name || m.agent}`} onClick={() => onRemove(m.workflow || k)}><Icon.minus /></button>
                  </div>
                );
              })}
            </section>
            <AddToTeam team={team} info={info} onAdd={onAdd} onRemove={onRemove} />
          </>
        )}
      </div>
    </Window>
  );
}

function TeamSettings({ team, all, onSet, onDelete }: { team: Team; all: Team[]; onSet: (x: Partial<Team>) => void; onDelete: () => void }) {
  const leadKey = team.members.find((m) => !m.reports_to)?.name;
  return (
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
          {team.members.map((m) => <option key={memberKey(m)} value={memberKey(m)}>{m.name || m.workflow || m.agent || "any agent"}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>answers to team</span>
        <select className="input" value={team.under ?? ""} onChange={(e) => onSet({ under: e.target.value })} aria-label="Answers to team">
          <option value="">none – a top-level team</option>
          {all.filter((x) => x.name !== team.name && !within(all, x.name, team.name)).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>team prompt</span>
        <textarea className="input" rows={3} value={team.prompt ?? ""} onChange={(e) => onSet({ prompt: e.target.value })} placeholder="every member gets this first" aria-label="Team prompt" />
      </label>
      <div className="row">
        <button className="btn sm ghost danger" data-testid="team-delete" onClick={onDelete}><Icon.close /> Delete team</button>
      </div>
    </section>
  );
}

/** Limits & domains (B2 shapes): the team's own fences, the path domains it
 *  may touch, cost and turn limits, and its autonomy. The repository's global
 *  fences still load and show as inherited chips – read only, one line. */
function LimitsDomains({ team, info, onSet }: { team: Team; info: AgentsInfo; onSet: (x: Partial<Team>) => void }) {
  const [open, setOpen] = useState(true);
  const fences = team.fences ?? [];
  const setFences = (v: RawRule[]) => onSet({ fences: v });
  const setLimits = (x: Partial<NonNullable<Team["limits"]>>) => onSet({ limits: { ...team.limits, ...x } });
  return (
    <section className="tc-limits" aria-label="Limits and domains" data-testid="tc-limits">
      <button className="tc-side-h tc-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        limits & domains<span className={`tc-chev${open ? " up" : ""}`}><Icon.chevron /></span>
      </button>
      {open && (
        <div className="tc-limits-body">
          <label className="mi-field"><span>autonomy</span>
            <div className="seg" role="group" aria-label="Autonomy">
              {(["ask", "act", "full"] as const).map((a) => (
                <button key={a} type="button" className={(team.limits?.autonomy || "ask") === a ? "on" : ""}
                  data-testid={`tc-autonomy-${a}`} onClick={() => setLimits({ autonomy: a })}>{a}</button>
              ))}
            </div>
          </label>
          <div className="tc-lim-row">
            <label className="mi-field"><span>max cost $</span>
              <input className="input mono" type="number" min={0} value={team.limits?.max_cost ?? ""} placeholder="no limit"
                aria-label="Max cost" onChange={(e) => setLimits({ max_cost: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} />
            </label>
            <label className="mi-field"><span>max turns</span>
              <input className="input mono" type="number" min={0} value={team.limits?.max_turns ?? ""} placeholder="no limit"
                aria-label="Max turns" onChange={(e) => setLimits({ max_turns: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          </div>
          <label className="mi-field" title="paths and globs this team may change; empty means the whole repository"><span>domains</span>
            <Chips values={team.domains ?? []} onChange={(v) => onSet({ domains: v })} placeholder="globs, e.g. web/src/**" label="Domains" />
          </label>
          <div className="mi-field"><span>fences</span>
            <div className="tc-fences">
              {fences.map((f, i) => (
                <div key={i} className="tc-fence" data-testid={`tc-fence-${i}`}>
                  <select className="input tc-fence-level" value={f.level} aria-label={`Fence ${i + 1} level`}
                    onChange={(e) => setFences(fences.map((y, j) => (j === i ? { ...y, level: e.target.value as RawRule["level"] } : y)))}>
                    {(["locked", "hidden", "review"] as const).map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <input className="input mono" value={(f.paths ?? []).join(", ")} placeholder="paths, comma separated"
                    aria-label={`Fence ${i + 1} paths`}
                    onChange={(e) => setFences(fences.map((y, j) => (j === i ? { ...y, paths: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : y)))} />
                  <button className="btn sm ghost icon-only danger" aria-label={`Remove fence ${i + 1}`}
                    onClick={() => setFences(fences.filter((_, j) => j !== i))}><Icon.close /></button>
                </div>
              ))}
              <button className="btn sm ghost" onClick={() => setFences([...fences, { level: "locked", paths: [] }])}><Icon.plus /> Add fence</button>
            </div>
          </div>
          {info.rules.length > 0 && (
            <div className="tc-inherited" title="the repository's global fences – every team runs under them too">
              <span className="tc-side-h">inherited</span>
              <div className="tc-inherited-chips">
                {info.rules.map((r, i) => (
                  <span key={i} className="tc-inh-chip mono">{r.level} · {r.reason || [...r.paths, ...r.symbols].join(", ") || "guard"}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** "Add to team" is a search box, not a list of every agent. Research loops
 *  are work modes for one agent, never team members: they never appear. */
function AddToTeam({ team, info, onAdd, onRemove }: { team: Team; info: AgentsInfo; onAdd: (workflow: string) => void; onRemove: (workflow: string) => void }) {
  const [q, setQ] = useState("");
  const inTeam = new Set(team.members.map((m) => m.workflow).filter(Boolean));
  const pool = useMemo(() => info.workflows.filter((w) => !w.research), [info.workflows]);
  const hits = pool.filter((w) => w.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="tc-side-agents" aria-label="Add agents to the team">
      <h3 className="tc-side-h">add to the team</h3>
      <input className="input" data-testid="tc-add-search" value={q} placeholder="search agents…"
        aria-label="Search agents to add" onChange={(e) => setQ(e.target.value)} />
      <div className="tc-add-hits">
        {hits.length === 0 && <div className="muted tc-side-empty">{q ? `no agent matches “${q}”` : "no agents yet"}</div>}
        {hits.map((w) => (
          <div key={w.name} className="tc-acard" data-testid={`tc-agent-${w.name}`}>
            <AgentHarmonograph name={w.name} size={20} />
            <span className="tc-mcard-name mono">{w.name}</span>
            <span className="spacer" />
            {inTeam.has(w.name)
              ? <button className="btn sm ghost icon-only" data-testid={`team-add-${w.name}`} aria-pressed="true" title={`${w.name} is in the team – remove it`} onClick={() => onRemove(w.name)}><Icon.minus /></button>
              : <button className="btn sm ghost icon-only" data-testid={`team-add-${w.name}`} aria-pressed="false" title={`Add ${w.name} to the team`} onClick={() => onAdd(w.name)}><Icon.plus /></button>}
          </div>
        ))}
      </div>
    </section>
  );
}


/** The seat's effective fences, outer layer first: repo (the global raw
 *  rules), then the team's fences, then the seat workflow's own rules. Each
 *  row keeps its source so a person sees why a path is locked. */
function effRows(m: Member, team: Team, info: AgentsInfo): { level: string; paths: string; source: string; why: string }[] {
  const rows: { level: string; paths: string; source: string; why: string }[] = [];
  for (const r of info.raw_rules ?? []) rows.push({ level: r.level, paths: (r.paths ?? []).join(" ") || "–", source: "repo", why: r.reason || "repository rule" });
  for (const r of team.fences ?? []) rows.push({ level: r.level, paths: (r.paths ?? []).join(" ") || "–", source: `team ${team.name}`, why: r.reason || `team ${team.name} fence` });
  const wf = info.workflows.find((w) => w.name === m.workflow);
  // workflow_rules has no owner field in the payload, so a rule counts as
  // this seat's only when its paths actually come from this workflow's
  // lock/hide/review lists – otherwise every rule was attributed to every seat.
  const owns = (paths: string[], list?: string[]) => !!list && paths.some((p) => list.includes(p));
  for (const r of info.workflow_rules ?? []) {
    if (!wf) break;
    const hit = (r.level === "locked" && owns(r.paths, wf.lock)) || (r.level === "hidden" && owns(r.paths, wf.hide)) || (r.level === "review" && owns(r.paths, wf.review));
    if (hit) rows.push({ level: r.level, paths: r.paths.join(" ") || "–", source: `agent ${wf.name}`, why: r.reason || `${wf.name} rule` });
  }
  return rows;
}

/** One member's fields – now with the seat's service: the agent definition
 *  is neutral, the service is chosen where the seat is. */
function MemberEdit({ team, idx, info, act, onSet, onClose }: {
  team: Team; idx: number | null; info: AgentsInfo; act: Act; onSet: (x: Partial<Team>) => void; onClose: () => void;
}) {
  const m = team.members[idx ?? -1];
  const k = memberKey(m);
  const setM = (x: Partial<Member>) => onSet({ members: team.members.map((y, i) => (i === idx ? { ...y, ...x } : y)) });
  const setService = (v: string) => setM({ service: v, agent: v || "any" });
  const others = team.members.filter((y) => memberKey(y) !== k).map(memberKey).filter(Boolean);
  const svc = (m as { service?: string }).service ?? (m.agent === "any" ? "" : m.agent);
  return (
    <section className="tc-member-edit" aria-label={`Edit ${m.name || m.agent}`}>
      <div className="mi-kind"><AgentHarmonograph name={k} size={16} family="team" /> {k === leadSeat(team) ? "lead" : titleFor(m.role || "member")}<span className="spacer" />
        <button className="btn sm ghost icon-only" onClick={onClose} aria-label="Back to the team"><Icon.close /></button>
      </div>
      <label className="mi-field"><span>name</span>
        <input className="input mono" value={m.name ?? ""} placeholder={m.agent} onChange={(e) => setM({ name: e.target.value.replace(/[^\w -]/g, "") })} aria-label="Seat name" />
      </label>
      <label className="mi-field" title="which agent runs this seat – any connected agent unless you pin one"><span>service</span>
        <select className="input" value={svc} onChange={(e) => setService(e.target.value)} aria-label="Service">
          <option value="">{info.default_agent ? `default – ${AGENT_NAME[info.default_agent] ?? info.default_agent}` : "any connected agent"}</option>
          {AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAME[a]}</option>)}
        </select>
      </label>
      <label className="mi-field" title="leave empty for the provider's own default model"><span>model</span>
        <input className="input mono" list={`tc-models-${k}`} value={m.model ?? ""} placeholder="provider default" onChange={(e) => setM({ model: e.target.value.trim() })} aria-label="Model" />
        <datalist id={`tc-models-${k}`}>{(MODELS[svc || (info.default_agent ?? "")] ?? Object.values(MODELS).flat()).map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <label className="mi-field"><span>workflow</span>
        <select className="input" value={m.workflow ?? ""} onChange={(e) => setM({ workflow: e.target.value })} aria-label="Workflow">
          <option value="">none – kula.toml's fences</option>{info.workflows.filter((w) => !w.research).map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>role</span><input className="input" value={m.role ?? ""} onChange={(e) => setM({ role: e.target.value })} aria-label="Role" /></label>
      <label className="mi-field"><span>answers to</span>
        <select className="input" value={m.reports_to ?? ""} onChange={(e) => setM({ reports_to: e.target.value })} aria-label="Answers to">
          <option value="">nobody – leads</option>{others.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <div className="mi-field"><span>hands off to</span>
        <div className="team-hands">
          {others.map((o) => {
            const on = (m.hands_off ?? []).includes(o);
            return <button key={o} className={`chip-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setM({ hands_off: on ? (m.hands_off ?? []).filter((h) => h !== o) : [...(m.hands_off ?? []), o] })}><AgentHarmonograph name={o} size={12} /> {keyName(team.members, o)}</button>;
          })}
        </div>
      </div>
      <label className="mi-field"><span>system prompt</span>
        <textarea className="input" rows={3} value={m.prompt ?? ""} onChange={(e) => setM({ prompt: e.target.value })} aria-label="System prompt" />
      </label>
      {/* Effective fences: one read-only list, outer layer first – repo · team
          · agent – each row with its source, so a person sees why a path is
          locked. Built from the same data Guards::for_agent layers; when the
          backend's effective_fences route lands it replaces this derivation. */}
      <div className="mi-field tc-eff" data-testid="tc-eff-fences">
        <span>effective fences</span>
        <div className="tc-eff-list" role="list">
          {effRows(m, team, info).map((r, i) => (
            <div key={i} className="tc-eff-row" role="listitem" title={r.why}>
              <span className={`tag ${r.level === "locked" ? "red" : r.level === "review" ? "yellow" : ""}`}>{r.level}</span>
              <span className="mono tc-eff-paths">{r.paths}</span>
              <span className="muted tc-eff-src">{r.source}</span>
            </div>
          ))}
          {effRows(m, team, info).length === 0 && <span className="muted">nothing is locked for this seat</span>}
        </div>
      </div>
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
