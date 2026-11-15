// The hub edits a draft of the teams in kula.toml. Every edit lands here; the
// save goes through teams_preview (the exact diff) and then teams_save.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentsInfo, Member, Team } from "../../api";
import { freeName, seatKey } from "../../roster";

export type Pick = { team: string; key?: string } | null;
export type LinkKind = "rt" | "ho";

/** Cycles and references to seats that do not exist, per team. */
export function teamProblems(t: Team): string[] {
  const known = new Set(t.members.map((m) => seatKey(m)).filter(Boolean));
  const out: string[] = [];
  for (const m of t.members) {
    if (!seatKey(m).trim()) { out.push("a seat has no name"); continue; }
    if (m.reports_to && !known.has(m.reports_to)) out.push(`${seatKey(m)} answers to ${m.reports_to}, who is not on the team`);
    for (const h of m.hands_off ?? []) if (h && !known.has(h)) out.push(`${seatKey(m)} hands off to ${h}, who is not on the team`);
  }
  for (const m of t.members) {
    const seen = new Set([seatKey(m)]);
    let cur = m.reports_to;
    while (cur && !seen.has(cur)) { seen.add(cur); cur = t.members.find((x) => seatKey(x) === cur)?.reports_to; }
    if (cur) { out.push(`${seatKey(m)}: answers to forms a cycle`); break; }
  }
  return out;
}

/** Whether team `name` sits somewhere under team `top`. */
export function within(all: Team[], name: string, top: string) {
  let cur = all.find((x) => x.name === name)?.under, hops = 0;
  while (cur && hops++ < all.length) {
    if (cur === top) return true;
    cur = all.find((x) => x.name === cur)?.under;
  }
  return false;
}

/** Problems that keep a draft from saving. */
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
    if (t.color && !/^#[0-9a-fA-F]{6}$/.test(t.color)) out.push(`${t.name}: colour must be #rrggbb`);
    for (const m of t.members) if (m.color && !/^#[0-9a-fA-F]{6}$/.test(m.color)) out.push(`${t.name}/${seatKey(m)}: colour must be #rrggbb`);
    for (const p of teamProblems(t)) out.push(`${t.name}: ${p}`);
  }
  return out;
}

/** Drop empty optional keys so a draft compares equal to what the server reads back. */
const tidy = (m: Member): Member => {
  const o: Record<string, unknown> = { ...m };
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0 && k !== "agent")) delete o[k];
  }
  if (m.fence) {
    const f = { ...m.fence };
    for (const k of ["lock", "hide", "review"] as const) if (!f[k]?.length) delete f[k];
    if (Object.keys(f).length) o.fence = f; else delete o.fence;
  }
  return o as unknown as Member;
};

/** The draft and every edit the hub makes to it. */
export function useDraft(info: AgentsInfo, setPick: (p: Pick) => void) {
  const [draft, setDraft] = useState<Team[]>(info.teams);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(info.teams), [draft, info.teams]);
  // a change made elsewhere resets a clean draft; a save adopts what the server reads back
  const saving = useRef(false);
  useEffect(() => { if (!dirty || saving.current) { saving.current = false; setDraft(info.teams); } }, [info.teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const member = (team: string, key: string) => draft.find((t) => t.name === team)?.members.find((x) => seatKey(x) === key);
  const setTeam = (name: string, f: (t: Team) => Team) => setDraft((d) => d.map((t) => (t.name === name ? f(t) : t)));
  const setMember = (team: string, key: string, m: Partial<Member>) => {
    const cur = member(team, key);
    if (!cur) return;
    // a seat is pointed at by its key: renaming carries the pointers along
    const after = seatKey({ ...cur, ...m });
    setTeam(team, (t) => {
      let members = t.members.map((x) => (seatKey(x) === key ? tidy({ ...x, ...m }) : x));
      if (after !== key) members = members.map((x) => ({ ...x, reports_to: x.reports_to === key ? after : x.reports_to, hands_off: x.hands_off?.map((h) => (h === key ? after : h)) }));
      return { ...t, members };
    });
    if (after !== key) setPick({ team, key: after });
  };
  /** Add a value to one of a seat's lists (skills, mcp, tags), once. */
  const attach = (team: string, key: string, field: "skills" | "mcp" | "tags", v: string) => {
    const cur = member(team, key);
    if (!cur || (cur[field] ?? []).includes(v)) return;
    setMember(team, key, { [field]: [...(cur[field] ?? []), v] });
  };
  const dropMember = (team: string, key: string) => {
    setTeam(team, (t) => ({ ...t, members: t.members.filter((x) => seatKey(x) !== key).map((x) => ({ ...x, reports_to: x.reports_to === key ? "" : x.reports_to, hands_off: x.hands_off?.filter((h) => h !== key) })) }));
    setPick({ team });
  };
  const addSeat = (team: string, seed: Partial<Member> = {}) => {
    const t = draft.find((x) => x.name === team);
    if (!t) return null;
    const name = freeName(t.name, t.members.map(seatKey));
    const lead = t.members.find((m) => !m.reports_to);
    setTeam(team, (x) => ({ ...x, members: [...x.members, tidy({ name, agent: "", workflow: "", reports_to: lead ? seatKey(lead) : "", ...seed })] }));
    setPick({ team, key: name });
    return name;
  };
  const freeTeam = (base = "team") => {
    const taken = new Set(draft.map((t) => t.name));
    if (base !== "team" && !taken.has(base)) return base;
    let n = 1;
    while (taken.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };
  const addTeam = (t?: Team) => {
    const name = t?.name ?? freeTeam();
    const team: Team = t ?? { name, about: "", prompt: "", members: [{ name: `${name}-lead`, agent: "", workflow: "", reports_to: "" }] };
    setDraft((d) => [...d, team]);
    setPick({ team: team.name });
    return team.name;
  };
  const renameTeam = (from: string, to: string) => {
    setDraft((d) => d.map((t) => (t.name === from ? { ...t, name: to } : t.under === from ? { ...t, under: to } : t)));
    setPick({ team: to });
  };
  const dropTeam = (name: string) => {
    setDraft((d) => d.filter((t) => t.name !== name).map((t) => (t.under === name ? { ...t, under: "" } : t)));
    setPick(null);
  };
  const connect = (kind: LinkKind, team: string, from: string, to: string) => {
    if (from === to) return;
    if (kind === "rt") setMember(team, to, { reports_to: from });
    else {
      const h = member(team, from)?.hands_off ?? [];
      if (!h.includes(to)) setMember(team, from, { hands_off: [...h, to] });
    }
  };
  const dropEdge = (kind: LinkKind, team: string, from: string, to: string) => {
    if (kind === "rt") setMember(team, to, { reports_to: "" });
    else setMember(team, from, { hands_off: (member(team, from)?.hands_off ?? []).filter((h) => h !== to) });
  };
  return { draft, dirty, saving, member, setTeam, setMember, attach, dropMember, addSeat, addTeam, freeTeam, renameTeam, dropTeam, connect, dropEdge, reset: () => setDraft(info.teams) };
}

export type Draft = ReturnType<typeof useDraft>;
