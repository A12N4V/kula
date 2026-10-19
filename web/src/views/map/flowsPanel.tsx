// Value-flow canvas – the map as a flowchart of what the program achieves.
// Left to right: entry tiles (the kit's D shape) → flow tiles (name under the
// tile, outcome as the subtitle) → the sections that implement them. Nodes
// are `kind: "tile"` per docs/design/flow-canvas.md §2.1; icons come from
// views/map/icons.tsx (KindIcon / RoleMark). Selection opens the inspector's
// deep link for a section. The old `flows` key (chain-family edges) is not
// touched – this reads only the additive `value_flows` from /api/map.

import { useMemo, useState } from "react";
import { FlowCanvas, type FlowEdge, type FlowNode } from "../../flow";
import { KindIcon, RoleMark, ROLE_COLOR } from "./icons";
import type { MapData, Role, ValueFlow } from "./types";

type Props = {
  data: MapData;
  /** Open a section in the block canvas (Map's deep link). */
  onSection?: (blockId: string) => void;
};

const entId = (n: number) => `vf:e${n}`;
const flowId = (i: number) => `vf:f${i}`;
const secId = (b: string) => `vf:b${b}`;

/** Flow tiles ranked left to right: the API's order is already the stable
 *  (name, entry) sort, so the canvas needs no second opinion. */
export function flowsToNodes(data: MapData): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const flows = data.value_flows ?? [];
  const entryNodes = new Map<number, FlowNode>();
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    const el = data.leaves[f.entry];
    if (!entryNodes.has(f.entry)) {
      const n: FlowNode = {
        id: entId(f.entry), kind: "tile", entry: true,
        title: el?.name ?? `entry ${f.entry}`, subtitle: "entry",
        icon: el ? <KindIcon kind={el.kind} /> : <RoleMark role="entry" />,
        color: ROLE_COLOR.entry,
      };
      entryNodes.set(f.entry, n);
      nodes.push(n);
    }
    nodes.push({
      id: flowId(i), kind: "tile", title: f.name, subtitle: f.outcome,
      icon: <KindIcon kind={el?.kind ?? "fn"} />, color: "var(--text-2)",
      badge: f.members.length > 1 ? `${f.members.length}` : undefined,
    });
    edges.push({ id: `vf:${f.entry}:${i}`, source: entId(f.entry), target: flowId(i), main: true, weight: 2 });
    for (const b of f.sections) {
      const blk = data.blocks[b];
      const role = (blk?.role ?? "core") as Role;
      if (!nodes.some((n) => n.id === secId(b))) {
        nodes.push({
          id: secId(b), kind: "tile", title: blk?.name ?? b, subtitle: role,
          icon: <RoleMark role={role} />, color: ROLE_COLOR[role], noOut: true,
        });
      }
      edges.push({ id: `vf:f${i}:${b}`, source: flowId(i), target: secId(b), main: true, weight: 1 });
    }
  }
  return { nodes, edges };
}

/** The value-flow lens: one LR flowchart, entries leftmost, no hard-coded
 *  count – an empty map shows its empty state and nothing else breaks. */
export function FlowsPanel({ data, onSection }: Props) {
  const flows = data.value_flows ?? [];
  const { nodes, edges } = useMemo(() => flowsToNodes(data), [data]);
  const [sel, setSel] = useState<string | null>(null);
  const open = (id: string) => {
    if (id.startsWith(secId(""))) onSection?.(id.slice(secId("").length));
  };
  if (!flows.length) {
    return (
      <div className="sy-root vf-empty" data-testid="map-flows-empty">
        <div className="empty">
          <p>No value flows yet – the extractor found no entry-to-side-effect chains.</p>
          <p className="muted">Rebuild the map, or check <code>KULA_FLOWS_MAX</code> and the entry detection.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="vf-canvas" style={{ height: "100%", minHeight: 320 }} data-testid="map-flows">
      <FlowCanvas
        nodes={nodes} edges={edges}
        selection={sel} onSelect={setSel}
        onOpen={open}
        ns="map-flows" testId="vf-canvas"
        minZoom={0.25}
      />
    </div>
  );
}
