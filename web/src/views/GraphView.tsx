import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import EdgeCurveProgram from "@sigma/edge-curve";
import { attachOverlay, drawHover, drawOutlinedLabel, type Overlay } from "../graphfx";
import { api, colorFor, relTime, type Context, type GraphData, type Impact, type Node, type SymbolHistory } from "../api";
import { blend, churnColor, dirColor, GLYPH, groupDirs, hue, kindColor, LANG_GLYPH, makeColorer } from "../colors";
import { knownDirs, useSettings, type Settings } from "../settings";
import { Empty, Icon, Kind, Logo, Md, Sym, useToast } from "../ui";
import Contrast from "./Contrast";
import type { ContrastMode, Go } from "../nav";

type Props = {
  focus: number | null; setFocus: (id: number | null) => void; onChanged: () => void; version: number;
  contrast: { base: string; head: string; mode?: ContrastMode } | null; setContrast: (c: { base: string; head: string; mode?: ContrastMode } | null) => void; go: Go;
  openSettings: () => void;
};

/** ForceAtlas2 tuned for code graphs: tight directories, readable bridges. */
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

function MapView({ focus, setFocus, onChanged, version, setContrast, go, openSettings }: Props) {
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
  const overlay = useRef<Overlay | null>(null);
  const state = useRef({ hover: null as string | null, focus: null as number | null, filter: null as Filter, impact: null as Map<string, number> | null, neigh: new Set<string>() });

  useEffect(() => {
    setData(null);
    setErr(null);
    api.graph(level).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [level, version]);

  const churn = data?.churn ?? {};
  // Territories and colours follow the chosen depth; the layout always uses the automatic one.
  const groups = useMemo(() => groupDirs(data?.nodes.map((n) => n.path) ?? [], s.dirDepth), [data, s.dirDepth]);
  const colorer = useMemo(() => makeColorer(s, groups, churn), [s.colorBy, s.dirColors, s.theme, groups, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = useRef({ groups, colorer });
  look.current = { groups, colorer };
  useEffect(() => { knownDirs.set({ list: groups.sizes.map(([d, n]) => [d, n, groups.label(d)]), depth: groups.depth }); }, [groups]);

  // Build the graph: seeded by directory on a golden-angle spiral, refined live by the worker.
  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph({ multi: false, type: "directed" });
    const lay = groupDirs(data.nodes.map((n) => n.path), 0);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const spread = Math.sqrt(data.nodes.length) * 14;
    const centre = new Map(lay.sizes.map(([d], i) => {
      const r = spread * Math.sqrt((i + 0.5) / lay.sizes.length);
      return [d, { x: r * Math.cos(i * golden), y: r * Math.sin(i * golden) }];
    }));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of data.nodes) {
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
      g.mergeNodeAttributes(id, { rank: i, deg, din: g.inDegree(id), dout: g.outDegree(id), size: Math.min(18, (kind === "file" || kind === "class" ? 3.6 : 2.4) + Math.sqrt(deg) * 1.35) });
    });
    // One invisible anchor per directory, tied to its members: the layout pulls each
    // directory into its own region, so territories read as places rather than a blend.
    for (const [d] of lay.sizes) {
      const anchor = `__dir:${d}`;
      const c = centre.get(d)!;
      g.addNode(anchor, { x: c.x, y: c.y, size: 0.1, virtual: true, label: "" });
    }
    g.forEachNode((id, a) => { if (!a.virtual) g.addEdge(`__dir:${a.dir}`, id, { virtual: true, weight: 1.2, size: 0.1, color: "#000" }); });
    if (g.order > 1) forceAtlas2.assign(g, { iterations: 40, settings: layoutSettings(g) });
    return g;
  }, [data]);

  // Theme tokens the reducers read (refreshed when the theme changes).
  const theme = useMemo(() => ({
    bg: cssVar("--bg"), faded: cssVar("--node-faded"), accent: cssVar("--accent"), text3: cssVar("--text-3"), in: cssVar("--blue"), out: cssVar("--accent"),
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
        labelFont: "Geist Variable, system-ui, sans-serif",
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
      const res: any = { ...attr, color: colorer.node(attr.node) };
      const hub = c.hubIcons && isHub(attr);
      if (hub) res.forceLabel = true;
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      const dim = () => { res.color = theme.faded; res.dimmed = true; res.label = ""; res.forceLabel = false; res.zIndex = 0; res.size = Math.max(1.4, attr.size * 0.45); };
      const f = st.filter;
      if (st.impact) {
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
    r.on("clickNode", ({ node }) => setFocus(Number(node)));
    r.on("clickStage", () => { setFocus(null); setImpact(null); });

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const ov = attachOverlay(r, graph, {
      group: (a) => (a.virtual ? null : look.current.groups.of(a.node.path)),
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
      setSettling(true);
      timer = window.setTimeout(() => {
        worker?.stop();
        noverlap.assign(graph, { maxIterations: 40, settings: { margin: 3, ratio: 1.15 } });
        setSettling(false);
      }, Math.min(4500, 1400 + graph.order * 4));
    } else {
      forceAtlas2.assign(graph, { iterations: 200, settings: layoutSettings(graph) });
      noverlap.assign(graph, { maxIterations: 40, settings: { margin: 3, ratio: 1.15 } });
    }
    sigma.current = r;
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
      quiet: !!active || !!st.impact || !!filter,
      focusMode: !!active || !!st.impact,
      activeGroup: peek ?? (filter?.type === "dir" ? filter.key : activeNode ? groups.of(activeNode.node.path) : null),
    });
  }, [hover, focus, filter, impact, graph, s.flow, peek, groups]);

  // Fly to the focused node.
  useEffect(() => {
    if (focus == null || !sigma.current || !graph?.hasNode(String(focus))) return;
    const pos = sigma.current.getNodeDisplayData(String(focus));
    if (pos) sigma.current.getCamera().animate({ x: pos.x, y: pos.y, ratio: Math.min(sigma.current.getCamera().ratio, 0.45) }, { duration: 650 });
  }, [focus, graph, settling]);

  useEffect(() => { if (focus == null) setImpact(null); }, [focus]);
  useEffect(() => setFilter(null), [s.colorBy, s.dirDepth, level]);

  const cam = (f: (c: ReturnType<Sigma["getCamera"]>) => void) => sigma.current && f(sigma.current.getCamera());
  const hovered = hover && graph?.hasNode(hover) && !hover.startsWith("__dir:") ? graph.getNodeAttributes(hover) : null;
  const hubCount = graph ? graph.filterNodes((_id, a) => isHub(a)).length : 0;

  return (
    <div className={`graph-wrap ${focus != null ? "inspecting" : ""}`}>
      <div ref={box} className="graph-canvas" />
      {!data && !err && <div className="loading"><div className="stack" style={{ alignItems: "center" }}><Logo spin /><span>Laying out the graph…</span></div></div>}
      {err && <div className="loading"><Empty title={err.includes("WebGL") ? "Graph unavailable" : "No graph yet"}>{err}{!err.includes("WebGL") && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => api.reindex().then(onChanged)}>Build graph</button></div>}</Empty></div>}

      <div className="graph-overlay hud">
        <div className="seg">
          <button className={level === "symbol" ? "on" : ""} onClick={() => setLevel("symbol")}>Symbols</button>
          <button className={level === "file" ? "on" : ""} onClick={() => setLevel("file")}>Files</button>
        </div>
        <button className="btn sm hud-btn" onClick={() => setContrast({ base: "HEAD", head: "WORKTREE" })} title="Overlay two revisions' graphs"><Icon.compare /> Contrast</button>
        <button className="btn sm hud-btn icon-only" onClick={openSettings} title="Graph settings  ," aria-label="Graph settings"><Icon.sliders /></button>
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

      {hovered && hover !== String(focus) && <HoverCard n={hovered.node} dir={groups.label(groups.of(hovered.node.path))} deg={[hovered.din, hovered.dout]} churn={churn[hovered.node.path] ?? 0} hub={isHub(hovered)} />}

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

      {focus != null && <Inspector id={focus} onClose={() => setFocus(null)} setFocus={setFocus} impact={impact} setImpact={setImpact} go={go} churn={churn} deg={graph?.hasNode(String(focus)) ? [graph.getNodeAttribute(String(focus), "din"), graph.getNodeAttribute(String(focus), "dout")] : null} />}
    </div>
  );
}

function HoverCard({ n, dir, deg, churn, hub }: { n: Node; dir: string; deg: [number, number]; churn: number; hub: boolean }) {
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
      </div>
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

function Inspector({ id, onClose, setFocus, impact, setImpact, go: goView, churn, deg }: {
  id: number; onClose: () => void; setFocus: (id: number) => void; impact: Impact | null; setImpact: (i: Impact | null) => void; go: Go;
  churn: Record<string, number>; deg: [number, number] | null;
}) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [tab, setTab] = useState<"context" | "impact" | "history" | "source" | "notes">("context");
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
  const toast = useToast();
  const load = () => api.symbol(id).then(setCtx).catch((e) => toast(e.message, "err"));
  // `#graph/<id>/impact` opens straight onto a tab (first load only).
  const initialTab = useRef(location.hash.split("/")[2] as typeof tab | undefined);
  useEffect(() => { setCtx(null); load(); setTab(initialTab.current ?? "context"); initialTab.current = undefined; }, [id]);
  useEffect(() => {
    if (tab === "impact") api.impact(id, dir).then(setImpact).catch((e) => toast(e.message, "err"));
    else setImpact(null);
    if (tab === "history") { setHist(null); api.history(id).then(setHist).catch((e) => toast(e.message, "err")); }
  }, [tab, dir, id]);

  const go = (n: Node) => setFocus(n.id);
  const lists: [string, Node[], string][] = ctx ? [["Called by", ctx.callers, "in"], ["Calls", ctx.callees, "out"], ["Contains", ctx.children, ""], ["Imports", ctx.imports, "out"], ["Imported by", ctx.imported_by, "in"]] : [];
  const target = ctx ? (ctx.node.kind === "file" ? `file:${ctx.node.path}` : `symbol:${ctx.node.path}:${ctx.node.name}`) : "";

  return (
    <aside className="inspector" aria-label="Symbol inspector">
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
      </header>
      <div className="tabs">
        {(["context", "impact", "history", "source", "notes"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}{t === "notes" && ctx?.notes.length ? ` ${ctx.notes.length}` : ""}
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
            {ctx.notes.map((n) => (
              <div key={n.id} className="note"><Md text={n.body} /><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{n.author}</div></div>
            ))}
            <textarea className="textarea" placeholder={`Annotate ${ctx.node.name}… use [[symbol]] to link`} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
              <button className="btn primary" disabled={!note.trim()} onClick={async () => {
                await api.metaAction("notes", "new", { target, body: note });
                setNote(""); toast("Note saved to refs/kula/meta"); load();
              }}>Save note</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
