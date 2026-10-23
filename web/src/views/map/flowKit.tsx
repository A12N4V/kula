// map flow on the kit – MapData mapped onto F1's flow canvas (web/src/flow).
// The old hand-drawn SVG flow (flow.tsx) is gone: sections are kit group
// frames (or single wide nodes at depth 1), blocks are tile nodes, an
// expanded block hangs its functions below as circle sub-nodes (capped at
// 40 – the map has ~4 100 leaves and never mounts them all), and section
// flows become chain-weight edges. A focused chain dims everything it does
// not cross through the kit's `dim` flag. The capabilities lens renders one
// swimlane group per entry family from the same pure lens as before.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { FlowCanvas, type FlowEdge, type FlowGroup, type FlowNode } from "../../flow";
import { dirColor, groupDirs } from "../../colors";
import { settings as appSettings } from "../../settings";
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
  /** A picked value flow: its sections ring in its hue, its wires carry it, the rest dims. */
  flowTint?: { color: string; sections: Set<string> } | null;
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
  /** The node hover toolbar's actions (Run, Open code, Pin – n8n §4: nothing
      on the node face; the toolbar floats above it). */
  onNodeTool?: (id: string, action: "open" | "pin" | "run") => void;
  /** Blocks whose pin is on – the toolbar shows the state. */
  pinned?: string | null;
  /** U2: a block id to pan the camera to (search). Camera-only – the layout
      key does not change, so no re-layout can follow (PLAN P4.6). */
  reveal?: string | null;
};

const title = (b: Block) => b.theme || b.name;
const kindGlyphOf = (k: string) => ({ function: "ƒ", fn: "ƒ", method: "m", class: "C", struct: "S", interface: "I", trait: "T", type: "T", enum: "E", const: "K" } as Record<string, string>)[k] ?? "·";
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

/** The busiest section: the one the most flow runs through (R0 – the
    readable-by-default landing centred on it). */
export function busiestSection(data: MapData & { flows?: Flow[] }): string | null {
  try {
    const { flows, sections } = mapFlowLayout(data);
    const through = (id: string) => flows.reduce((acc, f) => acc + (f.from === id || f.to === id ? f.weight : 0), 0);
    let best: string | null = null, bestW = -1;
    for (const id of Object.keys(sections)) {
      const w = through(id);
      if (w > bestW) { best = id; bestW = w; }
    }
    return best;
  } catch {
    return null;
  }
}

/** Sub-node icons keep the graph's kind glyphs; cards carry the role mark. */
function fnIcon(kind: string) {
  return <KindIcon kind={kind} />;
}

/** The flow lens on the kit canvas – R0's one canvas: every block is the
    information-rich card (name, role, logo, files, symbol count, in/out
    degree, the flows and chains it belongs to); sections render as frames
    holding their cards. Selection is single-writer (the kit); a focused
    chain dims everything it does not cross through the kit's `dim` flag. */
export function FlowKitView({ flowTint, data, roles, focus, selection, onSelect, onDrill, onLeaf, onClearFocus, depth = 2, layoutKey = 0, marks, steps = [], onStepTool, scheme = "role", canvas, onNodeTool, pinned, reveal }: Props) {
  const { sections, layers, band, flows, headline, secOf } = useMemo(() => mapFlowLayout(data), [data]);
  const lit = (id: string) => !focus?.chain || focus.on.has(id);
  const [openPath, setOpenPath] = useState<string[]>([]);
  // Directory ranks come from the Graph view's own node set, so a directory
  // has the same hue on both canvases (src/ blue, web/src/ orange, …).
  // Cached per session so the first paint already has the Graph's hues.
  const [graphPaths, setGraphPaths] = useState<string[] | null>(() => { try { return JSON.parse(sessionStorage.getItem("kula.map.graphPaths") || "null"); } catch { return null; } });
  useEffect(() => {
    let live = true;
    api.graph("symbol").then((g) => {
      const paths = g.nodes.filter((n) => n.kind !== "package").map((n) => n.path);
      try { sessionStorage.setItem("kula.map.graphPaths", JSON.stringify(paths)); } catch { /* private window */ }
      if (live) setGraphPaths(paths);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  const shown = (b: Block) => roles.has(b.role);

  // Membership + degree, computed once per payload: the cards read them from
  // the kit payload instead of walking the map per render.
  const meta = useMemo(() => {
    const inDeg = new Map<string, number>(), outDeg = new Map<string, number>();
    for (const f of flows) {
      outDeg.set(f.from, (outDeg.get(f.from) ?? 0) + 1);
      inDeg.set(f.to, (inDeg.get(f.to) ?? 0) + 1);
    }
    const chainNames = new Map<string, string[]>();
    for (const fam of data.families) {
      for (const b of fam.blocks) {
        const sid = secOf[b] ?? b;
        if (!chainNames.has(sid)) chainNames.set(sid, []);
        chainNames.get(sid)!.push(`${data.leaves[fam.source]?.name ?? fam.source} → ${data.leaves[fam.terminal]?.name ?? fam.terminal}`);
      }
    }
    const flowNames = new Map<string, string[]>();
    for (const f of data.value_flows ?? []) for (const b of f.sections) {
      if (!flowNames.has(b)) flowNames.set(b, []);
      flowNames.get(b)!.push(f.name);
    }
    return { inDeg, outDeg, chainNames, flowNames };
  }, [data, flows, secOf]);

  // The built graph is memoised: new array identities would re-run the kit's
  // layout effect on every parent re-render (a selection change included),
  // which wipes the kit's selection flags and re-fits the viewport.
  const { nodes, edges, groups, reps } = useMemo((): { nodes: FlowNode[]; edges: FlowEdge[]; groups: FlowGroup[]; reps: Map<string, string> } => {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const groups: FlowGroup[] = [];
    const reps = new Map<string, string>();

  const st = appSettings.get();
  const dg = groupDirs(graphPaths ?? Object.values(data.leaves).map((l) => l.path), st.dirDepth);
  const EXT: Record<string, string> = { rs: "RS", ts: "TS", tsx: "TX", js: "JS", jsx: "JX", mjs: "JS", py: "PY", go: "GO", css: "CS", md: "MD" };
  const dirMemo = new Map<string, { dir: string; color: string; lang: string }>();
  const dirOfBlock = (id: string) => {
    let v = dirMemo.get(id);
    if (v) return v;
    const tally = new Map<string, number>(), langs = new Map<string, number>();
    for (const sid of symbolsUnder(data.blocks, id)) {
      const l = data.leaves[sid]; if (!l) continue;
      const d = dg.of(l.path); tally.set(d, (tally.get(d) ?? 0) + 1);
      const x = EXT[l.path.split(".").pop() ?? ""] ?? "··"; langs.set(x, (langs.get(x) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
    const dir = top(tally) ?? ".";
    v = { dir, color: dirColor(dir, dg, st), lang: top(langs) ?? "··" };
    dirMemo.set(id, v);
    return v;
  };
  const colorOf = (b: Block, sec: string) =>
    scheme === "section" ? `hsl(${hue(sec)} 60% 58%)`
    : scheme === "mono" ? "var(--text-3)"
    : scheme === "heat" ? (marks?.[sec]?.changed ? "var(--red)" : marks?.[sec]?.fence ? "var(--accent)" : "var(--line-2)")
    : ROLE_COLOR[b.role];

  // The block card node (R0): the old Blocks-lens card is the node itself.
  const blockCard = (b: Block, sec = b.id): FlowNode => {
    const fnIds = symbolsUnder(data.blocks, b.id).filter((id) => data.leaves[id]);
    // n8n §7 hover toolbar: Run first, then Open code, Pin. Run shares the
    // runner path the transport owns – the runner falls back to the whole
    // pipeline when the id is not a pipeline step.
    const nodeTools = onNodeTool ? (
      <>
        <button className="fc-tool" data-testid={`fn-run-${b.id}`} title="Run from here" onClick={(e) => { e.stopPropagation(); onNodeTool(b.id, "run"); }}><Icon.play /></button>
        <button className="fc-tool" data-testid={`fn-open-${b.id}`} title="Open code" onClick={(e) => { e.stopPropagation(); onNodeTool(b.id, "open"); }}><Icon.doc /></button>
        <button className={`fc-tool${pinned === b.id ? " on" : ""}`} data-testid={`fn-pin-${b.id}`} title={pinned === b.id ? "Unpin" : "Pin"} onClick={(e) => { e.stopPropagation(); onNodeTool(b.id, "pin"); }}><Icon.target /></button>
      </>
    ) : undefined;
    return {
      id: b.id, kind: "block",
      title: title(b), subtitle: b.theme ? b.name : undefined,
      color: colorOf(b, sec), entry: b.role === "entry", dim: !lit(b.id),
      toolbar: nodeTools,
      card: {
        hue: dirOfBlock(b.id).color, glyph: dirOfBlock(b.id).lang, dir: dg.label(dirOfBlock(b.id).dir),
        role: b.role, roleColor: colorOf(b, sec),
        logo: sectionLogo(`${b.theme ?? ""} ${b.name} ${b.summary ?? ""}`, b.role),
        files: b.files, symbols: fnIds.length,
        inDeg: meta.inDeg.get(sec), outDeg: meta.outDeg.get(sec),
        flows: meta.flowNames.get(sec), chains: meta.chainNames.get(sec),
        functions: fnIds.slice(0, FN_CAP).map((id) => ({ name: data.leaves[id].name, kind: data.leaves[id].kind })),
      },
    };
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
  // pipeline layer, left to right, shared utilities last. Every section is
  // a frame (depth 2) holding its block cards, or a single card at depth 1.
  // Region hues = the Graph view's directory palette (colors.ts): a block
  // takes the colour of the directory most of its symbols live in, so src/
  // is the same blue here as on the Graph. Frames are tinted with it, wires
  // carry it, and far zoom draws the block as a node of that colour.
  const regionHue = (id: string) => dirOfBlock(id).color;
  // Nested squares (U5, the Graph view's hub language): every block is one
  // solid square in its directory hue, sized by symbol count. Clicking a
  // square disassembles it in place into a tinted frame holding its children
  // (sub-blocks, then functions at the leaves). One branch is open at a time:
  // `openPath` is the chain section → … → block, so opening anything off the
  // path snaps the rest shut and the canvas stays compact.
  const GAP_X = 120, GAP_Y = 32, PAD = 16, HEAD = 46, FN = 72;
  const sq = (b: Block) => { const n = symbolsUnder(data.blocks, b.id).length; return Math.round((96 + 56 * Math.min(1, Math.sqrt(n / 150))) / 8) * 8; };
  const kidsOf = (id: string) => (data.blocks[id]?.children ?? []).map((c) => data.blocks[c]).filter((k): k is Block => !!k && shown(k));
  const isOpen = (id: string) => openPath.includes(id);
  type Box = { w: number; h: number; place: (x: number, y: number) => void };
  const measure = (b: Block, sec: string, level: number): Box => {
    const kids = kidsOf(b.id);
    const fns = kids.length ? [] : b.symbols.filter((n) => data.leaves[n]).slice(0, 24);
    if (!isOpen(b.id) || (!kids.length && !fns.length)) {
      const S = sq(b);
      return { w: S, h: S + 22, place: (x, y) => {
        const c = blockCard(b, sec);
        const inside: string[] = []; const walk = (id: string) => { for (const k of data.blocks[id]?.children ?? []) { inside.push(k); walk(k); } }; walk(b.id);
        if (c.card) c.card.has = inside.join(" ");
        if (flowTint && c.card) { if (flowTint.sections.has(sec)) c.card.flowHue = flowTint.color; else c.dim = true; }
        nodes.push({ ...c, solid: true, openable: kids.length > 0 || fns.length > 0, size: { w: S, h: S + 22 }, pos: { x, y }, ...markOf(sec, b.id === sec) });
        reps.set(b.id, b.id);
      } };
    }
    // Open: a frame of children; an open child takes a full row of its own.
    const parts: Box[] = kids.length ? kids.map((k) => measure(k, sec, level + 1))
      : fns.map((n) => ({ w: FN, h: FN + 18, place: (x: number, y: number) => {
          const l = data.leaves[n];
          nodes.push({ id: fnId(n), kind: "block", title: l.name, solid: true, leaf: true, color: regionHue(sec),
            card: { hue: regionHue(sec), glyph: kindGlyphOf(l.kind) }, size: { w: FN, h: FN + 18 }, pos: { x, y } } as FlowNode);
        } }));
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(parts.length))));
    const rows: Box[][] = [];
    let row: Box[] = [];
    for (let i = 0; i < parts.length; i++) {
      const openKid = kids[i] && isOpen(kids[i].id) && parts[i].w > sq(kids[i]);
      if (openKid) { if (row.length) rows.push(row); rows.push([parts[i]]); row = []; continue; }
      row.push(parts[i]);
      if (row.length === cols) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    const rw = (r: Box[]) => r.reduce((a, p) => a + p.w, 0) + GAP_Y * (r.length - 1);
    const rh = (r: Box[]) => Math.max(...r.map((p) => p.h));
    const w = Math.max(240, ...rows.map(rw)) + PAD * 2;
    const h = HEAD + rows.reduce((a, r) => a + rh(r), 0) + GAP_Y * (rows.length - 1) + PAD * 2;
    return { w, h, place: (x, y) => {
      nodes.push({ id: `open:${b.id}`, kind: "group", title: `${title(b)}`, subtitle: kids.length ? `${kids.length} blocks · click to fold` : `${b.symbols.length} symbols · click to fold`,
        color: regionHue(sec), size: { w, h }, pos: { x, y }, z: -100 + level } as FlowNode);
      let cy = y + HEAD + PAD;
      for (const r of rows) {
        let cx = x + PAD;
        for (const p of r) { p.place(cx, cy); cx += p.w + GAP_Y; }
        cy += rh(r) + GAP_Y;
      }
      const first = kids[0]?.id ?? (fns[0] != null ? fnId(fns[0]) : undefined);
      if (first) reps.set(b.id, reps.get(first) ?? first);
    } };
  };
  const columns: string[][] = [...layers.map((l) => l.filter((id) => sections[id] && shown(sections[id])))];
  const bandShown = band.filter((id) => sections[id] && shown(sections[id]));
  if (bandShown.length) columns.push(bandShown);
  const colOf = new Map<string, number>();
  // Wrap a busy layer into sub-columns so the closed map lands near 16:10.
  const closedH = Math.max(...Object.values(sections).map((b) => sq(b) + 22), 120) + GAP_Y;
  const nSecs = columns.flat().length;
  const perCol = Math.max(3, Math.ceil(Math.sqrt(nSecs / 1.6)));
  let x = 0;
  columns.forEach((col, ci) => {
    if (!col.length) return;
    let y = 0, colW = 0, inCol = 0;
    for (const id of col) {
      colOf.set(id, ci);
      const box = measure(sections[id], id, 0);
      if (inCol >= perCol && !isOpen(id)) { x += colW + GAP_X; y = 0; colW = 0; inCol = 0; }
      box.place(x, y);
      y += box.h + GAP_Y; colW = Math.max(colW, box.w); inCol++;
    }
    x += colW + GAP_X;
  });
  void closedH;

  // The pipeline lane: blocks left to right above the map as n8n's square
  // nodes, wired in order, each with a dashed wire down to the section it acts
  // on. A retry loops back to the last agent. Wires carry the run: marching
  // while data moves, green once passed, red where it failed; hovering one
  // shows "+" to insert a block there. Stickies sit where they were dropped.
  const LANE_Y = -288, STEP_W = 208; // lane steps clear each other – the 176 agent body plus a gap
  const fenceSize = (sid: string) => { const set = new Set<string>(); for (const sym of symbolsUnder(data.blocks, sid)) { const p = data.leaves[sym]?.path; if (p) set.add(p); } return set.size; };
  const nodeIdsSoFar = new Set(nodes.map((n) => n.id));
  const repOfSec = (sid: string) => { const r = reps.get(sid); return r && nodeIdsSoFar.has(r) ? r : null; };
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
    const lastRun = st.status === "success" ? "ok" : st.status === "error" ? "err" : undefined;
    const tools = (
      <>
        {st.status === "waiting" && <button className="fc-tool" data-testid="step-done" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "done"); }} title="The agent finished – hand on">done</button>}
        <button className="fc-tool" data-testid="step-run" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "run"); }} title="Run from this block"><Icon.play /></button>
        <button className="fc-tool" data-testid="step-open" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "open"); }} title="Open the step detail"><Icon.arrow /></button>
        <button className="fc-tool" data-testid="step-toggle" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "toggle"); }} title={st.disabled ? "Activate (D)" : "Deactivate (D)"}><Icon.lock /></button>
        <button className="fc-tool" data-testid="step-remove" onClick={(e) => { e.stopPropagation(); onStepTool?.(st.id, "remove"); }} title="Delete (Del)"><Icon.close /></button>
      </>
    );
    const last = li === run.length - 1;
    // Shape by kind (n8n §2): triggers keep the rounded leading edge, gates
    // are diamonds with labelled pass/fail forks, agents are wide softer
    // nodes with typed capability ports on the bottom edge.
    const agentPorts = [
      { id: "model", label: "Model", side: "bottom" as const },
      { id: "tools", label: "Tools", side: "bottom" as const },
      { id: "fence", label: "Fence", side: "bottom" as const },
      { id: "memory", label: "Memory", side: "bottom" as const },
    ];
    if (st.kind === "gate" || st.kind === "trigger") {
      nodes.push({
        id, kind: st.kind === "gate" ? "gate" : "tile", title: st.name,
        subtitle: st.note ?? (st.status === "waiting" ? "waiting for an agent" : name(st.section) ?? (st.kind === "gate" ? `kula ${st.ref}` : st.ref)),
        icon: <span className="fc-step-ico" style={{ color: KIND_COLOR[st.kind] }}><KindIco kind={st.kind} /></span>,
        color: KIND_COLOR[st.kind], status, entry: st.kind === "trigger", lastRun,
        noOut: last,
        toolbar: tools, pos: { x: li * STEP_W, y: LANE_Y }, connectable: true, accepts: li > 0,
      });
    } else if (st.kind === "agent" || st.kind === "crew") {
      nodes.push({
        id, kind: "agent", title: st.name,
        subtitle: st.note ?? (st.status === "waiting" ? "waiting" : name(st.section) ?? st.ref),
        color: KIND_COLOR[st.kind], status, lastRun, ports: agentPorts,
        toolbar: tools, pos: { x: li * STEP_W, y: LANE_Y }, connectable: true, accepts: li > 0,
      });
    } else {
      nodes.push({
        id, kind: "tile", title: st.name,
        subtitle: st.note ?? (st.status === "waiting" ? "waiting for an agent" : name(st.section) ?? (st.kind === "retry" ? `up to ${st.max ?? 3} rounds` : st.ref)),
        icon: <span className="fc-step-ico" style={{ color: KIND_COLOR[st.kind] }}><KindIco kind={st.kind} /></span>,
        color: KIND_COLOR[st.kind], status, lastRun, noOut: last,
        toolbar: tools, pos: { x: li * STEP_W, y: LANE_Y }, connectable: true, accepts: li > 0,
      });
    }
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
  if (steps.length) for (const n of nodes) if (!n.id.startsWith("step:") && n.kind === "block") n.accepts = true;
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
    const a = reps.get(f.from)!, b = reps.get(f.to)!;
    if (a === b || !nodeIds.has(a) || !nodeIds.has(b)) continue;
    // Flows back into an earlier column (or within one) would wrap the whole
    // canvas; the default view reads left to right, the sidebar lists them.
    if (colOf.get(f.to)! <= colOf.get(f.from)!) continue;
    const key = `${a}>${b}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    outCount.set(f.from, (outCount.get(f.from) ?? 0) + 1);
    const inFlow = !!flowTint && flowTint.sections.has(f.from) && flowTint.sections.has(f.to);
    edges.push({ id: key, source: a, target: b, weight: inFlow ? 4 : edgeWeight(f.weight, maxW), color: inFlow ? flowTint!.color : regionHue(f.from), flow: undefined, label: undefined, ...(inFlow ? { lit: true } : {}) } as FlowEdge);
  }

    // The card payload rides flat on the node data (the kit's BlockCard contract:
// BlockCardDataWithSize = the FlowNode with the card's fields spread over it),
// so the renderers read files/symbols/functions without reaching into .card.
    const flat = nodes.map((n) => (n.card ? { ...n, ...n.card } : n));
    return { nodes: flat, edges, groups, reps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, roles, focus, depth, marks, steps, scheme, meta, onNodeTool, pinned, openPath, graphPaths, flowTint]);

  // The landing zoom (R0, readable by default): the busiest section, at a
  // scale where the card labels are legible – fit stays one key away.
  const busiest = useMemo(() => {
    const id = busiestSection(data);
    return reps.get(id ?? "") ?? null;
  }, [data, reps]);

  // Intercepted selections: a group frame selects its section block – the
  // sidebar reads blocks. Selections that open panels must not run inside
  // React Flow's click dispatch – a synchronous parent update there
  // re-enters the store (React error 185). Defer them a tick.
  // A search hit (reveal) or an outside selection folded inside a closed
  // square opens the branch that holds it, so the camera has a node to go to.
  useEffect(() => {
    const target = reveal ?? selection;
    const bid = target?.startsWith("step:") ? null : target?.replace(/^sec:|^open:/, "");
    const b = bid ? data.blocks[bid] : undefined;
    if (!b || sections[b.id] || !b.parent) return;
    const chain: string[] = [];
    for (let p: Block | undefined = data.blocks[b.parent]; p; p = p.parent ? data.blocks[p.parent] : undefined) { chain.unshift(p.id); if (sections[p.id]) break; }
    if (chain.join() !== openPath.slice(0, chain.length).join()) setOpenPath(chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, selection, data]);
  // Only a pointer click opens/folds – keyboard traversal (arrows walk the
  // edges) moves the selection without rearranging the map under it.
  useEffect(() => {
    const down = (e: PointerEvent) => { const w = window as unknown as { __fcPtr?: number; __fcAt?: [number, number] }; w.__fcPtr = performance.now(); w.__fcAt = [e.clientX, e.clientY]; };
    const upAt = (e: PointerEvent) => { (window as unknown as { __fcUp?: [number, number, number] }).__fcUp = [e.clientX, e.clientY, performance.now()]; };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", upAt, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", upAt, true); };
  }, []);
  const byPointer = () => performance.now() - ((window as unknown as { __fcPtr?: number }).__fcPtr ?? -1e9) < 800;
  // Open on a real click only: wait for the pointer to come up within 5px of
  // where it went down – a drag selects the square without unfolding it.
  const onClickRelease = (fn: () => void) => {
    const w = window as unknown as { __fcAt?: [number, number]; __fcUp?: [number, number, number]; __fcPtr?: number };
    const at = w.__fcAt;
    // already released (React Flow selects on click): judge it now
    if (w.__fcUp && w.__fcPtr != null && w.__fcUp[2] >= w.__fcPtr) { if (!at || Math.hypot(w.__fcUp[0] - at[0], w.__fcUp[1] - at[1]) < 5) fn(); return; }
    const up = (e: PointerEvent) => { window.removeEventListener("pointerup", up, true); if (!at || Math.hypot(e.clientX - at[0], e.clientY - at[1]) < 5) fn(); };
    window.addEventListener("pointerup", up, true);
  };
  // Click = disassemble (or fold): the open branch is the chain from the
  // clicked block up to its section, so every other branch snaps shut.
  const chainOf = (id: string) => { const out: string[] = []; for (let b: Block | undefined = data.blocks[id]; b; b = b.parent ? data.blocks[b.parent] : undefined) { out.unshift(b.id); if (sections[b.id]) break; } return out; };
  const select = (id: string | null) => {
    if (!id || id === "lane") { onSelect?.(null); return; }
    if (id.startsWith("open:") && byPointer()) { const bid = id.slice(5); onClickRelease(() => setOpenPath(chainOf(bid).slice(0, -1))); onSelect?.(bid); return; }
    if (id.startsWith("fn:")) { onLeaf(Number(id.slice(3))); return; }
    if (byPointer() && data.blocks[id] && (kidsOfAny(id) || data.blocks[id].symbols.length)) onClickRelease(() => setOpenPath(chainOf(id)));
    onSelect?.(id.startsWith("sec:") ? id.slice(4) : id);
  };
  function kidsOfAny(id: string) { return (data.blocks[id]?.children ?? []).length > 0; }
  const open = (id: string) => {
    if (id.startsWith("step:")) { onStepTool?.(id.slice(5), "open"); return; }
    if (id === "lane") return;
    // Double-click = details: the inspector for a block, the code for a function.
    if (id.startsWith("fn:")) { onLeaf(Number(id.slice(3))); return; }
    const bid = id.startsWith("open:") ? id.slice(5) : id.startsWith("sec:") ? id.slice(4) : id;
    setTimeout(() => onDrill(bid), 0);
  };

  const dense = edges.length > 120;
  const denser = edges.length > 400;
  return (
    <div className={`sy-canvas fm-flow${dense ? " map-canvas--dense" : ""}${denser ? " map-canvas--denser" : ""}`} data-testid="map-flow" data-fc-chainfocus={focus?.chain ? "1" : undefined}>
      {/* U4 (X2 list): the "executes" crumb leaves landing – the workflow
          name already reads in the header, the label only duplicated it. */}
      <div className="fm-headline" data-testid="map-headline">
        <span className="fm-headline-v">{headline || "–"}</span>
      </div>
      <FlowCanvas
        {...canvas}
        reveal={reveal ?? (selection?.startsWith("step:") ? selection : null)}
        minZoom={0.1}
        initialFocus={busiest}
        initialZoom={0.85}
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
