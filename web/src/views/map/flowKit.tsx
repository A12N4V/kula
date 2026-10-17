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
  return { sections, layers: kept, labels, band, flows, headline };
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
export function FlowKitView({ data, roles, focus, selection, onSelect, onDrill, onLeaf, onClearFocus, depth = 2, layoutKey = 0 }: Props) {
  const { sections, layers, band, flows, headline } = useMemo(() => mapFlowLayout(data), [data]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lit = (id: string) => !focus?.chain || focus.on.has(id);
  const shown = (b: Block) => roles.has(b.role);
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const maxW = flows.reduce((m, f) => Math.max(m, f.weight), 0) || 1;
  // The block that carries a section's edges: its first (heaviest-leading)
  // child, or the section itself when it has none.
  const rep = (s: Block): string => {
    const kid = s.children.map((c) => data.blocks[c]).find((x): x is Block => !!x && shown(x));
    return kid?.id ?? s.id;
  };
  // Expansion lives in the node's hover/selection toolbar slot: the only
  // affordance the kit gives a tile without faking DOM into it.
  const expandTool = (b: Block, open: boolean) => (
    <button className="fc-tool" data-testid="map-expand" onClick={(e) => { e.stopPropagation(); toggleExpand(b.id); }}
      title={open ? "Collapse functions" : "Expand functions"}>
      {open ? "−" : "+"}
    </button>
  );

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const fnNodes: FlowNode[] = [];
  const secShown: string[] = [];

  const blockNode = (b: Block): FlowNode => {
    return {
      id: b.id, kind: "tile", title: title(b), subtitle: b.theme ? b.name : undefined,
      icon: <RoleMark role={b.role} />, color: ROLE_COLOR[b.role],
      entry: b.role === "entry", dim: !lit(b.id), hasSub: expanded.has(b.id),
      toolbar: expandTool(b, expanded.has(b.id)),
    };
  };

  // A section's functions: shown when its block node is expanded (cap 40).
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

  for (const layer of layers) for (const id of layer) {
    const s = sections[id];
    if (!s || !shown(s)) continue;
    secShown.push(id);
    if (depth < 2) {
      nodes.push({ ...blockNode(s), id: s.id, kind: "wide", title: title(s), subtitle: s.summary || undefined, dim: !lit(s.id) });
      fnNodes.push(...fnSubs(s));
      continue;
    }
    const kids = s.children.map((c) => data.blocks[c]).filter((x): x is Block => !!x && shown(x));
    if (!kids.length) {
      // A section that is its own block: one tile node in the frame's place.
      nodes.push(blockNode(s));
      groups.push({ id: secId(s), label: title(s), members: [s.id] });
      fnNodes.push(...fnSubs(s));
      continue;
    }
    for (const k of kids) { nodes.push(blockNode(k)); fnNodes.push(...fnSubs(k)); }
    groups.push({ id: secId(s), label: title(s), members: kids.map((k) => k.id) });
  }
  for (const id of band) {
    const s = sections[id];
    if (!s || !shown(s)) continue;
    secShown.push(id);
    if (depth < 2) {
      nodes.push({ ...blockNode(s), id: s.id, kind: "wide", title: title(s), subtitle: s.summary || undefined, dim: !lit(s.id) });
      fnNodes.push(...fnSubs(s));
      continue;
    }
    const kids = s.children.map((c) => data.blocks[c]).filter((x): x is Block => !!x && shown(x));
    if (!kids.length) {
      nodes.push(blockNode(s));
      groups.push({ id: secId(s), label: title(s), members: [s.id] });
      fnNodes.push(...fnSubs(s));
      continue;
    }
    for (const k of kids) { nodes.push(blockNode(k)); fnNodes.push(...fnSubs(k)); }
    groups.push({ id: secId(s), label: title(s), members: kids.map((k) => k.id) });
  }
  nodes.push(...fnNodes);

  // Section-level flows become chain-weight edges between each section's
  // representative block; never between a node and itself.
  const seenEdge = new Set<string>();
  for (const f of flows.slice(0, 96)) {
    const from = sections[f.from], to = sections[f.to];
    if (!from || !to || !secShown.includes(f.from) || !secShown.includes(f.to)) continue;
    const a = rep(from), b = rep(to);
    if (a === b) continue;
    const key = `${a}>${b}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push({ id: key, source: a, target: b, weight: edgeWeight(f.weight, maxW), backward: false });
  }

  // Intercepted selections: function circles open the code panel, "+ more"
  // chips toggle the expansion – neither becomes the block selection.
  const select = (id: string | null) => {
    if (!id) { onSelect?.(null); return; }
    if (id.startsWith("fn:")) { onLeaf(Number(id.slice(3))); return; }
    if (id.startsWith("more:")) {
      const bid = id.slice(5);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(bid)) next.delete(bid); else next.add(bid);
        return next;
      });
      return;
    }
    onSelect?.(id);
  };
  const open = (id: string) => {
    if (id.startsWith("fn:")) { onLeaf(Number(id.slice(3))); return; }
    if (id.startsWith("more:")) { onDrill(id.slice(5)); return; }
    onDrill(id.startsWith("sec:") ? id.slice(4) : id);
  };

  const anyExpanded = expanded.size > 0;
  return (
    <div className="sy-canvas fm-flow" data-testid="map-flow">
      <div className="fm-headline" data-testid="map-headline">
        <span className="fm-headline-k">executes</span>
        <span className="fm-headline-v">{headline || "–"}</span>
        <span className="fm-headline-tools">
          <button className="tab-btn sy-lens-btn" data-testid="map-collapse-all" title="collapse every expanded block" aria-pressed={anyExpanded}
            onClick={() => setExpanded(new Set())}>collapse</button>
        </span>
      </div>
      <FlowCanvas
        nodes={nodes} edges={edges} groups={groups}
        selection={selection ?? null} onSelect={select} onOpen={open}
        layoutKey={`map-${depth}-${layoutKey}`} ns="map" testId="map-flow-canvas"
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
};

/** One swimlane group per entry family (heaviest first), the lane's blocks
    as tile nodes chained left to right. Node ids are lane-scoped – a block
    can appear in several lanes – and selections map back to the block. */
export function CapsKitView({ data, roles, selection, onSelect }: CapsProps) {
  const lanes = useMemo(() => capabilities(data, 24, roles), [data, roles]);
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
        color: ROLE_COLOR[s.role], entry: j === 0, dim: !!selection && selection !== s.id,
      });
      if (j > 0) {
        const prev = `lane:${l.famId}:${l.stops[j - 1].id}`;
        edges.push({ id: `${gid}:${j}`, source: prev, target: id, weight: 2 });
      }
    });
    groups.push({ id: gid, label: `${i + 1} · ${l.label}`, members });
  });
  const select = (id: string | null) => {
    if (!id) { onSelect(null); return; }
    // lane:<fam>:<block> | lane:<fam> (frame) – both resolve to the block
    const parts = id.split(":");
    onSelect(parts.length >= 3 ? parts[2] : null);
  };
  return (
    <div className="sy-canvas fm-caps" data-testid="map-caps">
      <div className="fm-headline" data-testid="map-caps-headline">
        <span className="fm-headline-k">capabilities</span>
        <span className="fm-headline-v">{lanes.length} lanes – one per entry family, heaviest first</span>
      </div>
      <FlowCanvas
        nodes={nodes} edges={edges} groups={groups}
        selection={null} onSelect={select}
        layoutKey={`map-caps-${nodes.length}`} ns="map" testId="map-caps-canvas"
      />
    </div>
  );
}
