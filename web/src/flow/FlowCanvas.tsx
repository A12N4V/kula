// FlowCanvas – the one canvas. React Flow 12 under a kula skin: 16 px grid,
// dot background on --line, snap, marquee select, group collapse/expand,
// hover toolbar slot, keyboard layer, controls (zoom/fit/tidy/reset/lock),
// toggleable minimap, persisted drags, worker-offloaded dagre layout.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow, useStore, useUpdateNodeInternals, type Edge, type Node, type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { FcCtx } from "./fcContext";
import { edgeTypes } from "./edges";
import { layout, layoutWorkerUsed } from "./layout";
import { applyPersisted, applySizes, clearPersisted, persist, persistSizes } from "./positions";
import { CHIP, nodeSize, snap, type FlowEdge, type FlowGroup, type FlowNode } from "./types";
import { routeEdges } from "./route";
import { nodeTypes } from "./nodes";
import { Icon } from "../ui";

const EMPTY_GROUPS: FlowGroup[] = [];

export type FlowCanvasProps = {
  /** Lowest zoom; big preset maps pass less so fit can show everything. */
  minZoom?: number;
  /** Route main wires orthogonally through the column gutters (flow/route.ts). */
  route?: boolean;
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
  /** U8 – like reveal, but always centres: the camera follows an opened
      square even when the frame is already on screen (a search reveal must
      not yank the viewport, an open should keep the square under the
      pointer). */
  anchor?: string | null;
  /** A node was dragged to a new position (flow coords). */
  onMoved?: (id: string, pos: { x: number; y: number }) => void;
  /** Readable by default (R0): land centred on this node at `initialZoom`
      instead of a fit-everything view. */
  initialFocus?: string | null;
  initialZoom?: number;
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
    zIndex: n.z,
    // Per-node `draggable: true` would override the global nodesDraggable,
    // so chips set false and everything else stays undefined (global wins,
    // which is what the lock control flips).
    draggable: isChip ? false : undefined,
  } as RfNode;
};

function FlowCanvasInner(props: FlowCanvasProps) {
  const { nodes, edges, groups = EMPTY_GROUPS, selection, onSelect, layoutKey = "default", ns = "lab", sidebar, onOpen, testId = "flow-canvas", onContextMenu, onConnect, onConnectToPane, onStub, onKey, onMoved, reveal, anchor } = props;
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
  // Node ids the user has already seen a viewport of – fresh arrivals (a late
  // lane load) expand the view; refreshes of known ids never move the camera.
  const shownRef = useRef<Set<string>>(new Set());

  // Layout (cached, worker-offloaded) whenever the data or layoutKey changes.
  useEffect(() => {
    let live = true;
    performance.mark("fc:effect");
    (async () => {
      const effectiveKey = tidySeq.current ? `${layoutKey}:tidy${tidySeq.current}` : layoutKey;
      const withSizes = applySizes(ns, layoutKey, nodes);
      const res = await layout(withSizes, edges, groups, effectiveKey);
      performance.mark("fc:layout-done");
      (window as unknown as { __fcLayout?: { ms: number; nodes: number; worker: boolean; mainEdges: [string, string][] } }).__fcLayout = { ms: res.ms, nodes: res.nodes.filter((n) => n.kind !== "group").length, worker: !!layoutWorkerUsed(), mainEdges: edges.filter((e) => e.main !== false).map((e) => [e.source, e.target]) };
      if (!live) return;
      const withDrags = applyPersisted(ns, layoutKey, res.nodes);
      // Gutter routing (flow/route.ts) on the final positions – after layout,
      // stored sizes and persisted drags – in absolute canvas coordinates.
      let wires = edges;
      if (props.route) {
        const byId = new Map(withDrags.map((n) => [n.id, n]));
        const absOf = (n: FlowNode): { x: number; y: number } => {
          const p = n.parent ? byId.get(n.parent) : undefined;
          const o = p ? absOf(p) : { x: 0, y: 0 };
          return { x: o.x + (n.pos?.x ?? 0), y: o.y + (n.pos?.y ?? 0) };
        };
        wires = routeEdges(withDrags.map((n) => ({ ...n, pos: absOf(n) })), edges.filter((e) => !e.source.startsWith("step:")));
        const lane = edges.filter((e) => e.source.startsWith("step:"));
        wires = wires.concat(lane);
      }
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
      // Fresh arrivals (a late lane load, an undo bring-back) may land outside
      // the current viewport; a poll refresh of known ids never moves the
      // camera – it would snap the user's zoom back to the fit every second.
      const freshArrivals = shownRef.current.size > 0 && sorted.some((n) => !shownRef.current.has(n.id));
      shownRef.current = new Set(sorted.map((n) => n.id));
      setRfNodes(sorted.slice(0, FIRST).map(sized));
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
          setRfEdges(wires.map((e) => ({
            id: e.id, source: e.source, target: e.target, type: "flow-edge",
            data: { ...e }, zIndex: 0, // edges under nodes (n8n §5): the 40 px hit path must never eat a card's hover or drag
          })));
        }
        if (done >= sorted.length) {
          performance.mark("fc:hydrate");
          setHydrated(true);
          // Readable by default (R0): when the caller names an initialFocus,
          // land centred on it at a readable zoom instead of fitting every
          // node into 12 %. The focus node must be in the laid-out set.
          if (fittedKey.current !== layoutKey) {
            fittedKey.current = layoutKey;
            const focusId = props.initialFocus;
            window.requestAnimationFrame(() => {
              const n = focusId ? rf.getNode(focusId) : null;
              if (n) {
                const d = n.data as FlowNode;
                const z = props.initialZoom ?? 0.85;
                // Section members are positioned relative to their frame:
                // walk the parent chain for the canvas position.
                const abs = { ...n.position };
                for (let p = n.parentId ? rf.getNode(n.parentId) : undefined; p; p = p.parentId ? rf.getNode(p.parentId) : undefined) { abs.x += p.position.x; abs.y += p.position.y; }
                let cx = abs.x + ((d.size?.w ?? 200) / 2), cy = abs.y + ((d.size?.h ?? 120) / 2);
                // Never land with empty canvas above or left of the map: when
                // the focus sits near the map's top-left, clamp the camera so
                // the view starts at the map's edge (U5 – the landing showed
                // ~300px of nothing over the first row).
                const box = document.querySelector(`[data-testid="${testId}"] .react-flow`)?.getBoundingClientRect();
                const tops = rf.getNodes().filter((m) => !m.parentId);
                if (box && tops.length) {
                  const minX = Math.min(...tops.map((m) => m.position.x)), minY = Math.min(...tops.map((m) => m.position.y));
                  cx = Math.max(cx, minX - 40 + box.width / (2 * z));
                  // Clear whatever chrome floats over the canvas top (the map HUD row
                  // drops onto the canvas on phone).
                  const hudBottom = Math.max(box.top, ...[...document.querySelectorAll(".map-hud")].map((h) => h.getBoundingClientRect().bottom));
                  const pad = Math.max(34, hudBottom - box.top + 16) / z;
                  cy = Math.max(cy, minY - pad + box.height / (2 * z));
                }
                rf.setCenter(cx, cy, { zoom: z, duration: reduced.current ? 0 : 200 });
              } else {
                rf.fitView({ padding: 0.12, duration: reduced.current ? 0 : 120 });
              }
            });
          }
          {
            // Nodes outside the current viewport (the late pipeline lane, an
            // undo/redo bring-back) can never be seen or mounted under
            // onlyRenderVisibleElements – the fit above only saw mounted
            // nodes. Only a run that brings fresh ids expands the viewport:
            // the first landing stays at the readable zoom (R0), and a poll
            // refresh of known ids must never move the camera.
            window.requestAnimationFrame(() => {
              // An anchor (U8) owns the camera for this layout: opening a
              // square is a fresh-arrival run, but the camera must follow the
              // opened square, not re-fit the whole map over it.
              if (!live || !freshArrivals || anchor) return;
              const el = document.querySelector(`[data-testid="${testId}"] .react-flow`)?.getBoundingClientRect();
              if (!el) return;
              const t = rf.getViewport();
              // The app topbar is a grid row above the canvas, but a node
              // sitting above the canvas top still centres its click point
              // over the topbar – treat everything above the topbar's bottom
              // edge as off-canvas.
              const topbarBottom = document.querySelector("header.topbar")?.getBoundingClientRect().bottom ?? el.top;
              const top = Math.max(el.top, topbarBottom);
              const clipped = sorted.some((n) => {
                const s = nodeSize(n);
                const sx = el.left + t.x + n.pos!.x * t.zoom, sy = el.top + t.y + n.pos!.y * t.zoom;
                return sx < el.left - 2 || sy < top - 2 || sx + s.w * t.zoom > el.right + 2 || sy + s.h * t.zoom > el.bottom + 2;
              });
              if (!clipped) return;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const n of sorted) {
                const s = nodeSize(n);
                minX = Math.min(minX, n.pos!.x); minY = Math.min(minY, n.pos!.y);
                maxX = Math.max(maxX, n.pos!.x + s.w); maxY = Math.max(maxY, n.pos!.y + s.h);
              }
              if (maxX <= minX) return;
              const availH = el.bottom - top;
              const z = Math.max(0.1, Math.min(t.zoom, el.width / (maxX - minX + 160), availH / (maxY - minY + 160)));
              // Content taller than the viewport at the floor zoom would
              // centre with a negative offset – the top rows (the pipeline
              // lane) would land above the canvas, under the topbar. Align
              // the union top instead of centring when it overflows.
              const offY = Math.max(0, (availH - (maxY - minY) * z) / 2);
              rf.setViewport({ x: (el.width - (maxX - minX) * z) / 2 - minX * z, y: (top - el.top) + offY - minY * z, zoom: z });
            });
          }
          return;
        }
        setRfNodes((prev) => prev.concat(sorted.slice(done, done + CHUNK).map(sized)));
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
    const id = anchor ?? reveal;
    if (!id || revealed.current === id) return;
    const n = rfNodes.find((x) => x.id === id);
    if (!n) return;
    revealed.current = id;
    const s2 = nodeSize(n.data);
    // Members of a frame carry positions relative to it – pan to the absolute one.
    const abs = rf.getInternalNode(id)?.internals.positionAbsolute ?? n.position;
    const cx = abs.x + s2.w / 2, cy = abs.y + s2.h / 2;
    const el = document.querySelector(`[data-testid="${testId}"] .react-flow`)?.getBoundingClientRect();
    const t = rf.getViewport();
    const sx = cx * t.zoom + t.x, sy = cy * t.zoom + t.y;
    // An anchor (U8 open/fold) always centres; a plain reveal (search) only
    // pans when the node is off screen – a visible hit must not be yanked.
    if (!anchor && el && sx > 40 && sy > 40 && sx < el.width - 40 && sy < el.height - 40) return;
    rf.setCenter(cx, cy, { zoom: Math.max(t.zoom, 0.6), duration: reduced.current ? 0 : 200 });
  }, [anchor, reveal, rfNodes, rf, testId]);

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

  // Corner resize (R0): live size updates the node; release persists once and
  // re-measures internals so the virtualizer never hides the grown node.
  // Sizes the user set by dragging a handle. A poll refresh rebuilds rfNodes
  // from props – persisted sizes only rejoin on the next layout rebuild –
  // so the overrides are re-applied on every rebuild or a resize snaps back.
  const sizeOverrides = useRef(new Map<string, { w: number; h: number }>());
  const sized = useCallback((n: FlowNode) => {
    const rf = toRf(n, selRef.current, new Set(), new Set());
    const o = sizeOverrides.current.get(n.id);
    if (!o) return rf;
    return { ...rf, width: o.w, height: o.h, style: { ...rf.style, width: o.w, height: o.h }, data: { ...(rf.data as object), size: o } } as typeof rf;
  }, []);
  const onNodeResize = useCallback((id: string, size: { w: number; h: number }, commit: boolean) => {
    setRfNodes((prev) => prev.map((n) => {
      if (n.id !== id) return n;
      const d = n.data as FlowNode;
      return { ...n, width: size.w, height: size.h, style: { ...n.style, width: size.w, height: size.h }, data: { ...d, size } };
    }));
    if (commit) {
      sizeOverrides.current.set(id, size);
      persistSizes(ns, layoutKey, [{ id, size }]);
      window.setTimeout(() => updateInternals([id]), 50);
    }
  }, [ns, layoutKey, updateInternals]);

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
      const res = await layout(applySizes(ns, layoutKey, nodes), edges, groups, `${layoutKey}:tidy${tidySeq.current}`);
      setRfNodes(res.nodes.map((n) => toRf(n, null, collapsed, new Set())));
      setRfEdges(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "flow-edge", data: { ...e }, zIndex: 0 })));
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
  const zoom = useStore((s) => s.transform[2]);
  // Semantic zoom thresholds – contract §6 (X1 hand-off): far < 0.55 (the
  // caption under the tile), mid to 1.0 (facts), near above (the function
  // list). A resize forces a level regardless of scale.
  const zoomLevel: "far" | "mid" | "near" = zoom < 0.55 ? "far" : zoom < 1 ? "mid" : "near";

  return (
    <FcCtx.Provider value={{ open: onOpen, toggleGroup, activeId: hovered ?? sel, hovered, onStub, hoverEdge, setHoverEdge, onResize: onNodeResize, zoom, zoomLevel }}>
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
            // Virtualization (the 2 600-node FlowLab canvas needs it) races
            // the late pipeline lane under the map's ~100 nodes: the lane
            // mounts only inside the viewport, and the viewport repair runs
            // a frame later than React Flow's own unmount. Small canvases
            // skip the dance entirely – chunked hydration already bounds
            // their first paint.
            onlyRenderVisibleElements={rfNodes.length > 400}
            // Drag pans (n8n, Figma); Shift-drag draws a marquee; Shift-click adds.
            panOnDrag
            selectionKeyCode="Shift"
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
