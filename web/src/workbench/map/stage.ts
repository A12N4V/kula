// W2 – client-side staging heuristic: turn /api/graph (symbol level) +
// /api/flows into the Map the wheel, subway and inspector all read (PLAN
// pass 4, simplified: entrypoints → effect sinks → depth bands). Blocks are
// the graph's Leiden communities – the same unit the real codemap uses –
// capped to the biggest 40 with the rest folded into an "(other)" block.
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

const OTHER = "(other)";
const SINK = /store|cache|write|flush|exit|send|emit|serve|listen|spawn|fs|net|io/i;

function blockLabel(label: string, dir: string): string {
  // communities label as "<dir> · <top id>"; keep the identifier half
  const tail = label.includes("·") ? label.split("·").slice(1).join("·").trim() : "";
  return tail || dir.split("/").pop() || dir;
}

export async function buildMap(): Promise<MapShape> {
  const [graph, flows] = await Promise.all([api.graph("symbol"), api.flows()]);
  return shapeFrom(graph, flows);
}

export function shapeFrom(graph: GraphData, flows: Flow[]): MapShape {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  // Pass 1 – blocks = communities, biggest first; the rest folds into (other)
  const byComm = new Map<number, typeof graph.nodes>();
  for (const n of graph.nodes) (byComm.get(n.community) ?? byComm.set(n.community, []).get(n.community)!).push(n);
  const ranked = [...byComm.entries()]
    .map(([id, members]) => {
      const label = graph.communities.find((c) => c.id === id)?.label ?? `community ${id}`;
      const dir = members[0].path.split("/").slice(0, -1).join("/") || "(root)";
      return { id, members, label, dir, symbols: members.length };
    })
    .filter((r) => r.symbols >= 3)
    .sort((a, b) => b.symbols - a.symbols);
  const kept = ranked.slice(0, 40);
  const commBlock = new Map<number, string>();
  for (const r of kept) commBlock.set(r.id, String(r.id));
  const churn = graph.churn ?? {};
  const blocks: MapBlock[] = kept.map((r) => {
    const files = [...new Set(r.members.map((m) => m.path))];
    return {
      id: String(r.id),
      label: blockLabel(r.label, r.dir),
      stage: "transform" as Stage,
      symbols: r.symbols,
      dir: r.dir,
      files,
      churn: files.reduce((s, f) => s + (churn[f] ?? 0), 0),
    };
  });
  const otherMembers = graph.nodes.filter((n) => !commBlock.has(n.community));
  if (otherMembers.length) {
    blocks.push({
      id: OTHER,
      label: OTHER,
      stage: "transform",
      symbols: otherMembers.length,
      dir: "(rest)",
      files: [],
      churn: 0,
    });
  }
  const blockOfComm = (c: number) => commBlock.get(c) ?? OTHER;

  // Pass 2 – stage. entry = communities owning flow entries; effect = sink
  // signatures or the last step of a flow; middle = depth bands on the
  // community DAG from entries (terciles).
  const entryComms = new Set<number>();
  const effectComms = new Set<number>();
  for (const f of flows) {
    const e = nodes.get(f.entry.id);
    if (e) entryComms.add(e.community);
    const last = f.steps[f.steps.length - 1];
    const ln = last ? nodes.get(last.node.id) : undefined;
    if (ln) effectComms.add(ln.community);
  }
  for (const n of graph.nodes) if (SINK.test(n.name)) effectComms.add(n.community);
  // community-level DAG depth from entries
  const deps = new Map<number, Set<number>>();
  for (const e of graph.edges) {
    const sc = nodes.get(e.src)?.community;
    const dc = nodes.get(e.dst)?.community;
    if (sc != null && dc != null && sc !== dc) (deps.get(sc) ?? deps.set(sc, new Set()).get(sc)!).add(dc);
  }
  const depth = new Map<number, number>();
  const queue: number[] = [...entryComms];
  entryComms.forEach((c) => depth.set(c, 0));
  while (queue.length) {
    const c = queue.shift()!;
    for (const next of deps.get(c) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(c) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  const midDepths = kept
    .map((r) => depth.get(r.id))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const at = (q: number) => midDepths[Math.min(midDepths.length - 1, Math.floor(q * midDepths.length))] ?? 0;
  const t1 = at(1 / 3);
  const t2 = at(2 / 3);
  const stageOfComm = (c: number): Stage => {
    if (entryComms.has(c)) return "entry";
    if (effectComms.has(c)) return "effect";
    const d = depth.get(c);
    if (d == null) return "transform"; // unreachable from entries – default band
    return d <= t1 ? "ingest" : d <= t2 ? "transform" : "decide";
  };
  for (const b of blocks) b.stage = b.id === OTHER ? "transform" : stageOfComm(Number(b.id));
  // every stage must have at least one block (wheel geometry expects it)
  for (const s of STAGES) {
    if (!blocks.some((b) => b.stage === s)) {
      const donor = blocks.find((b) => b.id !== OTHER && b.stage === "transform") ?? blocks[0];
      if (donor) donor.stage = s;
    }
  }
  const blockOf = new Map(blocks.map((b) => [b.id, b]));

  // Pass 3 – threads from flows: entry block → effect block, weight = reach,
  // steps give the stop order and the function chain for the subway.
  const threadMap = new Map<string, MapThread>();
  for (const f of flows) {
    const e = nodes.get(f.entry.id);
    if (!e) continue;
    const fromId = blockOfComm(e.community);
    const last = f.steps[f.steps.length - 1];
    const ln = last ? nodes.get(last.node.id) : undefined;
    const toId = ln ? blockOfComm(ln.community) : fromId;
    if (!blockOf.has(fromId) || !blockOf.has(toId) || fromId === toId) continue;
    const id = `${fromId}->${toId}`;
    const t = threadMap.get(id) ?? {
      id,
      label: `${blockOf.get(fromId)!.label} → ${blockOf.get(toId)!.label}`,
      blocks: [fromId, toId],
      weight: 0,
      fns: [],
    };
    t.weight += f.reach;
    for (const s of f.steps) {
      const n = nodes.get(s.node.id);
      if (!n) continue;
      const b = blockOfComm(n.community);
      if (blockOf.has(b)) {
        if (!t.blocks.includes(b)) t.blocks.push(b);
        t.fns.push({ block: b, name: n.name, path: n.path });
      }
    }
    threadMap.set(id, t);
  }
  const threads = [...threadMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 24);
  return { blocks, threads };
}
