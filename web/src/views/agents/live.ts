// Live mode (P3.17): the team's event log, streamed, and what it paints on the
// canvas at a moment: seats that just acted, hand-offs between them, refusals
// struck on the areas they named. Replay is the same picture at an earlier moment.

import { useEffect, useState } from "react";
import { api, streamEvents, type AgentsInfo, type KulaEvent, type Territory } from "../../api";
import { seatKey } from "../../roster";
import { areaOf } from "./territory";

/** How long an event stays painted. */
export const WINDOW = 30_000;
const POLL = 5_000;

export type Via = "off" | "stream" | "poll";

/** The event log while `on`: a stream first, a five second poll when the stream will not hold. */
export function useEvents(on: boolean): { events: KulaEvent[]; via: Via } {
  const [events, setEvents] = useState<KulaEvent[]>([]);
  const [via, setVia] = useState<Via>("off");
  useEffect(() => {
    if (!on) { setVia("off"); return; }
    const ac = new AbortController();
    let since = 0;
    let timer: number | undefined;
    const add = (got: KulaEvent[]) => {
      const fresh = got.filter((e) => e.seq > since);
      if (!fresh.length) return;
      since = fresh[fresh.length - 1].seq;
      setEvents((xs) => [...xs, ...fresh].slice(-500));
    };
    const poll = () => {
      if (ac.signal.aborted) return;
      setVia("poll");
      api.agentEvents(since).then((r) => add(r.events)).catch(() => {}).finally(() => { if (!ac.signal.aborted) timer = window.setTimeout(poll, POLL); });
    };
    setEvents([]);
    setVia("stream");
    streamEvents(0, (e) => add([e]), ac.signal)
      .then(() => { if (!ac.signal.aborted) poll(); })
      .catch(() => { if (!ac.signal.aborted) poll(); });
    return () => { ac.abort(); window.clearTimeout(timer); };
  }, [on]);
  return { events, via };
}

/** The seat on the canvas an event's agent sits in: by seat name, then by the agent that runs it. */
export function seatFor(info: AgentsInfo, team: string | undefined, agent: string | undefined): string | null {
  if (!agent) return null;
  const a = agent.toLowerCase().replace(/^agent:/, "");
  const id = ["claude", "cursor", "codex", "gemini"].find((x) => a.startsWith(x)) ?? a;
  const teams = info.teams.filter((t) => t.name === (team || info.team?.name)).concat(info.teams);
  for (const t of teams) {
    const m = t.members.find((x) => x.name && x.name.toLowerCase() === a) ?? t.members.find((x) => x.agent === id);
    if (m) return `seat:${t.name}/${seatKey(m)}`;
  }
  return null;
}

export type Paint = {
  /** seat id → passed | failed | rejected | refused | running | handoff */
  seats: Map<string, string>;
  handoffs: { id: string; source: string; target: string }[];
  /** area path → refused */
  areas: Map<string, string>;
};

/** What the log paints at a moment. */
export function paintAt(info: AgentsInfo, areas: Territory[], events: KulaEvent[], at: number): Paint {
  const p: Paint = { seats: new Map(), handoffs: [], areas: new Map() };
  for (const e of events) {
    if (e.ts > at || e.ts <= at - WINDOW) continue;
    const seat = seatFor(info, e.team, e.agent);
    if (e.kind === "refused") {
      if (seat) p.seats.set(seat, "refused");
      const a = e.path ? areaOf(areas, e.path) : null;
      if (a) p.areas.set(a, "refused");
    } else if (e.kind === "verdict" || e.kind === "slice") {
      if (seat && e.verdict) p.seats.set(seat, e.verdict);
    } else if (e.kind === "handoff") {
      const from = seatFor(info, e.team, e.from);
      if (seat) p.seats.set(seat, "handoff");
      if (from && seat && from !== seat) p.handoffs = [...p.handoffs.filter((h) => !(h.source === from && h.target === seat)), { id: `lv:${e.seq}`, source: from, target: seat }];
    }
  }
  return p;
}

/** One line for an event, no dashes. */
export function line(e: KulaEvent): string {
  const who = e.agent || "someone";
  switch (e.kind) {
    case "team_start": return `${e.team} started${e.agent ? ` by ${e.agent}` : ""}`;
    case "team_stop": return `${e.team} stopped`;
    case "refused": return `${who} refused${e.path ? ` on ${e.path}` : ""}`;
    case "handoff": return `${e.from} hands ${e.slice} to ${who}`;
    case "verdict": return `${e.slice} ${e.verdict} for ${who}`;
    case "slice": return `${e.slice} ${e.verdict} with ${who}`;
    default: return e.msg || e.kind;
  }
}
