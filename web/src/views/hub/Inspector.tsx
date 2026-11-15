// The right side of the hub: whatever is picked (a seat, a team or a flow),
// laid out as plain sections, and the kula.toml changes waiting to be saved.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type AgentsInfo, type Explain, type FlowMap, type Member, type ResearchRun, type Suggestion, type Team } from "../../api";
import { Chips } from "../../Autofill";
import { seatKey } from "../../roster";
import { AGENT_IDS, AGENT_NAME, MODELS, type Act } from "./data";
import { draftProblems, type Draft, type Pick } from "./draft";
import { GuardTag } from "./levels";
import { lineDiff } from "./linediff";
import { MetricChart, pointsOf } from "./MetricChart";
import { TaskCard } from "./TaskCard";

// warm tints only: green, blue, violet, red and yellow mean skills, MCP, memory, lock and review
export const SWATCHES = ["#e8e2d9", "#c2b9ac", "#b5835a", "#d9a066", "#8d8378", "#6f665d"];
const CATEGORIES = ["build", "research", "review"];

function Sec({ title, children, aside, dot }: { title: string; children: ReactNode; aside?: ReactNode; dot?: string }) {
  return (
    <section className="hub-sec" aria-label={title}>
      <h3>{dot && <i className={`hub-pal-dot ${dot}`} aria-hidden />}{title}{aside && <span className="hub-sec-aside">{aside}</span>}</h3>
      {children}
    </section>
  );
}
function Field({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return <label className={`hub-field${tone ? ` ${tone}` : ""}`}><span>{label}</span>{children}</label>;
}
function Swatches({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="hub-swatches" role="radiogroup" aria-label="Colour">
      <button type="button" role="radio" aria-checked={!value} aria-label="No colour" className={`hub-sw none${!value ? " on" : ""}`} onClick={() => onChange(undefined)} />
      {SWATCHES.map((c) => <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Colour ${c}`} className={`hub-sw${value === c ? " on" : ""}`} style={{ background: c }} onClick={() => onChange(c)} />)}
    </div>
  );
}

/** Values over experiments as a small line: kept points filled, the baseline dashed. */
function ExplainBox({ team, seat, d }: { team: string; seat: string; d: Draft }) {
  const [path, setPath] = useState("");
  const [sym, setSym] = useState("");
  const [res, setRes] = useState<Explain | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setRes(null); setErr(null); }, [team, seat]);
  const run = () => {
    if (!path.trim()) return;
    setErr(null);
    api.agentAction<Explain>("explain", { name: team, agent: seat, path: path.trim(), target: sym.trim(), teams: d.dirty ? d.draft : [] })
      .then(setRes).catch((e: Error) => setErr(e.message));
  };
  return (
    <div className="hub-explain">
      <div className="hub-row">
        <input className="input mono" placeholder="path" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} aria-label="Path to explain" />
        <input className="input mono hub-sym" placeholder="symbol" value={sym} onChange={(e) => setSym(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} aria-label="Symbol to explain" />
        <button className="btn sm" onClick={run} disabled={!path.trim()}>Explain</button>
      </div>
      {err && <div className="team-err" role="alert">{err}</div>}
      {res && (
        <div className="hub-verdict" data-level={res.verdict.level}>
          <div className="hub-row"><GuardTag level={res.verdict.level} /><span className="mono muted">{res.verdict.rule || "no rule"}</span></div>
          <ul>{res.hits.map((h, i) => <li key={i} className={h.rule === res.verdict.rule && h.level === res.verdict.level ? "decides" : ""}><GuardTag level={h.level} /><span className="mono">{h.rule}</span><span className="muted">{h.reason}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function SeatPanel({ info, d, team, m, act }: { info: AgentsInfo; d: Draft; team: Team; m: Member; act: Act }) {
  const key = seatKey(m);
  const set = (p: Partial<Member>) => d.setMember(team.name, key, p);
  const fence = m.fence ?? {};
  const run = info.research.find((r) => r.workflow && r.workflow === m.workflow);
  const others = team.members.map(seatKey).filter((k) => k !== key);
  void act;
  return (
    <>
      <div className="hub-insp-title"><span>{key}</span><span className="mono muted">{team.name}</span></div>
      <Sec title="Identity">
        <Swatches value={m.color} onChange={(c) => set({ color: c })} />
        <Field label="Name"><input className="input" value={m.name ?? ""} placeholder={key} onChange={(e) => set({ name: e.target.value })} aria-label="Seat name" /></Field>
        <Field label="Agent">
          <select className="input" value={m.agent} onChange={(e) => set({ agent: e.target.value })} aria-label="Agent">
            <option value="">Any connected</option>
            {AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAME[a]}</option>)}
          </select>
        </Field>
        <Field label="Model">
          <input className="input mono" list="hub-models" value={m.model ?? ""} placeholder="default" onChange={(e) => set({ model: e.target.value || undefined })} aria-label="Model" />
          <datalist id="hub-models">{(MODELS[m.agent] ?? Object.values(MODELS).flat()).map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Role"><input className="input" value={m.role ?? ""} onChange={(e) => set({ role: e.target.value || undefined })} aria-label="Role" /></Field>
        <Field label="Workflow">
          <select className="input" value={m.workflow ?? ""} onChange={(e) => set({ workflow: e.target.value })} aria-label="Workflow">
            <option value="">None</option>
            {info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Reports to">
          <select className="input" value={m.reports_to ?? ""} onChange={(e) => set({ reports_to: e.target.value })} aria-label="Reports to">
            <option value="">Nobody</option>
            {others.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Tags"><Chips values={m.tags ?? []} onChange={(v) => set({ tags: v })} as="name" placeholder="tag" label="Tags" /></Field>
      </Sec>
      <Sec title="Prompt">
        <textarea className="textarea" rows={3} value={m.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} aria-label="Seat prompt" />
      </Sec>
      <Sec title="Skills" dot="skill"><Chips values={m.skills ?? []} onChange={(v) => set({ skills: v })} as="name" placeholder="skill" label="Skills" /></Sec>
      <Sec title="MCP" dot="mcp"><Chips values={m.mcp ?? []} onChange={(v) => set({ mcp: v })} as="name" placeholder="server" label="MCP servers" /></Sec>
      <Sec title="Memory" dot="memory">
        <input className="input mono" list="hub-docs" placeholder="AGENTS.md" value={m.memory ?? ""} onChange={(e) => set({ memory: e.target.value || undefined })} aria-label="Memory file" />
        <datalist id="hub-docs">{info.docs_list.map((p) => <option key={p} value={p} />)}</datalist>
      </Sec>
      <Sec title="Fences">
        <Field label="Scope"><Chips values={m.scope ?? []} onChange={(v) => set({ scope: v })} placeholder="src/**" label="Scope" /></Field>
        <Field label="Lock" tone="lock"><Chips values={fence.lock ?? []} onChange={(v) => set({ fence: { ...fence, lock: v } })} placeholder="path or path:symbol" label="Lock" /></Field>
        <Field label="Hide"><Chips values={fence.hide ?? []} onChange={(v) => set({ fence: { ...fence, hide: v } })} placeholder="path" label="Hide" /></Field>
        <Field label="Review" tone="review"><Chips values={fence.review ?? []} onChange={(v) => set({ fence: { ...fence, review: v } })} placeholder="path" label="Review" /></Field>
      </Sec>
      <Sec title="Can it touch"><ExplainBox team={team.name} seat={key} d={d} /></Sec>
      {run && (
        <Sec title="Research" aside={<span className="mono muted">{run.active ? "running" : "stopped"}</span>}>
          <div className="hub-stats mono">
            <span>{run.metric}</span><span>{run.goal === "max" ? "higher" : "lower"} is better</span>
            <span>{run.experiments.length}/{run.budget || "any"} used</span>
          </div>
          <MetricChart points={pointsOf(run)} baseline={run.baseline} metric={run.metric} goal={run.goal} />
        </Sec>
      )}
      <div className="hub-row end"><button className="btn sm ghost" onClick={() => d.dropMember(team.name, key)}>Remove seat</button></div>
    </>
  );
}

function TeamPanel({ info, d, team, act }: { info: AgentsInfo; d: Draft; team: Team; act: Act }) {
  const set = (p: Partial<Team>) => d.setTeam(team.name, (t) => ({ ...t, ...p }));
  const running = info.team?.name === team.name;
  const saved = info.teams.some((t) => t.name === team.name);
  return (
    <>
      <div className="hub-insp-title"><span>{team.name}</span><span className="mono muted">{team.members.length} {team.members.length === 1 ? "seat" : "seats"}</span></div>
      <Sec title="Team" aside={running ? <span className="mono accent">running</span> : undefined}>
        <Swatches value={team.color} onChange={(c) => set({ color: c })} />
        <Field label="Name"><input className="input" value={team.name} onChange={(e) => d.renameTeam(team.name, e.target.value)} aria-label="Team name" /></Field>
        <Field label="Category">
          <div className="seg" role="radiogroup" aria-label="Category">
            <button type="button" className={team.category ? "" : "on"} aria-pressed={!team.category} onClick={() => set({ category: undefined })}>none</button>
            {CATEGORIES.map((c) => <button key={c} type="button" className={team.category === c ? "on" : ""} aria-pressed={team.category === c} onClick={() => set({ category: team.category === c ? undefined : c })}>{c}</button>)}
          </div>
        </Field>
        <Field label="About"><input className="input" value={team.about ?? ""} onChange={(e) => set({ about: e.target.value })} aria-label="About" /></Field>
        <Field label="Under">
          <select className="input" value={team.under ?? ""} onChange={(e) => set({ under: e.target.value })} aria-label="Under">
            <option value="">Top level</option>
            {d.draft.filter((t) => t.name !== team.name).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </Field>
      </Sec>
      <Sec title="Prompt"><textarea className="textarea" rows={3} value={team.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} aria-label="Team prompt" /></Sec>
      <Sec title="Seats" aside={<span className="mono muted">{team.members.length}</span>}>
        <ul className="hub-list">{team.members.map((m) => <li key={seatKey(m)}><span className="hub-sw-dot" style={{ background: m.color || "var(--line-2)" }} />{seatKey(m)}<span className="muted mono">{m.agent || "any"}</span></li>)}</ul>
        <div className="hub-row"><button className="btn sm" onClick={() => d.addSeat(team.name)}>Add seat</button></div>
      </Sec>
      <div className="hub-row">
        {running
          ? <button className="btn sm" onClick={() => act("team_stop", {}, "Team stopped")}>Stop</button>
          : <button className="btn sm" disabled={d.dirty || !saved} title={d.dirty ? "Save first" : undefined} onClick={() => act("team_start", { name: team.name }, "Team started")}>Launch</button>}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => d.dropTeam(team.name)}>Delete team</button>
      </div>
    </>
  );
}

function FlowPanel({ map, id, d, pick, close }: { map: FlowMap; id: string; d: Draft; pick: Pick; close: () => void }) {
  const f = map.flows.find((x) => x.id === id);
  if (!f) return null;
  const dom = map.domains.find((x) => x.id === f.domain);
  return (
    <Sec title="Flow" aside={<button className="icon-btn" aria-label="Close flow" onClick={close}>{"×"}</button>}>
      <div className="hub-flow-title"><span className={`hub-flow-kind ${f.kind}`}>{f.kind}</span><strong>{f.route || f.entry.name}</strong></div>
      <div className="mono muted hub-flow-meta">{dom?.label} {"·"} {f.steps.length} steps {"·"} {f.files.length} files</div>
      <ol className="hub-steps">
        {f.steps.map((s) => (
          <li key={`${s.id}-${s.depth}`} style={{ paddingLeft: 6 + s.depth * 12 }}>
            {s.branch && <span className={`hub-branch ${s.branch}`}>{s.branch}</span>}
            <span className="hub-step-name">{s.name}</span>
            <span className="mono muted">{s.path.split("/").pop()}:{s.line}</span>
          </li>
        ))}
      </ol>
      {pick?.key && <button className="btn sm" onClick={() => d.setMember(pick.team, pick.key!, { scope: [...f.files].sort() })}>Scope {pick.key} to this flow</button>}
    </Sec>
  );
}

/** A fence or workflow an agent proposed; only a person adds it to kula.toml. */
function SuggestionRow({ s, act }: { s: Suggestion; act: Act }) {
  const what = s.guard ? [...(s.guard.paths ?? []), ...(s.guard.symbols ?? [])].join(", ") : s.workflow?.name ?? "";
  return (
    <li className="hub-sugg">
      <div className="hub-row">{s.guard ? <GuardTag level={s.guard.level} /> : <span className="tag accent">workflow</span>}<span className="mono hub-sugg-what" title={what}>{what}</span></div>
      <p>{s.why} <span className="muted mono">{s.by}</span></p>
      <div className="hub-row">
        <button className="btn sm ghost" onClick={() => act("suggestion_dismiss", { id: s.id }, "Dismissed").catch(() => {})}>Dismiss</button>
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => act("suggestion_accept", { id: s.id }, "Added to kula.toml").catch(() => {})}>Accept</button>
      </div>
    </li>
  );
}

function Overview({ info, d, act }: { info: AgentsInfo; d: Draft; act: Act }) {
  const seats = d.draft.reduce((n, t) => n + t.members.length, 0);
  return (
    <>
      <Sec title="Hub">
        <div className="hub-stats mono"><span>{d.draft.length} teams</span><span>{seats} seats</span><span>{(info.skills ?? []).length} skills</span><span>{info.research.length} research</span></div>
        <p className="muted">Pick a seat or team to edit it</p>
      </Sec>
      <Sec title={info.task ? "Now" : "Task"}><TaskCard info={info} act={act} /></Sec>
      {info.suggestions.length > 0 && (
        <Sec title="Suggested" aside={<span className="mono muted">{info.suggestions.length}</span>}><ul className="hub-list">{info.suggestions.map((x) => <SuggestionRow key={x.id} s={x} act={act} />)}</ul></Sec>
      )}
      {(info.guard_warnings?.length ?? 0) > 0 && (
        <Sec title="Fence warnings"><ul className="hub-warns">{info.guard_warnings!.map((w) => <li key={w}>{w}</li>)}</ul></Sec>
      )}
      {(info.seat_overlaps?.length ?? 0) > 0 && (
        <Sec title="Overlaps"><ul className="hub-warns">{info.seat_overlaps!.map((o) => <li key={`${o.team}${o.a}${o.b}`}><span className="mono">{o.team}</span> {o.a} and {o.b} share {o.count} files</li>)}</ul></Sec>
      )}
    </>
  );
}

/** What the draft would change in kula.toml, and the save. */
export function ChangesCard({ d, act }: { d: Draft; act: Act }) {
  const problems = useMemo(() => draftProblems(d.draft), [d.draft]);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDiff(null); setErr(null); }, [d.draft]);
  const lines = useMemo(() => (diff ? lineDiff(diff.before, diff.after) : []), [diff]);
  if (!d.dirty && !diff) return null;
  const review = () => {
    setErr(null); setBusy(true);
    api.agentAction<{ before: string; after: string }>("teams_preview", { teams: d.draft })
      .then(setDiff).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };
  const save = () => {
    setErr(null); setBusy(true);
    d.saving.current = true;
    act("teams_save", { teams: d.draft }, "Teams saved").then(() => setDiff(null)).catch((e: Error) => { d.saving.current = false; setErr(e.message); }).finally(() => setBusy(false));
  };
  return (
    <section className="hub-changes" aria-label="Changes">
      <h3>Changes<span className="hub-sec-aside mono muted">kula.toml</span></h3>
      {problems.length > 0 && <ul className="cv-problems" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <div className="team-err" role="alert">{err}</div>}
      {diff && (lines.length === 0
        ? <p className="muted">No change to kula.toml</p>
        : <pre className="cv-diff" aria-label="Diff">{lines.map((l, i) => <div key={i} className={l.k === "+" ? "add" : l.k === "-" ? "del" : l.k === "…" ? "gap" : ""}>{l.k === "…" ? "⋯" : `${l.k} ${l.t}`}</div>)}</pre>)}
      <div className="hub-row">
        <button className="btn sm ghost" onClick={() => { d.reset(); setDiff(null); }}>Revert</button>
        <span className="spacer" />
        {diff && lines.length > 0
          ? <button className="btn sm primary" disabled={busy || problems.length > 0} onClick={save}>Save</button>
          : <button className="btn sm" disabled={busy || problems.length > 0} onClick={review}>Review</button>}
      </div>
    </section>
  );
}

export function Inspector({ info, d, pick, flow, setFlow, map, act }: {
  info: AgentsInfo; d: Draft; pick: Pick; flow: string | null; setFlow: (f: string | null) => void; map: FlowMap | null; act: Act;
}) {
  const team = pick ? d.draft.find((t) => t.name === pick.team) : undefined;
  const m = team && pick?.key ? team.members.find((x) => seatKey(x) === pick.key) : undefined;
  return (
    <>
      {flow && map && <FlowPanel map={map} id={flow} d={d} pick={pick} close={() => setFlow(null)} />}
      {m && team ? <SeatPanel info={info} d={d} team={team} m={m} act={act} />
        : team ? <TeamPanel info={info} d={d} team={team} act={act} />
        : !flow && <Overview info={info} d={d} act={act} />}
    </>
  );
}
