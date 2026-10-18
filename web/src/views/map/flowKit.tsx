// map flow on the kit – MapData mapped onto F1's flow canvas (web/src/flow).
// The old hand-drawn SVG flow (flow.tsx) is gone: sections are kit group
// frames (or single wide nodes at depth 1), blocks are tile nodes, an
// expanded block hangs its functions below as circle sub-nodes (capped at
// 40 – the map has ~4 100 leaves and never mounts them all), and section
// flows become chain-weight edges. A focused chain dims everything it does
// not cross through the kit's `dim` flag. The capabilities lens renders one
// swimlane group per entry family from the same pure lens as before.

import { useMemo, useState } from "react";
import { FlowCanvas, type FlowEdge, type FlowGroup, type FlowNode } from "../../flow";
import { KindIcon, RoleMark, ROLE_COLOR } from "./icons";
import type { Block, MapData, Role } from "./types";
import { capabilities } from "./lenses";
import type { Focus } from "./chainFocus";
import { Icon } from "../../ui";
import type { Marks } from "./workspace";
import { KIND_COLOR, KindIco, type Step } from "./pipeline";

export type Scheme = "role" | "section" | "heat" | "mono";
export const SCHEMES: { id: Scheme; label: string; hint: string }[] = [
  { id: "role", label: "Role", hint: "entry, step, terminal, shared" },
  { id: "section", label: "Section", hint: "one hue per section" },
  { id: "heat", label: "Changes", hint: "hot where files changed" },
  { id: "mono", label: "Quiet", hint: "monochrome, agents stand out" },
];
const hue = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };

/** No block ever mounts all its functions: this frame caps the expansion. */
export const FN_CAP = 40;

type Flow = { from: string; to: string; weight: number };
type Props = {
  data: MapData & { flows?: Flow[] };
  roles: Set<Role>;
  focus?: Focus | null;
  selection?: string | null;
  onSelect?: (id: string | null) => void;
  onDrill: (id: string) => void;
  onLeaf: (id: number) => void;
  onClearFocus?: () => void;
  /** Grouping depth: 1 = one wide node per section, 2 = child blocks inside each frame. */
  depth?: number;
  layoutKey?: number;
  /** Expanded blocks (their functions hang below as circle sub-nodes). */
  expanded?: Set<string>;
  onToggleExpand?: (id: string) => void;
  /** Clear every expansion (the collapse tinker). */
  onClearExpand?: () => void;
  /** Workspace overlays per section: agent fence, changes, drop target. */
  marks?: Marks;
  /** Pipeline blocks drawn as a lane above the sections they act on. */
  steps?: Step[];
  onStepTool?: (id: string, action: "done" | "remove") => void;
  scheme?: Scheme;
};

const title = (b: Block) => b.theme || b.name;
const secId = (b: Block) => `sec:${b.id}`;
const fnId = (n: number) => `fn:${n}`;
const moreId = (b: Block) => `more:${b.id}`;

/** Every symbol under a block, depth-first. */
function symbolsUnder(blocks: Record<string, Block>, id: string, out: number[] = []): number[] {
  const b = blocks[id];
  if (!b) return out;
  out.push(...b.symbols);
  for (const c of b.children) symbolsUnder(blocks, c, out);
  return out;
}

/* Section-to-section flow + layers + headline. Pure, carried over from the
   retired flow.tsx layout: section flows are M1's block flows folded up to
   their section, else each chain family's crossed blocks weighted by its
   chain count; layers are the BFS distance from the entry sections. */
export function mapFlowLayout(data: MapData & { flows?: Flow[] }) {
  const sections: Record<string, Block> = {};
  for (const b of Object.values(data.blocks)) if (b.depth === 0 && b.parent !== null) sections[b.id] = b;
  const secOf = new Map<string, string>();
  const up = (id: string): string | undefined => {
    if (secOf.has(id)) return secOf.get(id);
    const b = data.blocks[id];
    if (!b) return undefined;
    const s = sections[id] ? id : b.parent ? up(b.parent) : undefined;
    if (s) secOf.set(id, s);
    return s;
  };
  const w = new Map<string, number>();
  const add = (a?: string, b?: string, v = 1) => {
    if (!a || !b || a === b) return;
    const k = `${a}\u0000${b}`;
    w.set(k, (w.get(k) ?? 0) + v);
  };
  if (data.flows?.length) for (const f of data.flows) add(up(f.from), up(f.to), f.weight);
  else for (const fam of data.families) {
    const secs = fam.blocks.map(up).filter((s, i, a) => s && a[i - 1] !== s) as string[];
    const v = Math.log1p(fam.count);
    for (let i = 1; i < secs.length; i++) add(secs[i - 1], secs[i], v);
  }
  const flows = [...w.entries()].map(([k, weight]) => { const [from, to] = k.split("\u0000"); return { from, to, weight }; })
    .sort((a, b) => b.weight - a.weight);
  const title = (b: Block) => b.theme || b.name;

  // Layers: the function sections, by distance from the entry sections along
  // the flow; anything the flow never reaches falls back to its role's column.
  const BAND_ROLES: Role[] = ["utility", "model", "config"];
  const ROLE_LAYER: Partial<Record<Role, number>> = { entry: 0, orchestrator: 1, core: 2, adapter: 3 };
  const fnIds = Object.values(sections).filter((b) => !BAND_ROLES.includes(b.role) && b.role !== "test" && b.role !== "glue").map((b) => b.id);
  const isFn = new Set(fnIds);
  const out = new Map<string, string[]>();
  for (const f of flows) if (isFn.has(f.from) && isFn.has(f.to)) (out.get(f.from) ?? out.set(f.from, []).get(f.from)!).push(f.to);
  const depth = new Map<string, number>();
  const queue = fnIds.filter((id) => sections[id].role === "entry");
  if (!queue.length) {
    const into = new Set(flows.map((f) => f.to));
    queue.push(...fnIds.filter((id) => !into.has(id)));
  }
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const d = depth.get(queue[i])!;
    for (const n of out.get(queue[i]) ?? []) if (!depth.has(n)) { depth.set(n, d + 1); queue.push(n); }
  }
  const reached = depth.size ? Math.max(...depth.values()) + 1 : 0;
  for (const id of fnIds) if (!depth.has(id)) depth.set(id, (depth.size && reached ? reached : 0) + (ROLE_LAYER[sections[id].role] ?? 2));
  const nLayers = Math.max(...depth.values(), 0) + 1;
  const layers: string[][] = Array.from({ length: nLayers }, () => []);
  const through = (id: string) => flows.reduce((s, f) => s + (f.from === id || f.to === id ? f.weight : 0), 0);
  for (const id of fnIds) layers[depth.get(id)!].push(id);
  for (const l of layers) l.sort((a, b) => through(b) - through(a));
  const band = Object.values(sections).filter((b) => BAND_ROLES.includes(b.role)).map((b) => b.id).sort((a, b) => through(b) - through(a));

  // Headline: the heaviest section of each layer, left to right.
  const headline = layers.filter((l) => l.length).map((l) => title(sections[l[0]])).join(" → ");
  const kept = layers.filter((l) => l.length);
  const labels = kept.map((l, i) =>
    l.some((id) => sections[id].role === "entry") ? "entry"
      : i === kept.length - 1 && kept.length > 1 ? "terminal"
      : l.every((id) => sections[id].role === "adapter") ? "outside world"
      : `step ${i}`);
  return { sections, layers: kept, labels, band, flows, headline, secOf: Object.fromEntries(secOf) as Record<string, string> };
}

/** Chain/flow weight quantised to the kit's 1–4 edge stroke. */
function edgeWeight(weight: number, max: number): number {
  const m = max || 1;
  return Math.min(4, Math.max(1, Math.round(1 + 3 * Math.sqrt(weight / m))));
}

/** Sub-node icons keep the graph's kind glyphs; tiles carry the role mark. */
function fnIcon(kind: string) {
  return <KindIcon kind={kind} />;
}

/** The flow lens on the kit canvas. Selection is single-writer (the kit):
    function circles and "+ more" chips are intercepted here and never
    become the block selection; everything else maps to the block id. */
export function FlowKitView({ data, roles, focus, selection, onSelect, onDrill, onLeaf, onClearFocus, depth = 2, layoutKey = 0, expanded: expandedProp, onToggleExpand, onClearExpand, marks, steps = [], onStepTool, scheme = "role" }: Props) {
  const { sections, layers, band, flows, headline, secOf } = useMemo(() => mapFlowLayout(data), [data]);
  const [expandedState, setExpanded] = useState<Set<string>>(() => new Set());
  const expanded = expandedProp ?? expandedState;
  const toggleExpand = onToggleExpand ?? ((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  });
  const [openSecs, setOpenSecs] = useState<Set<string>>(() => new Set());
  const toggleSec = (id: string) => setOpenSecs((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const secTool = (id: string, open: boolean) => (
    <button className="fc-tool" data-testid="map-open-section" onClick={(e) => { e.stopPropagation(); toggleSec(id); }}
      title={open ? "Close section" : "Open section – show its blocks"}>
      {open ? "−" : "+"}
    </button>
  );
  const lit = (id: string) => !focus?.chain || focus.on.has(id);
  const shown = (b: Block) => roles.has(b.role);
  // Expansion lives in the node's hover/selection toolbar slot: the only
  // affordance the kit gives a tile without faking DOM into it.
  const expandTool = (b: Block, open: boolean) => (
    <button className="fc-tool" data-testid="map-expand-node" onClick={(e) => { e.stopPropagation(); toggleExpand(b.id); }}
      title={open ? "Collapse functions" : "Expand functions"}>
      {open ? "−" : "+"}
    </button>
  );

  // The built graph is memoised: new array identities would re-run the kit's
  // layout effect on every parent re-render (a selection change included),
  // which wipes the kit's selection flags and re-fits the viewport.
  const { nodes, edges, groups } = useMemo((): { nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[] } => {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const groups: FlowGroup[] = [];
    const fnNodes: FlowNode[] = [];
    const secShown: string[] = [];


  const colorOf = (b: Block, sec: string) =>
    scheme === "section" ? `hsl(${hue(sec)} 60% 58%)`
    : scheme === "mono" ? "var(--text-3)"
    : scheme === "heat" ? (marks?.[sec]?.changed ? "var(--red)" : marks?.[sec]?.fence ? "var(--accent)" : "var(--line-2)")
    : ROLE_COLOR[b.role];
  const blockNode = (b: Block, sec = b.id): FlowNode => {
    return {
      id: b.id, kind: "tile", title: title(b), subtitle: b.theme ? b.name : undefined,
      icon: <RoleMark role={b.role} />, color: colorOf(b, sec),
      entry: b.role === "entry", dim: !lit(b.id), hasSub: expanded.has(b.id),
      toolbar: expandTool(b, expanded.has(b.id)),
    };
  };

  // A block's functions: shown when the block is expanded (cap 40).
  const fnSubs = (b: Block) => {
    if (!expanded.has(b.id)) return [];
    const syms = symbolsUnder(data.blocks, b.id).filter((id) => data.leaves[id]);
    const cap = Math.min(syms.length, FN_CAP);
    const subs: FlowNode[] = syms.slice(0, cap).map((id) => {
      const l = data.leaves[id];
      return {
        id: fnId(id), kind: "circle", sub: true, parent: b.id,
        title: l.name, subtitle: `${l.path}:${l.line}`, icon: fnIcon(l.kind),
        color: ROLE_COLOR[l.role] ?? undefined, dim: !lit(b.id),
      };
    });
    if (syms.length > cap) subs.push({
      id: moreId(b), kind: "wide", sub: true, parent: b.id,
      title: `+ ${syms.length - FN_CAP} more`, color: "var(--text-3)", dim: !lit(b.id),
    });
    return subs;
  };

  // Overlay marks → ring and badge (a section's mark also rings its blocks).
  const markOf = (secId: string, first: boolean): Partial<FlowNode> => {
    const mk = marks?.[secId];
    if (!mk) return {};
    const ring = mk.drop ? "drop" : mk.fence ? "fence" : mk.changed ? "hot" : undefined;
    const badge = first && (mk.agent || mk.changed)
      ? <span className={`fc-badge-in${mk.agent ? " agent" : ""}`} data-testid={`ws-badge-${secId}`}>{mk.agent ?? ""}{mk.changed ? <span className="fc-badge-n">{mk.changed}</span> : null}</span>
      : undefined;
    return { ring, badge };
  };
  // The view owns the layout (the kit's preset mode): one column per
  // pipeline layer, left to right, shared utilities last. A closed section
  // is one coloured wide node; an open one is a frame with its blocks in a
  // small grid. Complexity stays behind a click – nothing opens by default.
  const CELL_W = 176, CELL_H = 192, GAP_Y = 48, GAP_X = 160, HEAD = 48;
  const columns: string[][] = [...layers.map((l) => l.filter((id) => sections[id] && shown(sections[id])))];
  const bandShown = band.filter((id) => sections[id] && shown(sections[id]));
  if (bandShown.length) columns.push(bandShown);
  const colOf = new Map<string, number>();
  const repOf = new Map<string, string>();
  let x = 0;
  columns.forEach((col, ci) => {
    if (!col.length) return;
    let y = 0, colW = 256;
    for (const id of col) {
      const s = sections[id];
      colOf.set(id, ci);
      secShown.push(id);
      const kids = s.children.map((c) => data.blocks[c]).filter((k): k is Block => !!k && shown(k));
      const open = depth >= 2 || openSecs.has(id);
      if (!open || !kids.length) {
        nodes.push({
          ...blockNode(s), kind: "wide", title: title(s),
          subtitle: kids.length ? `${kids.length} blocks · ${s.summary || s.name}` : (s.summary || undefined),
          toolbar: kids.length ? secTool(id, false) : expandTool(s, expanded.has(s.id)),
          pos: { x, y },
          ...markOf(id, true),
        });
        fnNodes.push(...fnSubs(s));
        repOf.set(id, s.id);
        y += 96 + GAP_Y;
        continue;
      }
      const cols = Math.min(3, Math.ceil(Math.sqrt(kids.length)));
      kids.forEach((k, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        nodes.push({ ...blockNode(k, id), pos: { x: x + c * CELL_W, y: y + HEAD + r * CELL_H }, ...markOf(id, i === 0) });
        fnNodes.push(...fnSubs(k));
      });
      groups.push({ id: secId(s), label: title(s), members: kids.map((k) => k.id) });
      repOf.set(id, kids[0].id);
      const rows = Math.ceil(kids.length / cols);
      y += HEAD + rows * CELL_H + GAP_Y;
      colW = Math.max(colW, cols * CELL_W);
    }
    x += colW + GAP_X;
  });
  nodes.push(...fnNodes);

  // The pipeline lane: blocks left to right above the map, wired in order,
  // each with a dashed wire down to the section it acts on (n8n's main flow
  // over the data it touches). A retry loops back to the last agent.
  const LANE_Y = -256, STEP_W = 288;
  const repOfSec = (sid: string) => { const r = repOf.get(sid); return r && nodeIdsSoFar.has(r) ? r : null; };
  const nodeIdsSoFar = new Set(nodes.map((n) => n.id));
  const name = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : null);
  let prevStep: string | null = null, lastAgent: string | null = null;
  steps.forEach((st, i) => {
    const id = `step:${st.id}`;
    const status = st.status === "waiting" || st.status === "running" ? "running" : st.status === "success" ? "success" : st.status === "error" ? "error" : undefined;
    const tools = (
      <>
        {st.status === "waiting" && <button className="fc-tool" data-testid="step-done" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "done"); }} title="Mark this agent's task done">done</button>}
        <button className="fc-tool" data-testid="step-remove" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "remove"); }} title="Remove block"><Icon.close /></button>
      </>
    );
    nodes.push({
      id, kind: "wide", title: st.name,
      subtitle: st.note ?? (st.status === "waiting" ? "waiting for an agent" : st.kind === "note" ? (st.task || "note") : name(st.section) ? `on ${name(st.section)}` : st.kind),
      icon: <span className="fc-step-ico" style={{ color: KIND_COLOR[st.kind] }}><KindIco kind={st.kind} /></span>,
      color: KIND_COLOR[st.kind], status, entry: st.kind === "trigger", noOut: i === steps.length - 1 && st.kind !== "note",
      toolbar: tools, pos: { x: i * STEP_W, y: LANE_Y },
    });
    if (st.kind === "note") return;
    if (prevStep) edges.push({ id: `${prevStep}>${id}`, source: prevStep, target: id, weight: 3, main: true });
    if (st.kind === "retry" && lastAgent) edges.push({ id: `${id}>loop`, source: id, target: lastAgent, weight: 2, main: true, backward: true, label: `x${st.max ?? 3}` });
    const target = st.section ? repOfSec(st.section) : null;
    if (target) edges.push({ id: `${id}~${target}`, source: id, target, main: false });
    prevStep = id;
    if (st.kind === "agent" || st.kind === "crew") lastAgent = id;
  });
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Edges: each section keeps its two heaviest outgoing flows (every flow as
  // an edge is spaghetti; the sidebar lists the rest). A flow into an
  // earlier column routes below, as n8n draws loops.
  const seenEdge = new Set<string>();
  const maxW = flows.reduce((m, f) => Math.max(m, f.weight), 0) || 1;
  const outCount = new Map<string, number>();
  for (const f of flows) {
    if (!colOf.has(f.from) || !colOf.has(f.to)) continue;
    if ((outCount.get(f.from) ?? 0) >= 2) continue;
    const a = repOf.get(f.from)!, b = repOf.get(f.to)!;
    if (a === b || !nodeIds.has(a) || !nodeIds.has(b)) continue;
    // Flows back into an earlier column (or within one) would wrap the whole
    // canvas; the default view reads left to right, the sidebar lists them.
    if (colOf.get(f.to)! <= colOf.get(f.from)!) continue;
    const key = `${a}>${b}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    outCount.set(f.from, (outCount.get(f.from) ?? 0) + 1);
    edges.push({ id: key, source: a, target: b, weight: edgeWeight(f.weight, maxW) });
  }
    return { nodes, edges, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, roles, focus, depth, expanded, openSecs, marks, steps, scheme]);

  // Intercepted selections: function circles open the code panel, "+ more"
  // chips toggle the expansion – neither becomes the block selection.
  // Selections that open panels or mutate the graph must not run inside
  // React Flow's click dispatch – a synchronous parent update there
  // re-enters the store (React error 185). Defer them a tick.
  const select = (id: string | null) => {
    if (!id) { onSelect?.(null); return; }
    if (id.startsWith("fn:")) { const n = Number(id.slice(3)); setTimeout(() => onLeaf(n), 0); return; }
    if (id.startsWith("more:")) { const bid = id.slice(5); setTimeout(() => toggleExpand(bid), 0); return; }
    // a group frame selects its section block – the sidebar reads blocks
    onSelect?.(id.startsWith("sec:") ? id.slice(4) : id);
  };
  const open = (id: string) => {
    if (id.startsWith("step:")) return;
    if (id.startsWith("fn:")) { const n = Number(id.slice(3)); setTimeout(() => onLeaf(n), 0); return; }
    if (id.startsWith("more:")) { const bid = id.slice(5); setTimeout(() => onDrill(bid), 0); return; }
    if (id.startsWith("sec:")) { const sid = id.slice(4); setTimeout(() => toggleSec(sid), 0); return; }
    if (sections[id] && data.blocks[id]?.children.length && depth < 2) { setTimeout(() => toggleSec(id), 0); return; }
    onDrill(id);
  };

  const anyExpanded = expanded.size > 0;
  return (
    <div className="sy-canvas fm-flow" data-testid="map-flow">
      <div className="fm-headline" data-testid="map-headline">
        <span className="fm-headline-k">executes</span>
        <span className="fm-headline-v">{headline || "–"}</span>
        <span className="fm-headline-tools">
          <button className="tab-btn sy-lens-btn" data-testid="map-collapse-all" title="collapse every expanded block" aria-pressed={anyExpanded}
            onClick={() => onClearExpand?.()}>collapse</button>
        </span>
      </div>
      <FlowCanvas
        minZoom={0.1}
        nodes={nodes} edges={edges} groups={groups}
        selection={selection ?? null} onSelect={select} onOpen={open}
        // the focus state rides the layout key: the kit's layout cache keys on
        // node ids/edges only, so a dim change would otherwise never repaint
        layoutKey={`map-${depth}-${layoutKey}-${focus?.chain ? `f${focus.chain.id}` : "n"}`} ns="map" testId="map-flow-canvas"
      />
      {focus?.chain && <FocusBadge n={focus.on.size} onClear={() => onClearFocus?.()} still={focus.still} />}
    </div>
  );
}

function FocusBadge({ n, onClear, still }: { n: number; onClear: () => void; still: boolean }) {
  return (
    <div className="fm-focus-badge" data-testid="map-focus-badge">
      <Icon.target />
      <span className="mono">focused chain · {n} blocks{still ? " · still" : " · animated"}</span>
      <button className="tab-btn sy-lens-btn" onClick={onClear} data-testid="map-focus-clear">clear</button>
    </div>
  );
}

/* ---- Capabilities lens on the kit ------------------------------------ */

type CapsProps = {
  data: MapData;
  roles: Set<Role>;
  selection: string | null;
  onSelect: (id: string | null) => void;
  /** A lane's files open the (editable) code panel, as the old lane rows did. */
  onFile?: (path: string) => void;
};

/** One swimlane group per entry family (heaviest first), the lane's blocks
    as tile nodes chained left to right. Node ids are lane-scoped – a block
    can appear in several lanes – and selections map back to the block.
    The graph is memoised on the lanes only and the layout key stays stable:
    selection must NOT ride either, or the kit's re-layout would replace the
    nodes, React Flow would deselect them and the echo would clear the very
    selection the click just made (the details panel closed and stayed
    closed). The selected stop's accent border comes from React Flow's own
    click selection instead. */
export function CapsKitView({ data, roles, selection, onSelect, onFile }: CapsProps) {
  const lanes = useMemo(() => capabilities(data, 24, roles), [data, roles]);
  const [selLane, setSelLane] = useState<string | null>(null);
  const { nodes, edges, groups } = useMemo((): { nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[] } => {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const groups: FlowGroup[] = [];
    lanes.forEach((l, i) => {
      const gid = `lane:${l.famId}`;
      const members: string[] = [];
      l.stops.forEach((s, j) => {
        const id = `lane:${l.famId}:${s.id}`;
        members.push(id);
        nodes.push({
          id, kind: "tile", title: s.name, icon: <RoleMark role={s.role} />,
          color: ROLE_COLOR[s.role], entry: j === 0,
        });
        if (j > 0) {
          const prev = `lane:${l.famId}:${l.stops[j - 1].id}`;
          edges.push({ id: `${gid}:${j}`, source: prev, target: id, weight: 2 });
        }
      });
      groups.push({ id: gid, label: `${i + 1} · ${l.label}`, members });
    });
    return { nodes, edges, groups };
  }, [lanes]);
  // The controlled selection is a node id; resolve the selected block to the
  // first lane stop that shows it so the kit paints the accent border.
  const selNode = selection ? nodes.find((n) => n.id.endsWith(`:${selection}`))?.id ?? null : null;
  const select = (id: string | null) => {
    if (!id) { setSelLane(null); onSelect(null); return; }
    // lane:<fam>:<block> | lane:<fam> (frame) – stops resolve to the block,
    // a frame selects the lane (its files list opens the code panel).
    const parts = id.split(":");
    if (parts.length >= 3) { setSelLane(null); onSelect(parts[2]); }
    else { setSelLane(id.slice(5)); onSelect(null); }
  };
  const lane = selLane != null ? lanes.find((l) => String(l.famId) === selLane) : null;
  if (!lanes.length)
    return <div className="sy-canvas fm-caps" data-testid="map-caps"><div className="view-loading">no capability families under this filter</div></div>;
  return (
    <div className="sy-canvas fm-caps" data-testid="map-caps">
      <div className="fm-headline" data-testid="map-caps-headline">
        <span className="fm-headline-k">capabilities</span>
        <span className="fm-headline-v">{lanes.length} lanes – one per entry family, heaviest first</span>
        {lane && lane.files.length > 0 && (
          <span className="fm-headline-tools" data-testid="map-caps-files">
            {lane.files.map((p) => (
              <button key={p} className="fm-fn" onClick={() => onFile?.(p)} title={p}>
                <span className="mono fm-fn-name">{p.split("/").pop()}</span>
              </button>
            ))}
          </span>
        )}
      </div>
      <FlowCanvas
        minZoom={0.5}
        nodes={nodes} edges={edges} groups={groups}
        selection={selNode} onSelect={select}
        layoutKey={`map-caps-${nodes.length}`} ns="map" testId="map-caps-canvas"
      />
    </div>
  );
}
