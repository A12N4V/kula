// Gutter routing – wires that never cross a card and never share a run.
//
// n8n keeps its canvas clean with small left-to-right workflows and bezier
// wires under the nodes; a code map has ~100 cards and dense links, so
// beziers pile up through cards. Here every wire is orthogonal and lives in
// the empty space the column layout leaves:
//   1. leave the source card's right edge, run to the gutter after its column;
//   2. adjacent column → drop down/up the gutter to the target's row and enter
//      its left edge;
//   3. farther column → climb to a highway above (or below) the map, cross
//      the intervening columns there, drop down the gutter before the target.
// Tracks: inside a gutter each *target* owns one vertical track (wires into
// the same card merge into one trunk, metro-map style), each *source* owns
// one departure track, and highway rows are one per wire – so no two wires
// ever run on top of each other. Corners are rounded by the renderer.
import { nodeSize, type FlowEdge, type FlowNode } from "./types";

type Pt = { x: number; y: number };
const TRACK = 10; // px between parallel tracks
const EDGE_PAD = 24; // first track's distance from the column edge

export function routeEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes = nodes.filter((n) => n.pos && n.kind !== "group").map((n) => {
    const s = nodeSize(n);
    return { id: n.id, x: n.pos!.x, y: n.pos!.y, w: s.w, h: s.h };
  });
  if (!boxes.length) return edges;
  // Physical columns: merge overlapping x-intervals of every card.
  const iv = boxes.map((b) => [b.x, b.x + b.w] as [number, number]).sort((a, b) => a[0] - b[0]);
  const cols: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + 8) last[1] = Math.max(last[1], b); else cols.push([a, b]);
  }
  const colAt = (x: number) => cols.findIndex(([a, b]) => x >= a - 1 && x <= b + 1);
  const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const mid = (top + bottom) / 2;
  // Gutter g sits between cols[g] and cols[g+1].
  const gutterW = (g: number) => (cols[g + 1] ? cols[g + 1][0] - cols[g][1] : 200);
  const inTrack = new Map<string, number>(); // `${g}|${target}` → k
  const outTrack = new Map<string, number>(); // `${g}|${source}` → k
  const usedIn = new Map<number, number>(), usedOut = new Map<number, number>();
  // Highway rows are shared per target: every long wire into one card rides
  // the same row and the same arrival trunk – a bundle, not a ribbon.
  const hiRow = new Map<string, number>();
  let hiUp = 0, hiDown = 0;
  const take = (m: Map<string, number>, used: Map<number, number>, g: number, key: string) => {
    const k = `${g}|${key}`;
    if (!m.has(k)) { m.set(k, used.get(g) ?? 0); used.set(g, (used.get(g) ?? 0) + 1); }
    return m.get(k)!;
  };
  // Arrival tracks sit near the target column, departure tracks near the
  // source column, both clamped inside the gutter.
  const inX = (g: number, k: number) => cols[g][1] + Math.max(EDGE_PAD, gutterW(g) - EDGE_PAD - k * TRACK);
  const outX = (g: number, k: number) => cols[g][1] + Math.min(gutterW(g) - EDGE_PAD, EDGE_PAD + k * TRACK);

  // Short wires first so they get the tracks nearest the cards.
  const order = [...edges].sort((a, b) => span(a) - span(b));
  function span(e: FlowEdge) {
    const s = byId.get(e.source), t = byId.get(e.target);
    return s?.pos && t?.pos ? Math.abs(t.pos.x - s.pos.x) : 0;
  }
  const out = new Map<string, FlowEdge>();
  for (const e of order) {
    const s = boxes.find((b) => b.id === e.source), t = boxes.find((b) => b.id === e.target);
    if (!s || !t || e.backward) { out.set(e.id, e); continue; }
    const sc = colAt(s.x + s.w), tc = colAt(t.x);
    if (sc < 0 || tc < 0 || tc <= sc) { out.set(e.id, e); continue; }
    const sy = s.y + s.h / 2, ty = t.y + t.h / 2;
    const p: Pt[] = [{ x: s.x + s.w, y: sy }];
    if (tc === sc + 1) {
      const x = inX(sc, take(inTrack, usedIn, sc, e.target));
      p.push({ x, y: sy }, { x, y: ty });
    } else {
      const up = ty <= mid;
      const rk = `${up ? "u" : "d"}|${e.target}`;
      if (!hiRow.has(rk)) hiRow.set(rk, up ? hiUp++ : hiDown++);
      const hy = up ? top - 32 - hiRow.get(rk)! * TRACK : bottom + 32 + hiRow.get(rk)! * TRACK;
      const x1 = outX(sc, take(outTrack, usedOut, sc, e.source));
      const x2 = inX(tc - 1, take(inTrack, usedIn, tc - 1, e.target));
      p.push({ x: x1, y: sy }, { x: x1, y: hy }, { x: x2, y: hy }, { x: x2, y: ty });
    }
    p.push({ x: t.x, y: ty });
    out.set(e.id, { ...e, route: p, long: tc > sc + 1 });
  }
  return edges.map((e) => out.get(e.id) ?? e);
}
