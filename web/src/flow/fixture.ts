// Synthetic 2 600-node fixture for the #flow-lab dev route – deterministic,
// no repo data, big enough to exercise the perf bar (first paint ≤ 1 500 ms,
// mean frame ≤ 20 ms during a scripted pan).
import type { FlowEdge, FlowGroup, FlowNode } from "./types";

export type FlowLabCounts = { nodes: number; edges: number; groups: number };

export function flowLabFixture(): { nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[]; counts: FlowLabCounts } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const SECTIONS = 40;
  const BLOCKS = 52; // 40 × (52 blocks + 12 subs + 1 head) = 2 600 nodes exactly

  for (let s = 0; s < SECTIONS; s++) {
    const gid = `g${s}`;
    const head: FlowNode = { id: `s${s}`, kind: "wide", title: `Section ${s}`, subtitle: `${BLOCKS} blocks`, entry: s % 4 === 0 ? true : undefined, color: s % 2 ? "var(--accent)" : "var(--violet)", icon: "flows" };
    nodes.push(head);
    for (let b = 0; b < BLOCKS; b++) {
      const id = `n${s}_${b}`;
      nodes.push({
        id, kind: b % 9 === 8 ? "wide" : "tile", title: `Block ${s}.${b}`,
        subtitle: b % 3 === 0 ? `fan ${b}` : undefined,
        color: b % 5 === 0 ? "var(--green)" : b % 7 === 0 ? "var(--blue)" : undefined,
        icon: b % 5 === 0 ? "check" : b % 7 === 0 ? "pr" : undefined,
        status: b === 3 && s % 5 === 0 ? "running" : undefined,
        noOut: b === BLOCKS - 1,
      });
      if (b < 12) nodes.push({ id: `c${s}_${b}`, kind: "circle", title: `Cfg ${s}.${b}`, subtitle: `scope ${b}`, sub: true, parent: id, icon: "settings" });
      if (b > 0) edges.push({ id: `e${s}_${b}`, source: `n${s}_${b - 1}`, target: `n${s}_${b}`, weight: (b % 4) + 1, label: b % 11 === 0 ? `${b}` : undefined });
      if (b === 0) edges.push({ id: `eh${s}`, source: `s${s}`, target: id, weight: 3 });
    }
    edges.push({ id: `eb${s}`, source: `n${s}_40`, target: `n${s}_5`, weight: 1 }); // one loop back per section
    groups.push({ id: gid, label: `Section ${s}`, members: [`s${s}`, ...Array.from({ length: BLOCKS }, (_, b) => `n${s}_${b}`)] });
  }
  // A few cross-section forward links keep components non-trivial (backward
  // cross-links would make one giant cyclic component – dagre's cycle
  // breaking dominates the layout cost, so the lab keeps loops local).
  for (let s = 1; s < SECTIONS; s += 4) edges.push({ id: `x${s}`, source: `n${s - 1}_${BLOCKS - 1}`, target: `s${s}`, weight: 2 });
  return { nodes, edges, groups, counts: { nodes: nodes.length, edges: edges.length, groups: groups.length } };
}
