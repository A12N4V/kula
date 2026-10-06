import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import EdgeCurveProgram from "@sigma/edge-curve";
import { attachOverlay, drawHover, drawOutlinedLabel, type Overlay } from "../graphfx";
import { api, colorFor, relTime, type Context, type GraphData, type GuardLevel, type Impact, type Node, type RawRule, type SymbolHistory } from "../api";
import { GuardTag, LEVEL_MEANS } from "./Agents";
import { visit } from "../near";
import { LinkArea } from "../Autofill";
import { useCode } from "../CodePanel";
import { blend, churnColor, dirColor, GLYPH, groupDirs, hue, kindColor, LANG_GLYPH, makeColorer } from "../colors";
import { knownDirs, settings, useSettings, type Settings } from "../settings";
import { Empty, Icon, Kind, Logo, Md, ShowOutput, Sym, useToast } from "../ui";
import { GraphLoader, type LoadStep } from "../AsciiMark";
import { PreEditPanel } from "../AgentChecks";
import type { IndexProgress } from "../api";
import Contrast from "./Contrast";
import type { ContrastMode, Go } from "../nav";
import { Grip } from "../resize";

type Props = {
  focus: number | null; setFocus: (id: number | null) => void; onChanged: () => void; version: number;
  contrast: { base: string; head: string; mode?: ContrastMode } | null; setContrast: (c: { base: string; head: string; mode?: ContrastMode } | null) => void; go: Go;
  openSettings: () => void;
  /** Open with the fences overlay: "" for what is in force, or a workflow to preview. */
  fences?: string;
};

/** ForceAtlas2 tuned for code graphs: tight directories, readable bridges. */
const PKG = "__pkg";

/** Pin packages on a ring just outside the code, each at the mean bearing of its importers. */
function placePackages(g: Graph) {
  let cx = 0, cy = 0, n = 0, R = 0;
  g.forEachNode((_id, a) => { if (!a.virtual && a.dir !== PKG) { cx += a.x; cy += a.y; n++; } });
  if (!n) return;
  cx /= n; cy /= n;
  g.forEachNode((_id, a) => { if (!a.virtual && a.dir !== PKG) R = Math.max(R, Math.hypot(a.x - cx, a.y - cy)); });
  const pk = g.filterNodes((_id, a) => a.dir === PKG).map((id) => {
    let sx = 0, sy = 0;
    g.forEachInNeighbor(id, (_m, b) => { sx += b.x - cx; sy += b.y - cy; });
    return { id, t: sx || sy ? Math.atan2(sy, sx) : 0 };
  }).sort((a, b) => a.t - b.t);
  // keep a minimum arc between neighbours so the rim never stacks
  const gap = (Math.PI * 2) / Math.max(pk.length, 24);
  for (let i = 1; i < pk.length; i++) pk[i].t = Math.max(pk[i].t, pk[i - 1].t + gap);
  const ring = R * 1.22 + 40;
  for (const { id, t } of pk) g.mergeNodeAttributes(id, { x: cx + Math.cos(t) * ring, y: cy + Math.sin(t) * ring, fixed: true });
}

export function layoutSettings(g: Graph) {
  return { ...forceAtlas2.inferSettings(g), linLogMode: true, outboundAttractionDistribution: true, edgeWeightInfluence: 1, gravity: 1.1, scalingRatio: 7, slowDown: 3, barnesHutOptimize: g.order > 600 };
}

export function cssVar(name: string) {
  // Sigma's colour parser rejects "rgba(1, 2, 3, 0.4)" with spaces; normalise.
  return getComputedStyle(document.documentElement).getPropertyValue(name).replace(/\s+/g, "") || "#888";
}

/** `c` at opacity `a`, pre-blended onto the page background (edge shaders ignore alpha). */
export const withAlpha = (c: string, a: number) => blend(c, a, cssVar("--bg"));

export const CURVATURE = 0.25; // @sigma/edge-curve default
const LABELS = { few: [0.35, 9], normal: [0.8, 6], many: [1.8, 3] } as const;
const TRANSPARENT = "rgba(0,0,0,0)";

export default function GraphView(props: Props) {
  const { contrast, setContrast, setFocus } = props;
  if (contrast)
    return (
      <Contrast
        base={contrast.base}
        head={contrast.head}
        mode={contrast.mode ?? "overlay"}
        onMode={(mode) => setContrast({ ...contrast, mode })}
        onChange={(base, head) => setContrast({ ...contrast, base, head })}
        onExit={() => setContrast(null)}
        openSettings={props.openSettings}
        openInMap={async (name, path) => {
          const hits = await api.search(name);
          const hit = hits.find((h) => h.path === path) ?? hits[0];
          setContrast(null);
          if (hit) setFocus(hit.id);
        }}
      />
    );
  return <MapView {...props} />;
}

type Filter = { type: "dir" | "cluster" | "kind"; key: string } | null;
type InspectorTab = "context" | "impact" | "edit" | "history" | "source" | "notes";

/**
 * Shortest path between two nodes: along the direction of calls and imports
 * first (how control actually flows), then against it, then ignoring direction.
 */
export function shortest(g: Graph, from: string, to: string): string[] | null {
  const bfs = (next: (n: string) => string[]) => {
    const prev = new Map<string, string | null>([[from, null]]);
    const q = [from];
    while (q.length) {
      const n = q.shift()!;
      if (n === to) break;
      for (const m of next(n)) if (!prev.has(m) && !m.startsWith("__dir:")) { prev.set(m, n); q.push(m); }
    }
    if (!prev.has(to)) return null;
    const out: string[] = [];
    for (let n: string | null = to; n; n = prev.get(n) ?? null) out.unshift(n);
    return out;
  };
  return bfs((n) => g.outNeighbors(n)) ?? bfs((n) => g.inNeighbors(n)) ?? bfs((n) => g.neighbors(n));
}

function MapView(props: Props) {
  const { focus, setFocus, onChanged, version, setContrast, go } = props;
  const box = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const s = useSettings();
  const cfg = useRef(s);
  cfg.current = s;
  const [level, setLevel] = useState<"symbol" | "file">("symbol");
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth > 760);
  const [settling, setSettling] = useState(false);
  // The loader outlives the load by its exit animation.
  const busy = !err && (!data || settling);
  const [loaderOn, setLoaderOn] = useState(true);
  useEffect(() => {
    if (busy) { setLoaderOn(true); return; }
    const t = window.setTimeout(() => setLoaderOn(false), 500);
    return () => clearTimeout(t);
  }, [busy]);
  const overlay = useRef<Overlay | null>(null);
  const state = useRef({
    hover: null as string | null, focus: null as number | null, filter: null as Filter, impact: null as Map<string, number> | null, neigh: new Set<string>(),
    fences: null as Map<string, GuardLevel> | null, fenceTask: false, path: null as Map<string, number> | null,
  });
  // Fences overlay: what agents may not touch, from kula.toml and the task.
  const [fences, setFences] = useState<Map<string, GuardLevel> | null>(null);
  const [fenceTask, setFenceTask] = useState<string | null>(null);
  const [fencesOn, setFencesOn] = useState(props.fences !== undefined);
  // "" shows what is in force now (kula.toml + the task's workflow); a name previews that workflow.
  const [fenceWf, setFenceWf] = useState(props.fences ?? "");
  const [fenceInfo, setFenceInfo] = useState<{ workflows: string[]; active: string | null; task: string | null }>({ workflows: [], active: null, task: null });
  useEffect(() => { if (props.fences !== undefined) { setFencesOn(true); setFenceWf(props.fences); } }, [props.fences]);
  useEffect(() => {
    if (!fencesOn) { setFences(null); setFenceTask(null); return; }
    api.agents().then(async (a) => {
      setFenceInfo({ workflows: a.workflows.map((w) => w.name), active: a.workflow?.name ?? null, task: a.task?.title ?? null });
      if (fenceWf) {
        const p = await api.agentAction<{ levels: Record<string, GuardLevel> }>("preview", { workflow: fenceWf });
        const scoped = a.workflows.find((w) => w.name === fenceWf)?.scope?.length;
        setFences(new Map(Object.entries(p.levels))); setFenceTask(scoped ? `${fenceWf} workflow` : null);
      } else { setFences(new Map(Object.entries(a.levels))); setFenceTask(a.task?.title ?? null); }
    }).catch(() => setFences(new Map()));
  }, [fencesOn, version, fenceWf]);
  // Path trace: shift-click a second symbol to light the shortest path between them.
  // Armed from the keyboard with `t`: the next neighbour (arrows) or click becomes the other end.
  const [trace, setTrace] = useState<{ from: string; to: string; path: string[] | null } | null>(null);
  const [traceArmed, setTraceArmed] = useState(false);
  // Mirror of traceArmed for the sigma event closures, which never re-bind.
  const armed = useRef(false);
  // The key handler below binds once per graph: focus and toast travel in refs
  // so a rebinding gap can never swallow a keystroke.
  const focusRef = useRef<number | null>(focus);
  // Where keyboard neighbour-walking is, per node: repeated arrows cycle that side.
  const traceFromRef = useRef({ id: "", idx: -1 });
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tabReq, setTabReq] = useState<{ tab: InspectorTab; n: number } | null>(null);
  const code = useCode();
  const toast = useToast();
  focusRef.current = focus;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let dead = false;
    setData(null);
    setErr(null);
    // A first run indexes behind the loader: while the server is building, keep waiting instead of failing.
    const load = (tries: number) => api.graph(level).then((d) => { if (!dead) { setData(d); setSettling(true); } }).catch(async (e) => {
      const p = await api.progress().catch(() => null);
      if (dead) return;
      if (tries < 600 && (p?.active || tries < 4)) window.setTimeout(() => load(tries + 1), p?.active ? 200 : 600);
      else setErr(String(e.message ?? e));
    });
    load(0);
    return () => { dead = true; };
  }, [level, version]);

  // Honest progress while the view is blocked: the server's index phases (when it is building), then fetch and layout.
  const [prog, setProg] = useState<IndexProgress | null>(null);
  const [sawIndex, setSawIndex] = useState(false);
  const settle = useRef({ t0: 0, ms: 1 });
  useEffect(() => {
    if (!busy) return;
    setSawIndex(false);
    let on = true;
    const tick = () => api.progress().then((p) => { if (!on) return; setProg(p); if (p.active) setSawIndex(true); }).catch(() => {});
    tick();
    const t = window.setInterval(tick, 150);
    return () => { on = false; clearInterval(t); };
  }, [busy]);
  const steps: LoadStep[] = [
    ...(sawIndex ? [
      { id: "walk", label: "Walk", weight: 0.4 },
      { id: "parse", label: "Parse", weight: 3 },
      { id: "link", label: "Link", weight: 0.8 },
      { id: "cluster", label: "Cluster", weight: 0.5 },
      { id: "write", label: "Store", weight: 0.4 },
    ] : []),
    { id: "fetch", label: "Read graph", weight: 0.8 },
    { id: "layout", label: "Lay out", weight: 2.4 },
  ];
  const stepAt = (id: string) => Math.max(0, steps.findIndex((x) => x.id === id));
  const [load, loadFrac, loadDetail] = prog?.active
    ? [stepAt(prog.phase), prog.phase === "parse" && prog.total ? prog.done / prog.total : 0.5,
       prog.phase === "parse" ? `${prog.done.toLocaleString()} / ${prog.total.toLocaleString()} files` : undefined]
    : !data ? [stepAt("fetch"), 0.5, undefined]
    : [stepAt("layout"), settling ? (performance.now() - settle.current.t0) / settle.current.ms : 1, `${data.nodes.length.toLocaleString()} nodes · ${data.edges.length.toLocaleString()} edges`];

  const churn = data?.churn ?? {};
  // Territories and colours follow the chosen depth; the layout always uses the automatic one.
  const groups = useMemo(() => groupDirs(data?.nodes.filter((n) => n.kind !== "package").map((n) => n.path) ?? [], s.dirDepth), [data, s.dirDepth]);
  const colorer = useMemo(() => makeColorer(s, groups, churn), [s.colorBy, s.dirColors, s.theme, groups, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = useRef({ groups, colorer });
  look.current = { groups, colorer };
  useEffect(() => { knownDirs.set({ list: groups.sizes.map(([d, n]) => [d, n, groups.label(d)]), depth: groups.depth }); }, [groups]);

  // Build the graph: seeded by directory on a golden-angle spiral, refined live by the worker.
  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph({ multi: false, type: "directed" });
    const lay = groupDirs(data.nodes.filter((n) => n.kind !== "package").map((n) => n.path), 0);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const spread = Math.sqrt(data.nodes.length) * 14;
    const centre = new Map(lay.sizes.map(([d], i) => {
      const r = spread * Math.sqrt((i + 0.5) / lay.sizes.length);
      return [d, { x: r * Math.cos(i * golden), y: r * Math.sin(i * golden) }];
    }));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of data.nodes) {
      if (n.kind === "package") { g.addNode(String(n.id), { x: 0, y: 0, label: n.name, color: "#888", size: 2, node: n, dir: PKG, fixed: true }); continue; }
      const d = lay.of(n.path);
      const c = centre.get(d)!;
      const j = Math.sqrt(lay.sizes.find(([k]) => k === d)?.[1] ?? 1) * 5;
      g.addNode(String(n.id), { x: c.x + (rnd() - 0.5) * j, y: c.y + (rnd() - 0.5) * j, label: n.name, color: "#888", size: 2, node: n, dir: d });
    }
    for (const e of data.edges) {
      const a = String(e.src), b = String(e.dst);
      if (a === b || !g.hasNode(a) || !g.hasNode(b) || g.hasEdge(a, b)) continue;
      const na = g.getNodeAttributes(a), nb = g.getNodeAttributes(b);
      const sameDir = na.dir === nb.dir, sameComm = na.node.community === nb.node.community;
      g.addEdge(a, b, { kind: e.kind, size: e.kind === "CALLS" ? 0.8 : 0.5, color: "#444", weight: sameDir && sameComm ? 5 : sameDir ? 3 : sameComm ? 0.8 : 0.12 });
    }
    // Rank by degree once; the hub share is a view setting.
    const ranked = g.nodes().sort((x, y) => g.degree(y) - g.degree(x));
    ranked.forEach((id, i) => {
      const deg = g.degree(id);
      const kind = g.getNodeAttribute(id, "node").kind;
      const size = kind === "package" ? Math.min(14, 6 + Math.sqrt(deg) * 1.2) : Math.min(18, (kind === "file" || kind === "class" ? 3.6 : 2.4) + Math.sqrt(deg) * 1.35);
      g.mergeNodeAttributes(id, { rank: kind === "package" ? Infinity : i, deg, din: g.inDegree(id), dout: g.outDegree(id), size });
    });
    // One invisible anchor per directory, tied to its members: the layout pulls each
    // directory into its own region, so territories read as places rather than a blend.
    for (const [d] of lay.sizes) {
      const anchor = `__dir:${d}`;
      const c = centre.get(d)!;
      g.addNode(anchor, { x: c.x, y: c.y, size: 0.1, virtual: true, label: "" });
    }
    g.forEachNode((id, a) => { if (!a.virtual && a.dir !== PKG) g.addEdge(`__dir:${a.dir}`, id, { virtual: true, weight: 1.2, size: 0.1, color: "#000" }); });
    placePackages(g);
    if (g.order > 1) forceAtlas2.assign(g, { iterations: 40, settings: layoutSettings(g) });
    placePackages(g);
    return g;
  }, [data]);

  // Theme tokens the reducers read (refreshed when the theme changes).
  const theme = useMemo(() => ({
    bg: cssVar("--bg"), faded: cssVar("--node-faded"), accent: cssVar("--accent"), text3: cssVar("--text-3"), in: cssVar("--blue"), out: cssVar("--accent"),
    locked: cssVar("--red"), review: cssVar("--yellow"), hidden: cssVar("--violet"),
  }), [s.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const tok = useRef(theme);
  tok.current = theme;

  const isHub = (a: any) => !!graph && !a.virtual && a.deg >= 4 && a.rank < Math.max(3, Math.round(cfg.current.hubShare * graph.order));

  // Renderer, overlay and live layout.
  useEffect(() => {
    if (!graph || !box.current) return;
    let r: Sigma;
    try {
      r = new Sigma(graph, box.current, {
        renderEdgeLabels: false,
        labelFont: "JetBrains Mono Variable, ui-monospace, monospace",
        labelSize: 11.5,
        labelWeight: "500",
        labelColor: { color: cssVar("--text") },
        labelGridCellSize: 90,
        defaultEdgeType: "line",
        edgeProgramClasses: { line: EdgeRectangleProgram, curved: EdgeCurveProgram },
        defaultDrawNodeLabel: drawOutlinedLabel,
        defaultDrawNodeHover: drawHover,
        hideEdgesOnMove: graph.size > 3000,
        zIndex: true,
        minCameraRatio: 0.03,
        maxCameraRatio: 6,
      });
    } catch (e) {
      console.error(e);
      setErr("This browser could not start WebGL, which the graph needs. Other views still work.");
      return;
    }
    r.setSetting("nodeReducer", (id, attr) => {
      const st = state.current, c = cfg.current, { colorer, groups } = look.current, theme = tok.current;
      if (attr.virtual) return { ...attr, hidden: true };
      if (attr.dir === PKG && !c.packages) return { ...attr, hidden: true };
      const res: any = { ...attr, color: colorer.node(attr.node) };
      const hub = c.hubIcons && isHub(attr);
      if (hub) res.forceLabel = true;
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      const dim = () => { res.color = theme.faded; res.dimmed = true; res.label = ""; res.forceLabel = false; res.zIndex = 0; res.size = Math.max(1.4, attr.size * 0.45); };
      const f = st.filter;
      if (st.path) {
        const at = st.path.get(id);
        if (at !== undefined) { res.color = theme.accent; res.zIndex = 3; res.forceLabel = true; res.size = Math.max(attr.size, 5); }
        else dim();
      } else if (st.fences) {
        // Fenced code in its level's colour. With a task, what it may change keeps its own
        // colour and everything outside its scope recedes; without one, open code recedes.
        const lv = st.fences.get(id);
        if (lv && lv !== "scope") { res.color = lv === "review" ? theme.review : lv === "hidden" ? theme.hidden : theme.locked; res.zIndex = 3; res.forceLabel = true; }
        else if (!lv && st.fenceTask) { res.zIndex = 2; }
        else dim();
      } else if (st.impact) {
        const depth = st.impact.get(id);
        if (id === String(st.focus)) { res.zIndex = 3; res.forceLabel = true; }
        else if (depth) { res.color = blend(theme.accent, [1, 0.72, 0.5][Math.min(depth, 3) - 1], theme.bg); res.zIndex = 2; res.forceLabel = depth === 1; }
        else dim();
      } else if (f && !(f.type === "dir" ? groups.of(attr.node.path) === f.key : f.type === "cluster" ? String(attr.node.community) === f.key : attr.node.kind === f.key)) {
        dim();
      } else if (active) {
        if (id === active) { res.zIndex = 3; res.forceLabel = true; }
        else if (st.neigh.has(id)) { res.zIndex = 2; res.forceLabel = true; }
        else dim();
      }
      if (attr.dir === PKG) { res.pkg = res.dimmed ? theme.faded : theme.text3; res.color = TRANSPARENT; res.forceLabel = false; res.label = ""; res.zIndex = Math.max(res.zIndex ?? 0, 1); return res; }
      if (hub && !res.dimmed) { res.tile = res.color; res.hubTile = true; res.color = TRANSPARENT; res.zIndex = Math.max(res.zIndex ?? 0, 1); }
      return res;
    });
    r.setSetting("edgeReducer", (id, attr) => {
      const st = state.current, c = cfg.current, { colorer, groups } = look.current, theme = tok.current;
      if (attr.virtual) return { ...attr, hidden: true };
      const res: any = { ...attr, type: c.curved ? "curved" : "line" };
      if (!c.imports && attr.kind === "IMPORTS") { res.hidden = true; return res; }
      const [a, b] = graph.extremities(id);
      const na = graph.getNodeAttributes(a), nb = graph.getNodeAttributes(b);
      if (st.path) {
        const i = st.path.get(a), j = st.path.get(b);
        if (i !== undefined && j !== undefined && Math.abs(i - j) === 1) { res.color = theme.accent; res.size = 2; res.zIndex = 3; } else res.hidden = true;
        return res;
      }
      if (st.fences) {
        const lit = (n: string) => { const lv = st.fences!.get(n); return st.fenceTask ? lv !== "scope" : !!lv && lv !== "scope"; };
        if (!(lit(a) && lit(b))) res.hidden = true;
        return res;
      }
      if (st.impact) {
        const on = (st.impact.has(a) || a === String(st.focus)) && (st.impact.has(b) || b === String(st.focus));
        if (on) { res.color = blend(theme.accent, 0.6, theme.bg); res.size = 1.3; res.zIndex = 2; } else res.hidden = true;
        return res;
      }
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      if (active) {
        // Direction by colour: calls out of the active symbol vs. calls into it.
        if (a === active) { res.color = blend(theme.out, 0.85, theme.bg); res.size = 1.4; res.zIndex = 2; }
        else if (b === active) { res.color = blend(theme.in, 0.85, theme.bg); res.size = 1.4; res.zIndex = 2; }
        else res.hidden = true;
        return res;
      }
      const f = st.filter;
      if (f) {
        const keep = (n: any) => (f.type === "dir" ? groups.of(n.node.path) === f.key : f.type === "cluster" ? String(n.node.community) === f.key : n.node.kind === f.key);
        if (!keep(na) && !keep(nb)) { res.hidden = true; return res; }
      }
      const within = groups.of(na.node.path) === groups.of(nb.node.path);
      const imp = attr.kind === "IMPORTS";
      res.color = within && colorer.mode === "directory"
        ? blend(colorer.node(na.node), imp ? 0.2 : 0.34, theme.bg)
        : blend(theme.text3, imp ? 0.16 : 0.26, theme.bg);
      return res;
    });
    r.on("enterNode", ({ node }) => { setHover(node); box.current!.style.cursor = "pointer"; });
    r.on("leaveNode", () => { setHover(null); box.current!.style.cursor = ""; });
    r.on("clickNode", ({ node, event }) => {
      const from = state.current.focus;
      if ((armed.current || event.original.shiftKey) && from != null && String(from) !== node) {
        setTrace({ from: String(from), to: node, path: shortest(graph, String(from), node) });
        armed.current = false;
        setTraceArmed(false);
        return;
      }
      setTrace(null);
      setFocus(Number(node));
    });
    r.on("rightClickNode", ({ node, event }) => {
      event.original.preventDefault();
      event.preventSigmaDefault();
      const m = event.original as MouseEvent;
      setMenu({ id: node, x: m.clientX, y: m.clientY });
    });
    r.on("clickStage", () => { setFocus(null); setImpact(null); setTrace(null); setMenu(null); });
    r.getMouseCaptor().on("mousedown", () => setMenu(null));

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ov = attachOverlay(r, graph, {
      group: (a) => (a.virtual || a.dir === PKG ? null : look.current.groups.of(a.node.path)),
      groupLabel: (k) => look.current.groups.label(k),
      groupColor: (k) => (look.current.colorer.mode === "directory" ? dirColor(k, look.current.groups, cfg.current) : null),
      hub: (_id, a) => cfg.current.hubIcons && isHub(a),
      glyph: (a) => (a.node.kind === "file" ? LANG_GLYPH[a.node.lang] ?? "·" : GLYPH[a.node.kind] ?? "·"),
      reducedMotion: reduced,
    });
    overlay.current = ov;

    let worker: FA2Layout | null = null;
    let timer = 0;
    if (!reduced && graph.order > 2) {
      worker = new FA2Layout(graph, { settings: layoutSettings(graph) });
      worker.start();
      const settleMs = Math.min(4500, 1400 + graph.order * 4);
      settle.current = { t0: performance.now(), ms: settleMs };
      setSettling(true);
      timer = window.setTimeout(() => {
        worker?.stop();
        noverlap.assign(graph, { maxIterations: 40, settings: { margin: 3, ratio: 1.15 } });
        placePackages(graph);
        setSettling(false);
      }, settleMs);
    } else {
      setSettling(false);
      forceAtlas2.assign(graph, { iterations: 200, settings: layoutSettings(graph) });
      noverlap.assign(graph, { maxIterations: 40, settings: { margin: 3, ratio: 1.15 } });
      placePackages(graph);
    }
    sigma.current = r;
    // UI tests (and only automation) can find nodes on screen.
    if (navigator.webdriver) (window as any).__kula = { sigma: r, graph };
    return () => {
      clearTimeout(timer);
      worker?.kill();
      ov.kill();
      overlay.current = null;
      r.kill();
      sigma.current = null;
      setSettling(false);
    };
  }, [graph, setFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // View settings → renderer, without rebuilding the graph.
  useEffect(() => {
    const r = sigma.current;
    if (!r) return;
    const [density, threshold] = LABELS[s.labels];
    r.setSetting("labelDensity", density);
    r.setSetting("labelRenderedSizeThreshold", threshold);
    r.setSetting("labelColor", { color: cssVar("--text") });
    overlay.current?.retheme();
    overlay.current?.set({ territories: s.territories, hubIcons: s.hubIcons, curvature: s.curved ? CURVATURE : 0 });
    r.refresh({ skipIndexation: true });
  }, [s, graph, colorer, theme]);

  // Interaction state → reducers and overlay.
  useEffect(() => {
    const st = state.current;
    st.hover = hover;
    st.focus = focus;
    st.filter = filter;
    st.impact = impact ? new Map(impact.hits.map((h) => [String(h.node.id), h.depth])) : null;
    st.fences = fences;
    st.fenceTask = !!fenceTask;
    st.path = trace?.path ? new Map(trace.path.map((id, i) => [id, i])) : null;
    const active = hover ?? (focus != null ? String(focus) : null);
    st.neigh = new Set(active && graph?.hasNode(active) ? graph.neighbors(active).filter((n) => !n.startsWith("__dir:")) : []);
    sigma.current?.refresh({ skipIndexation: true });
    if (!graph || !overlay.current) return;
    const f = focus != null && graph.hasNode(String(focus)) ? String(focus) : null;
    const flows: [string, string][] = [];
    if (s.flow && f) {
      if (st.impact) graph.forEachEdge((_e, _a, a, b) => { if (flows.length < 160 && (st.impact!.has(a) || a === f) && (st.impact!.has(b) || b === f)) flows.push([a, b]); });
      else graph.forEachEdge(f, (_e, attr, a, b) => { if (flows.length < 120 && attr.kind === "CALLS") flows.push([a, b]); });
    }
    const activeNode = active && graph.hasNode(active) ? graph.getNodeAttributes(active) : null;
    overlay.current.set({
      focus: f,
      flows,
      quiet: !!active || !!st.impact || !!filter || !!st.path || !!st.fences,
      focusMode: !!active || !!st.impact || !!st.path,
      activeGroup: peek ?? (filter?.type === "dir" ? filter.key : activeNode ? groups.of(activeNode.node.path) : null),
    });
  }, [hover, focus, filter, impact, graph, s.flow, peek, groups, s.packages, fences, fenceTask, trace]);

  // Fly to the focused node.
  useEffect(() => {
    if (focus == null || !sigma.current || !graph?.hasNode(String(focus))) return;
    const pos = sigma.current.getNodeDisplayData(String(focus));
    if (pos) sigma.current.getCamera().animate({ x: pos.x, y: pos.y, ratio: Math.min(sigma.current.getCamera().ratio, 0.45) }, { duration: 650 });
  }, [focus, graph, settling]);

  useEffect(() => { if (focus == null) setImpact(null); }, [focus]);
  useEffect(() => setFilter(null), [s.colorBy, s.dirDepth, level]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f") setFencesOn((x) => !x);
      if (e.key === "Escape") { setMenu(null); setTrace(null); armed.current = false; setTraceArmed(false); }
      if (e.key === "t" && focusRef.current != null) {
        armed.current = true;
        setTraceArmed(true);
        toastRef.current("Trace armed – press an arrow for a neighbour or click another symbol");
      }
      // Walk the neighbours of the selection: arrows down/right follow calls out,
      // up/left follow calls in. Repeats cycle through that side's neighbours.
      const dirKeys: Record<string, "in" | "out"> = { ArrowRight: "out", ArrowDown: "out", ArrowLeft: "in", ArrowUp: "in" };
      const side = dirKeys[e.key];
      const focus = focusRef.current;
      if (side && focus != null && graph?.hasNode(String(focus))) {
        e.preventDefault();
        const id = String(focus);
        const ns = (side === "out" ? graph.outNeighbors(id) : graph.inNeighbors(id)).filter((n) => !n.startsWith("__dir:"));
        if (!ns.length) return;
        const sorted = ns.sort((a, b) => graph.degree(b) - graph.degree(a));
        const at = armed.current ? -1 : traceFromRef.current.idx;
        const next = sorted[(at + 1) % sorted.length];
        if (armed.current) {
          // A trace is armed from this node: the neighbour becomes the other end.
          setTrace({ from: id, to: next, path: shortest(graph, id, next) });
          armed.current = false;
          setTraceArmed(false);
          traceFromRef.current = { id, idx: -1 };
        } else {
          traceFromRef.current = traceFromRef.current.id === id ? { id, idx: at + 1 } : { id, idx: 0 };
          setFocus(Number(next));
        }
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [graph, setFocus]);
  const cam = (f: (c: ReturnType<Sigma["getCamera"]>) => void) => sigma.current && f(sigma.current.getCamera());
  const hovered = hover && graph?.hasNode(hover) && !hover.startsWith("__dir:") ? graph.getNodeAttributes(hover) : null;
  // The card waits a beat so brushing past nodes does not flicker it on.
  const [cardOn, setCardOn] = useState(false);
  useEffect(() => {
    setCardOn(false);
    if (!hover) return;
    const t = window.setTimeout(() => setCardOn(true), 260);
    return () => window.clearTimeout(t);
  }, [hover]);
  const pkgCount = data ? data.nodes.filter((n) => n.kind === "package").length : 0;
  const hubCount = graph ? graph.filterNodes((_id, a) => isHub(a)).length : 0;

  return (
    <div className={`graph-wrap ${focus != null ? "inspecting" : ""}`}>
      <div ref={box} className="graph-canvas" />
      {loaderOn && <GraphLoader steps={steps} at={busy ? load : steps.length} frac={busy ? loadFrac : 1} detail={busy ? loadDetail : undefined} leaving={!busy} />}
      {err && <div className="loading"><Empty title={err.includes("WebGL") ? "Graph unavailable" : "No graph yet"}>{err}{!err.includes("WebGL") && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => api.reindex().then(onChanged)}>Build graph</button></div>}</Empty></div>}

      <div className="graph-overlay hud">
        <div className="seg">
          <button className={level === "symbol" ? "on" : ""} onClick={() => setLevel("symbol")}>Symbols</button>
          <button className={level === "file" ? "on" : ""} onClick={() => setLevel("file")}>Files</button>
        </div>
        <button className={`btn sm hud-btn ${s.packages ? "on" : ""}`} aria-pressed={s.packages} onClick={() => settings.set({ packages: !s.packages })} title="Show external packages on the rim">
          <Icon.box /> Packages{pkgCount ? <span className="muted"> {pkgCount}</span> : null}
        </button>
        <button className="btn sm hud-btn" onClick={() => setContrast({ base: "HEAD", head: "WORKTREE" })} title="Overlay two revisions' graphs"><Icon.compare /> Contrast</button>
        <button className={`btn sm hud-btn ${fencesOn ? "on" : ""}`} aria-pressed={fencesOn} onClick={() => setFencesOn(!fencesOn)} title="Show what agents may not touch  (f)">
          <Icon.lock /> Fences{fences ? <span className="muted"> {[...fences.values()].filter((v) => v !== "scope").length}</span> : null}
        </button>
        {data && (
          <span className="hud-stats hide-sm">
            {settling ? <><span className="dot warn pulse" /> settling</> : <>
              <b>{data.nodes.length.toLocaleString()}</b> {level === "file" ? "files" : "symbols"}<i />
              <b>{data.edges.length.toLocaleString()}</b> edges<i />
              <b>{groups.sizes.length}</b> dirs<i />
              <b>{hubCount}</b> hubs{data.truncated ? <><i />top by degree</> : null}
            </>}
          </span>
        )}
      </div>

      {trace && graph && (
        <div className="graph-overlay trace-chip" role="status">
          {trace.path ? (
            <>
              <span className="eyebrow">path</span>
              {trace.path.map((id, i) => (
                <span key={id} className="tc-step">
                  {i > 0 && <span className="tc-arrow">→</span>}
                  <button className="mono" onClick={() => setFocus(Number(id))}>{graph.getNodeAttribute(id, "label")}</button>
                </span>
              ))}
              <span className="muted">{trace.path.length - 1} {trace.path.length === 2 ? "hop" : "hops"}</span>
            </>
          ) : <span className="muted">No path between {graph.getNodeAttribute(trace.from, "label")} and {graph.getNodeAttribute(trace.to, "label")}.</span>}
          <button className="btn ghost sm" onClick={() => setTrace(null)} aria-label="Clear path"><Icon.close /></button>
        </div>
      )}
      {fences && !trace && graph && (
        <div className="graph-overlay fence-key" role="note">
          <span className="eyebrow">{fenceWf ? "preview" : "for agents"}</span>
          <select className="fk-wf" value={fenceWf} onChange={(e) => setFenceWf(e.target.value)} aria-label="Fences of">
            <option value="">{fenceInfo.active ? `now · ${fenceInfo.active}` : "now"}</option>
            {fenceInfo.workflows.map((w) => <option key={w} value={w}>{w} workflow</option>)}
          </select>
          {(["locked", "hidden", "review"] as GuardLevel[]).map((l) => {
            const n = [...fences.values()].filter((v) => v === l).length;
            return n ? <span key={l} className="fk" title={LEVEL_MEANS[l]}><GuardTag level={l} /> {n} <span className="muted fk-means">{LEVEL_MEANS[l]}</span></span> : null;
          })}
          {fenceTask && <span className="fk" title="Agents may change only these"><span className="guard-tag open">editable</span> {graph.filterNodes((id, a) => !a.virtual && a.dir !== PKG && !fences.has(id)).length}<span className="muted fk-task">{fenceTask}</span></span>}
          {![...fences.values()].some((v) => v !== "scope") && !fenceTask && <span className="muted">nothing fenced – agents may change everything shown</span>}
          <button className="btn ghost sm" onClick={() => setFencesOn(false)} aria-label="Hide fences"><Icon.close /></button>
        </div>
      )}
      {menu && graph?.hasNode(menu.id) && (
        <NodeMenu x={menu.x} y={menu.y} n={graph.getNodeAttribute(menu.id, "node")} onClose={() => setMenu(null)}
          inspect={(tab) => { setFocus(Number(menu.id)); if (tab) setTabReq({ tab, n: Date.now() }); }}
          source={(n) => code.open({ path: n.path, line: n.kind === "file" ? undefined : n.start_line })}
          traceFrom={() => { if (focus != null && String(focus) !== menu.id) setTrace({ from: String(focus), to: menu.id, path: shortest(graph, String(focus), menu.id) }); else { setFocus(Number(menu.id)); toast("Shift-click another symbol to trace a path to it"); } }}
          copied={(what) => toast(`Copied ${what}`)}
        />
      )}

      {hovered && cardOn && hover !== String(focus) && <HoverCard n={hovered.node} dir={groups.label(groups.of(hovered.node.path))} deg={[hovered.din, hovered.dout]} churn={churn[hovered.node.path] ?? 0} hub={isHub(hovered)} fence={hover != null ? fences?.get(hover) ?? null : null} />}

      {data && (
        <Legend
          open={legendOpen} setOpen={setLegendOpen} mode={s.colorBy} groups={groups} settings={s} data={data} churn={churn}
          filter={filter} setFilter={setFilter} setPeek={setPeek}
        />
      )}

      <div className="graph-overlay zoom">
        <button className="btn" aria-label="Zoom in" onClick={() => cam((c) => c.animatedZoom({ duration: 200 }))}><Icon.plus /></button>
        <button className="btn" aria-label="Zoom out" onClick={() => cam((c) => c.animatedUnzoom({ duration: 200 }))}><Icon.minus /></button>
        <button className="btn" aria-label="Fit graph" title="Fit" onClick={() => cam((c) => c.animatedReset({ duration: 300 }))}><Icon.target /></button>
        <button className="btn" aria-label="Re-run layout" title="Re-run layout" onClick={() => setData((d) => (d ? { ...d } : d))}><Icon.refresh /></button>
      </div>

      {focus != null && <Inspector id={focus} tabReq={tabReq} onClose={() => setFocus(null)} setFocus={setFocus} impact={impact} setImpact={setImpact} go={go} churn={churn} deg={graph?.hasNode(String(focus)) ? [graph.getNodeAttribute(String(focus), "din"), graph.getNodeAttribute(String(focus), "dout")] : null}
        onTrace={() => { armed.current = true; setTraceArmed(true); toast("Trace armed – press an arrow for a neighbour or click another symbol"); }}
        traceArmed={traceArmed} />}
    </div>
  );
}

function HoverCard({ n, dir, deg, churn, hub, fence }: { n: Node; dir: string; deg: [number, number]; churn: number; hub: boolean; fence: GuardLevel | null }) {
  const lines = n.end_line - n.start_line + 1;
  return (
    <div className="hover-card" key={n.id}>
      <Kind kind={n.kind} size={22} />
      <div className="hc-main">
        <div className="hc-name mono">{n.name}{hub && <span className="hc-hub">hub</span>}</div>
        <div className="hc-path mono">{n.path}:{n.start_line}</div>
      </div>
      <div className="hc-stats">
        <span title="Incoming edges (callers, importers)"><b className="in">{deg[0]}</b> in</span>
        <span title="Outgoing edges (callees, imports)"><b className="out">{deg[1]}</b> out</span>
        {n.kind !== "file" && <span><b>{lines}</b> ln</span>}
        <span title="Commits touching this file in 90 days"><b>{churn}</b> {churn === 1 ? "commit" : "commits"}</span>
        <span className="hc-dir mono">{dir}</span>
        {(fence && fence !== "scope") && <span title={LEVEL_MEANS[fence]}><GuardTag level={fence} /></span>}
      </div>
    </div>
  );
}

/** Right-click on a node: everything you can do with it, without hunting through tabs. */
function NodeMenu({ x, y, n, onClose, inspect, source, traceFrom, copied }: {
  x: number; y: number; n: Node; onClose: () => void; inspect: (tab?: InspectorTab) => void; source: (n: Node) => void; traceFrom: () => void; copied: (what: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as globalThis.Node)) onClose(); };
    window.addEventListener("mousedown", away);
    ref.current?.querySelector("button")?.focus();
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);
  const loc = n.kind === "file" || n.kind === "package" ? n.path : `${n.path}:${n.start_line}`;
  const iri = n.kind === "file" ? `urn:kula:file:${n.path}` : n.kind === "package" ? `urn:kula:pkg:${n.name}` : `urn:kula:sym:${n.path}#${n.name}`;
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => copied(what)).catch(() => {}); onClose(); };
  const items: [string, string, () => void][] = [
    ["Inspect", "↵", () => { inspect(); onClose(); }],
    ...(n.kind !== "package" ? [["Open source", "", () => { source(n); onClose(); }] as [string, string, () => void]] : []),
    ["Impact", "", () => { inspect("impact"); onClose(); }],
    ...(n.kind !== "file" && n.kind !== "package" ? [["Pre-edit check", "", () => { inspect("edit"); onClose(); }] as [string, string, () => void]] : []),
    ["Path from selection", "⇧ click", () => { traceFrom(); onClose(); }],
    ["Notes & memory", "", () => { inspect("notes"); onClose(); }],
    ["Copy location", loc.length > 28 ? "" : loc, () => copy(loc, loc)],
    ["Copy RDF IRI", "", () => copy(iri, "IRI")],
  ];
  const left = Math.min(x, window.innerWidth - 248), top = Math.min(y, window.innerHeight - items.length * 32 - 60);
  return (
    <div ref={ref} className="node-menu" style={{ left, top }} role="menu" aria-label={`${n.name} actions`}
      onKeyDown={(e) => {
        const bs = [...(ref.current?.querySelectorAll("button") ?? [])];
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
        if (e.key === "Escape") onClose();
      }}>
      <div className="nm-head"><Kind kind={n.kind} size={14} /><span className="mono">{n.name}</span></div>
      {items.map(([label, hint, run]) => (
        <button key={label} role="menuitem" onClick={run}><span>{label}</span>{hint && <span className="muted mono">{hint}</span>}</button>
      ))}
    </div>
  );
}

function Legend({ open, setOpen, mode, groups, settings: s, data, churn, filter, setFilter, setPeek }: {
  open: boolean; setOpen: (o: boolean) => void; mode: Settings["colorBy"]; groups: ReturnType<typeof groupDirs>; settings: Settings;
  data: GraphData; churn: Record<string, number>; filter: Filter; setFilter: (f: Filter) => void; setPeek: (k: string | null) => void;
}) {
  const total = data.nodes.length || 1;
  let rows: { key: string; label: string; n: number; color: string; type: "dir" | "cluster" | "kind" }[] = [];
  if (mode === "directory") rows = groups.sizes.map(([d, n]) => ({ key: d, label: groups.label(d), n, color: dirColor(d, groups, s), type: "dir" }));
  if (mode === "cluster") {
    const count = new Map<number, number>();
    data.nodes.forEach((x) => count.set(x.community, (count.get(x.community) ?? 0) + 1));
    rows = data.communities.filter((c) => count.get(c.id)).sort((a, b) => count.get(b.id)! - count.get(a.id)!)
      .map((c) => ({ key: String(c.id), label: c.label, n: count.get(c.id)!, color: hue(c.id), type: "cluster" }));
  }
  if (mode === "kind") {
    const count = new Map<string, number>();
    data.nodes.forEach((x) => count.set(x.kind, (count.get(x.kind) ?? 0) + 1));
    rows = [...count].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: k, n, color: kindColor(k), type: "kind" }));
  }
  const max = Math.max(20, ...Object.values(churn));
  const hottest = Object.entries(churn).filter(([p]) => data.nodes.some((x) => x.path === p)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const title = { directory: "Directories", cluster: "Clusters", kind: "Kinds", churn: "Churn · 90 days" }[mode];

  return (
    <div className={`graph-overlay legend ${open ? "" : "closed"}`}>
      <Grip id="legend" edge="right" min={200} max={560} label="Resize legend width" />
      {open && <Grip id="legend-h" edge="top" min={80} max={900} label="Resize legend height" />}
      <button className="legend-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        {mode !== "churn" && <span className="count">{rows.length}</span>}
        <span className="spacer" />
        <Icon.chevron />
      </button>
      {mode !== "churn" && (
        // Composition bar: each band is a share of all nodes – always visible, even collapsed.
        <div className="comp-bar" role="presentation">
          {rows.slice(0, 16).map((r) => (
            <i key={r.key} style={{ flexGrow: r.n, background: r.color, opacity: filter && filter.key !== r.key ? 0.25 : 1 }} title={`${r.label} · ${r.n}`}
              onClick={() => setFilter(filter?.key === r.key ? null : { type: r.type, key: r.key })} />
          ))}
        </div>
      )}
      {open && mode !== "churn" && (
        <div className="legend-rows">
          {rows.slice(0, 40).map((r) => (
            <div key={r.key} className={`li ${filter?.key === r.key ? "on" : ""}`}
              onMouseEnter={() => r.type === "dir" && setPeek(r.key)} onMouseLeave={() => setPeek(null)}
              onClick={() => setFilter(filter?.key === r.key ? null : { type: r.type, key: r.key })}>
              <span className="sw" style={{ background: r.color }} />
              <span className={`lbl ${r.type === "dir" ? "mono" : ""}`}>{r.label}</span>
              <span className="n">{r.n}</span>
              <span className="pct">{Math.round((r.n / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      {open && mode === "churn" && (
        <div className="legend-rows">
          <div className="ramp" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => churnColor(t)).join(",")})` }} />
          <div className="ramp-scale"><span>0</span><span>{max} commits</span></div>
          {hottest.map(([p, n]) => (
            <div key={p} className="li"><span className="sw" style={{ background: churnColor(Math.log1p(n) / Math.log1p(max)) }} /><span className="lbl mono">{p}</span><span className="n">{n}</span></div>
          ))}
          {!hottest.length && <div className="muted" style={{ padding: "4px 6px" }}>No commits in 90 days.</div>}
        </div>
      )}
      {filter && <button className="legend-clear" onClick={() => setFilter(null)}>Showing {filter.type === "dir" ? groups.label(filter.key) : rows.find((r) => r.key === filter.key)?.label} only · clear</button>}
    </div>
  );
}

function Inspector({ id, tabReq, onClose, setFocus, impact, setImpact, go: goView, churn, deg, onTrace, traceArmed }: {
  id: number; tabReq: { tab: InspectorTab; n: number } | null; onClose: () => void; setFocus: (id: number) => void; impact: Impact | null; setImpact: (i: Impact | null) => void; go: Go;
  churn: Record<string, number>; deg: [number, number] | null;
  /** Arm path-trace from this symbol (the keyboard path to shift-click). */
  onTrace: () => void; traceArmed: boolean;
}) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [tab, setTab] = useState<InspectorTab>("context");
  const [hist, setHist] = useState<SymbolHistory | null>(null);
  // Browser-style back/forward through symbols you've inspected.
  const trail = useRef<{ stack: number[]; at: number }>({ stack: [], at: -1 });
  const [, bump] = useState(0);
  useEffect(() => {
    const t = trail.current;
    if (t.stack[t.at] !== id) { t.stack = [...t.stack.slice(0, t.at + 1), id]; t.at = t.stack.length - 1; bump((x) => x + 1); }
  }, [id]);
  const step = (d: number) => {
    const t = trail.current;
    const at = t.at + d;
    if (at < 0 || at >= t.stack.length) return;
    t.at = at; bump((x) => x + 1); setFocus(t.stack[at]);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === "[") step(-1);
      if (e.key === "]") step(1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const [dir, setDir] = useState<"up" | "down">("up");
  const [note, setNote] = useState("");
  const [asMemory, setAsMemory] = useState(false);
  // Reach-for actions: blame output in place, and a fence picker for this symbol.
  const [blame, setBlame] = useState<string | null>(null);
  const [fencing, setFencing] = useState<"locked" | "review" | "hidden" | null>(null);
  const toast = useToast();
  const load = () => api.symbol(id).then((c) => { setCtx(c); visit({ path: c.node.path, name: c.node.name, kind: c.node.kind, id: c.node.id }); }).catch((e) => toast(e.message, "err"));
  // `#graph/<id>/impact` opens straight onto a tab (first load only).
  const initialTab = useRef(location.hash.split("/")[2] as typeof tab | undefined);
  useEffect(() => { setCtx(null); load(); setTab(initialTab.current ?? "context"); initialTab.current = undefined; }, [id]);
  // A tab asked for from outside (the node menu); after the id effect so it wins.
  useEffect(() => { if (tabReq) setTab(tabReq.tab); }, [tabReq]);
  useEffect(() => {
    if (tab === "impact") api.impact(id, dir).then(setImpact).catch((e) => toast(e.message, "err"));
    else setImpact(null);
    if (tab === "history") { setHist(null); api.history(id).then(setHist).catch((e) => toast(e.message, "err")); }
  }, [tab, dir, id]);

  const go = (n: Node) => setFocus(n.id);
  const lists: [string, Node[], string][] = ctx ? [["Called by", ctx.callers, "in"], ["Calls", ctx.callees, "out"], ["Contains", ctx.children, ""], ["Imports", ctx.imports, "out"], ["Imported by", ctx.imported_by, "in"]] : [];
  const target = ctx ? (ctx.node.kind === "file" ? `file:${ctx.node.path}` : `symbol:${ctx.node.path}:${ctx.node.name}`) : "";
  const loc = ctx ? (ctx.node.kind === "file" ? ctx.node.path : `${ctx.node.path}:${ctx.node.start_line}`) : "";
  const iri = ctx
    ? ctx.node.kind === "file" ? `urn:kula:file:${ctx.node.path}` : ctx.node.kind === "package" ? `urn:kula:pkg:${ctx.node.name}` : `urn:kula:sym:${ctx.node.path}#${ctx.node.name}`
    : "";
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => toast(`Copied ${what}`)).catch(() => {}); };
  const runBlame = () => {
    if (!ctx) return;
    setBlame(null);
    const n = ctx.node;
    const args = n.kind === "file" ? ["blame", "--", n.path] : ["blame", "-L", `${n.start_line},${n.end_line}`, "--", n.path];
    api.exec(args).then((r) => setBlame(r.stdout || r.stderr || "(no output)")).catch((e) => toast(e.message, "err"));
  };
  const fence = async (level: "locked" | "review" | "hidden") => {
    if (!ctx) return;
    const rule: RawRule = { paths: [ctx.node.path], level, reason: "fenced from the inspector" };
    try {
      const a = await api.agents();
      const rules = [...(a.rules ?? []).filter((r) => !r.paths?.includes(ctx.node.path) || r.level === level), rule];
      await api.agentAction("guards_save", { rules });
      toast(`${ctx.node.kind === "file" ? "File" : "Symbol"} fenced: ${level}`);
      setFencing(null);
      load();
    } catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <aside className="inspector" aria-label="Symbol inspector">
      <Grip id="inspector" edge="left" min={300} max={960} label="Resize inspector" />
      <header>
        <div className="row">
          <div className="kind">{ctx && <Kind kind={ctx.node.kind} size={15} />}{ctx?.node.kind ?? "loading"}</div>
          <span className="spacer" />
          <button className="btn ghost sm" disabled={trail.current.at <= 0} onClick={() => step(-1)} aria-label="Back" title="Back  [">←</button>
          <button className="btn ghost sm" disabled={trail.current.at >= trail.current.stack.length - 1} onClick={() => step(1)} aria-label="Forward" title="Forward  ]">→</button>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close" title="Close  esc"><Icon.close /></button>
        </div>
        <h2>{ctx?.node.name ?? "…"}</h2>
        {ctx && <div className="muted mono" style={{ fontSize: 11.5 }}>{ctx.node.path}:{ctx.node.start_line}–{ctx.node.end_line}</div>}
        {ctx && (
          <div className="insp-facts">
            <span><b className="in">{ctx.callers.length + ctx.imported_by.length}</b> in</span>
            <span><b className="out">{ctx.callees.length + ctx.imports.length}</b> out</span>
            {ctx.node.kind !== "file" && <span><b>{ctx.node.end_line - ctx.node.start_line + 1}</b> lines</span>}
            <span><b>{churn[ctx.node.path] ?? 0}</b> {(churn[ctx.node.path] ?? 0) === 1 ? "commit" : "commits"} · 90d</span>
            {deg && deg[0] + deg[1] > 0 && ctx.callers.length === 0 && ctx.node.kind !== "file" && <span className="warn-fact">no callers</span>}
            {ctx.community && <span className="insp-cluster" title="Cluster"><i style={{ background: colorFor(ctx.node.community) }} />{ctx.community}</span>}
          </div>
        )}
        {ctx?.guard && ctx.guard.level !== "open" && (
          <div className={`insp-guard ${ctx.guard.level}`} title={ctx.guard.rule}>
            <Icon.lock /><GuardTag level={ctx.guard.level} /><span>{ctx.guard.reason}</span>
          </div>
        )}
        {ctx && (
          <div className="insp-actions">
            <button className="btn sm" onClick={() => setTab("impact")}><Icon.workflow /> Impact</button>
            <button className={`btn sm ${traceArmed ? "on" : ""}`} onClick={onTrace} title="Path to another symbol  t"><Icon.arrow /> Trace</button>
            <button className="btn sm" onClick={() => setTab("history")}><Icon.history /> History</button>
            <button className="btn sm" onClick={runBlame}><Icon.search /> Blame</button>
            <button className="btn sm" aria-label="Open memory notes" onClick={() => setTab("notes")}><Icon.memory /> Remember</button>
            <span className="fence-wrap">
              <button className={`btn sm ${fencing !== null ? "on" : ""}`} aria-expanded={fencing !== null} onClick={() => setFencing(fencing === null ? "locked" : null)}><Icon.fence /> Fence this</button>
              {fencing !== null && (
                <span className="fence-pick" role="menu" aria-label="Fence level">
                  {(["locked", "review", "hidden"] as const).map((l) => (
                    <button key={l} role="menuitem" className={fencing === l ? "on" : ""} onClick={() => { setFencing(l); fence(l); }}><GuardTag level={l} /></button>
                  ))}
                </span>
              )}
            </span>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => copy(loc, "location")} title={`Copy ${loc}`}>Copy path:line</button>
            <button className="btn sm ghost" onClick={() => copy(iri, "symbol id")} title={`Copy ${iri}`}>Copy id</button>
          </div>
        )}
        {blame !== null && (
          <div className="insp-blame">
            <div className="row"><span className="section-title" style={{ margin: 0 }}>Blame</span><span className="spacer" /><button className="btn ghost sm" aria-label="Hide blame" onClick={() => setBlame(null)}><Icon.close /></button></div>
            <ShowOutput text={blame} />
          </div>
        )}
      </header>
      <div className="tabs">
        {(["context", "impact", "edit", "history", "source", "notes"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "edit" ? "Pre-edit" : t === "notes" ? "Notes" : t[0].toUpperCase() + t.slice(1)}{t === "notes" && ctx && ctx.notes.length + (ctx.memories?.length ?? 0) ? ` ${ctx.notes.length + (ctx.memories?.length ?? 0)}` : ""}
          </button>
        ))}
      </div>
      <div className="body">
        {!ctx ? <div className="muted" style={{ padding: 16 }}>Loading…</div> : tab === "context" ? (
          <>
            {ctx.container && (<><div className="section-title">Defined in</div><Sym n={ctx.container} onClick={go} /></>)}
            {lists.filter(([, l]) => l.length).map(([t, l, dir]) => (
              <div key={t}>
                <div className={`section-title ${dir}`}>{t} <span className="count">{l.length}</span></div>
                {l.slice(0, 60).map((n) => <Sym key={n.id} n={n} onClick={go} right={n.path === ctx.node.path ? `:${n.start_line}` : undefined} />)}
              </div>
            ))}
            {lists.every(([, l]) => !l.length) && <Empty title="Isolated">No resolved relationships.</Empty>}
          </>
        ) : tab === "impact" ? (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="seg">
                <button className={dir === "up" ? "on" : ""} onClick={() => setDir("up")}>Dependents</button>
                <button className={dir === "down" ? "on" : ""} onClick={() => setDir("down")}>Dependencies</button>
              </div>
            </div>
            {impact && (
              <>
                <div className="stat-row">
                  <div className="stat"><b className={`risk ${impact.risk}`}>{impact.risk}</b><span>risk</span></div>
                  <div className="stat"><b>{impact.hits.length}</b><span>symbols</span></div>
                  <div className="stat"><b>{impact.files}</b><span>files</span></div>
                </div>
                {[1, 2, 3].map((d) => {
                  const l = impact.hits.filter((h) => h.depth === d);
                  return l.length ? (
                    <div key={d}>
                      <div className="section-title">{d === 1 ? "Direct" : `Depth ${d}`} <span className="count">{l.length}</span></div>
                      {l.slice(0, 50).map((h) => <Sym key={h.node.id} n={h.node} onClick={go} />)}
                    </div>
                  ) : null;
                })}
                {!impact.hits.length && <Empty title="Nothing ripples">Changing this is contained.</Empty>}
              </>
            )}
          </>
        ) : tab === "edit" ? (
          <PreEditPanel id={id} />
        ) : tab === "history" ? (
          !hist ? <div className="muted" style={{ padding: "16px 0" }}>Reading git history…</div> : (
            <>
              <div className="section-title">Owners</div>
              {hist.owners.length === 0 && <div className="muted">No commits touch this yet.</div>}
              {hist.owners.slice(0, 5).map(([who, n]) => (
                <div key={who} className="owner-row">
                  <span className="avatar">{who.slice(0, 1).toUpperCase()}</span>
                  <span>{who}</span>
                  <div className="owner-bar"><i style={{ width: `${(n / hist.owners[0][1]) * 100}%` }} /></div>
                  <span className="muted">{n}</span>
                </div>
              ))}
              <div className="section-title">Commits touching {ctx.node.kind === "file" ? "this file" : "these lines"} <span className="count">{hist.commits.length}</span></div>
              {hist.commits.map((c) => (
                <div key={c.sha} className="sym" onClick={() => goView("history", { sha: c.sha })}>
                  <span className="mono muted" style={{ fontSize: 11 }}>{c.short}</span>
                  <span className="nm" style={{ fontFamily: "var(--font)" }}>{c.subject}</span>
                  <span className="p">{c.author} · {relTime(c.time)}</span>
                </div>
              ))}
            </>
          )
        ) : tab === "source" ? (
          <pre className="code" style={{ marginTop: 12, maxHeight: "none" }}>{ctx.snippet || "(empty)"}</pre>
        ) : (
          <div style={{ marginTop: 12 }}>
            {!!ctx.memories?.length && (
              <>
                <div className="section-title">Agent memory <span className="count">{ctx.memories.length}</span></div>
                {ctx.memories.map((m) => (
                  <div key={m.id} className={`note mem ${m.stale ? "stale" : ""}`}>
                    <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                      <span className={`tag ${m.stale ? "yellow" : "green"}`}>{m.stale ? "stale" : "fresh"}</span>
                      {m.via !== "self" && <span className="tag">{m.via}</span>}
                      <span className="spacer" />
                      {m.stale && <button className="btn sm ghost" onClick={async () => { await api.agentAction("confirm", { id: m.id }); toast("Re-anchored"); load(); }}>Still true</button>}
                    </div>
                    <div>{m.body}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{m.author} · {relTime(m.created)}{m.via !== "self" ? ` · on ${m.target.replace(/^symbol:/, "")}` : ""}</div>
                  </div>
                ))}
              </>
            )}
            {ctx.notes.length > 0 && <div className="section-title">Notes <span className="count">{ctx.notes.length}</span></div>}
            {ctx.notes.map((n) => (
              <div key={n.id} className="note"><Md text={n.body} /><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{n.author}</div></div>
            ))}
            <div className="seg note-kind" role="radiogroup" aria-label="Save as">
              <button className={!asMemory ? "on" : ""} role="radio" aria-checked={!asMemory} onClick={() => setAsMemory(false)}>Note</button>
              <button className={asMemory ? "on" : ""} role="radio" aria-checked={asMemory} onClick={() => setAsMemory(true)}>Agent memory</button>
            </div>
            <LinkArea placeholder={asMemory ? `One fact agents should know about ${ctx.node.name}. It goes stale when this code changes.` : `Annotate ${ctx.node.name}… type [[ to link a symbol`} value={note} onChange={setNote} label={asMemory ? "Memory" : "Note"} />
            <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
              <button className="btn primary" disabled={!note.trim()} onClick={async () => {
                try {
                  if (asMemory) await api.agentAction("remember", { target: target.replace(/^symbol:/, ""), text: note });
                  else await api.metaAction("notes", "new", { target, body: note });
                  setNote(""); toast(asMemory ? "Remembered – anchored to this code" : "Note saved to refs/kula/meta"); load();
                } catch (e: any) { toast(e.message, "err"); }
              }}>{asMemory ? "Remember" : "Save note"}</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
