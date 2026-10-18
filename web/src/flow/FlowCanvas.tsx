// FlowCanvas – the one canvas. React Flow 12 under a kula skin: 16 px grid,
// dot background on --line, snap, marquee select, group collapse/expand,
// hover toolbar slot, keyboard layer, controls (zoom/fit/tidy/reset/lock),
// toggleable minimap, persisted drags, worker-offloaded dagre layout.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow, useStore, useUpdateNodeInternals, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FcCtx } from "./fcContext";
import { edgeTypes } from "./edges";
import { layout, layoutWorkerUsed } from "./layout";
import { applyPersisted, clearPersisted, persist } from "./positions";
import { CHIP, nodeSize, snap, type FlowEdge, type FlowGroup, type FlowNode } from "./types";
import { nodeTypes } from "./nodes";
import { Icon } from "../ui";

const EMPTY_GROUPS: FlowGroup[] = [];

export type FlowCanvasProps = {
  /** Lowest zoom; big preset maps pass less so fit can show everything. */
  minZoom?: number;
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
  /** Right-click on a node (id) or the pane (null): screen point and flow point. */
  onContextMenu?: (id: string | null, screen: { x: number; y: number }, flow: { x: number; y: number }) => void;
  /** A connection dragged from a connectable output onto an accepting input. */
  onConnect?: (source: string, target: string) => void;
  /** A connection dropped on empty canvas (n8n opens the node panel there). */
  onConnectToPane?: (source: string, flow: { x: number; y: number }) => void;
  /** The "+" stub on a node with no outgoing edge. */
  onStub?: (id: string) => void;
  /** Keys the canvas does not handle itself; return true when handled. */
  onKey?: (key: string, sel: string | null, ev: React.KeyboardEvent) => boolean;
  /** Pan to this node when it changes (n8n brings a new node into view). */
  reveal?: string | null;
  /** A node was dragged to a new position (flow coords). */
  onMoved?: (id: string, pos: { x: number; y: number }) => void;
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
    // Explicit dimensions: React Flow marks nodes without them
    // visibility:hidden until its ResizeObserver measures them, which never
    // fires for nodes mounted outside the viewport under
    // onlyRenderVisibleElements (the collapse chip was stuck invisible).
    width: s.w, height: s.h,
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
  const { nodes, edges, groups = EMPTY_GROUPS, selection, onSelect, layoutKey = "default", ns = "lab", sidebar, onOpen, testId = "flow-canvas", onContextMenu, onConnect, onConnectToPane, onStub, onKey, onMoved, reveal } = props;
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const rf = useReactFlow();
  const updateInternals = useUpdateNodeInternals();
  const [rfNodes, setRfNodes] = useState<RfNode[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Collapse-time viewport centre per group (flow coords) – the chip's anchor
  // when the frame origin is off the virtualized viewport.
  const [chipAnchor, setChipAnchor] = useState<Record<string, { x: number; y: number }>>({});
  const [locked, setLocked] = useState(false);
  const [showMini, setShowMini] = useState(false); // default off – rendering 2 600 mini-rects costs the first paint
  const [sideOpen, setSideOpen] = useState(false);
  const [internalSel, setInternalSel] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const sel = selection !== undefined ? selection : internalSel;
  // The selection rides through layout re-runs: a caller that rebuilds its
  // nodes array (a poll, an unrelated state tick) must not deselect the node
  // the user just picked – rebuilt nodes keep the current selection, and
  // React Flow never sees an empty echo to clear it.
  const selRef = useRef(sel);
  selRef.current = sel;
  const rfSelRef = useRef<string | null>(null);
  const didFit = useRef(false);
  const nodesRef = useRef<RfNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  nodesRef.current = rfNodes;
  edgesRef.current = rfEdges;
  const reduced = useRef(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const tidySeq = useRef(0);
  // The viewport is the user's: fit once per layout key, never on a data refresh.
  const fittedKey = useRef<string | null>(null);

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
      setRfNodes(sorted.slice(0, FIRST).map((n) => toRf(n, selRef.current, new Set(), new Set())));
      didFit.current = true;
      // Hydrate the rest in small chunks (no 600 ms long task), then fit.
      let done = FIRST;
      const CHUNK = 800;
      let edgesSet = false;
      const step = () => {
        if (!live) return;
        if (!edgesSet && done >= Math.min(FIRST + CHUNK, sorted.length)) {
          // Edges hydrate with the second chunk – the first paint renders nodes only.
          edgesSet = true;
          setRfEdges(edges.map((e) => ({
            id: e.id, source: e.source, target: e.target, type: "flow-edge",
            data: { ...e }, zIndex: e.main === false ? 0 : 1,
          })));
        }
        if (done >= sorted.length) {
          performance.mark("fc:hydrate");
          setHydrated(true);
          if (fittedKey.current !== layoutKey) {
            fittedKey.current = layoutKey;
            window.requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 }));
          }
          return;
        }
        setRfNodes((prev) => prev.concat(sorted.slice(done, done + CHUNK).map((n) => toRf(n, selRef.current, new Set(), new Set()))));
        done += CHUNK;
        window.setTimeout(step, 50);
      };
      window.setTimeout(step, 60);
    })();
    return () => { live = false; };
  }, [nodes, edges, groups, layoutKey, ns, rf]);

  // Reveal: once the node is laid out, pan it into view unless it already is.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    const n = rfNodes.find((x) => x.id === reveal);
    if (!n) return;
    revealed.current = reveal;
    const s2 = nodeSize(n.data);
    // Members of a frame carry positions relative to it – pan to the absolute one.
    const abs = rf.getInternalNode(reveal)?.internals.positionAbsolute ?? n.position;
    const cx = abs.x + s2.w / 2, cy = abs.y + s2.h / 2;
    const el = document.querySelector(`[data-testid="${testId}"] .react-flow`)?.getBoundingClientRect();
    const t = rf.getViewport();
    const sx = cx * t.zoom + t.x, sy = cy * t.zoom + t.y;
    if (el && sx > 40 && sy > 40 && sx < el.width - 40 && sy < el.height - 40) return;
    rf.setCenter(cx, cy, { zoom: Math.max(t.zoom, 0.6), duration: reduced.current ? 0 : 200 });
  }, [reveal, rfNodes, rf, testId]);

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
      // Anchor: the collapse-time viewport centre (flow coords) when the frame
      // origin itself is off the virtualized viewport (shelf-packed frames
      // start far left – a chip born there is visibility:hidden forever).
      const anchor = chipAnchor[g.id] ?? frame?.position ?? { x: 0, y: 0 };
      const chip: RfNode = {
        id: `${g.id}::chip`, type: "wide",
        position: { x: anchor.x, y: anchor.y },
        data: { id: `${g.id}::chip`, kind: "wide", title: g.label, subtitle: `${g.members.length} members`, size: CHIP, color: "var(--accent)" },
        width: CHIP.w, height: CHIP.h,
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
    const gid = id && id !== "*" ? id : groups.find((g) => g.id === sel || g.members.includes(sel ?? ""))?.id;
    if (!gid) return;
    const collapsing = !collapsed.has(gid);
    if (collapsing) {
      // The chip anchors at the current viewport centre (flow coords).
      const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setChipAnchor((prev) => ({ ...prev, [gid]: { x: snap(c.x - CHIP.w / 2), y: snap(c.y - CHIP.h / 2) } }));
    }
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
    // New/changed nodes (the chip among them) need a forced re-measure, or
    // React Flow's virtualization keeps them visibility:hidden. The hook in
    // 12.12.0 takes the ids to re-measure – pass them all.
    window.setTimeout(() => updateInternals(nodesRef.current.map((n) => n.id)), 50);
  }, [groups, sel, collapsed, rf, updateInternals]);

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
      // The visual selection follows keyboard moves here (synchronously –
      // keydown is not inside React Flow's store dispatch, so this cannot
      // re-enter it; the click path must not write flags for the same reason).
      setRfNodes((prev) => prev.map((n) => {
        const want = n.id === id;
        if (n.selected === want) return n;
        return { ...n, selected: want };
      }));
      const n = byId.get(id);
      if (n) {
        const s = nodeSize(n.data);
        rf.setCenter(n.position.x + s.w / 2, n.position.y + s.h / 2, { zoom: rf.getZoom(), duration: reduced.current ? 0 : 120 });
      }
      ev.preventDefault();
    };
    const key = ev.key;
    if (onKey?.(key, sel, ev)) { ev.preventDefault(); return; }
    // n8n's zoom keys: 1 fits the workflow, 0 resets the zoom.
    if (key === "1" && !ev.metaKey && !ev.ctrlKey) { rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 }); ev.preventDefault(); return; }
    if (key === "0" && !ev.metaKey && !ev.ctrlKey) { rf.zoomTo(1, { duration: reduced.current ? 0 : 120 }); ev.preventDefault(); return; }
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
    if (key === "Escape") {
      select(null);
      setRfNodes((prev) => prev.map((n) => (n.selected ? { ...n, selected: false } : n)));
      ev.preventDefault();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, select, onOpen, rf, onKey]);

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
    <FcCtx.Provider value={{ open: onOpen, toggleGroup, activeId: hovered ?? sel, hovered, onStub, hoverEdge, setHoverEdge }}>
      <div className={`fc-wrap${sidebar ? " fc-with-side" : ""}`} data-testid={testId} data-fc-ready={rfNodes.length > 0 ? "1" : "0"} data-fc-hydrated={hydrated ? "1" : "0"}>
        <div className="fc-canvas" tabIndex={0} onKeyDown={onKeyDown} aria-label="Flow canvas" data-fc-selection={sel ?? ""}>
          <ReactFlow
            nodes={view.nodes}
            edges={view.edges}
            onNodesChange={(changes: NodeChange[]) => setRfNodes((prev) => applyNodeChanges(changes, prev) as RfNode[])}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { if (n.id.endsWith("::chip")) { toggleGroup(n.id.replace(/::chip$/, "")); return; } select(n.id); }}
            onPaneClick={() => select(null)}
            onNodeDoubleClick={(_, n) => onOpen?.(n.id)}
            onNodeContextMenu={onContextMenu ? (e, n) => { e.preventDefault(); select(n.id); onContextMenu(n.id, { x: e.clientX, y: e.clientY }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); } : undefined}
            onPaneContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(null, { x: e.clientX, y: e.clientY }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); } : undefined}
            nodesConnectable={!!(onConnect || onConnectToPane)}
            onConnect={(c) => { if (c.source && c.target) onConnect?.(c.source, c.target); }}
            onConnectEnd={(e, st) => {
              if (st.isValid || !st.fromNode || !onConnectToPane) return;
              const p = "changedTouches" in e ? e.changedTouches[0] : (e as MouseEvent);
              onConnectToPane(st.fromNode.id, rf.screenToFlowPosition({ x: p.clientX, y: p.clientY }));
            }}
            connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2 }}
            onNodeMouseEnter={(_, n) => setHovered(n.id)}
            onNodeMouseLeave={() => setHovered(null)}
            onSelectionChange={(objs) => {
              // Only forward additions: React Flow fires an empty selection
              // echo while the controlled selection syncs (and when it clears
              // its internal set on a re-render). Forwarding that echo would
              // clear a selection the app just set programmatically; user
              // clearing is onPaneClick and the Escape handler, not here.
              // Forward only a change in React Flow's own selection, so a late
              // echo of a node Escape just cleared cannot re-select it.
              const id = objs.nodes[0]?.id ?? null;
              const prev = rfSelRef.current;
              rfSelRef.current = id;
              if (id && id !== prev && id !== sel) select(id);
            }}
            onNodeDragStop={(_, n, nodes2) => {
              const rfNodesNow = rf.getNodes() as unknown as RfNode[];
              const allAbs = rfNodesNow.map((x) => ({ id: x.id, kind: (x.data as FlowNode).kind, title: "", parent: x.parentId, pos: { x: x.position.x, y: x.position.y } }) as FlowNode);
              const dragged = nodes2.map((x) => ({ id: x.id, kind: (x.data as FlowNode).kind, title: "", parent: x.parentId, pos: { x: snap(x.position.x), y: snap(x.position.y) } }) as FlowNode);
              if (dragged.length) persist(ns, layoutKey, dragged, allAbs);
              if (onMoved) for (const d of dragged) onMoved(d.id, d.pos!);
              void n;
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
            minZoom={props.minZoom ?? 0.5}
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
              <button className={`fc-ctl${showMini ? " on" : ""}`} data-testid="fc-minimap-toggle" onClick={() => setShowMini((v) => !v)} title="Minimap" aria-pressed={showMini}><Icon.home /></button>
              <span className="fc-zoom mono" data-testid="fc-zoom">{zoomPct}%</span>
            </Panel>
          </ReactFlow>
          {sidebar && (
            <button className="fc-side-toggle" data-testid="fc-side-toggle" onClick={() => setSideOpen((v) => !v)} aria-expanded={sideOpen} title="Details"><Icon.sidebar /></button>
          )}
        </div>
        {sidebar && (
          <aside className={`fc-side fc-sidebar${sideOpen ? " fc-side-open" : ""}`} data-testid="fc-sidebar">{sidebar}</aside>
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
