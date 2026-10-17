// Layout – dagre LR main flow, TB sub-layout for attached config sub-nodes,
// group boxes derived from member bounding boxes, weak-component partitioning
// so a big canvas lays out as many small dagre runs instead of one huge one.
// Cached per (layoutKey, data hash); off the main thread in a Worker when the
// synchronous run costs more than 30 ms (docs/design/flow-canvas.md §3.3).
import dagre from "@dagrejs/dagre";
import { CHIP, CIRCLE, FlowEdge, FlowGroup, FlowNode, GRID, GROUP_PAD, nodeSize, RANK_STEP, snap, TILE, WIDE, dataHash } from "./types";

export type LaidOut = { nodes: FlowNode[]; groups: FlowGroup[]; ms: number };

/* One dagre run over a flat node set. */
function dagreRun(ids: string[], edges: { source: string; target: string }[], dir: "LR" | "TB", pos: Map<string, FlowNode>): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: dir, nodesep: dir === "LR" ? 32 : 24, ranksep: dir === "LR" ? RANK_STEP : 96, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) {
    const n = pos.get(id)!;
    const s = nodeSize(n);
    g.setNode(id, { width: s.w, height: s.h });
  }
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const n = g.node(id) as { x: number; y: number; width: number; height: number };
    // dagre centres; we want top-left, snapped to the grid.
    out.set(id, { x: snap(n.x - n.width / 2), y: snap(n.y - n.height / 2) });
  }
  return out;
}

/* Weakly connected components over main nodes (sub-nodes ride their parent). */
function components(ids: string[], edges: FlowEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  const link = (a: string, b: string) => {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  };
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) link(e.source, e.target);
  }
  const seen = new Set<string>();
  const comps: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const next of adj.get(cur) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    comps.push(comp);
  }
  return comps;
}

/** Synchronous layout. Pure: returns new node objects with positions. */
export function layoutSync(nodes: FlowNode[], edges: FlowEdge[], groups: FlowGroup[] = []): LaidOut {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const pos = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const mains = nodes.filter((n) => !n.sub);
  const subs = nodes.filter((n) => n.sub);
  const mainEdges = edges.filter((e) => e.main !== false && !nodes.find((n) => n.id === e.target && n.sub));
  const out = new Map<string, { x: number; y: number }>();

  // Main flow: components are batched into large dagre runs (one run per
  // ~700 nodes – dagre pays a fixed cost per run, but huge single runs risk
  // stack overflow on the recursion in its ranking), then shelf-packed so
  // sections read as distinct islands instead of one tangle.
  const comps = components(mains.map((n) => n.id), mainEdges);
  comps.sort((a, b) => b.length - a.length);
  const BATCH = 700;
  const batches: string[][] = [];
  let cur: string[] = [];
  for (const comp of comps) {
    if (cur.length + comp.length > BATCH && cur.length) { batches.push(cur); cur = []; }
    cur = cur.concat(comp);
  }
  if (cur.length) batches.push(cur);
  const placedById = new Map<string, { x: number; y: number }>();
  for (const batch of batches) {
    const inBatch = new Set(batch);
    const batchEdges = mainEdges.filter((e) => inBatch.has(e.source) && inBatch.has(e.target));
    const placed = dagreRun(batch, batchEdges, "LR", pos);
    for (const [id, p] of placed) placedById.set(id, p);
  }
  // Shelf-pack the components (their coordinates are independent).
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const comp of comps) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of comp) {
      const p = placedById.get(id)!;
      const s = nodeSize(pos.get(id)!);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    }
    const w = maxX - minX;
    if (x > 0 && x + w > 8000) { x = 0; y += rowH + 256; rowH = 0; }
    for (const id of comp) {
      const p = placedById.get(id)!;
      out.set(id, { x: snap(p.x - minX + x), y: snap(p.y - minY + y) });
    }
    x += w + 256;
    rowH = Math.max(rowH, maxY - minY);
  }

  // Sub-nodes: one TB dagre run over every sub-tree (each parent's sub-tree
  // is a separate weak component, so one batched run is safe), then each
  // sub-tree is translated so its centroid sits under its parent.
  const byParent = new Map<string, FlowNode[]>();
  for (const s of subs) {
    if (!s.parent) continue;
    if (!byParent.has(s.parent)) byParent.set(s.parent, []);
    byParent.get(s.parent)!.push(s);
  }
  if (byParent.size) {
    const allKids = [...byParent.values()].flat();
    const kidSet = new Set(allKids.map((k) => k.id));
    const kidEdges = edges.filter((e) => kidSet.has(e.source) && kidSet.has(e.target));
    const placed = dagreRun(allKids.map((k) => k.id), kidEdges, "TB", pos);
    for (const [pid, kids] of byParent) {
      const pp = out.get(pid) ?? pos.get(pid)?.pos;
      if (!pp) continue;
      const pnode = pos.get(pid)!;
      let cx = 0;
      let minY = Infinity;
      for (const k of kids) {
        const p = placed.get(k.id)!;
        cx += p.x + CIRCLE.w / 2;
        minY = Math.min(minY, p.y);
      }
      const centre = cx / kids.length;
      const originX = snap(pp.x + nodeSize(pnode).w / 2 - centre);
      const originY = snap(pp.y + nodeSize(pnode).h + 32 - minY);
      for (const k of kids) {
        const p = placed.get(k.id)!;
        out.set(k.id, { x: snap(p.x + originX), y: snap(p.y + originY) });
      }
    }
  }

  const laid: FlowNode[] = nodes.map((n) => {
    if (n.pos && !out.has(n.id)) return n; // caller-pinned position wins
    const p = out.get(n.id) ?? n.pos ?? { x: 0, y: 0 };
    return { ...n, pos: p };
  });

  // Group frames: bounding box of members + padding, behind them.
  const memberOf = new Map<string, string[]>();
  for (const grp of groups) memberOf.set(grp.id, grp.members.filter((m) => laid.some((n) => n.id === m && !n.sub)));
  const groupsOut: FlowGroup[] = groups.map((g) => ({ ...g }));
  const groupNodes: FlowNode[] = [];
  for (const g of groups) {
    const members = laid.filter((n) => g.members.includes(n.id) && !n.sub);
    if (!members.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      const s = nodeSize(m);
      minX = Math.min(minX, m.pos!.x);
      minY = Math.min(minY, m.pos!.y);
      maxX = Math.max(maxX, m.pos!.x + s.w);
      maxY = Math.max(maxY, m.pos!.y + s.h);
    }
    groupNodes.push({
      id: g.id, kind: "group", title: g.label, subtitle: `${members.length}`,
      size: { w: snap(maxX - minX + GROUP_PAD * 2), h: snap(maxY - minY + GROUP_PAD * 2) },
      pos: { x: snap(minX - GROUP_PAD), y: snap(minY - GROUP_PAD) },
      parent: undefined,
    });
    // Members become children of the frame so dragging the frame drags them.
    for (const m of members) m.parent = g.id;
  }

  // Rebase children into their parent's coordinate space (React Flow parentId).
  const byId = new Map(laid.concat(groupNodes as FlowNode[]).map((n) => [n.id, n]));
  for (const n of byId.values()) {
    if (!n.parent) continue;
    const p = byId.get(n.parent);
    if (!p || !p.pos || !n.pos) continue;
    n.pos = { x: n.pos.x - p.pos.x, y: n.pos.y - p.pos.y };
  }

  const all = [...groupNodes, ...laid];
  return { nodes: all, groups: groupsOut, ms: (typeof performance !== "undefined" ? performance.now() : 0) - t0 };
}

/* ---- Cache + worker offload ---------------------------------------- */

/** Test/debug hook: did the last big layout go through the Worker? */
export function layoutWorkerUsed(): boolean {
  return worker !== null && workerUsed;
}
let workerUsed = false;

type Job = { nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[] };

const cache = new Map<string, LaidOut>();
const WORKER_MS = 30;
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: LaidOut) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ id: number; result: LaidOut }>) => {
      const job = pending.get(ev.data.id);
      if (!job) return;
      pending.delete(ev.data.id);
      job.resolve(ev.data.result);
    };
    worker.onerror = () => {
      worker = null;
      for (const job of pending.values()) job.reject(new Error("layout worker failed"));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Layout with the 30 ms rule: under it we pay the main-thread cost once and
 * cache; over it the same job runs in the inline Worker. Cached per
 * (layoutKey, data hash); callers pass `pinned` positions that must win.
 */
export async function layout(nodes: FlowNode[], edges: FlowEdge[], groups: FlowGroup[], cacheKey: string): Promise<LaidOut> {
  const hash = dataHash(nodes, edges);
  const key = `${cacheKey}:${hash}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, nodes: rebasePinned(hit.nodes, nodes) };
  const job: Job = { nodes: nodes.map((n) => ({ ...n, pos: undefined })), edges, groups };
  const w = getWorker();
  if (w) {
    const id = ++seq;
    let result: LaidOut;
    try {
      result = await new Promise<LaidOut>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workerUsed = true;
        w.postMessage({ id, ...job });
      });
    } catch {
      // Worker failed mid-job – fall back to the main thread, once, uncached.
      const w2 = getWorker();
      if (w2 && w2 !== w) return layout(nodes, edges, groups, cacheKey);
      result = layoutSync(job.nodes, job.edges, job.groups);
    }
    cache.set(key, result);
    return { ...result, nodes: rebasePinned(result.nodes, nodes) };
  }
  const result = layoutSync(job.nodes, job.edges, job.groups);
  // Learned cost: once a synchronous run proved expensive, route the next big
  // one through the worker (the first expensive run is the price of measuring).
  if (result.ms > WORKER_MS && !w) {
    cache.delete(key);
    const w2 = getWorker();
    if (w2) return layout(nodes, edges, groups, cacheKey);
  }
  cache.set(key, result);
  return { ...result, nodes: rebasePinned(result.nodes, nodes) };
}

/** Caller-pinned positions survive a cached (or fresh) layout. */
function rebasePinned(laid: FlowNode[], original: FlowNode[]): FlowNode[] {
  const pinned = new Map(original.filter((n) => n.pos).map((n) => [n.id, n.pos!]));
  if (!pinned.size) return laid;
  return laid.map((n) => (pinned.has(n.id) ? { ...n, pos: pinned.get(n.id)! } : n));
}

export function clearLayoutCache() {
  cache.clear();
}

/* Size sanity for tests: every supported kind maps to a grid size. */
export const SIZE_OF = { tile: TILE, wide: WIDE, circle: CIRCLE, chip: CHIP, grid: GRID };
