// The map model: one shared picture of the program, built from the flow map
// and the graph. Stations are deduplicated by symbol id across flows, so a
// symbol many flows pass through exists once – an interchange. Everything the
// variants draw reads from here; nothing re-fetches or re-derives.
//
// Pure and deterministic: the same flowmap and graph always build the same
// model. No Math.random, no Date.now, no map iteration order dependence
// (insertion order of the input arrays is the only order used).

import type { FlowMap, FlowPath, FlowStep, GraphData, Node } from "../../api";

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
  /** Id of the containing class, interface or function, when it has one. */
  container?: number;
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
  /** Containment rectangles, when the graph was supplied. */
  containers: MapContainer[];
}

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\/|(\.test\.|\.spec\.|_test\.|_tests\.)/;
/** Test paths: a test directory or a test file suffix, the same idea as the backend. */
export function isTestPath(p: string): boolean {
  return TEST_FILE.test(p);
}

/** Module of a path: path minus extension; a mod.rs counts as its folder
 * (src/index/mod.rs → src/index). */
export function moduleOf(path: string): string {
  let p = path.replace(/\.[^./]+$/, "");
  if (p.endsWith("/mod")) p = p.slice(0, -4);
  return p;
}

/** Modules never used for domains: the server and cmd binaries. */
const DOMAIN_SKIP = /^src\/(server|cmd)(\/|$)/;

/** Plain-words label for a module: src/guard.rs → Guard, src/index/mod.rs →
 * Index, web/src/views/hub → Hub view. */
export function plainLabel(modulePath: string): string {
  const seg = modulePath.split("/").filter(Boolean);
  const last = seg[seg.length - 1] ?? modulePath;
  const name = last ? last.charAt(0).toUpperCase() + last.slice(1) : modulePath;
  return seg.includes("views") ? `${name} view` : name;
}

/** One symbol inside a container. Non-flow members (onFlow false) are the
 * container's own methods or variables that no flow passes through. */
export interface MapMember {
  id: string;
  name: string;
  kind: string;
  line: number;
  onFlow: boolean;
}

/** A class, interface or function rectangle that holds stations. */
export interface MapContainer {
  id: number;
  kind: "class" | "interface" | "function";
  name: string;
  path: string;
  line: number;
  end?: number;
  parent?: number;
  members: MapMember[];
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

  // Domains are recomputed from the steps themselves (backend community ids
  // are too coarse). The rule, also documented in docs/design/map-view.md:
  //   · each flow joins the most frequent module among its steps, skipping the
  //     entry step and any step under src/server or src/cmd
  //   · module = path without extension, mod.rs → its folder
  //   · a domain left with a single flow merges into its nearest neighbour,
  //     the domain sharing the most stations with it
  const stationBySid = stations;
  const bestModule = new Map<string, string>();
  for (const f of flows) {
    const tally = new Map<string, number>();
    f.steps.forEach((st, i) => {
      if (i === 0) return; // the entry step says nothing about where the flow lives
      const path = stationBySid.get(st.station)?.path;
      if (!path) return;
      const m = moduleOf(path);
      if (!m || DOMAIN_SKIP.test(m)) return;
      tally.set(m, (tally.get(m) ?? 0) + 1);
    });
    let best = "", bestN = 0;
    for (const m of [...tally.keys()].sort()) {
      const n = tally.get(m)!;
      if (n > bestN) { best = m; bestN = n; }
    }
    if (!best) best = moduleOf(stationBySid.get(f.entry)?.path ?? "") || "misc";
    bestModule.set(f.id, best);
  }

  const groups = new Map<string, { flows: string[]; stations: Set<string> }>();
  for (const f of flows) {
    const m = bestModule.get(f.id)!;
    let g = groups.get(m);
    if (!g) { g = { flows: [], stations: new Set() }; groups.set(m, g); }
    g.flows.push(f.id);
    for (const st of f.steps) g.stations.add(st.station);
  }

  // Merge single-flow domains into their nearest neighbour by shared stations.
  for (const m of [...groups.keys()]) {
    const g = groups.get(m)!;
    if (g.flows.length !== 1 || groups.size <= 1) continue;
    let bestM = "", bestShared = -1, bestSize = -1;
    for (const m2 of [...groups.keys()].sort()) {
      if (m2 === m) continue;
      const g2 = groups.get(m2)!;
      let shared = 0;
      for (const s of g.stations) if (g2.stations.has(s)) shared++;
      if (shared > bestShared || (shared === bestShared && g2.flows.length > bestSize)) {
        bestM = m2; bestShared = shared; bestSize = g2.flows.length;
      }
    }
    const into = groups.get(bestM)!;
    into.flows.push(...g.flows);
    for (const s of g.stations) into.stations.add(s);
    groups.delete(m);
  }

  const domainOfFlow = new Map<string, number>();
  const domainById = new Map<number, MapDomain>();
  [...groups.keys()].sort().forEach((m, i) => {
    const id = i + 1;
    const g = groups.get(m)!;
    const files: string[] = [];
    for (const fid of g.flows) {
      domainOfFlow.set(fid, id);
      const f = flows.find((x) => x.id === fid)!;
      for (const p of f.files) if (!files.includes(p)) files.push(p);
    }
    domainById.set(id, { id, label: plainLabel(m), flows: [...g.flows], files, size: files.length });
  });
  for (const f of flows) f.domain = domainOfFlow.get(f.id) ?? f.domain;

  const interchanges = stationList
    .filter((s) => s.degree >= 2)
    .sort((a, b) => b.degree - a.degree || Number(a.id.slice(1)) - Number(b.id.slice(1)));

  return {
    domains: [...domainById.values()].sort((a, b) => a.id - b.id),
    flows,
    stations: stationList.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
    interchanges,
    containers: buildContainers(graph, stations),
  };
}

/**
 * Containment from the graph. A node that some other node names as its
 * `parent` is a container; its children are its members, and members that no
 * flow passes through still appear (onFlow false) so a class rectangle shows
 * the whole class. Function containers get their variables lazily from N1 –
 * `loadInner` fills those in, cached per data version.
 */
function buildContainers(graph: GraphData | undefined, stations: Map<string, MapStation>): MapContainer[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const containers: MapContainer[] = [];
  const children = new Map<number, Node[]>();
  for (const n of graph.nodes) {
    if (n.parent == null) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  for (const n of graph.nodes) {
    if (!children.has(n.id)) continue;
    const kind = n.kind === "class" ? "class" : n.kind === "interface" ? "interface" : "function";
    const members: MapMember[] = (children.get(n.id) ?? [])
      .sort((a, b) => a.start_line - b.start_line)
      .map((c) => ({
        id: stationId(c.id),
        name: c.name,
        kind: c.kind,
        line: c.start_line,
        onFlow: stations.has(stationId(c.id)),
      }));
    const cid = n.id;
    containers.push({
      id: cid,
      kind,
      name: n.name,
      path: n.path,
      line: n.start_line,
      end: n.end_line,
      ...(n.parent != null && byId.has(n.parent) ? { parent: n.parent } : {}),
      members,
    });
    // Attach stations to their container.
    for (const c of children.get(n.id) ?? []) {
      const st = stations.get(stationId(c.id));
      if (st && st.container == null) st.container = cid;
    }
  }
  return containers;
}

let innerVersion = 0;
const innerCache = new Map<number, Map<string, MapMember[]>>();

/** Advance the data version so `loadInner` caches are dropped on reindex. */
export function bumpDataVersion(): number {
  return ++innerVersion;
}

/** Variables of a function container, lazily from N1. Stub until N1's
 * endpoint lands: resolves an empty map, cached per data version. */
export async function loadInner(ids: string[], version = innerVersion): Promise<Map<string, MapMember[]>> {
  const cached = innerCache.get(version);
  if (cached) return cached;
  const empty = new Map<string, MapMember[]>();
  innerCache.set(version, empty);
  return empty;
}

/** Symbol count per file from the graph, for a finer domain size later. */
export function fileSize(graph?: GraphData): Map<string, number> {
  const m = new Map<string, number>();
  if (graph) for (const n of graph.nodes) m.set(n.path, (m.get(n.path) ?? 0) + 1);
  return m;
}
