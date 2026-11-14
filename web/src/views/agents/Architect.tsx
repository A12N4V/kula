// Architect mode (P3.15): the canvas edits a draft of the teams. Drag between
// seats to wire them, inspect a seat or team to edit it, then review the exact
// kula.toml change (the server renders it with the same code a save uses) and
// save through teams_save.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentsInfo, type Team } from "../../api";
import { Icon } from "../../ui";
import type { Act } from "./data";
import { MemberDetail, within } from "./Teams";
import { teamProblems } from "./TeamOrg";
import { freeName, seatKey } from "../../roster";
import { lineDiff } from "./linediff";
import type { CanvasEdit } from "./CanvasFlow";

type Member = Team["members"][number];
export type Pick = { team: string; key?: string } | null;
export type LinkKind = "rt" | "ho";

/** Problems that keep a draft from saving, beyond each team's own. */
export function draftProblems(teams: Team[]): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  for (const t of teams) {
    if (!/^[\w-]+$/.test(t.name)) out.push(`team "${t.name}" needs a name of letters, digits, _ or -`);
    else if (names.has(t.name)) out.push(`two teams are named ${t.name}`);
    names.add(t.name);
    const keys = t.members.map(seatKey);
    const dup = keys.find((k, i) => k && keys.indexOf(k) !== i);
    if (dup) out.push(`${t.name}: two seats are named ${dup}`);
    if (t.members.length && !t.members.some((m) => !m.reports_to)) out.push(`${t.name} has no lead`);
    for (const p of teamProblems(t)) out.push(`${t.name}: ${p}`);
  }
  return out;
}

/** The draft and every edit Architect mode makes to it. */
export function useDraft(info: AgentsInfo, pick: Pick, setPick: (p: Pick) => void, kind: LinkKind) {
  const [draft, setDraft] = useState<Team[]>(info.teams);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(info.teams), [draft, info.teams]);
  // a change made elsewhere resets a clean draft; a save adopts what the
  // server reads back, whose shape may differ from the draft's
  const saving = useRef(false);
  useEffect(() => { if (!dirty || saving.current) { saving.current = false; setDraft(info.teams); } }, [info.teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTeam = (name: string, f: (t: Team) => Team) => setDraft((d) => d.map((t) => (t.name === name ? f(t) : t)));
  const setMember = (team: string, key: string, m: Partial<Member>) => {
    const cur = draft.find((t) => t.name === team)?.members.find((x) => seatKey(x) === key);
    if (!cur) return;
    // a seat is pointed at by its key (name, else agent): renaming carries the pointers along
    const after = seatKey({ ...cur, ...m });
    setTeam(team, (t) => {
      let members = t.members.map((x) => (seatKey(x) === key ? { ...x, ...m } : x));
      if (after !== key) members = members.map((x) => ({ ...x, reports_to: x.reports_to === key ? after : x.reports_to, hands_off: x.hands_off?.map((h) => (h === key ? after : h)) }));
      return { ...t, members };
    });
    if (after !== key) setPick({ team, key: after });
  };
  const dropMember = (team: string, key: string) => {
    setTeam(team, (t) => ({ ...t, members: t.members.filter((x) => seatKey(x) !== key).map((x) => ({ ...x, reports_to: x.reports_to === key ? "" : x.reports_to, hands_off: x.hands_off?.filter((h) => h !== key) })) }));
    setPick({ team });
  };
  const moveMember = (team: string, key: string, dir: 1 | -1) => setTeam(team, (t) => {
    const i = t.members.findIndex((x) => seatKey(x) === key), j = i + dir;
    if (i < 0 || j < 0 || j >= t.members.length) return t;
    const members = [...t.members];
    [members[i], members[j]] = [members[j], members[i]];
    return { ...t, members };
  });
  const addSeat = (team: string) => {
    const t = draft.find((x) => x.name === team);
    if (!t) return;
    const name = freeName(t.name, t.members.map(seatKey));
    const lead = t.members.find((m) => !m.reports_to);
    setTeam(team, (x) => ({ ...x, members: [...x.members, { name, agent: "", workflow: "", reports_to: lead ? seatKey(lead) : "" }] }));
    setPick({ team, key: name });
  };
  const addTeam = () => {
    const taken = new Set(draft.map((t) => t.name));
    let n = 1;
    while (taken.has(`team${n}`)) n++;
    const name = `team${n}`;
    setDraft((d) => [...d, { name, about: "", prompt: "", members: [{ name: `${name}-lead`, agent: "", workflow: "", reports_to: "" }] } as Team]);
    setPick({ team: name });
  };
  const renameTeam = (from: string, to: string) => {
    setDraft((d) => d.map((t) => (t.name === from ? { ...t, name: to } : t.under === from ? { ...t, under: to } : t)));
    setPick({ team: to });
  };
  const dropTeam = (name: string) => {
    setDraft((d) => d.filter((t) => t.name !== name).map((t) => (t.under === name ? { ...t, under: "" } : t)));
    setPick(null);
  };
  const edit: CanvasEdit = {
    connect: (team, from, to) => {
      if (kind === "rt") setMember(team, to, { reports_to: from });
      else {
        const m = draft.find((t) => t.name === team)?.members.find((x) => seatKey(x) === from);
        const h = m?.hands_off ?? [];
        if (!h.includes(to)) setMember(team, from, { hands_off: [...h, to] });
      }
    },
    dropEdge: (k, team, from, to) => {
      if (k === "rt") setMember(team, to, { reports_to: "" });
      else {
        const m = draft.find((t) => t.name === team)?.members.find((x) => seatKey(x) === from);
        setMember(team, from, { hands_off: (m?.hands_off ?? []).filter((h) => h !== to) });
      }
    },
    addSeat,
    pickTeam: (team) => setPick({ team }),
    team: pick && !pick.key ? pick.team : null,
  };
  return { draft, setDraft, dirty, edit, saving, setTeam, setMember, dropMember, moveMember, addTeam, renameTeam, dropTeam, reset: () => setDraft(info.teams) };
}

export type Draft = ReturnType<typeof useDraft>;

/** The inspector for whatever is picked in Architect mode. */
export function ArchitectInspector({ info, d, pick, setPick }: { info: AgentsInfo; d: Draft; pick: Pick; setPick: (p: Pick) => void }) {
  const t = pick ? d.draft.find((x) => x.name === pick.team) : undefined;
  if (!pick || !t) return <section className="card cv-hint" aria-label="Architect help"><p className="muted">Drag from a seat to another to wire them. Click a team name to edit it.</p></section>;
  if (pick.key) {
    const k = t.members.findIndex((m) => seatKey(m) === pick.key);
    if (k < 0) return null;
    const key = pick.key;
    return (
      <section className="card cv-inspect map-inspector" aria-label="Seat">
        <MemberDetail team={t} k={k} info={info}
          setM={(m) => d.setMember(t.name, key, m)} drop={() => d.dropMember(t.name, key)}
          move={(dir) => d.moveMember(t.name, key, dir)} close={() => setPick(null)} />
      </section>
    );
  }
  return (
    <section className="card cv-inspect map-inspector" aria-label="Team">
      <div className="mi-kind">team<span className="spacer" /><button className="icon-btn" onClick={() => setPick(null)} title="Close" aria-label="Close"><Icon.close /></button></div>
      <input className="input mono mi-title" value={t.name} onChange={(e) => d.renameTeam(t.name, e.target.value.replace(/[^\w-]/g, ""))} aria-label="Team name" />
      <input className="input" value={t.about ?? ""} onChange={(e) => d.setTeam(t.name, (x) => ({ ...x, about: e.target.value }))} placeholder="about" aria-label="Team about" />
      <label className="mi-field"><span>answers to team</span>
        <select className="input" value={t.under ?? ""} onChange={(e) => d.setTeam(t.name, (x) => ({ ...x, under: e.target.value }))} aria-label="Answers to team">
          <option value="">none, a top level team</option>
          {d.draft.filter((x) => x.name !== t.name && !within(d.draft, x.name, t.name)).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>team prompt</span>
        <textarea className="input" rows={5} value={t.prompt ?? ""} onChange={(e) => d.setTeam(t.name, (x) => ({ ...x, prompt: e.target.value }))} placeholder="every member gets this first" aria-label="Team prompt" />
      </label>
      <div className="row">
        <button className="btn sm ghost" onClick={() => d.edit.addSeat(t.name)}><Icon.plus /> seat</button>
        <span className="spacer" /><button className="btn sm ghost danger" onClick={() => d.dropTeam(t.name)}>Delete team</button>
      </div>
    </section>
  );
}

/** What the draft would change in kula.toml, and the save. */
export function ChangesCard({ d, act }: { d: Draft; act: Act }) {
  const problems = useMemo(() => draftProblems(d.draft), [d.draft]);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the review goes stale the moment the draft moves
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
    <section className="card cv-changes" aria-label="Changes">
      <div className="card-head"><h2>Changes</h2><span className="muted">kula.toml</span></div>
      {problems.length > 0 && <ul className="cv-problems" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {err && <div className="team-err" role="alert">{err}</div>}
      {diff && (lines.length === 0
        ? <p className="muted">No change to kula.toml</p>
        : <pre className="cv-diff" aria-label="Diff">{lines.map((l, i) => <div key={i} className={l.k === "+" ? "add" : l.k === "-" ? "del" : l.k === "…" ? "gap" : ""}>{l.k === "…" ? "⋯" : `${l.k} ${l.t}`}</div>)}</pre>)}
      <div className="row">
        <button className="btn sm ghost" onClick={() => { d.reset(); setDiff(null); }}>Revert</button>
        <span className="spacer" />
        {diff && lines.length > 0
          ? <button className="btn sm primary" disabled={busy || problems.length > 0} onClick={save}>Save</button>
          : <button className="btn sm" disabled={busy || problems.length > 0} onClick={review}>Review</button>}
      </div>
    </section>
  );
}
