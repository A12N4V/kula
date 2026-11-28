// The metro layout: districts on a grid, each flow an octilinear line on its
// own track, stations placed in call order, shared stations pinned once.
//
// Deterministic: ordering comes from ids and lengths only, seeded with
// hashSeed where a tiebreak needs a stable pseudo-choice. No Math.random, no
// time, no iteration-order dependence beyond model order. The same model and
// world always produce the same coordinates, so the layout is safe to cache
// per model and draw must never rebuild it.
//
// The same object holds the drawn geometry and the hit geometry: hit reads
// exactly what draw drew.

import type { MapModel, MapFlow } from "../model";
import { domainGrid, hashSeed, clamp } from "../layout-common";

export interface Pt { x: number; y: number }
export interface MetroDomain { id: number; x: number; y: number; w: number; h: number; label: string; flows: number }
export interface MetroStation { id: string; x: number; y: number; degree: number; name: string; branch?: string }
export interface MetroFlow {
  id: string;
  domain: number;
  /** Station ids in call order, deduplicated. */
  stations: string[];
  /** Polyline vertices in world coordinates (octilinear, offsets applied). */
  poly: Pt[];
}
export interface MetroSegment { flow: string; a: Pt; b: Pt }
export interface MetroLayout {
  domains: MetroDomain[];
  flows: MetroFlow[];
  stations: MetroStation[];
  /** Segments for hit testing, one entry per polyline leg. */
  segments: MetroSegment[];
  world: { w: number; h: number };
}

const SPACING = 5; // perpendicular distance between parallel lines

/** Track y for flow i of n in a district: rows packed inside the rect. */
function trackY(r: { y: number; h: number }, i: number, n: number): number {
  // never exceed the district: rows compress as far as needed, and very
  // dense districts overlap their lines rather than spill past the edge
  const rowH = Math.min(44, (r.h - 46) / Math.max(1, n));
  return r.y + 34 + i * rowH;
}

/**
 * Octilinear path from a to b with a perpendicular offset for parallel
 * lines. Every leg is 0°, 45° or 90° and the endpoints stay pinned where
 * the stations are: a short axis jog carries the line to its offset lane,
 * the long run sits in that lane, and a short axis leg returns to b.
 */
function octiLegs(a: Pt, b: Pt, off: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.abs(off) < 0.5) {
    if (adx < 0.5 || ady < 0.5) return [];
    const m = Math.min(adx, ady);
    return [{ x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m }];
  }
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  if (ady < 0.5) {
    // horizontal run: vertical jog at the middle, run offset, vertical back
    return [{ x: midX, y: a.y }, { x: midX, y: a.y + off }, { x: b.x, y: a.y + off }];
  }
  if (adx < 0.5) {
    // vertical run: horizontal jog at the middle, run offset, horizontal back
    return [{ x: a.x, y: midY }, { x: a.x + off, y: midY }, { x: a.x + off, y: b.y }];
  }
  const m = Math.min(adx, ady);
  const c = { x: a.x + Math.sign(dx) * m, y: a.y + Math.sign(dy) * m };
  if (adx === m) {
    // vertical remainder: horizontal jog to the offset lane, vertical run, back
    return [c, { x: c.x + off, y: c.y }, { x: c.x + off, y: b.y }];
  }
  // horizontal remainder: vertical jog to the offset lane, horizontal run, back
  return [c, { x: c.x, y: c.y + off }, { x: b.x, y: c.y + off }];
}

/**
 * Build the metro layout for a model. `world` is the world rectangle the
 * variant draws (Map.tsx WORLD). Pure: no input is mutated.
 */
export function metroLayout(model: MapModel, world = { w: 1600, h: 1000 }): MetroLayout {
  const rects = domainGrid(model, world.w, world.h);
  const domains: MetroDomain[] = rects.map((r) => {
    const d = model.domains.find((x) => x.id === r.id);
    return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, label: d?.label ?? "", flows: d?.flows.length ?? 0 };
  });
  const rectOf = new Map<number, MetroDomain>(domains.map((d) => [d.id, d]));

  // Flows per district ordered by length desc then entry id (the plan's rule),
  // so each flow owns one track and the picture is stable.
  const byDomain = new Map<number, MapFlow[]>();
  for (const f of model.flows) {
    const a = byDomain.get(f.domain) ?? [];
    if (!byDomain.has(f.domain)) byDomain.set(f.domain, a);
    a.push(f);
  }
  for (const a of byDomain.values()) {
    a.sort((f, g) => g.steps.length - f.steps.length || f.id.localeCompare(g.id) || (hashSeed(f.id) - hashSeed(g.id)));
  }

  // First pass: every station gets a provisional position on the first flow
  // (in the deterministic order above) that reaches it. Shared stations keep
  // that first position and every other flow routes through it.
  const pos = new Map<string, Pt>();
  const flowStations = new Map<string, string[]>();
  const trackOf = new Map<string, { i: number; n: number; r: MetroDomain }>();
  for (const [did, fl] of [...byDomain.entries()].sort((a, b) => a[0] - b[0])) {
    const r = rectOf.get(did);
    if (!r) continue;
    fl.forEach((f, i) => {
      const uniq: string[] = [];
      for (const s of f.steps) if (!uniq.includes(s.station)) uniq.push(s.station);
      flowStations.set(f.id, uniq);
      trackOf.set(f.id, { i, n: fl.length, r });
      const x0 = r.x + 20, x1 = r.x + r.w - 20;
      const y = trackY(r, i, fl.length);
      uniq.forEach((sid, j) => {
        if (pos.has(sid)) return;
        const x = uniq.length === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * j) / Math.max(1, uniq.length - 1);
        pos.set(sid, { x, y });
      });
    });
  }

  // Second pass: build each flow's polyline through the (possibly pinned)
  // station points, with perpendicular offsets where flows run parallel.
  const flows: MetroFlow[] = [];
  const segments: MetroSegment[] = [];
  const parallel = new Map<string, string[]>(); // "a|b" (unordered) -> flow ids
  for (const f of model.flows) {
    const seq = flowStations.get(f.id) ?? [];
    for (let i = 0; i + 1 < seq.length; i++) {
      const key = [seq[i], seq[i + 1]].sort().join("|");
      const a = parallel.get(key) ?? [];
      if (!parallel.has(key)) parallel.set(key, a);
      if (!a.includes(f.id)) a.push(f.id);
    }
  }
  for (const f of model.flows) {
    const seq = flowStations.get(f.id) ?? [];
    const pts = seq.map((sid) => pos.get(sid)).filter((p): p is Pt => !!p);
    if (pts.length === 0) continue;
    const poly: Pt[] = pts.length === 1 ? [pts[0]] : [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const key = [seq[i], seq[i + 1]].sort().join("|");
      const ranks = parallel.get(key) ?? [f.id];
      const rank = ranks.indexOf(f.id);
      // fan-out capped: a trunk many flows share stays a tidy cable, not a fan
      const raw = (rank - (ranks.length - 1) / 2) * SPACING;
      const off = clamp(raw, -22, 22);
      // alternate the offset side deterministically per segment pair so two
      // lines between the same stations part around the stations, not all one way
      const side = hashSeed(key) % 2 === 0 ? 1 : -1;
      for (const leg of octiLegs(pts[i], pts[i + 1], off * side)) poly.push(leg);
      poly.push(pts[i + 1]);
      segments.push({ flow: f.id, a: pts[i], b: pts[i + 1] });
    }
    flows.push({ id: f.id, domain: f.domain, stations: seq, poly });
  }

  const stations: MetroStation[] = [];
  for (const st of model.stations) {
    const p = pos.get(st.id);
    if (!p) continue;
    stations.push({ id: st.id, x: p.x, y: p.y, degree: st.degree, name: st.name, branch: st.branch });
  }

  return { domains, flows, stations, segments, world: { ...world } };
}
