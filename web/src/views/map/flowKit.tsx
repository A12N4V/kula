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
import { KindIcon, RoleMark, ROLE_COLOR, sectionLogo } from "./icons";
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
  onStepTool?: (id: string, action: "done" | "remove" | "run" | "toggle" | "insert" | "open") => void;
  /** n8n canvas callbacks, passed through to the kit. */
  canvas?: Partial<Pick<React.ComponentProps<typeof FlowCanvas>, "onContextMenu" | "onConnect" | "onConnectToPane" | "onStub" | "onKey" | "onMoved" | "reveal">>;
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
export function FlowKitView({ data, roles, focus, selection, onSelect, onDrill, onLeaf, onClearFocus, depth = 2, layoutKey = 0, expanded: expandedProp, onToggleExpand, onClearExpand, marks, steps = [], onStepTool, scheme = "role", canvas }: Props) {
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
      icon: sectionLogo(`${b.theme ?? ""} ${b.name} ${b.summary ?? ""}`, b.role), color: colorOf(b, sec),
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
        // Graph's square node: the section's logo in the box, its name and
        // size under it – a glance reads what each part of the code does.
        nodes.push({
          ...blockNode(s), kind: "tile", title: title(s),
          subtitle: kids.length ? `${kids.length} blocks · ${s.files} files` : `${s.files} files · ${s.symbols.length} fns`,
          icon: sectionLogo(`${s.theme ?? ""} ${s.name} ${s.summary ?? ""}`, s.role),
          size: { w: 96, h: 160 },
          toolbar: kids.length ? secTool(id, false) : expandTool(s, expanded.has(s.id)),
          pos: { x: x + 80, y },
          ...markOf(id, true),
        });
        fnNodes.push(...fnSubs(s));
        repOf.set(id, s.id);
        y += 160 + GAP_Y;
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

  // The pipeline lane: blocks left to right above the map as n8n's square
  // nodes, wired in order, each with a dashed wire down to the section it acts
  // on. A retry loops back to the last agent. Wires carry the run: marching
  // while data moves, green once passed, red where it failed; hovering one
  // shows "+" to insert a block there. Stickies sit where they were dropped.
  const LANE_Y = -288, STEP_W = 176;
  const fenceSize = (sid: string) => { const set = new Set<string>(); for (const sym of symbolsUnder(data.blocks, sid)) { const p = data.leaves[sym]?.path; if (p) set.add(p); } return set.size; };
  const nodeIdsSoFar = new Set(nodes.map((n) => n.id));
  const repOfSec = (sid: string) => { const r = repOf.get(sid); return r && nodeIdsSoFar.has(r) ? r : null; };
  const name = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : null);
  let prevStep: Step | null = null, lastAgent: string | null = null, li = 0;
  const flowOf = (st: Step) => st.status === "success" || st.status === "skipped" ? "ok" : st.status === "error" ? "err" : undefined;
  const run = steps.filter((x) => x.kind !== "note");
  steps.forEach((st) => {
    const id = `step:${st.id}`;
    if (st.kind === "note") {
      nodes.push({ id, kind: "sticky", title: st.name, subtitle: st.task, color: st.color, size: { w: 224, h: 144 }, pos: st.pos ?? { x: -272, y: LANE_Y - 32 } });
      return;
    }
    const status = st.disabled ? "disabled" : st.status === "waiting" || st.status === "running" ? "running" : st.status === "success" ? "success" : st.status === "error" ? "error" : undefined;
    const tools = (
      <>
        {st.status === "waiting" && <button className="fc-tool" data-testid="step-done" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "done"); }} title="The agent finished – hand on">done</button>}
        <button className="fc-tool" data-testid="step-run" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "run"); }} title="Run from this block"><Icon.play /></button>
        <button className="fc-tool" data-testid="step-toggle" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "toggle"); }} title={st.disabled ? "Activate (D)" : "Deactivate (D)"}><Icon.lock /></button>
        <button className="fc-tool" data-testid="step-remove" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "remove"); }} title="Delete (Del)"><Icon.close /></button>
      </>
    );
    const last = li === run.length - 1;
    nodes.push({
      id, kind: "tile", title: st.name,
      subtitle: st.note ?? (st.status === "waiting" ? "waiting for an agent" : name(st.section) ?? (st.kind === "gate" ? `kula ${st.ref}` : st.kind === "retry" ? `up to ${st.max ?? 3} rounds` : st.ref)),
      icon: <span className="fc-step-ico" style={{ color: KIND_COLOR[st.kind] }}><KindIco kind={st.kind} /></span>,
      color: KIND_COLOR[st.kind], status, entry: st.kind === "trigger", noOut: last,
      toolbar: tools, pos: { x: li * STEP_W, y: LANE_Y }, connectable: true, accepts: li > 0,
    });
    li++;
    if (prevStep) {
      const pid = `step:${prevStep.id}`;
      const live = prevStep.status === "success" && (st.status === "running" || st.status === "waiting");
      edges.push({
        id: `${pid}>${id}`, source: pid, target: id, weight: 2, main: true,
        flow: live ? "run" : flowOf(prevStep) && st.status && st.status !== "idle" ? flowOf(st) ?? "ok" : undefined,
        tools: <button data-testid={`edge-add-${prevStep.id}`} title="Insert a block here" onClick={(e) => { e.stopPropagation(); onStepTool?.(prevStep!.id, "insert"); }}>+</button>,
      });
    }
    if (st.kind === "retry" && lastAgent) edges.push({ id: `${id}>loop`, source: id, target: lastAgent, weight: 2, main: true, backward: true, label: `up to ${st.max ?? 3}x` });
    const target = st.section ? repOfSec(st.section) : null;
    // After a run the section wire carries its count, as n8n's item counts do.
    const ran = st.status === "success" || st.status === "error" || st.status === "waiting";
    if (target) edges.push({ id: `${id}~${target}`, source: id, target, main: false, flow: st.status === "waiting" ? "run" : undefined, label: ran && st.section ? `${fenceSize(st.section)} files` : undefined });
    prevStep = st;
    if (st.kind === "agent" || st.kind === "crew") lastAgent = id;
  });
  // The lane reads as one thing: a labelled frame round its blocks.
  const laneIds = run.map((x) => `step:${x.id}`);
  if (laneIds.length) groups.push({ id: "lane", label: "Pipeline", members: laneIds });
  // Sections accept a wire dragged from a block: that block now acts on it.
  if (steps.length) for (const n of nodes) if (!n.id.startsWith("step:") && n.kind !== "circle") n.accepts = true;
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
    if (!id || id === "lane") { onSelect?.(null); return; }
    if (id.startsWith("fn:")) { const n = Number(id.slice(3)); setTimeout(() => onLeaf(n), 0); return; }
    if (id.startsWith("more:")) { const bid = id.slice(5); setTimeout(() => toggleExpand(bid), 0); return; }
    // a group frame selects its section block – the sidebar reads blocks
    onSelect?.(id.startsWith("sec:") ? id.slice(4) : id);
  };
  const open = (id: string) => {
    if (id.startsWith("step:")) { onStepTool?.(id.slice(5), "open"); return; }
    if (id === "lane") return;
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
        {...canvas}
        reveal={selection?.startsWith("step:") ? selection : null}
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
