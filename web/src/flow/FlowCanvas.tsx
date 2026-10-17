// FlowCanvas – the one canvas. React Flow 12 under a kula skin: 16 px grid,
// dot background on --line, snap, marquee select, group collapse/expand,
// hover toolbar slot, keyboard layer, controls (zoom/fit/tidy/reset/lock),
// toggleable minimap, persisted drags, worker-offloaded dagre layout.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow, useStore, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FcCtx } from "./fcContext";
import { edgeTypes } from "./edges";
import { layout, layoutWorkerUsed } from "./layout";
import { applyPersisted, clearPersisted, persist } from "./positions";
import { CHIP, nodeSize, snap, type FlowEdge, type FlowGroup, type FlowNode } from "./types";
import { nodeTypes } from "./nodes";

export type FlowCanvasProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
  /** Controlled selection; internal state when omitted. */
  selection?: string | null;
  onSelect?: (id: string | null) => void;
  /** Invalidate layout + persisted drags when it changes. */
  layoutKey?: string;
  /** Persistence namespace – the caller's repo + view. */
  ns?: string;
  /** Sidebar column content (a <FlowSidebar> frame or any node). */
  sidebar?: ReactNode;
  /** Open a node's detail (Enter, double-click, hover toolbar). */
  onOpen?: (id: string) => void;
  testId?: string;
};

type RfNode = Node<FlowNode>;

const toRf = (n: FlowNode, sel: string | null, collapsed: Set<string>, chipIds: Set<string>): RfNode => {
  const s = nodeSize(n);
  const isChip = chipIds.has(n.id);
  return {
    id: n.id,
    type: isChip ? "wide" : n.kind,
    position: { x: n.pos?.x ?? 0, y: n.pos?.y ?? 0 },
    data: isChip ? { ...n, size: CHIP } : n,
    style: { width: s.w, height: s.h },
    parentId: n.parent,
    extent: n.parent ? "parent" : undefined,
    hidden: collapsed.has(n.parent ?? ""),
    selected: sel === n.id,
    // Per-node `draggable: true` would override the global nodesDraggable,
    // so chips set false and everything else stays undefined (global wins,
    // which is what the lock control flips).
    draggable: isChip ? false : undefined,
  } as RfNode;
};

function FlowCanvasInner(props: FlowCanvasProps) {
  const { nodes, edges, groups = [], selection, onSelect, layoutKey = "default", ns = "lab", sidebar, onOpen, testId = "flow-canvas" } = props;
  const rf = useReactFlow();
  const [rfNodes, setRfNodes] = useState<RfNode[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState(false);
  const [showMini, setShowMini] = useState(false); // default off – rendering 2 600 mini-rects costs the first paint
  const [sideOpen, setSideOpen] = useState(false);
  const [internalSel, setInternalSel] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const sel = selection !== undefined ? selection : internalSel;
  const didFit = useRef(false);
  const nodesRef = useRef<RfNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  nodesRef.current = rfNodes;
  edgesRef.current = rfEdges;
  const reduced = useRef(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const tidySeq = useRef(0);

  // Layout (cached, worker-offloaded) whenever the data or layoutKey changes.
  useEffect(() => {
    let live = true;
    performance.mark("fc:effect");
    (async () => {
      const effectiveKey = tidySeq.current ? `${layoutKey}:tidy${tidySeq.current}` : layoutKey;
      const res = await layout(nodes, edges, groups, effectiveKey);
      performance.mark("fc:layout-done");
      (window as unknown as { __fcLayout?: { ms: number; nodes: number; worker: boolean; mainEdges: [string, string][] } }).__fcLayout = { ms: res.ms, nodes: res.nodes.filter((n) => n.kind !== "group").length, worker: !!layoutWorkerUsed(), mainEdges: edges.filter((e) => e.main !== false).map((e) => [e.source, e.target]) };
      if (!live) return;
      const withDrags = applyPersisted(ns, layoutKey, res.nodes);
      // Progressive hydration: paint the first chunk now (the ready marker and
      // the first viewport come up immediately), the rest lands next frame so
      // a 2 600-node canvas still paints under the perf bar.
      // Parents must precede children in the array (React Flow requirement),
      // so sort by parent-chain depth first, then left-to-right for hydration.
      const depthOf = new Map<string, number>();
      const byId = new Map(withDrags.map((n) => [n.id, n]));
      const depth = (n: FlowNode): number => {
        if (depthOf.has(n.id)) return depthOf.get(n.id)!;
        const d = n.parent && byId.has(n.parent) ? depth(byId.get(n.parent)!) + 1 : 0;
        depthOf.set(n.id, d);
        return d;
      };
      const sorted = [...withDrags].sort((a, b) => depth(a) - depth(b) || (a.pos!.x - b.pos!.x) || (a.pos!.y - b.pos!.y));
      const FIRST = 400;
      setRfNodes(sorted.slice(0, FIRST).map((n) => toRf(n, null, new Set(), new Set())));
      setRfEdges(edges.map((e) => ({
        id: e.id, source: e.source, target: e.target, type: "flow-edge",
        data: { ...e }, zIndex: e.main === false ? 0 : 1,
      })));
      didFit.current = true;
      // Hydrate the rest in small chunks (no 600 ms long task), then fit.
      let done = FIRST;
      const CHUNK = 800;
      const step = () => {
        if (!live) return;
        if (done >= sorted.length) {
          performance.mark("fc:hydrate");
          setHydrated(true);
          rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 });
          return;
        }
        setRfNodes((prev) => prev.concat(sorted.slice(done, done + CHUNK).map((n) => toRf(n, null, new Set(), new Set()))));
        done += CHUNK;
        window.setTimeout(step, 50);
      };
      window.setTimeout(step, 60);
    })();
    return () => { live = false; };
  }, [nodes, edges, groups, layoutKey, ns, rf]);

  // Collapsed groups: members + frame hidden, one chip per collapsed group,
  // edges re-anchored to the chip (docs/design/flow-canvas.md §4).
  const view = useMemo(() => {
    const chipIds = new Set<string>();
    for (const g of groups) if (collapsed.has(g.id)) chipIds.add(`${g.id}::chip`);
    const memberOf = new Map<string, FlowGroup>();
    for (const g of groups) for (const m of g.members) memberOf.set(m, g);
    // Hide group frames + members of collapsed groups; add chips.
    const shown: RfNode[] = [];
    for (const n of rfNodes) {
      const g = memberOf.get(n.id);
      if (g && collapsed.has(g.id)) continue;
      if (n.type === "group" && collapsed.has(n.id)) continue;
      shown.push(n);
    }
    for (const g of groups) {
      if (!collapsed.has(g.id)) continue;
      const frame = rfNodes.find((n) => n.id === g.id);
      const chip: RfNode = {
        id: `${g.id}::chip`, type: "wide",
        position: { x: frame?.position.x ?? 0, y: frame?.position.y ?? 0 },
        data: { id: `${g.id}::chip`, kind: "wide", title: g.label, subtitle: `${g.members.length} members`, size: CHIP, color: "var(--accent)" },
        style: { width: CHIP.w, height: CHIP.h },
        selected: sel === g.id,
      } as RfNode;
      shown.push(chip);
    }
    const reAnchor = (id: string): string | null => {
      const g = memberOf.get(id);
      if (g && collapsed.has(g.id)) return `${g.id}::chip`;
      return id;
    };
    const outEdges = rfEdges.flatMap((e) => {
      const s = reAnchor(e.source);
      const t = reAnchor(e.target);
      if (!s || !t || s === t) return [];
      if (s === e.source && t === e.target) return [e];
      return [{ ...e, source: s, target: t }];
    });
    return { nodes: shown, edges: outEdges, chipIds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfNodes, rfEdges, collapsed, groups, sel]);

  const toggleGroup = useCallback((id?: string) => {
    const gid = id ?? groups.find((g) => g.id === sel || g.members.includes(sel ?? ""))?.id;
    if (!gid) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }, [groups, sel]);

  const select = useCallback((id: string | null) => {
    setInternalSel(id);
    onSelect?.(id);
  }, [onSelect]);

  /* Keyboard: one tabIndex surface on the wrapper (guidance-f1 risk 3). */
  const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const all = nodesRef.current;
    const byId = new Map(all.map((n) => [n.id, n]));
    const cur = sel ? byId.get(sel) : null;
    const mainEdges = edgesRef.current.filter((e) => (e.data as FlowEdge | undefined)?.main !== false);
    const go = (id: string | undefined) => {
      if (!id) return;
      select(id);
      const n = byId.get(id);
      if (n) {
        const s = nodeSize(n.data);
        rf.setCenter(n.position.x + s.w / 2, n.position.y + s.h / 2, { zoom: rf.getZoom(), duration: reduced.current ? 0 : 120 });
      }
      ev.preventDefault();
    };
    const key = ev.key;
    if (key === "ArrowRight" || key === "ArrowLeft" || key === "ArrowUp" || key === "ArrowDown") {
      if (!cur) { go(all.find((n) => !n.parentId)?.id); return; }
      if (key === "ArrowRight") {
        const outs = mainEdges.filter((e) => e.source === cur.id);
        const sub = outs.find((e) => (byId.get(e.target)?.data as FlowNode)?.sub);
        go((outs.sort((a, b) => (byId.get(b.target)?.position.x ?? 0) - (byId.get(a.target)?.position.x ?? 0))[0] ?? sub)?.target);
      } else if (key === "ArrowLeft") {
        const ins = mainEdges.filter((e) => e.target === cur.id);
        go(ins.sort((a, b) => (byId.get(b.source)?.position.x ?? 0) - (byId.get(a.source)?.position.x ?? 0))[0]?.source);
      } else if (key === "ArrowDown") {
        go(all.find((n) => n.parentId === cur.id && (n.data as FlowNode).sub)?.id);
      } else {
        go(cur.parentId ?? all.find((n) => n.id === cur.parentId)?.parentId);
      }
      return;
    }
    if (key === "Enter") {
      if (cur) { select(cur.id); onOpen?.(cur.id); ev.preventDefault(); }
      return;
    }
    if (key === "f" || key === "F") { rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 }); ev.preventDefault(); return; }
    if (key === "t" || key === "T") { tidy(); ev.preventDefault(); return; }
    if (key === "+" || key === "=") { rf.zoomIn({ duration: reduced.current ? 0 : 120 }); ev.preventDefault(); return; }
    if (key === "-" || key === "_") { rf.zoomOut({ duration: reduced.current ? 0 : 120 }); ev.preventDefault(); return; }
    if (key === "Escape") { select(null); ev.preventDefault(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, select, onOpen, rf]);

  const tidy = useCallback(() => {
    tidySeq.current += 1;
    clearPersisted(ns, layoutKey);
    didFit.current = false; // the layout effect re-runs and fits
    setRfNodes((prev) => prev.map((n) => ({ ...n }))); // nudge effect via key change below
    // Re-run layout directly for determinism:
    (async () => {
      const res = await layout(nodes, edges, groups, `${layoutKey}:tidy${tidySeq.current}`);
      setRfNodes(res.nodes.map((n) => toRf(n, null, collapsed, new Set())));
      setRfEdges(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "flow-edge", data: { ...e }, zIndex: e.main === false ? 0 : 1 })));
      rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 });
    })();
  }, [nodes, edges, groups, layoutKey, ns, rf, collapsed]);

  const resetLayout = useCallback(() => {
    clearPersisted(ns);
    tidySeq.current += 1;
    (async () => {
      const res = await layout(nodes, edges, groups, layoutKey);
      setRfNodes(res.nodes.map((n) => toRf(n, null, collapsed, new Set())));
      rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 });
    })();
  }, [nodes, edges, groups, layoutKey, ns, rf, collapsed]);

  // Live zoom readout (the store subscription keeps it current between zooms).
  const zoomPct = Math.round(useStore((s) => s.transform[2]) * 100);

  return (
    <FcCtx.Provider value={{ open: onOpen, toggleGroup, activeId: hovered ?? sel }}>
      <div className={`fc-wrap${sidebar ? " fc-with-side" : ""}`} data-testid={testId} data-fc-ready={rfNodes.length > 0 ? "1" : "0"} data-fc-hydrated={hydrated ? "1" : "0"}>
        <div className="fc-canvas" tabIndex={0} onKeyDown={onKeyDown} aria-label="Flow canvas">
          <ReactFlow
            nodes={view.nodes}
            edges={view.edges}
            onNodesChange={(changes: NodeChange[]) => setRfNodes((prev) => applyNodeChanges(changes, prev) as RfNode[])}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { if (n.id.endsWith("::chip")) { toggleGroup(n.id.replace(/::chip$/, "")); return; } select(n.id); }}
            onPaneClick={() => select(null)}
            onNodeDoubleClick={(_, n) => onOpen?.(n.id)}
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onSelectionChange={(objs) => {
              const first = objs.nodes[0];
              if (first && first.id !== sel) select(first.id);
              if (!objs.nodes.length && sel) select(null);
            }}
            onNodeDragStop={(_, n, nodes2) => {
              const rfNodesNow = rf.getNodes() as unknown as RfNode[];
              const allAbs = rfNodesNow.map((x) => ({ id: x.id, kind: (x.data as FlowNode).kind, title: "", parent: x.parentId, pos: { x: x.position.x, y: x.position.y } }) as FlowNode);
              const dragged = nodes2.map((x) => ({ id: x.id, kind: (x.data as FlowNode).kind, title: "", parent: x.parentId, pos: { x: snap(x.position.x), y: snap(x.position.y) } }) as FlowNode);
              if (dragged.length) persist(ns, layoutKey, dragged, allAbs);
            }}
            nodesDraggable={!locked}
            nodesFocusable={false} // keyboard lives on the wrapper; nodes are not tabbable controls
            edgesFocusable={false}
            snapToGrid
            snapGrid={[16, 16]}
            onlyRenderVisibleElements
            selectionOnDrag
            panOnDrag={[1, 2]}
            panActivationKeyCode="Space"
            multiSelectionKeyCode="Shift"
            minZoom={0.5}
            maxZoom={2}
            defaultEdgeOptions={{ type: "flow-edge" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={2} color="var(--line)" />
            {showMini && (
              <MiniMap pannable zoomable style={{ width: 192, height: 128 }} className="fc-minimap" maskColor="var(--bg-2)" nodeColor="var(--line-2)" nodeStrokeColor="var(--accent-soft)" />
            )}
            <Panel position="bottom-left" className="fc-controls">
              <button className="fc-ctl" data-testid="fc-zoom-in" onClick={() => rf.zoomIn({ duration: reduced.current ? 0 : 120 })} title="Zoom in (+)">+</button>
              <button className="fc-ctl" data-testid="fc-zoom-out" onClick={() => rf.zoomOut({ duration: reduced.current ? 0 : 120 })} title="Zoom out (−)">−</button>
              <button className="fc-ctl" data-testid="fc-fit" onClick={() => rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 })} title="Fit (F)">⤢</button>
              <button className="fc-ctl" data-testid="fc-tidy" onClick={tidy} title="Tidy (T)">⌗</button>
              <button className="fc-ctl" data-testid="fc-reset" onClick={resetLayout} title="Reset layout">⟲</button>
              <button className={`fc-ctl${locked ? " on" : ""}`} data-testid="fc-lock" onClick={() => setLocked((v) => !v)} title={locked ? "Unlock drag" : "Lock drag"} aria-pressed={locked}>⊘</button>
              <button className={`fc-ctl${showMini ? " on" : ""}`} data-testid="fc-minimap-toggle" onClick={() => setShowMini((v) => !v)} title="Minimap" aria-pressed={showMini}>▦</button>
              <span className="fc-zoom mono" data-testid="fc-zoom">{zoomPct}%</span>
            </Panel>
          </ReactFlow>
          {sidebar && (
            <button className="fc-side-toggle" data-testid="fc-side-toggle" onClick={() => setSideOpen((v) => !v)} aria-expanded={sideOpen} title="Details">◧</button>
          )}
        </div>
        {sidebar && (
          <aside className={`fc-side${sideOpen ? " fc-side-open" : ""}`} data-testid="fc-sidebar">{sidebar}</aside>
        )}
      </div>
    </FcCtx.Provider>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
