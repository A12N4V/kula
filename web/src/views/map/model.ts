// The map model: one shared picture of the program, built from the flow map
// and the graph. Stations are deduplicated by symbol id across flows, so a
// symbol many flows pass through exists once – an interchange. Everything the
// variants draw reads from here; nothing re-fetches or re-derives.
//
// Pure and deterministic: the same flowmap and graph always build the same
// model. No Math.random, no Date.now, no map iteration order dependence
// (insertion order of the input arrays is the only order used).

import type { FlowMap, FlowPath, FlowStep, GraphData } from "../../api";

export const LAYERS = ["entry", "handler", "logic", "data", "io", "test"] as const;
export type Layer = (typeof LAYERS)[number];

/** One station occurrence on a flow: its place in the call order. */
export interface MapStep {
  station: string;
  /** Call order along the flow, 0 for the entry. */
  order: number;
  depth: number;
  /** `if` | `loop` | `match` | `try` when the call sits in such a block. */
  branch?: string;
  layer: Layer;
  /** Index of the calling step in the flow's steps, none for the entry. */
  from?: number;
  /** Line in the caller where the call sits. */
  site: number;
}

export interface MapStation {
  id: string;
  name: string;
  kind: string;
  path: string;
  line: number;
  /** Layer of the first occurrence in flow order. */
  layer: Layer;
  /** Number of distinct flows through this station. */
  degree: number;
  /** First branch flag seen across flows, if any. */
  branch?: string;
  /** Every file the symbol appears in across flows, in first-seen order. */
  files: string[];
  /** Flow ids through this station, in flowmap order. */
  flows: string[];
}

export interface MapFlow {
  id: string;
  label: string;
  kind: string;
  route?: string;
  domain: number;
  /** Station id of the entry step. */
  entry: string;
  steps: MapStep[];
  files: string[];
}

export interface MapDomain {
  id: number;
  label: string;
  flows: string[];
  files: string[];
  /** Size of the district: number of distinct files. */
  size: number;
}

export interface MapModel {
  domains: MapDomain[];
  flows: MapFlow[];
  stations: MapStation[];
  /** Stations with degree ≥ 2, busiest first, id as the tiebreak. */
  interchanges: MapStation[];
}

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|(\.test\.|\.spec\.|_test\.|_tests\.)/;

/** Test paths: a test directory or a test file suffix, the same idea as the backend. */
export function isTestPath(p: string): boolean {
  return TEST_FILE.test(p);
}

/**
 * Layer of a step. Precedence, highest first:
 *
 * | layer   | when                                                                |
 * |---------|---------------------------------------------------------------------|
 * | test    | the flow is a test (kind `test`, or the entry lives on a test path) |
 * | entry   | depth 0 – the flow's own entry point                                |
 * | io      | step path under `store/` or `server/`, or the name serves or writes or reads or fetches |
 * | handler | depth 1 – a direct callee of an entry                               |
 * | data    | the name mentions store, query, db or repo                          |
 * | logic   | everything else                                                     |
 *
 * The entry always keeps its own layer: it is what the flow is entered by,
 * wherever it lives. Test flows stay one layer so the eye reads them as tests.
 */
export function layerOf(step: FlowStep, flow: FlowPath): Layer {
  if (flow.kind === "test" || isTestPath(flow.entry.path)) return "test";
  if (step.depth === 0) return "entry";
  if (/(^|\/)(store|server)\//.test(step.path) || /^(serve|write|read|fetch|save|load|insert|send|listen)/i.test(step.name)) return "io";
  if (step.depth === 1) return "handler";
  if (/store|query|db|repo|persist/i.test(step.name)) return "data";
  return "logic";
}

/** Verb–object flow label: "Serve /api/index", else the entry name in plain words. */
export function flowLabel(f: FlowPath): string {
  if (f.route) return `Serve ${f.route}`;
  const words = f.entry.name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!words) return f.entry.name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const stationId = (symId: number) => `s${symId}`;

/** Build the shared model. `graph` is optional; it only feeds domain sizes. */
export function buildMapModel(fm: FlowMap, graph?: GraphData): MapModel {
  const stations = new Map<string, MapStation>();
  const flows: MapFlow[] = [];

  for (const f of fm.flows) {
    const steps: MapStep[] = [];
    const seen = new Set<string>();
    f.steps.forEach((s, i) => {
      const sid = stationId(s.id);
      const layer = layerOf(s, f);
      steps.push({ station: sid, order: i, depth: s.depth, branch: s.branch, layer, from: (s as FlowStep & { from?: number }).from, site: s.site });
      // One station per symbol per flow, however often the flow calls it.
      if (seen.has(sid)) return;
      seen.add(sid);
      let st = stations.get(sid);
      if (!st) {
        st = { id: sid, name: s.name, kind: s.kind, path: s.path, line: s.line, layer, degree: 0, files: [], flows: [] };
        stations.set(sid, st);
      }
      st.flows.push(f.id);
      if (!st.files.includes(s.path)) st.files.push(s.path);
    });
    flows.push({
      id: f.id,
      label: flowLabel(f),
      kind: f.kind,
      route: f.route,
      domain: f.domain,
      entry: f.steps.length ? stationId(f.steps[0].id) : "",
      steps,
      files: f.files,
    });
  }

  // Degree and branch flags, counted after all flows are in.
  const branchByStation = new Map<string, string>();
  for (const f of flows) {
    for (const st of f.steps) {
      if (st.branch && !branchByStation.has(st.station)) branchByStation.set(st.station, st.branch);
    }
  }
  const stationList = [...stations.values()];
  for (const st of stationList) {
    st.degree = st.flows.length;
    const br = branchByStation.get(st.id);
    if (br) st.branch = br;
  }

  const domainById = new Map<number, MapDomain>();
  for (const d of fm.domains) {
    domainById.set(d.id, { id: d.id, label: d.label, flows: [], files: d.files, size: d.files.length });
  }
  for (const f of flows) {
    const d = domainById.get(f.domain);
    if (d) {
      d.flows.push(f.id);
      for (const p of f.files) if (!d.files.includes(p)) d.files.push(p);
    }
    d && (d.size = d.files.length);
  }

  const interchanges = stationList
    .filter((s) => s.degree >= 2)
    .sort((a, b) => b.degree - a.degree || Number(a.id.slice(1)) - Number(b.id.slice(1)));

  return {
    domains: [...domainById.values()].sort((a, b) => a.id - b.id),
    flows,
    stations: stationList.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
    interchanges,
  };
}

/** Symbol count per file from the graph, for a finer domain size later. */
export function fileSize(graph?: GraphData): Map<string, number> {
  const m = new Map<string, number>();
  if (graph) for (const n of graph.nodes) m.set(n.path, (m.get(n.path) ?? 0) + 1);
  return m;
}
