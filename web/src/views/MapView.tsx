// MapView – code as blocks and chains, on the map. Route #/map (deep link
// #map/<blockId> drills straight to a block). Three regions: a resizable
// sidebar (chain families + block tree, virtualised), the nested-box canvas
// with breadcrumb, role glyphs and chain path, and the readout table.
// Data comes from GET /api/map in one payload; the lens (Functions /
// Utilities / All) and the role filter are client-side, so switching is
// instant. While the map runs, /api/map/progress drives the progress state –
// never an empty view. Until M1's API lands, the fixture (same shapes) stands
// in, so the swap is a one-line change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Workflow } from "../api";
import { Icon } from "../ui";
import { useCode } from "../CodePanel";
import { Grip, listWidth } from "../resize";
import { fixture } from "./map/fixture";
import { BlockCanvas } from "./map/canvas";
import { Readout, SubwayStrip } from "./map/readout";
import { MapViewSidebar } from "./map/sidebar";
import { FlowKitView } from "./map/flowKit";
import { flowHue, JourneysPanel, JourneyStrip } from "./map/flowsPanel";
import { Legend } from "./map/legend"; // U7 – the map's key (announced: mount-only glue)
import { PlainPanel, RailSearch } from "./map/plain"; // U9 – the reading layer (announced: mount-only glue)
import { ProgressStrip, useMapProgress } from "./map/progress";
import { focusOf, type Focus } from "./map/chainFocus";
import { Library, ReviewPanel, RunPanel, fencedSectionsOf, filesOf, sectionAtPoint, sectionOf, stashNewItem, useAgentFence, useLive, useMarks, type Marks } from "./map/workspace";
// U2 chrome: rail, layers, Map·Runs·Evals, tidy (undoable) – new file, so
// this diff stays wiring-only.
import { DEFAULT_LAYERS, EvalsBoard, FrameSwitch, LayerBar, MapRail, TidyStrip, type Frame, type LayerId, type Layers } from "./map/chrome";
import { ActorBand, FenceHull } from "./agents/actors";
import { AgentInspector } from "./agents/AgentInspector";
import { AddForm } from "./agents/AddForm";
import { clearPersisted } from "../flow/positions";
import { RoleMark } from "./map/icons";
import { ContextMenu, Executions, FLOW, KIND_COLOR, KindIco, NodePanel, PipelinePanel, StepDetails, droppedItem, isItemDrag, runnable, usePipeline, useRunner, type Item, type MenuItem, type Step } from "./map/pipeline";
import { AskGate, ChangeBadges, ConflictMarks, PlanOverlay, useSupervision } from "./map/supervision"; // U4 – run supervision
import { log } from "../dock/bus";
import { type Scheme } from "./map/flowKit";
import type { Go } from "../nav";
import type { Chain, ChainPage, Lens, MapData, MapProgress, Role } from "./map/types";
import { LENS_ROLES, ROLES, ROLE_RULES } from "./map/types";

const PROGRESS_LABEL: Record<string, string> = {
  idle: "idle", load: "loading graph", graph: "building graph", similarity: "measuring similarity",
  map: "mapping", done: "done", error: "failed",
};
// The run reports phases as strings – the bar's percent follows the phase list.
const PHASES = ["load", "graph", "similarity", "map", "done"];
const EMPTY_PATHS: string[] = [];

// The view owns its own sidebar visibility on phones (390 px): a drawer.
type Tab = "inspect" | "structure" | "pipeline" | "live" | "changes" | "library";
const TABS: { id: Tab; label: string }[] = [
  { id: "inspect", label: "Overview" }, { id: "structure", label: "Structure" }, { id: "pipeline", label: "Pipeline" },
  { id: "live", label: "Agents" }, { id: "changes", label: "Changes" }, { id: "library", label: "Library" },
];

export default function MapView({ block, go }: { openSymbol?: (id: number) => void; version?: number; block?: string; go?: Go }) {
  const [data, setData] = useState<MapData | null>(null);
  const [prog, setProg] = useState<MapProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [selChain, setSelChain] = useState<Chain | null>(null);
  const [selLeaf, setSelLeaf] = useState<number | null>(null);
  const [openRoot, setOpenRoot] = useState<string[]>([]);
  const [roles, setRoles] = useState<Set<Role>>(() => new Set(ROLES));
  const [rolesOpen, setRolesOpen] = useState(false);
  const [side, setSide] = useState(false); // phone drawer
  // The selected block fills the sidebar (the flow canvas selects, not drills);
  // a re-layout key and a pinned selection are the tinker levers.
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  // U2: layers (contract §5 defaults), the Map·Runs·Evals frame, the rail's
  // search + add surfaces, the search camera target and the tidy undo.
  const [layers, setLayers] = useState<Layers>(() => {
    try { return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem("kula.map.layers") ?? "{}") }; } catch { return DEFAULT_LAYERS; }
  });
  useEffect(() => { try { localStorage.setItem("kula.map.layers", JSON.stringify(layers)); } catch { /* private */ } }, [layers]);
  // Picking a chain from a list turns the Chains layer on (contract §5:
  // "Flows and Chains off until picked from a list") – selection is the pick.
  useEffect(() => { if (selChain) setLayers((l) => l.chains ? l : { ...l, chains: true }); }, [selChain]);
  const toggleLayer = useCallback((id: LayerId) => {
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const [frame, setFrame] = useState<Frame>("map");
  // The picked value flow: its hue rings its squares and paints its wires.
  const [flowPick, setFlowPick] = useState<number | null>(null);
  const flowTint = useMemo(() => {
    const f = flowPick != null ? data?.value_flows?.[flowPick] : undefined;
    return f ? { color: flowHue(flowPick!), sections: new Set(f.sections) } : null;
  }, [flowPick, data]);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [reveal, setReveal] = useState<string | null>(null);
  // Tidy snapshot: the persisted drag positions + sizes, kept so one undo
  // puts every card back exactly where it was (PLAN P4: explicit, undoable).
  const [tidyUndo, setTidyUndo] = useState<{ key: string; map: Record<string, { x: number; y: number }>; sizes: Record<string, { w: number; h: number }> } | null>(() => {
    try { return JSON.parse(localStorage.getItem("kula.map.tidyUndo") ?? "null"); } catch { return null; }
  });
  useEffect(() => {
    try { if (tidyUndo) localStorage.setItem("kula.map.tidyUndo", JSON.stringify(tidyUndo)); else localStorage.removeItem("kula.map.tidyUndo"); } catch { /* private */ }
  }, [tidyUndo]);
  const code = useCode();
  const setInspForcedRef = useRef<(v: boolean) => void>(() => {});
  // Workspace: one canvas for code and agents. The sidebar's tabs manage and
  // inform; the canvas holds the code and the pipeline that acts on it.
  const [tab, setTab] = useState<Tab>("inspect");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [scheme, setScheme] = useState<Scheme>(() => { try { return (localStorage.getItem("kula.map.scheme") as Scheme) || "mono"; } catch { return "mono"; } });
  useEffect(() => { try { localStorage.setItem("kula.map.scheme", scheme); } catch { /* private */ } }, [scheme]);
  const [viewSec, setViewSec] = useState<string>("show");
  const ws = useLive(true);
  // U3 – actors on the terrain: the selected agent, its fence, and the R1
  // add form the band and the Fence port "+" both open.
  const [selAgent, setSelAgent] = useState<string | null>(null);
  const [editFence, setEditFence] = useState(false);
  const [agentAdd, setAgentAdd] = useState(false);
  const fence = useAgentFence(ws.info, ws.reload);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pipe = usePipeline("map");
  const runner = useRunner(data, pipe, ws.reload);
  // U4 – run supervision: plan overlay, conflicts, changes, ask gate.
  const sup = useSupervision(data, pipe.steps);
  const waiting = pipe.steps.find((x) => x.status === "waiting");
  const selStep = selBlock?.startsWith("step:") ? selBlock.slice(5) : null;
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewOpen) return;
    const away = (e: PointerEvent) => { if (!viewRef.current?.contains(e.target as Node)) setViewOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    window.addEventListener("pointerdown", away); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [viewOpen]);
  const live = useMapProgress();
  const wasActive = useRef(false);
  useEffect(() => {
    const active = !!live?.running;
    // While a pass runs, pull the partial map now and then; when it ends,
    // pull the finished one – no reload needed.
    if (active || wasActive.current) api.map().then(setData).catch(() => { /* keep what is shown */ });
    wasActive.current = active;
  }, [live?.running, live?.phase]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Live API first. With no map yet, /api/map/progress says whether the map is
  // still running – then the view shows its progress, not an empty state, and
  // polls until it lands. With no API at all (pre-M1) the fixture stands in.
  // The API lists blocks (contract JSON); the view indexes them by id, so
  // key them once – the fixture already has the Record shape.
  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The view hangs everything off a synthetic root keyed by id. If a payload
    // ever ships blocks as a flat list (depth-0 sections carry parent null),
    // rebuild the Record around the same root node the fixture uses.
    const normalize = (d: MapData): MapData => {
      if (!Array.isArray(d.blocks)) return d;
      const root: MapData["blocks"][string] = {
        id: "__root", parent: null, depth: 0, name: "repo", summary: "whole repo",
        kind: "section", symbols: [], children: [], files: 0, cohesion: 1, source: "graph", role: "glue",
      };
      const byId: MapData["blocks"] = { __root: root };
      for (const b of d.blocks) {
        if (b.parent === null && b.depth === 0) { b.parent = "__root"; root.children.push(b.id); }
        byId[b.id] = b;
      }
      return { ...d, blocks: byId };
    };
    const set = (d: MapData) => { if (!dead) setData(normalize(d)); };
    const loadMap = () => api.map().then(set).catch(() => set(fixture));
    const poll = () => {
      api.mapProgress()
        .then((p) => {
          if (dead) return;
          setProg(p);
          if (p.running) timer = setTimeout(poll, 500);
          else loadMap();
        })
        .catch(() => set(fixture)); // no progress endpoint yet – fixture
    };
    api.map()
      .then(set)
      .catch(() => poll());
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  // The deep link arrives as the shell's target.block (the shell owns the
  // hash – the lazy view mounts after its URL sync has run, so reading
  // location.hash here would already be too late). Seed once per new target.
  const [seeded, setSeeded] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (block === seeded) return;
    setSeeded(block);
    setPath(block ? [block] : []);
  }, [block, seeded]);
  // If the fixture is in use, the deep link has to wait for it.
  useEffect(() => {
    if (!data) return;
    if (path.length && !data.blocks[path[0]]) setPath([]);
    if (!openRoot.length) {
      setOpenRoot(Object.values(data.blocks).filter((b) => b.depth === 0).map((b) => b.id));
    }
  }, [data, path, openRoot]);

  const drill = useCallback((id: string) => {
    setPath((p) => {
      // Clicking an open ancestor pops back to it; a new block descends.
      const at = p.indexOf(id);
      const next = at >= 0 ? p.slice(0, at + 1) : [...p, id];
      if (`#map/${next.join("/")}` !== location.hash) history.replaceState(null, "", `#map/${next.join("/")}`);
      return next;
    });
  }, []);
  const home = useCallback(() => { setPath([]); history.replaceState(null, "", "#map"); }, []);

  // Esc steps back out to the flow (unless a field or dialog has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement)?.closest?.("input, textarea, [role=dialog]")) return;
      if (path.length || selChain) { home(); setSelChain(null); }
      else { setSelBlock(null); setInspForcedRef.current(false); } // Esc closes the inspector
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path.length, selChain, home]);

  // The paged chain enumeration the sidebar expands: live API, with the
  // fixture's deterministic stand-in (same paged shape) until M1 lands.
  const loadChains = useCallback((family: string, cursor?: string): Promise<ChainPage> =>
    api.mapChains(family, cursor).catch(() => fixtureChains(family, cursor ?? null)), []);

  const chain: Chain | null = selChain;

  // The block the readout describes: the drilled block, the selected block
  // (the flow canvas selects rather than drills), the chain's entry block,
  // else the repo root.
  const readBlock = useMemo(() => {
    if (!data) return null;
    if (path.length) return data.blocks[path[path.length - 1]] ?? null;
    if (selBlock && data.blocks[selBlock]) return data.blocks[selBlock];
    const root = Object.values(data.blocks).find((b) => b.parent === null);
    if (root) return root;
    if (chain) {
      const leafBlock = [...chain.blocks].reverse().find((b) => data.blocks[b]);
      return leafBlock ? data.blocks[leafBlock] : null;
    }
    return null;
  }, [data, path, chain, selBlock]);

  const selectChain = useCallback((c: Chain) => {
    setSelChain((cur) => (cur?.id === c.id ? null : c));
    setSelLeaf(null);
    setTab("inspect");
    setInspForced(true);
  }, []);

  const selectLeaf = useCallback((id: number) => {
    setSelLeaf(id);
    const l = data?.leaves[id];
    // CodePanel is a shell-level overlay – opening it here keeps the user in
    // MapView (openSymbol would bounce the tab to Graph).
    if (l) code.open({ path: l.path, line: l.line, name: l.name, kind: l.kind as never, id });
  }, [data, code]);

  const toggle = useCallback((id: string) => {
    setOpenRoot((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  }, []);

  const setLens = useCallback((l: Lens) => {
    setRoles(new Set(l === "all" ? ROLES : LENS_ROLES[l]));
  }, []);
  const toggleRole = useCallback((role: Role) => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
        if (next.size === 0) for (const r of ROLES) next.add(r); // never filter to nothing
      } else next.add(role);
      return next;
    });
  }, []);

  const lens: Lens = useMemo(() => {
    const f = LENS_ROLES.functions, u = LENS_ROLES.utilities;
    const has = (arr: Role[]) => arr.every((r) => roles.has(r)) && roles.size === arr.length;
    if (has(f)) return "functions";
    if (has(u)) return "utilities";
    return "all"; // mixed custom set reads as All
  }, [roles]);

  // Tinker: testing code is one toggle off, not a role chip hunt.
  const [hideTests, setHideTests] = useState(false);
  useEffect(() => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (hideTests) next.delete("test"); else next.add("test");
      return next;
    });
  }, [hideTests]);
  // Pinned selection survives a re-render of the canvas (localStorage, wrapped).
  const [pinned, setPinned] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem("kula.map.pin") ?? "null"); } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem("kula.map.pin", JSON.stringify(pinned)); } catch { /* private window */ }
  }, [pinned]);
  // A pin is read back as well as written: on the first load, the stored block
  // fills the sidebar again (silently dropped when the map no longer has it).
  const restored = useRef(false);
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    if (pinned && data.blocks[pinned]) setSelBlock(pinned);
    else if (pinned) setPinned(null);
  }, [data, pinned]);

  const marks = useMarks(data, "review", ws.info, ws.files, dropTarget);
  const sections = useMemo(() => data ? Object.values(data.blocks).filter((b) => b.depth === 0 && b.parent !== null).map((b) => b.id) : [], [data]);
  // U3 · fence focus: the selected agent's fence rings its sections and dims
  // everything else to ≤ 35% (contract §8.5). Fences auto-on when an agent is
  // selected – the ring rides the existing marks, the dim rides the kit's
  // focus path, so no flow-level change.
  const selPaths = selAgent ? fence.fencePaths(selAgent) : EMPTY_PATHS;
  const fenced = useMemo(() => (selAgent ? fencedSectionsOf(data, selPaths) : []), [data, selAgent, selPaths.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const fenceMarks = useMemo(() => {
    if (!fenced.length) return marks;
    const m: Marks = { ...marks };
    for (const id of fenced) m[id] = { ...m[id], fence: true, agent: (selAgent ?? "").slice(0, 1).toUpperCase() };
    return m;
  }, [marks, fenced, selAgent]);
  // The kit dims on focus.chain's truthiness and focus.on's membership, so a
  // U6 – the agent library for the terrain: one row per non-builtin workflow,
  // its fenced section ids from the fence data (empty = whole codebase).
  // Keyed by content: `fence` changes identity every render, and a new array
  // here would re-run the kit's layout on every frame.
  const terrainKey = JSON.stringify(ws.info ? ws.info.workflows.filter((w) => !w.research && !w.builtin)
    .map((w) => ({ name: w.name, sections: fencedSectionsOf(data, fence.fencePaths(w.name)) })) : []);
  const terrainAgents = useMemo(() => JSON.parse(terrainKey) as { name: string; sections: string[] }[], [terrainKey]);
  // fence focus carries a stub chain: the agent's fence is the focused "path".
  const fenceFocus = useMemo((): Focus | null => (selAgent
    ? { chain: { id: "fence" } as unknown as Chain, on: new Set(fenced), sections: new Set(fenced), still: true }
    : null), [fenced, selAgent]);
  // Edit fence on canvas: with the mode armed, a block click adds or removes
  // its section's files from the fence and the hull redraws (PLAN P4.3).
  useEffect(() => {
    if (!editFence || !selAgent || !selBlock || selBlock.startsWith("step:") || !data) return;
    const sec = sectionOf(data, selBlock) ?? selBlock;
    const files = filesOf(data, sec);
    if (!files.length) return;
    if (fenced.includes(sec)) void fence.dropPaths(selAgent, files); else void fence.addPaths(selAgent, files);
    setSelBlock(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFence, selBlock, selAgent, data, fenced]);
  const openAgentAdd = useCallback(() => { setAgentAdd(true); setInspForced(true); }, []);
  const createAgent = useCallback((wf: Workflow) => {
    api.agentAction("workflows_save", { workflows: [...(ws.info?.workflows ?? []).filter((w) => !w.builtin), wf] })
      .catch(() => { /* the editor shows the server's state */ })
      .then(() => { stashNewItem("agent", wf.name); ws.reload(); setAgentAdd(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.info, ws.reload]);
  const dropOnAgent = useCallback((agent: string, item: import("./map/pipeline").Item | null) => {
    if (!data || !item) return;
    // A palette block's ref is the block (or section) it acts on; a step's
    // section rides the payload's section field when the step has one.
    const sec = data.blocks[item.ref] ? sectionOf(data, item.ref) ?? item.ref : null;
    if (!sec) return;
    void fence.addPaths(agent, filesOf(data, sec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fence]);
  // A palette click adds the block on the selected section (or at the end).
  // The section a click-added block lands on: the last section selected (a
  // selected block stays the target while the new blocks take the selection).
  const [lastSec, setLastSec] = useState<string | null>(null);
  useEffect(() => { if (data && selBlock && !selStep && data.blocks[selBlock]) setLastSec(sectionOf(data, selBlock) ?? selBlock); }, [data, selBlock, selStep]);
  // Where the next block goes: after a block (the "+" on a wire or a stub, a
  // wire dropped on empty canvas), else at the end on the last section.
  const [insert, setInsert] = useState<{ after: string | null; pos?: { x: number; y: number } } | null>(null);
  const openPanel = useCallback((after: string | null = null, pos?: { x: number; y: number }) => { setInsert({ after, pos }); setPanel(true); }, []);
  const pick = (it: Item) => {
    const at = insert?.after ? pipe.steps.findIndex((x) => x.id === insert.after) + 1 : undefined;
    const id = pipe.add(it, it.kind === "agent" || it.kind === "crew" ? lastSec : null, at && at > 0 ? at : undefined, it.kind === "note" ? insert?.pos : undefined);
    setInsert(null);
    setPanel(false); // n8n closes the panel once a node is in
    setSelBlock(`step:${id}`); setTab("pipeline");
  };
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!data || !isItemDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const sec = sectionAtPoint(data, e.clientX, e.clientY);
    if (sec !== dropTarget) setDropTarget(sec);
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    if (!data) return;
    const it = droppedItem(e);
    const sec = sectionAtPoint(data, e.clientX, e.clientY);
    setDropTarget(null);
    if (!it) return;
    e.preventDefault();
    const id = pipe.add(it, sec);
    setSelBlock(`step:${id}`); setTab("pipeline");
  };
  const [ndv, setNdv] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; id: string | null; flow: { x: number; y: number } } | null>(null);
  const select = (id: string | null) => setSelBlock(id ? `step:${id}` : null);
  const addSticky = (pos?: { x: number; y: number }) => { const id = pipe.add(FLOW[1], null, undefined, pos); select(id); setTab("pipeline"); };
  // U2 – tidy, explicit and undoable: snapshot the persisted drags and sizes,
  // clear them, and let the kit re-lay out on the bumped layout key. The undo
  // writes the snapshot back and bumps again – no re-fit beyond the kit's own.
  // The storage keys mirror flow/positions.ts (v1, ns "map", kit layoutKey
  // `map-<depth>-<layoutKey>-<focus>`); flow/* itself is not edited.
  const kitKey = `map-2-${layoutKey}-${selChain ? `f${selChain.id}` : "n"}`;
  const tidy = useCallback(() => {
    const posKey = `kula.flow.pos.v1.map.${kitKey}`;
    const sizeKey = `kula.flow.size.v1.map.${kitKey}`;
    let map: Record<string, { x: number; y: number }> = {};
    let sizes: Record<string, { w: number; h: number }> = {};
    try { map = JSON.parse(localStorage.getItem(posKey) ?? "{}"); sizes = JSON.parse(localStorage.getItem(sizeKey) ?? "{}"); } catch { /* private */ }
    if (Object.keys(map).length || Object.keys(sizes).length) setTidyUndo({ key: posKey, map, sizes });
    else setTidyUndo(null);
    clearPersisted("map", kitKey);
    setLayoutKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitKey]);
  const undoTidy = useCallback(() => {
    if (!tidyUndo) return;
    // Write the snapshot back under the key the kit will read AFTER this
    // undo's layout bump – the bump moves the kit on to layoutKey + 1.
    const nextKey = `map-2-${layoutKey + 1}-${selChain ? `f${selChain.id}` : "n"}`;
    try {
      localStorage.setItem(`kula.flow.pos.v1.map.${nextKey}`, JSON.stringify(tidyUndo.map));
      const sizeKey = `kula.flow.size.v1.map.${nextKey}`;
      if (Object.keys(tidyUndo.sizes).length) localStorage.setItem(sizeKey, JSON.stringify(tidyUndo.sizes));
    } catch { /* private */ }
    setTidyUndo(null);
    setLayoutKey((k) => k + 1);
  }, [tidyUndo, layoutKey, selChain]);
  // U2 – search moves the camera, never re-lays-out: the hit's symbol resolves
  // to the block that owns it, the block is selected and the kit's reveal pans
  // to it. No position is written, so B8 stays 0.
  const searchGo = useCallback(async () => {
    const s = q.trim();
    if (!s || !data) return;
    try {
      const hits = await api.search(s);
      const hit = hits[0];
      if (!hit) { setSearchOpen(false); return; }
      let blockId: string | null = null;
      for (const b of Object.values(data.blocks)) {
        if (b.symbols.includes(hit.id)) { blockId = b.id; break; }
        if (!blockId && (b.name === hit.path || b.theme === hit.name)) blockId = blockId ?? b.id;
      }
      if (!blockId) {
        // Last resort: the hit's directory against block names (paths often
        // name their block).
        const dir = hit.path.split("/").slice(0, -1).join("/");
        for (const b of Object.values(data.blocks)) if (b.name.includes(dir) || hit.path.includes(b.name)) { blockId = b.id; break; }
      }
      if (!blockId) { setSearchOpen(false); return; }
      setSelBlock(blockId);
      setReveal(blockId);
      setInspForced(true);
      setSearchOpen(false);
      setQ("");
    } catch { /* offline – the input stays open */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data]);
  const removeStep = (id: string) => { pipe.remove(id); setSelBlock((b) => (b === `step:${id}` ? null : b)); };
  const toggleStep = (id: string) => { const st = pipe.steps.find((x) => x.id === id); if (st) pipe.update(id, { disabled: !st.disabled }); };
  const rename = () => { setTab("pipeline"); window.setTimeout(() => { const el = document.querySelector<HTMLInputElement>("[data-testid=pl-name]"); el?.focus(); el?.select(); }, 60); };
  // n8n's canvas keys (docs.n8n.io/build/keyboard-shortcuts): N or Tab opens
  // the node panel, Shift+S a sticky, D deactivates, Del deletes, F2 renames,
  // ⌘C/⌘V copy and paste, ⌘Z/⇧⌘Z undo and redo, ⌘↵ runs.
  const keys = (key: string, ev: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, onCanvas: boolean): boolean => {
    const mod = ev.metaKey || ev.ctrlKey;
    const cur = selStep;
    if (mod && key === "Enter") { void runner.run(); return true; }
    // An IDE's run keys: F5 run, ⇧F5 stop, F8 pause/continue, F10 step.
    if (key === "F5") { if (ev.shiftKey) runner.stop(); else if (!runner.running) void runner.run(); return true; }
    if (key === "F8") { if (runner.running) runner.togglePause(); else void runner.run(); return true; }
    if (key === "F10") { runner.step(); return true; }
    if (mod && key.toLowerCase() === "z") { if (ev.shiftKey) pipe.redo(); else if (tidyUndo) undoTidy(); else pipe.undo(); return true; }
    if (mod && key.toLowerCase() === "c" && cur && !window.getSelection()?.toString()) return pipe.copy(cur);
    if (mod && key.toLowerCase() === "v") { const id = pipe.paste(cur); if (id) select(id); return !!id; }
    if (mod && key.toLowerCase() === "d" && cur) { select(pipe.duplicate(cur)); return true; }
    if (mod || ev.altKey || !onCanvas) return false;

    if (key === "S" && ev.shiftKey) { addSticky(); return true; }
    if (!cur) return false;
    if (key === "d" || key === "D") { toggleStep(cur); return true; }
    if (key === "Delete" || key === "Backspace") { removeStep(cur); return true; }
    if (key === "F2") { rename(); return true; }
    if (key === "Enter") { setNdv(cur); return true; }
    return false;
  };
  const keysRef = useRef(keys);
  keysRef.current = keys;
  // The keys closure reads tidyUndo through keysRef, but the effect's deps
  // need the guard too, so re-binding on tidyUndo keeps ⌘Z undo-current.
  useEffect(() => { keysRef.current = keys; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [role=dialog], .fc-canvas")) return; // the canvas routes its own keys
      // From the page itself only – keyboard focus order elsewhere stays intact.
      const onPage = e.target === document.body;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void runner.run(); return; }
      if (onPage && keysRef.current(e.key, e, true)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runner]);
  useEffect(() => { if (selStep) setTab("pipeline"); }, [selStep]);
  const onStepTool = useCallback((id: string, a: "done" | "remove" | "run" | "toggle" | "insert" | "open") => {
    if (a === "done") runner.markDone(id);
    else if (a === "run") void runner.run(id);
    else if (a === "toggle") toggleStep(id);
    else if (a === "insert") openPanel(id);
    else if (a === "open") setNdv(id);
    else removeStep(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, pipe]);
  const canvas = useMemo(() => ({
    onKey: (key: string, _sel: string | null, ev: React.KeyboardEvent) => keysRef.current(key, ev, true),
    onStub: (id: string) => { if (id.startsWith("step:")) openPanel(id.slice(5)); },
    onConnect: (source: string, target: string) => {
      if (!source.startsWith("step:") || !data) return;
      const sid = source.slice(5);
      if (target.startsWith("step:")) return; // order is the lane; wires between blocks follow it
      const sec = data.blocks[target] ? sectionOf(data, target) ?? target : null;
      if (sec) { pipe.update(sid, { section: sec }); select(sid); log("map", `${pipe.steps.find((x) => x.id === sid)?.name ?? "block"} now acts on ${data.blocks[sec]?.theme || data.blocks[sec]?.name}`); }
    },
    onConnectToPane: (source: string, pos: { x: number; y: number }) => { if (source.startsWith("step:")) openPanel(source.slice(5), pos); },
    onContextMenu: (id: string | null, at: { x: number; y: number }, flow: { x: number; y: number }) => setMenu({ at, id, flow }),
    onMoved: (id: string, pos: { x: number; y: number }) => { if (id.startsWith("step:") && pipe.steps.find((x) => x.id === id.slice(5))?.kind === "note") pipe.patch(id.slice(5), { pos }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, pipe, openPanel]);
  const menuItems = (m: NonNullable<typeof menu>): MenuItem[] => {
    const st = m.id?.startsWith("step:") ? pipe.steps.find((x) => x.id === m.id!.slice(5)) : null;
    if (st) return [
      { label: "Open", key: "↵", run: () => setNdv(st.id), testid: "cm-open" },
      ...(st.kind !== "note" ? [{ label: "Run from here", run: () => void runner.run(st.id), disabled: runner.running, testid: "cm-run" }] : []),
      ...(st.status === "waiting" ? [{ label: "Mark done", run: () => runner.markDone(st.id) }] : []),
      { label: "Rename", key: "F2", run: () => { select(st.id); rename(); } },
      { label: st.disabled ? "Activate" : "Deactivate", key: "D", run: () => toggleStep(st.id), testid: "cm-toggle" },
      { label: "Duplicate", key: "⌘D", run: () => select(pipe.duplicate(st.id)), testid: "cm-dup" },
      { label: "Copy", key: "⌘C", run: () => pipe.copy(st.id) },
      { label: "Insert after", key: "N", run: () => openPanel(st.id) },
      { sep: true, label: "", run: () => {} },
      { label: "Delete", key: "Del", danger: true, run: () => removeStep(st.id), testid: "cm-delete" },
    ];
    const secId = m.id && data?.blocks[m.id] ? sectionOf(data, m.id) ?? m.id : null;
    return [
      ...(secId ? [{ label: "Add an agent here", run: () => { setLastSec(secId); setPanel(true); setInsert(null); } }] : []),
      { label: "Add sticky note", key: "⇧S", run: () => addSticky(m.flow), testid: "cm-sticky" },
      { label: "Paste", key: "⌘V", run: () => { const id = pipe.paste(); if (id) select(id); } },
      { sep: true, label: "", run: () => {} },
      { label: runner.running ? "Stop run" : "Run pipeline", key: "⌘↵", run: () => (runner.running ? runner.stop() : void runner.run()) },
      { label: "Undo", key: "⌘Z", run: pipe.undo },
      { label: "Redo", key: "⇧⌘Z", run: pipe.redo },
    ];
  };
  // Inspector: closed until a click (a node, a chain) or a HUD button opens it.
  const [inspForced, setInspForced] = useState(false);
  setInspForcedRef.current = setInspForced;
  const insp = inspForced || !!selBlock || !!selChain || path.length > 0;
  const openInsp = (t: Tab) => { setTab(t); setInspForced(true); };
  const closeInsp = () => { setInspForced(false); setSelBlock(null); setSelChain(null); if (path.length) home(); };
  useEffect(() => { if (selBlock && !selStep && tab !== "inspect" && tab !== "structure") setTab("inspect"); // a node click shows the node
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBlock]);
  const inspHead = useMemo(() => {
    const st = selStep ? pipe.steps.find((x) => x.id === selStep) : null;
    if (st) return {
      kind: <><span className="np-ico sm" style={{ color: KIND_COLOR[st.kind] }}><KindIco kind={st.kind} /></span>{st.kind} block</>,
      title: st.name, sub: st.section && data ? `on ${data.blocks[st.section]?.theme || data.blocks[st.section]?.name}` : st.ref,
      facts: [[`#${runnable(pipe.steps).indexOf(st) + 1}`, "in the pipeline"], ...(st.ms != null ? [[`${(st.ms / 1000).toFixed(1)}s`, "last run"]] : [])] as [string, string][],
      actions: [
        <button key="r" className="btn sm" onClick={() => void runner.run(st.id)} disabled={runner.running}><Icon.play /> Run from here</button>,
        <button key="o" className="btn sm" onClick={() => setNdv(st.id)}><Icon.arrow /> Details</button>,
        <button key="d" className="btn sm" onClick={() => toggleStep(st.id)}><Icon.lock /> {st.disabled ? "Activate" : "Deactivate"}</button>,
      ],
    };
    const b = readBlock && readBlock.parent !== null ? readBlock : null;
    if (b && data) {
      const sec = sectionOf(data, b.id) ?? b.id;
      const mk = marks[sec];
      return {
        kind: <><RoleMark role={b.role} />{b.depth === 0 ? "section" : "block"} · {b.role}</>,
        title: b.theme || b.name, sub: b.theme ? b.name : b.summary,
        facts: [[String(b.files), b.files === 1 ? "file" : "files"], [String(countSyms(data, b.id)), "functions"], ...(mk?.changed ? [[String(mk.changed), "changed"]] : []), ...(mk?.fence ? [["fenced", "by the task"]] : [])] as [string, string][],
        actions: [
          <button key="a" className="btn sm" onClick={() => { setLastSec(sec); openPanel(null); }} data-testid="insp-add-agent"><Icon.agents /> Add agent here</button>,
          <button key="p" className={`btn sm${pinned === b.id ? " on" : ""}`} onClick={() => setPinned((p) => (p === b.id ? null : b.id))}><Icon.target /> {pinned === b.id ? "Pinned" : "Pin"}</button>,
        ],
      };
    }
    if (selChain && data) return { kind: <>chain</>, title: `${data.leaves[selChain.source]?.name} → ${data.leaves[selChain.terminal]?.name}`, sub: `${selChain.len} steps`, facts: [] as [string, string][], actions: [] };
    return { kind: <>workspace</>, title: "Map", sub: `${sections.length} sections · ${Object.keys(data?.blocks ?? {}).length} blocks`, facts: [] as [string, string][], actions: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStep, pipe.steps, readBlock, selChain, data, marks, pinned, runner.running, sections]);
  const chainCard = !selChain || !data ? null : (
              <div className="fm-chain-card" data-testid="map-chain-card">
                <div className="fm-chain-card-head">
                  <span className="sy-section-label">chain</span>
                  <button className="tab-btn sy-lens-btn" data-testid="map-focus-chain" aria-pressed={!!selChain} title="dim everything this chain does not cross"
                    onClick={() => setSelChain(null)}>unfocus</button>
                </div>
                <p className="sy-summary">{data.leaves[selChain.source]?.name} → {data.leaves[selChain.terminal]?.name} · {selChain.len} steps</p>
                <SubwayStrip data={data} chain={selChain} onStep={(s) => typeof s === "number" ? selectLeaf(s) : undefined} />
              </div>
            
  );
  const ndvStep = ndv ? pipe.steps.find((x) => x.id === ndv) ?? null : null;
  const ndvPrev = ndvStep ? (() => { const r = runnable(pipe.steps); const i = r.findIndex((x) => x.id === ndvStep.id); return i > 0 ? r[i - 1] : null; })() : null;

  if (!data) {
    if (prog?.running) {
      // The map is running – its progress, never an empty state.
      const at = PHASES.indexOf(prog.phase);
      const pct = at >= 0 ? Math.round(((at + 1) / PHASES.length) * 100) : 0;
      return (
        <div className="sy-root" data-testid="map-view">
          <ProgressStrip p={prog} />
          <div className="sy-progress" data-testid="map-progress" aria-live="polite">
            <h2>mapping</h2>
            <div className="sy-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="sy-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <table className="sy-t" data-testid="map-progress-table">
              <tbody>
                <tr><th>phase</th><td>{PROGRESS_LABEL[prog.phase] ?? prog.phase}</td></tr>
                <tr><th>blocks</th><td>{prog.blocks}</td></tr>
                <tr><th>chains</th><td>{prog.chains}</td></tr>
                <tr><th>elapsed</th><td>{(prog.ms / 1000).toFixed(1)}s</td></tr>
              </tbody>
            </table>
            <p className="sy-summary">the graph is usable – the map finishes in the background</p>
          </div>
        </div>
      );
    }
    return <div className="sy-root"><div className="view-loading" aria-live="polite">{err ?? "loading map…"}</div></div>;
  }


  // Layers off → marks hidden, never navigated (contract §5): a root class
  // carries each off state into the CSS; the chain focus is gated here so a
  // Chains-off toggle simply stops showing focus, not a navigation.
  const layerCls = (["blocks", "flows", "chains", "fences", "agents", "runs"] as LayerId[])
    .filter((l) => !layers[l]).map((l) => `u2-l-${l}-off`).join(" ");
  return (
    <div className={`sy-root${layerCls ? ` ${layerCls}` : ""}`} ref={rootRef} data-testid="map-view">
      {/* One canvas (R0): no lens switcher, no View menu, no Add block button.
          The leftover "re-layout · pin · roles · Role" toolbar row is gone –
          tidy lives in the canvas zoom controls, pin on the node toolbar and
          in the inspector, roles opens from the canvas HUD. */}
      {/* U2: centred Map · Runs · Evals switch – the segments re-frame the
          same canvas, they are not new views. */}
      <FrameSwitch frame={frame} onFrame={(f) => { setFrame(f); if (f === "runs") openInsp("pipeline"); }}
        counts={{
          runs: runner.runs.length ? `${runner.runs.length}` : undefined,
          agents: ws.info ? `${ws.info.workflows.filter((w) => !w.research && !w.builtin).length + ws.info.teams.length}` : undefined,
        }}
        agentsOn={layers.agents} onAgents={() => toggleLayer("agents")} />
      {frame === "evals" && <EvalsBoard onRuns={() => { setFrame("runs"); openInsp("pipeline"); }} />}
      {/* U2: the bottom-left chrome stack – layer toggle, tidy strip, then the
          canvas zoom bar (fit · in · out · minimap) below them. */}
      <div className="u2-hud-bl">
        <LayerBar layers={layers} onToggle={toggleLayer} />
        <TidyStrip onTidy={tidy} canUndo={!!tidyUndo} onUndo={undoTidy} />
      </div>
      {/* U2: the right rail – add, search, note, panel. With the inspector
          open it docks beside it like the Roles HUD, so both stay reachable. */}
      <MapRail
        onAdd={() => setAddOpen(true)}
        onSearch={() => setSearchOpen((s) => !s)}
        onNote={() => addSticky()}
        onPanel={() => openInsp("pipeline")}
        search={searchOpen && (
          // U9 – the rail search gains the "Ask in plain words" question mode
          // (mount-only glue; the plain path keeps searchGo exactly as it was).
          <RailSearch value={q} onChange={setQ} onSubmit={() => void searchGo()}
            onPick={(id) => { setSelBlock(id); setReveal(id); setSearchOpen(false); setQ(""); }} />
        )}
      />
      {addOpen && ws.info && (
        <div className="u2-add-pop" data-testid="u2-add-pop">
          <AddForm kind="agent" info={ws.info}
            onCreate={(wf: Workflow) => { stashNewItem("agent", wf.name); setAddOpen(false); }}
            onCancel={() => setAddOpen(false)} />
        </div>
      )}
      {live?.running && <ProgressStrip p={live} />}
      {/* U3 – the actor band on top (contract §1): one row, 144px, never wraps. */}
      <ActorBand info={ws.info} selected={selAgent}
        onSelect={(name) => { setSelAgent(name); setEditFence(false); if (name) setInspForced(true); }}
        fencePaths={fence.fencePaths} editFence={editFence} onEditFence={setEditFence}
        onDropBlock={dropOnAgent} onAdd={openAgentAdd} />
      {rolesOpen && (
        <div className="sy-roles" id="map-role-filter" data-testid="map-role-filter" role="group" aria-label="Role filter">
          {/* R0 – the lens presets live with the role filter now (no View menu). */}
          <div className="sy-roles-presets">
            {(["functions", "utilities", "all"] as const).map((l) => (
              <button key={l} className={`tab-btn sy-lens-btn${lens === l ? " on" : ""}`} data-testid={`map-lens-${l}`} aria-pressed={lens === l}
                onClick={() => { setLens(l); setRolesOpen(false); }}>{l}</button>
            ))}
          </div>
          {ROLES.map((role) => (
            <label key={role} className="sy-role-row" title={ROLE_RULES[role]}>
              <input type="checkbox" checked={roles.has(role)} onChange={() => toggleRole(role)} data-testid={`map-role-${role}`} />
              <span className="mono sy-role-name">{role}</span>
              <span className="sy-role-rule">{ROLE_RULES[role]}</span>
            </label>
          ))}
        </div>
      )}
      <div className="sy-split" style={listWidth("map", 360)}>
        {path.length
          ? <BlockCanvas blocks={data.blocks} leaves={data.leaves} loops={data.loops} roles={roles} chain={chain} path={path} onDrill={drill} onLeaf={selectLeaf} onHome={home} />
          : <div className="ws-drop" ref={canvasWrapRef} onDragOver={onCanvasDragOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropTarget(null); }} onDrop={onCanvasDrop}><FlowKitView agents={terrainAgents} agentsOn={layers.agents} flowTint={flowTint} marks={fenceMarks} steps={pipe.steps} onStepTool={onStepTool} scheme={scheme} canvas={canvas} data={data} roles={roles} focus={fenceFocus ?? (layers.chains && chain ? focusOf(data, chain) : null)} selection={selBlock} onSelect={setSelBlock} onDrill={(id) => { setSelBlock(id); setInspForced(true); }} onLeaf={selectLeaf} onClearFocus={() => { setSelChain(null); }} layoutKey={layoutKey}
            reveal={reveal}
            pinned={pinned && !selStep ? pinned : null}
            onNodeTool={(id, action) => {
              if (action === "open") { drill(id); setSelBlock(id); setInspForced(true); }
              else if (action === "run") void runner.run(id); // not a step id → the whole pipeline
              else setPinned((p) => (p === id ? null : id));
            }} />
            <NodePanel info={ws.info} open={panel} onClose={() => { setPanel(false); setInsert(null); }} onPick={pick}
              hint={insert?.after ? `Insert after ${pipe.steps.find((x) => x.id === insert.after)?.name ?? "block"}` : lastSec ? `Add on ${data.blocks[lastSec]?.theme || data.blocks[lastSec]?.name}` : "Add a block"} />
            {menu && <ContextMenu at={menu.at} items={menuItems(menu)} onClose={() => setMenu(null)} />}
            {ndvStep && <StepDetails data={data} s={ndvStep} pipe={pipe} runner={runner} sections={sections} prev={ndvPrev} onClose={() => setNdv(null)} sup={sup} />}
            <Transport runner={runner} steps={runnable(pipe.steps)} waiting={waiting ? { id: waiting.id, name: waiting.name } : null} last={runner.runs[0] ?? null} sel={selStep} onPick={(id) => (sup.planActive ? sup.toggleStrike(id) : setSelBlock(`step:${id}`))} onOpen={(id) => { setSelBlock(`step:${id}`); setNdv(id); }} sup={sup} />
            {/* U3 – the fence hull around the selected agent's sections (§8.5). */}
            <FenceHull canvas={canvasWrapRef} fencedIds={fenced} agent={selAgent} />
            {/* U7 – journey steps over the map; onPickStep pans the camera via the kit's reveal. */}
            {flowPick != null && <JourneyStrip data={data} flowPick={flowPick} onPickStep={(id) => { setSelBlock(id); setReveal(id); }} onClose={() => setFlowPick(null)} />}
            {/* U4 – run supervision: plan overlay (read outline / write tint /
                strike to exclude), in-place conflict marks and +/− change
                badges on the sections, ask gate docked above the transport. */}
            <PlanOverlay sup={sup} canvas={canvasWrapRef} />
            <ConflictMarks sup={sup} canvas={canvasWrapRef} onOpen={(id) => setNdv(id)} />
            <ChangeBadges sup={sup} canvas={canvasWrapRef} onOpen={(id) => setNdv(id)} />
            <AskGate sup={sup} />
          </div>}

        {/* The canvas is everything until a click: then Graph's inspector – a
            floating panel with a header (kind, name, facts, actions) and sub-tabs. */}
        {!insp && (
          <div className="map-hud" data-testid="map-hud">
            <button className={`btn sm${rolesOpen ? " on" : ""}`} data-testid="map-roles-btn" aria-expanded={rolesOpen} aria-controls="map-role-filter"
              onClick={() => setRolesOpen((o) => !o)}>Roles</button>
            <button className="btn sm" onClick={() => openInsp("pipeline")} data-testid="hud-pipeline"><Icon.flows /> Pipeline{pipe.steps.length ? <b>{runnable(pipe.steps).length}</b> : null}</button>
            <button className="btn sm" onClick={() => openInsp("live")} data-testid="hud-live"><Icon.agents /> Agents{(ws.info?.task || ws.info?.team) && <i className="hud-dot" />}</button>
            <button className="btn sm" onClick={() => openInsp("changes")} data-testid="hud-changes"><Icon.changes /> Changes{ws.files.length ? <b>{ws.files.length}</b> : null}</button>
            <button className="btn sm" onClick={() => openInsp("structure")} data-testid="map-side-toggle"><Icon.sidebar /> Structure</button>
          </div>
        )}
        {/* U7 – the key is always on the map (X5 §2, critic blocking): with
            the inspector closed it docks at the right edge so landing #map
            still shows it – no click to know the key exists. */}
        {!insp && (
          <div className="u7-key-dock" data-testid="map-key-dock">
            <Legend data={data} ringHue={flowPick != null ? flowHue(flowPick) : null} />
          </div>
        )}
        {/* With the inspector open the other HUD buttons would hide behind it
            (the inspector covers the top-right), but Roles must stay reachable
            – the lens presets and role filter live in its popover. It docks to
            the left of the inspector instead of vanishing. */}
        {insp && (
          <div className="map-hud map-hud-side" data-testid="map-hud">
            <button className={`btn sm${rolesOpen ? " on" : ""}`} data-testid="map-roles-btn" aria-expanded={rolesOpen} aria-controls="map-role-filter"
              onClick={() => setRolesOpen((o) => !o)}>Roles</button>
          </div>
        )}
        {/* The add-block palette shares the inspector's corner – while it is
            open it rides above (n8n slides its panel over the canvas), so the
            inspector steps aside until the pick lands. */}
        {insp && (
        <aside className="inspector map-insp" id="map-sidebar" aria-label="Map inspector" data-testid="map-inspector"
          style={panel ? { zIndex: 24 } : undefined}>
          <Grip id="inspector" edge="left" min={300} max={960} label="Resize inspector" />
          {/* U7 – the key: always available at the top of the right column. */}
          <Legend data={data} ringHue={flowPick != null ? flowHue(flowPick) : null} />
          {/* U9 – the reading layer: run control, progress, code-names toggle. */}
          <PlainPanel agents={ws.info?.workflows.filter((w) => !w.builtin).map((w) => w.name)} />
          <header>            <div className="row">
              <div className="kind">{inspHead.kind}</div>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={closeInsp} aria-label="Close" title="Close  esc"><Icon.close /></button>
            </div>
            <h2>{inspHead.title}</h2>
            {inspHead.sub && <div className="muted mono" style={{ fontSize: 11.5 }}>{inspHead.sub}</div>}
            {inspHead.facts.length > 0 && <div className="insp-facts">{inspHead.facts.map((f, i) => <span key={i}><b>{f[0]}</b> {f[1]}</span>)}</div>}
            {inspHead.actions.length > 0 && <div className="insp-actions">{inspHead.actions}</div>}
          </header>
          <div className="tabs" role="tablist" aria-label="Inspector" data-testid="ws-tabs">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} data-testid={`ws-tab-${t.id}`} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "pipeline" && pipe.steps.length > 0 && <span className="ws-tab-n">{pipe.steps.length}</span>}
                {t.id === "live" && (ws.info?.task || ws.info?.team) && <span className="ws-tab-dot" />}
                {t.id === "changes" && ws.files.length > 0 && <span className="ws-tab-n">{ws.files.length}</span>}
              </button>
            ))}
          </div>
          <div className="body">
          {selAgent && ws.info && (
            <AgentInspector info={ws.info} agent={selAgent} data={data} onSaved={ws.reload}
              onFocusBlock={(id) => { setSelBlock(id); setInspForced(true); }}
              focusModel={!!ws.info && !ws.info.connections.some((c) => (c.mcp || c.hook) && c.workflows.includes(selAgent))} />
          )}
          {agentAdd && ws.info && <AddForm kind="agent" info={ws.info} onCreate={createAgent} onCancel={() => setAgentAdd(false)} />}
          {tab === "pipeline" && <PipelinePanel data={data} pipe={pipe} runner={runner} sel={selStep} onSel={(id) => setSelBlock(id ? `step:${id}` : null)} sections={sections} onOpen={setNdv} onAdd={() => openPanel(insert?.after ?? null)} />}
          {tab === "live" && <><RunPanel data={data} info={ws.info} onChanged={ws.reload} onSection={(id) => setSelBlock(id)} /><Executions runner={runner} /></>}
          {tab === "changes" && <ReviewPanel data={data} files={ws.files} onSection={(id) => setSelBlock(id)} onFile={(p) => code.open({ path: p, name: p.split("/").pop() })} />}
          {tab === "library" && <Library info={ws.info} go={go} onPick={pick} />}
          {tab === "inspect" && <>
            {chainCard}
            {/* U7 – Journeys: the flows list in the right column (the strip walks the camera). */}
            <JourneysPanel data={data} active={flowPick} onFlow={setFlowPick}
              onSection={(id) => { setSelBlock(id); setInspForced(true); }} />
            {<Readout data={data} block={readBlock} onLeaf={selectLeaf} onFamily={(famId) => { loadChains(famId).then((p) => { const c = p.chains[0]; if (c) selectChain(c); }).catch(() => { /* no chains pageable */ }); }} />}
          </>}
          {tab === "structure" && chainCard}
          {tab === "structure" && (
            <MapViewSidebar
              blocks={data.blocks} families={data.families} leaves={data.leaves} roles={roles}
              selChain={selChain?.id ?? null} selLeaf={selLeaf} openRoot={openRoot}
              loadChains={loadChains}
              onChain={selectChain} onLeaf={selectLeaf} onToggle={toggle} onZoom={drill}
              onClose={closeInsp}
            />
          )}
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

/** The run transport, after sema's time bar: docked under the canvas, one
    row of controls – run / pause-continue / step / re-run failed / stop, the
    clock as elapsed over expected, where the run is – and under it the run as
    a timeline. Each pipeline block is a segment sized by how long it took last
    time and filled by its state; the block in flight is the lit region, the
    way sema shades the window on its recording strip. Click a segment to open
    that block. */
function Transport({ runner, steps, waiting, last, sel, onPick, onOpen, sup }: { runner: ReturnType<typeof useRunner>; steps: Step[]; waiting: { id: string; name: string } | null; last: { status: string; ms: number } | null; sel: string | null; onPick: (id: string) => void; onOpen: (id: string) => void; sup: ReturnType<typeof useSupervision> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!runner.running) return; const t = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(t); }, [runner.running]);
  const blocks = steps.length;
  const el = runner.cursor ? now - runner.cursor.t0 : 0;
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const state = runner.running ? (runner.paused ? "paused" : waiting ? "waiting" : "running") : last ? last.status : "idle";
  // Segment widths: last run's time per block, an even share where unknown.
  const known = steps.map((s) => s.ms ?? 0);
  const fallback = Math.max(1, known.filter(Boolean).reduce((a, b) => a + b, 0) / Math.max(1, known.filter(Boolean).length));
  const span = known.map((ms) => Math.max(ms || fallback, fallback * 0.25));
  const total = span.reduce((a, b) => a + b, 0) || 1;
  const expected = last?.ms ?? 0;
  const label = runner.running
    ? `${runner.paused ? "Paused" : waiting ? "Waiting" : "Running"} ${runner.cursor ? `${runner.cursor.at}/${runner.cursor.of}` : ""}`
    : last ? `${last.status[0].toUpperCase()}${last.status.slice(1)}` : blocks ? "Ready" : "Pipeline empty";
  return (
    <div className={`tp tp-${state}`} data-testid="ws-runbar">
      <div className="tp-row" role="toolbar" aria-label="Run">
        {!runner.running
          ? <button className="tp-btn tp-go" onClick={() => void runner.run()} data-testid="ws-run-btn" title="Run pipeline  ⌘↵" disabled={!blocks}><Icon.play /><span>Run</span></button>
          : <button className="tp-btn" onClick={runner.togglePause} data-testid="ws-pause" title={runner.paused ? "Continue  F8" : "Pause before the next block  F8"} aria-pressed={runner.paused}>{runner.paused ? <Icon.play /> : <Icon.pause />}</button>}
        {/* U4 – the dry run: build the plan overlay before committing to a run. */}
        <button className={`tp-btn${sup.planActive ? " tp-plan-on" : ""}`} onClick={() => (sup.planActive ? sup.cancelPlan() : sup.dryRun())} data-testid="u4-dry-run" title="Dry-run – plan what this pipeline would touch" disabled={!blocks && !sup.planActive} aria-pressed={sup.planActive}><Icon.target />{sup.planActive ? <span>Planning</span> : null}</button>
        <button className="tp-btn" onClick={() => runner.step()} data-testid="ws-step" title="Step – run the next block, then pause  F10" disabled={!blocks || (runner.running && !runner.paused)}><Icon.stepOver /></button>
        {!runner.running && runner.failedAt && <button className="tp-btn" onClick={runner.rerunFailed} data-testid="ws-rerun" title="Re-run from the failed block"><Icon.rerun /></button>}
        {runner.running && <button className="tp-btn tp-stop" onClick={runner.stop} data-testid="ws-stop" title="Stop  ⇧F5"><Icon.stop /></button>}
        <span className="tp-clock mono">{runner.running ? clock(el) : last ? clock(last.ms) : "0:00"}{expected > 0 && runner.running ? ` / ${clock(expected)}` : ""}</span>
        <span className="tp-dot" />
        <span className="tp-state" data-testid="ws-run-state">{label}</span>
        {runner.running && waiting && <button className="tp-done" onClick={() => runner.markDone(waiting.id)} data-testid="ws-done" title="The agent finished – hand on to the next block">{waiting.name}: done</button>}
        <span className="tp-ctx mono">Pipeline · {blocks} {blocks === 1 ? "block" : "blocks"}{runner.runs.length ? ` · ${runner.runs.length} ${runner.runs.length === 1 ? "run" : "runs"}` : ""}</span>
      </div>
      {blocks > 0 && (
        <div className="tp-strip" role="list" aria-label="Run timeline" data-testid="ws-timeline">
          {steps.map((s, i) => {
            const st = s.status ?? "idle";
            const live = runner.running && runner.cursor && runner.cursor.at === i + 1;
            return (
              <button key={s.id} role="listitem" className={`tp-seg tp-seg-${st}${live ? " live" : ""}${sel === s.id ? " sel" : ""}`}
                style={{ flexGrow: span[i] / total }} onClick={() => onPick(s.id)} onDoubleClick={() => onOpen(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" && !sup.planActive) { e.preventDefault(); onOpen(s.id); } }} data-testid={`ws-seg-${s.id}`}
                title={`${i + 1}. ${s.name} – ${st}${s.ms ? ` · ${clock(s.ms)}` : ""}`}>
                <span className="tp-seg-n mono">{i + 1}</span><span className="tp-seg-name">{s.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One section of a dynamic dropdown: a row that expands in place (one open at a time). */
function Disclosure({ id, label, hint, open, setOpen, children }: { id: string; label: string; hint?: string; open: string; setOpen: (id: string) => void; children: React.ReactNode }) {
  const on = open === id;
  return (
    <div className={`dd-sec${on ? " open" : ""}`}>
      <button className="dd-head" aria-expanded={on} data-testid={`dd-${id}`} onClick={() => setOpen(on ? "" : id)}>
        <span className="dd-label">{label}</span><span className="dd-hint">{hint}</span>
        <span className={`ws-chev${on ? " up" : ""}`} aria-hidden="true"><Icon.chevron /></span>
      </button>
      <div className="dd-body"><div className="dd-inner">{children}</div></div>
    </div>
  );
}

/** Every symbol under a block, children included. */
function countSyms(data: MapData, id: string): number {
  const b = data.blocks[id];
  return b ? b.symbols.length + b.children.reduce((n, c) => n + countSyms(data, c), 0) : 0;
}

// Deterministic fixture enumeration with the same paged shape as the API.
function fixtureChains(family: string, cursor: string | null): Promise<ChainPage> {
  return import("./map/fixture").then((m) => m.fixtureChains(family, cursor));
}
