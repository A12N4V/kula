// Where things sit on the hub canvas. A plain tree per team (seats in columns by
// how far they are from the lead), teams wrapped into rows, flow map lanes in a grid above.
// Positions a person moved are kept on refs/kula/meta and win over the layout.

import type { FlowMap, Member, Team } from "../../api";
import { seatKey } from "../../roster";

// a seat is a small tile with its name under it, like a workflow node: columns run left to right by depth
export const SEAT_W = 96, SEAT_H = 96;
const COL_GAP = 64, ROW_GAP = 20, PAD = 20, HEAD = 34, TEAM_GAP = 56;
export const LANE_W = 232, FLOW_H = 24;
const LANE_HEAD = 40, LANE_GAP = 14, MAX_FLOWS = 8, MAX_LANES = 10;
// positions saved before the left to right layout are in another frame, so they are ignored without this mark
export const LAYOUT_MARK = "_v2";

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

/** Seats are one size; kept as a function so callers need not know. */
export function seatH(_m?: Member, _research = false): number { return SEAT_H; }

export function place(teams: Team[], saved: Saved, _research: (m: Member) => boolean = () => false, aspect = 1.6): Placed {
  const out: Placed = { teams: new Map(), seats: new Map() };
  const keep = !!saved[LAYOUT_MARK];
  for (const t of teams) {
    const cols: Member[][] = [];
    for (const m of t.members) { const d = depth(t, seatKey(m)); (cols[d] ??= []).push(m); }
    const packed = cols.filter(Boolean);
    const tall = Math.max(1, ...packed.map((c) => c.length));
    const colH = (n: number) => n * (SEAT_H + ROW_GAP) - ROW_GAP;
    let w = Math.max(1, packed.length) * (SEAT_W + COL_GAP) - COL_GAP + PAD * 2;
    let h = HEAD + PAD * 2 + colH(tall);
    packed.forEach((c, ci) => {
      const off = (colH(tall) - colH(c.length)) / 2;
      c.forEach((m, i) => {
        const k = seatKey(m);
        const s = keep ? saved[seatId(t.name, k)] : undefined;
        const p = s ? { x: Math.max(PAD, s[0]), y: Math.max(HEAD, s[1]) } : { x: PAD + ci * (SEAT_W + COL_GAP), y: HEAD + PAD + off + i * (SEAT_H + ROW_GAP) };
        out.seats.set(seatId(t.name, k), p);
        w = Math.max(w, p.x + SEAT_W + PAD);
        h = Math.max(h, p.y + SEAT_H + PAD);
      });
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
    // a lone short last row reads as an orphan, so it costs a little scale
    const orphan = y > 0 && x - TEAM_GAP < wide / 2 ? 0.9 : 1;
    return { at, fit: orphan * Math.min(ar / Math.max(1, wide), 1 / Math.max(1, y + tall)) };
  };
  const rows = new Set<number>();
  for (let a = 0; a < boxes.length; a++) {
    let w = -TEAM_GAP;
    for (let b = a; b < boxes.length; b++) { w += boxes[b].w + TEAM_GAP; rows.add(w); }
  }
  let best = wrap(Infinity);
  for (const r of rows) { const c = wrap(r); if (c.fit > best.fit) best = c; }
  [...out.teams.entries()].forEach(([name, b], k) => {
    const s = keep ? saved[teamId(name)] : undefined;
    b.x = s ? s[0] : best.at[k][0]; b.y = s ? s[1] : best.at[k][1];
  });
  return out;
}

export type Lane = { id: number; label: string; box: Box; flows: { id: string; y: number }[]; more: number };

/** The flow map as lanes above the teams: one per domain, its biggest flows inside. */
export function lanes(map: FlowMap, fitCols = Infinity): Lane[] {
  const doms = [...map.domains].sort((a, b) => b.flows - a.flows).slice(0, MAX_LANES);
  const rows = doms.map((d) => {
    const fs = map.flows.filter((f) => f.domain === d.id).sort((a, b) => b.steps.length - a.steps.length);
    return { d, fs: fs.slice(0, MAX_FLOWS), more: Math.max(0, fs.length - MAX_FLOWS) };
  });
  const laneH = (r: (typeof rows)[number]) => LANE_HEAD + Math.max(1, r.fs.length + (r.more ? 1 : 0)) * (FLOW_H + 4) + 8;
  // a grid rather than one long strip: about twice as wide as tall, each grid row as tall as its tallest lane
  // and never wider than the canvas shows at the map's zoom floor, so no lane is cut at the right edge
  const cols = Math.max(1, Math.min(rows.length, fitCols, Math.max(3, Math.ceil(Math.sqrt(rows.length * 2)))));
  // packed into the shortest column rather than grid rows, so a tall lane leaves no void beside it
  const colH: number[] = Array(cols).fill(0);
  const at = rows.map((r) => {
    const c = colH.indexOf(Math.min(...colH));
    const p = { x: c * (LANE_W + LANE_GAP), y: colH[c] };
    colH[c] += laneH(r) + LANE_GAP;
    return p;
  });
  const lift = Math.max(...colH) - LANE_GAP + 72;
  return rows.map((r, i) => ({
    id: r.d.id, label: r.d.label.replace(/^\.(?=$| )/, "root"), more: r.more,
    box: { x: at[i].x, y: at[i].y - lift, w: LANE_W, h: laneH(r) },
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
