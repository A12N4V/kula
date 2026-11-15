// Where things sit on the hub canvas. A plain tree per team (seats in rows by
// how far they are from the lead), teams wrapped into rows, flow map lanes in a grid above.
// Positions a person moved are kept on refs/kula/meta and win over the layout.

import type { FlowMap, Team } from "../../api";
import { seatKey } from "../../roster";

export const SEAT_W = 212, SEAT_H = 96;
const GAP_X = 22, GAP_Y = 44, PAD = 18, HEAD = 36, TEAM_GAP = 56;
export const LANE_W = 232, FLOW_H = 24;
const LANE_HEAD = 34, LANE_GAP = 14, MAX_FLOWS = 8, MAX_LANES = 10;

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = { teams: Map<string, Box>; seats: Map<string, { x: number; y: number }> };
export type Saved = Record<string, [number, number]>;

export const teamId = (t: string) => `team:${t}`;
export const seatId = (t: string, k: string) => `seat:${t}/${k}`;

/** How many hops a seat is from its team's lead (cycles stop at the team size). */
function depth(t: Team, key: string): number {
  let d = 0, cur = t.members.find((m) => seatKey(m) === key)?.reports_to;
  while (cur && d < t.members.length) { d++; cur = t.members.find((m) => seatKey(m) === cur)?.reports_to; }
  return d;
}

export function place(teams: Team[], saved: Saved): Placed {
  const out: Placed = { teams: new Map(), seats: new Map() };
  for (const t of teams) {
    const rows: string[][] = [];
    for (const m of t.members) { const d = depth(t, seatKey(m)); (rows[d] ??= []).push(seatKey(m)); }
    const packed = rows.filter(Boolean);
    const wide = Math.max(1, ...packed.map((r) => r.length));
    let w = wide * (SEAT_W + GAP_X) - GAP_X + PAD * 2;
    let h = HEAD + Math.max(1, packed.length) * (SEAT_H + GAP_Y) - GAP_Y + PAD * 2;
    packed.forEach((r, ri) => {
      const off = (w - (r.length * (SEAT_W + GAP_X) - GAP_X)) / 2;
      r.forEach((k, i) => {
        const s = saved[seatId(t.name, k)];
        const p = s ? { x: Math.max(PAD, s[0]), y: Math.max(HEAD, s[1]) } : { x: off + i * (SEAT_W + GAP_X), y: HEAD + PAD + ri * (SEAT_H + GAP_Y) };
        out.seats.set(seatId(t.name, k), p);
        w = Math.max(w, p.x + SEAT_W + PAD);
        h = Math.max(h, p.y + SEAT_H + PAD);
      });
    });
    out.teams.set(t.name, { x: 0, y: 0, w, h });
  }
  // wrap the teams into rows near a 1.6:1 frame, so many teams stay readable when fitted
  const boxes = [...out.teams.values()];
  const area = boxes.reduce((a, b) => a + (b.w + TEAM_GAP) * (b.h + TEAM_GAP), 0);
  const row = Math.max(...boxes.map((b) => b.w), Math.sqrt(area * 1.6));
  let x = 0, y = 0, tall = 0;
  for (const [name, b] of out.teams) {
    if (x > 0 && x + b.w > row) { x = 0; y += tall + TEAM_GAP; tall = 0; }
    const s = saved[teamId(name)];
    b.x = s ? s[0] : x; b.y = s ? s[1] : y;
    x += b.w + TEAM_GAP; tall = Math.max(tall, b.h);
  }
  return out;
}

export type Lane = { id: number; label: string; box: Box; flows: { id: string; y: number }[]; more: number };

/** The flow map as lanes above the teams: one per domain, its biggest flows inside. */
export function lanes(map: FlowMap): Lane[] {
  const doms = [...map.domains].sort((a, b) => b.flows - a.flows).slice(0, MAX_LANES);
  const rows = doms.map((d) => {
    const fs = map.flows.filter((f) => f.domain === d.id).sort((a, b) => b.steps.length - a.steps.length);
    return { d, fs: fs.slice(0, MAX_FLOWS), more: Math.max(0, fs.length - MAX_FLOWS) };
  });
  const tall = Math.max(1, ...rows.map((r) => r.fs.length + (r.more ? 1 : 0)));
  const h = LANE_HEAD + tall * (FLOW_H + 4) + 8;
  // a grid rather than one long strip: about twice as wide as tall
  const cols = Math.min(rows.length, Math.max(3, Math.ceil(Math.sqrt(rows.length * 2))));
  const lines = Math.ceil(rows.length / Math.max(1, cols));
  const top = -(lines * (h + LANE_GAP) - LANE_GAP + 72);
  return rows.map((r, i) => ({
    id: r.d.id, label: r.d.label, more: r.more,
    box: { x: (i % cols) * (LANE_W + LANE_GAP), y: top + Math.floor(i / cols) * (h + LANE_GAP), w: LANE_W, h },
    flows: r.fs.map((f, j) => ({ id: f.id, y: LANE_HEAD + j * (FLOW_H + 4) })),
  }));
}

/** A kula.toml path pattern as a test: globs, or a plain path that matches itself and anything under it. */
export function matcher(pats: string[]): (p: string) => boolean {
  const res = pats.filter(Boolean).map((g) => {
    if (!/[*?[]/.test(g)) { const d = g.replace(/\/$/, ""); return (p: string) => p === d || p.startsWith(`${d}/`); }
    const src = g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    const re = new RegExp(`^${src}$`);
    return (p: string) => re.test(p);
  });
  return (p) => res.some((f) => f(p));
}
