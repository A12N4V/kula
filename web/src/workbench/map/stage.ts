// W2 – client-side staging heuristic: turn /api/graph + /api/flows into the
// Map the wheel, subway and inspector all read (PLAN pass 4, simplified:
// entrypoints → effect sinks → depth bands; falls back to depth banding when
// the heuristic misplaces entry nodes).
import { api, type GraphData, type Flow } from "@/api";

export type Stage = "entry" | "ingest" | "transform" | "decide" | "effect";
export const STAGES: Stage[] = ["entry", "ingest", "transform", "decide", "effect"];

export interface MapBlock {
  id: string;
  label: string;
  stage: Stage;
  symbols: number;
  dir: string;
  files: string[];
  churn: number;
}

export interface MapThread {
  id: string;
  label: string;
  blocks: string[]; // ordered entry → effect, deduped
  weight: number; // function-path count (flow reach)
  fns: { block: string; name: string; path: string }[];
}

export interface MapShape {
  blocks: MapBlock[];
  threads: MapThread[];
}

const SINK = /(^|\/)(store|cache|git|net|fs|db|io|output|write|serve|api)(\/|$)|_cmd\.rs|server\.rs/;

function dirOf(path: string): string {
  const parts = path.split("/");
  return parts.length <= 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1) || 1).join("/");
}

function labelOf(dir: string): string {
  const parts = dir.split("/");
  return parts[parts.length - 1] || dir;
}

export async function buildMap(): Promise<MapShape> {
  const [graph, flows] = await Promise.all([api.graph("file"), api.flows()]);
  return shapeFrom(graph, flows);
}

export function shapeFrom(graph: GraphData, flows: Flow[]): MapShape {
  // Pass 1 – group nodes into blocks by directory (client-side stand-in for
  // Leiden; the graph is file-level here, symbols = files in the block).
  const byDir = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.kind !== "file") continue;
    const dir = dirOf(n.path);
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(n.path);
  }
  const churn = graph.churn ?? {};
  const ranked = [...byDir.entries()]
    .map(([dir, files]) => ({ dir, files, churn: files.reduce((s, f) => s + (churn[f] ?? 0), 0) }))
    .sort((a, b) => b.files.length - a.files.length);
  const kept = ranked.slice(0, 44).filter((r) => r.files.length >= 2);
  const rest = ranked.slice(kept.length).concat(ranked.filter((r) => r.files.length < 2));

  // Pass 2 – stage. Entry = dirs that own flow entrypoints; effect = dirs
  // matching sink signatures or owning the last step of a flow. Middle =
  // depth bands on the dir-level call graph from entries (terciles).
  const dirOfNode = (id: number) => dirOf(graph.nodes.find((n) => n.id === id)?.path ?? "");
  const entryDirs = new Set<string>();
  const effectDirs = new Set<string>();
  for (const f of flows) {
    entryDirs.add(dirOfNode(f.entry.id));
    const last = f.steps[f.steps.length - 1];
    if (last) effectDirs.add(dirOfNode(last.node.id));
  }
  // dir-level edges from the real graph
  const fileDir = new Map<number, string>();
  for (const n of graph.nodes) if (n.kind === "file") fileDir.set(n.id, dirOf(n.path));
  const fileOf = new Map<number, number[]>(); // dir node ids
  for (const n of graph.nodes) {
    if (n.kind === "file") continue;
    const p = n.parent;
    if (p == null) continue;
    // parent chains end at a file or package node
    let cur: number | null = p;
    while (cur != null) {
      const pn = graph.nodes.find((x) => x.id === cur);
      if (!pn) break;
      if (pn.kind === "file") {
        (fileOf.get(pn.id) ?? fileOf.set(pn.id, []).get(pn.id)!).push(n.id);
        cur = null;
      } else {
        cur = pn.parent;
      }
    }
  }
  const deps = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    const s = fileDir.get(e.src);
    const d = fileDir.get(e.dst);
    if (s && d && s !== d) (deps.get(s) ?? deps.set(s, new Set()).get(s)!).add(d);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [...entryDirs];
  entryDirs.forEach((d) => depth.set(d, 0));
  while (queue.length) {
    const d = queue.shift()!;
    for (const next of deps.get(d) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(d) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  const mid = kept.filter((r) => !entryDirs.has(r.dir) && !effectDirs.has(r.dir) && depth.has(r.dir));
  const depths = mid.map((r) => depth.get(r.dir)!).sort((a, b) => a - b);
  const at = (q: number) => depths[Math.min(depths.length - 1, Math.floor(q * depths.length))] ?? 0;
  const t1 = at(1 / 3);
  const t2 = at(2 / 3);
  const stageOfDir = (dir: string): Stage => {
    if (entryDirs.has(dir)) return "entry";
    if (effectDirs.has(dir) || SINK.test(dir)) return "effect";
    const d = depth.get(dir);
    if (d == null) return "transform"; // unreachable from entries – default band
    return d <= t1 ? "ingest" : d <= t2 ? "transform" : "decide";
  };

  const blocks: MapBlock[] = kept.map((r) => ({
    id: r.dir,
    label: labelOf(r.dir),
    stage: stageOfDir(r.dir),
    symbols: r.files.length,
    dir: r.dir,
    files: r.files,
    churn: r.churn,
  }));
  // fall back: any kept dir never reached from an entry stays in transform
  if (blocks.length >= 2) {
    const stages = new Set(blocks.map((b) => b.stage));
    for (const s of STAGES) if (!stages.has(s)) blocks[blocks.length - 1].stage = s;
  }
  const blockOf = new Map(blocks.map((b) => [b.dir, b]));

  // Pass 3 – threads from flows: entry block → effect block, weight = reach.
  const threadMap = new Map<string, MapThread>();
  for (const f of flows) {
    const from = blockOf.get(dirOfNode(f.entry.id));
    const to = blockOf.get(dirOfNode(f.steps[f.steps.length - 1]?.node.id ?? f.entry.id));
    if (!from || !to || from.id === to.id) continue;
    const id = `${from.id}->${to.id}`;
    const t = threadMap.get(id) ?? {
      id,
      label: `${from.label} → ${to.label}`,
      blocks: [from.id, to.id],
      weight: 0,
      fns: [],
    };
    t.weight += f.reach;
    for (const s of f.steps) {
      const b = blockOf.get(dirOfNode(s.node.id));
      if (b) {
        if (!t.blocks.includes(b.id)) t.blocks.push(b.id);
        t.fns.push({ block: b.id, name: s.node.name, path: s.node.path });
      }
    }
    threadMap.set(id, t);
  }
  const threads = [...threadMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 24);

  // pass 4 – leftovers fold into the nearest big block by shared prefix
  void rest;
  return { blocks, threads };
}
