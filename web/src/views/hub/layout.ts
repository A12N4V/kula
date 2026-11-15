// Where things sit on the hub canvas. A plain tree per team (seats in rows by
// how far they are from the lead), teams wrapped into rows, flow map lanes in a grid above.
// Positions a person moved are kept on refs/kula/meta and win over the layout.

import type { FlowMap, Member, Team } from "../../api";
import { seatKey } from "../../roster";

export const SEAT_W = 184;
// a seat is as tall as what it shows: name and sub, then a chip row and a fence row when they have anything
const SEAT_BASE = 52, CHIP_ROW = 24, FENCE_ROW = 22;
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

/** How tall a seat node draws; `research` seats always show their loop row. */
export function seatH(m: Member, research = false): number {
  const f = m.fence ?? {};
  const chips = research || !!(m.skills?.length || m.mcp?.length || m.memory);
  const fence = !!(m.tags?.length || f.lock?.length || f.hide?.length || f.review?.length || m.scope?.length);
  return SEAT_BASE + (chips ? CHIP_ROW : 0) + (fence ? FENCE_ROW : 0);
}

export function place(teams: Team[], saved: Saved, research: (m: Member) => boolean = () => false, aspect = 1.6): Placed {
  const out: Placed = { teams: new Map(), seats: new Map() };
  for (const t of teams) {
    const rows: Member[][] = [];
    for (const m of t.members) { const d = depth(t, seatKey(m)); (rows[d] ??= []).push(m); }
    const packed = rows.filter(Boolean);
    const wide = Math.max(1, ...packed.map((r) => r.length));
    const tall = packed.map((r) => Math.max(...r.map((m) => seatH(m, research(m)))));
    let w = wide * (SEAT_W + GAP_X) - GAP_X + PAD * 2;
    let h = HEAD + PAD * 2 + (tall.length ? tall.reduce((a, b) => a + b + GAP_Y, -GAP_Y) : SEAT_BASE);
    let y = HEAD + PAD;
    packed.forEach((r, ri) => {
      const off = (w - (r.length * (SEAT_W + GAP_X) - GAP_X)) / 2;
      r.forEach((m, i) => {
        const k = seatKey(m);
        const s = saved[seatId(t.name, k)];
        const p = s ? { x: Math.max(PAD, s[0]), y: Math.max(HEAD, s[1]) } : { x: off + i * (SEAT_W + GAP_X), y };
        out.seats.set(seatId(t.name, k), p);
        w = Math.max(w, p.x + SEAT_W + PAD);
        h = Math.max(h, p.y + seatH(m, research(m)) + PAD);
      });
      y += tall[ri] + GAP_Y;
    });
    out.teams.set(t.name, { x: 0, y: 0, w, h });
  }
  // wrap the teams into rows: try every row width a run of teams can make and
  // keep the one whose bounding box fits the canvas's own shape at the largest scale
  const boxes = [...out.teams.values()];
  const ar = Math.min(3, Math.max(0.6, aspect));
  const wrap = (row: number) => {
    let x = 0, y = 0, tall = 0, wide = 0;
    const at = boxes.map((b) => {
      if (x > 0 && x + b.w > row) { x = 0; y += tall + TEAM_GAP; tall = 0; }
      const p = [x, y] as const;
      x += b.w + TEAM_GAP; tall = Math.max(tall, b.h); wide = Math.max(wide, x - TEAM_GAP);
      return p;
    });
    return { at, fit: Math.min(ar / Math.max(1, wide), 1 / Math.max(1, y + tall)) };
  };
  const rows = new Set<number>();
  for (let a = 0; a < boxes.length; a++) {
    let w = -TEAM_GAP;
    for (let b = a; b < boxes.length; b++) { w += boxes[b].w + TEAM_GAP; rows.add(w); }
  }
  let best = wrap(Infinity);
  for (const r of rows) { const c = wrap(r); if (c.fit > best.fit) best = c; }
  [...out.teams.entries()].forEach(([name, b], k) => {
    const s = saved[teamId(name)];
    b.x = s ? s[0] : best.at[k][0]; b.y = s ? s[1] : best.at[k][1];
  });
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
  const laneH = (r: (typeof rows)[number]) => LANE_HEAD + Math.max(1, r.fs.length + (r.more ? 1 : 0)) * (FLOW_H + 4) + 8;
  // a grid rather than one long strip: about twice as wide as tall, each grid row as tall as its tallest lane
  const cols = Math.max(1, Math.min(rows.length, Math.max(3, Math.ceil(Math.sqrt(rows.length * 2)))));
  const lineH: number[] = [];
  rows.forEach((r, i) => { const li = Math.floor(i / cols); lineH[li] = Math.max(lineH[li] ?? 0, laneH(r)); });
  const tops: number[] = [];
  let acc = -(lineH.reduce((a, b) => a + b + LANE_GAP, -LANE_GAP) + 72);
  lineH.forEach((lh, li) => { tops[li] = acc; acc += lh + LANE_GAP; });
  return rows.map((r, i) => ({
    id: r.d.id, label: r.d.label === "." ? "root" : r.d.label, more: r.more,
    box: { x: (i % cols) * (LANE_W + LANE_GAP), y: tops[Math.floor(i / cols)], w: LANE_W, h: laneH(r) },
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
