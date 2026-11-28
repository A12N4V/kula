// Variant C · Storyboard layout. Pure and deterministic, cached per model:
//
//   grid   – every domain as a panel of flow "cards" (one card per flow,
//            with a mini step strip coloured by layer). This is the
//            zoomed-out map: zoom never changes the view, only the detail.
//   boards – one board per flow, drawn when a flow is open: swimlanes by
//            layer in LANE_ORDER, steps left to right in call order,
//            branch forks dropping down to their callees, loops curling
//            back, and chips on shared stations that jump to the other
//            flow that calls the same station.
//
// Nothing here touches the canvas; index.ts draws it. Two calls with the
// same model must produce identical JSON (the spec asserts that).

import type { MapModel, MapFlow, MapStation, Layer } from "../model";
import { domainGrid } from "../layout-common";

/** The story world is the same stage every variant shares. */
export const STORY_WORLD = { w: 1600, h: 1000 };

/** A lane per layer, in this order; layers a flow never touches are dropped. */
export const LANE_ORDER: Layer[] = ["entry", "handler", "logic", "data", "io", "test"];

const LANE_X = 130; // lane labels live left of the first step
const STEP_X0 = 160;
const STEP_GAP = 96;
const TOP = 96; // title strip above the lanes
const DOT_R = 7;
/** Steps per band: the board must fit the 1600-wide world however long the
 *  flow is, so long flows wrap onto continuation bands (same lanes again). */
export const BAND_STEPS = 14;
export const BAND_GAP = 40;
export const LANE_H = 84;
export const BOARD_W = STEP_X0 + (BAND_STEPS - 1) * STEP_GAP + 60;

const CARD_MIN_W = 148;
const CARD_H = 58;
const CARD_GAP = 10;

/* ---------------------------------------------------------------- grid ---- */

export interface StoryCard {
  flowId: string;
  domain: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  steps: number;
  /** First station's name, shown as the card's meta line. */
  entry: string;
  /** Normalised (0..1) positions of each step tick, LANE_ORDER colours. */
  strip: { layer: Layer; t: number }[];
}

export interface StoryDomain {
  id: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  flows: number;
  files: number;
}

export interface StoryGrid {
  domains: StoryDomain[];
  cards: StoryCard[];
}

/* --------------------------------------------------------------- board ---- */

export interface StoryStep {
  order: number;
  station: string;
  name: string;
  layer: Layer;
  x: number;
  y: number;
  branch?: string;
  /** A branch callee that is not the fall-through draws dropped by this much. */
  forkDrop: number;
  /** A loop step curls back to this step's x (null when it cannot). */
  curlToX: number | null;
}

export interface StoryLane {
  layer: Layer;
  y: number;
  count: number;
}

export interface StoryChip {
  station: string;
  x: number;
  y: number;
  w: number;
  h: number;
  flowId: string;
  label: string;
}

export interface StoryBoard {
  flowId: string;
  title: string;
  meta: string;
  lanes: StoryLane[];
  steps: StoryStep[];
  chips: StoryChip[];
  w: number;
  h: number;
  /** Board origin inside the world. */
  x: number;
  y: number;
}

export interface StoryLayout {
  grid: StoryGrid;
  boards: Map<string, StoryBoard>;
}

/* -------------------------------------------------------------- helpers ---- */

/** Lane order for one flow: LANE_ORDER filtered to the layers it touches. */
function lanesFor(steps: { layer: Layer }[]): Layer[] {
  const seen = new Set<Layer>(steps.map((s) => s.layer));
  return LANE_ORDER.filter((l) => seen.has(l));
}

/** Chip width without a canvas: mono font is ~6.2 px per character plus padding. */
export const chipWidth = (label: string) => Math.round(label.length * 6.2) + 16;
/** A chip is capped to the 96 px step gap minus a margin, so neighbouring
 *  chips on the same lane row can never touch, whatever their labels say. */
export const CHIP_W = 84;
export const CHIP_CHARS = 10;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* --------------------------------------------------------------- layout ---- */

const cache = new WeakMap<MapModel, StoryLayout>();

/** Cards fill a domain panel: choose the column count that maximises card size. */
function fitCards(n: number, availW: number, availH: number): { cols: number; cw: number; ch: number } {
  let best = { cols: 1, cw: availW - CARD_GAP, ch: availH - CARD_GAP };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = availW / cols - CARD_GAP;
    const ch = availH / rows - CARD_GAP;
    const w = Math.min(CARD_MIN_W * 1.5, Math.max(60, cw));
    const h = Math.min(CARD_H, Math.max(26, ch));
    const area = w * h;
    if (area > best.cw * best.ch) best = { cols, cw: w, ch: h };
  }
  return best;
}

export function storyLayout(model: MapModel): StoryLayout {
  const hit = cache.get(model);
  if (hit) return hit;

  const byDomain = new Map<number, MapFlow[]>();
  for (const f of model.flows) {
    const list = byDomain.get(f.domain) ?? [];
    list.push(f);
    byDomain.set(f.domain, list);
  }
  const stationById = new Map<string, MapStation>(model.stations.map((s) => [s.id, s]));

  // Panels follow the shared domain grid, then cards fill each panel.
  const grid: StoryGrid = { domains: [], cards: [] };
  for (const r of domainGrid(model, STORY_WORLD.w, STORY_WORLD.h)) {
    const dom = model.domains.find((d) => d.id === r.id);
    if (!dom) continue;
    const flows = byDomain.get(r.id) ?? [];
    // Flows within a domain keep model order – that is call-graph discovery
    // order, stable for a given head. Tiebreak on id in case of duplicates.
    flows.sort((a, b) => 0 || a.id.localeCompare(b.id));
    grid.domains.push({ id: r.id, label: dom.label, x: r.x, y: r.y, w: r.w, h: r.h, flows: flows.length, files: dom.files.length });
    const headH = 30;
    const { cols, cw, ch } = fitCards(flows.length, r.w - 16, r.h - headH - 12);
    flows.forEach((f, i) => {
      const cx = r.x + 8 + (i % cols) * (cw + CARD_GAP);
      const cy = r.y + headH + Math.floor(i / cols) * (ch + CARD_GAP);
      grid.cards.push({
        flowId: f.id,
        domain: r.id,
        x: cx,
        y: cy,
        w: cw,
        h: ch,
        label: truncate(f.label, Math.max(8, Math.round(cw / 7))),
        steps: f.steps.length,
        entry: stationById.get(f.entry)?.name ?? f.entry,
        strip: f.steps.slice(0, 24).map((s, j) => ({ layer: s.layer, t: f.steps.length > 1 ? j / (f.steps.length - 1) : 0 })),
      });
    });
  }

  const boards = new Map<string, StoryBoard>();
  for (const f of model.flows) {
    const lanes = lanesFor(f.steps);
    const laneIdx = new Map<Layer, number>(lanes.map((l, i) => [l, i]));
    const entryName = stationById.get(f.entry)?.name ?? "";
    const bands = Math.max(1, Math.ceil(f.steps.length / BAND_STEPS));
    const bandH = lanes.length * LANE_H + BAND_GAP;
    const board: StoryBoard = {
      flowId: f.id,
      title: f.label,
      meta: `${f.steps.length} steps · entry ${truncate(entryName, 26)} · ${f.files.length} files`,
      lanes: lanes.map((l) => ({ layer: l, y: TOP + laneIdx.get(l)! * LANE_H + LANE_H / 2, count: f.steps.filter((s) => s.layer === l).length })),
      steps: [],
      chips: [],
      w: BOARD_W,
      h: TOP + bands * bandH - BAND_GAP + 24,
      x: 60,
      y: 60,
    };

    /** Lane row y for a step's band and layer. */
    const rowY = (band: number, layer: Layer) =>
      TOP + band * bandH + (laneIdx.get(layer) ?? 0) * LANE_H + LANE_H / 2;

    // Parent of step j: `from` is the parent step's own index in this flow
    // (flowmap.rs emits the call site as a step index, not a symbol id).
    const parents = new Map<number, number>();
    f.steps.forEach((s, j) => {
      if (s.from == null || s.from < 0 || s.from >= j) return;
      parents.set(j, s.from);
    });

    // Fork drops: children of a branch step, in order, drop below the lane.
    // The first child (the fall-through, right after the branch) stays put.
    const branchKids = new Map<number, number[]>();
    for (const [child, parent] of parents) {
      const p = f.steps[parent];
      if (!p.branch) continue;
      const list = branchKids.get(parent) ?? [];
      list.push(child);
      branchKids.set(parent, list);
    }

    f.steps.forEach((s, j) => {
      const band = Math.floor(j / BAND_STEPS);
      const col = j % BAND_STEPS;
      let forkDrop = 0;
      const parent = parents.get(j);
      const sameBand = parent != null && Math.floor(parent / BAND_STEPS) === band;
      if (sameBand && f.steps[parent].branch) {
        const idx = (branchKids.get(parent) ?? []).indexOf(j);
        forkDrop = idx <= 0 ? 0 : Math.min(idx * 24, 48);
      }
      // A branch callee that is not the fall-through forks downwards: it sits
      // below its lane's baseline by the drop.
      const y = rowY(band, s.layer) + forkDrop;
      // Loop curl: back to the parent step when there is one, else the
      // previous step; only within a band, and never out of the first step.
      let curlToX: number | null = null;
      if (s.branch === "loop" && col > 0) {
        const back = sameBand && parent != null && parent < j ? parent : j - 1;
        if (Math.floor(back / BAND_STEPS) === band && col > 0) curlToX = STEP_X0 + (back % BAND_STEPS) * STEP_GAP;
      }
      board.steps.push({
        order: j,
        station: s.station,
        name: stationById.get(s.station)?.name ?? s.station,
        layer: s.layer,
        x: STEP_X0 + col * STEP_GAP,
        y,
        branch: s.branch,
        forkDrop,
        curlToX,
      });
    });

    // Chips on shared stations: every other flow that calls the same station,
    // capped at 3 per station, model order. They sit under the dot. Labels
    // truncate so a chip never crosses its 96 px step gap.
    let maxChipBottom = board.h;
    for (const st of board.steps) {
      const shared = stationById.get(st.station);
      if (!shared || shared.degree < 2) continue;
      const others = shared.flows.filter((id) => id !== f.id).slice(0, 3);
      others.forEach((id, i) => {
        const target = model.flows.find((ff) => ff.id === id);
        const label = truncate(target?.label ?? id, CHIP_CHARS);
        const cy = st.y + DOT_R + 8 + i * 22;
        maxChipBottom = Math.max(maxChipBottom, cy + 18);
        board.chips.push({
          station: st.station,
          x: st.x - CHIP_W / 2,
          y: cy,
          w: CHIP_W,
          h: 18,
          flowId: id,
          label,
        });
      });
    }
    // The panel grows to hold the chip stacks under its lowest steps.
    if (maxChipBottom > board.h) board.h = maxChipBottom + 12;
    boards.set(f.id, board);
  }

  const lay: StoryLayout = { grid, boards };
  cache.set(model, lay);
  return lay;
}

/** The board the view should open for a pick, when any. */
export function boardFor(lay: StoryLayout, pick: { kind: string; id: string } | null): StoryBoard | null {
  if (!pick) return null;
  if (pick.kind === "flow") return lay.boards.get(pick.id) ?? null;
  if (pick.kind === "station") {
    // First flow in model order that calls this station.
    return flowForStation(lay, pick.id);
  }
  return null;
}

// The station → flow lookup needs the model, not just the layout, so keep it
// beside boardFor as a small helper over the layout's boards.
function flowForStation(lay: StoryLayout, stationId: string): StoryBoard | null {
  for (const b of lay.boards.values()) {
    if (b.steps.some((s) => s.station === stationId)) return b;
  }
  return null;
}

/** Below this scale the grid shows panels and strips only – no card text. */
export const Z_CARD_TEXT = 0.5;
/** At or above this scale, with a flow open, the board replaces the grid. */
export const Z_STORY = 0.7;
