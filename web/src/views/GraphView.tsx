import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import EdgeCurveProgram from "@sigma/edge-curve";
import { attachFx, drawOutlinedLabel } from "../graphfx";
import { api, colorFor, relTime, type Context, type GraphData, type Impact, type Node, type SymbolHistory } from "../api";
import { Empty, Icon, Kind, Logo, Md, Sym, useToast } from "../ui";
import Contrast from "./Contrast";
import type { Go } from "../nav";

type Props = {
  focus: number | null; setFocus: (id: number | null) => void; onChanged: () => void; version: number; theme?: string | null;
  contrast: { base: string; head: string } | null; setContrast: (c: { base: string; head: string } | null) => void; go: Go;
};

/** ForceAtlas2 tuned for code graphs: tight clusters, readable bridges. */
export function layoutSettings(g: Graph) {
  return { ...forceAtlas2.inferSettings(g), linLogMode: true, outboundAttractionDistribution: true, edgeWeightInfluence: 1, gravity: 1.1, scalingRatio: 7, slowDown: 3, barnesHutOptimize: g.order > 600 };
}

/**
 * Colour `c` at opacity `a`, pre-blended onto the page background.
 * The curved-edge shader ignores alpha, so translucency must be baked in.
 */
export function withAlpha(c: string, a: number) {
  const hex = (x: string) => {
    const n = parseInt(x.replace("#", "").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (!c.startsWith("#")) return c;
  const bg = cssVar("--bg");
  const [r, g, b] = hex(c);
  const [R, G, B] = bg.startsWith("#") ? hex(bg) : [8, 8, 11];
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, "0");
  return `#${mix(r, R)}${mix(g, G)}${mix(b, B)}`;
}

export function cssVar(name: string) {
  // Sigma's colour parser rejects "rgba(1, 2, 3, 0.4)" with spaces; normalise.
  return getComputedStyle(document.documentElement).getPropertyValue(name).replace(/\s+/g, "") || "#888";
}

// Dark-aware hover label (sigma's default is a white box).
export function drawHover(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  // Details live in the floating hover card; on canvas we just ring the node and label it.
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3.5, 0, Math.PI * 2);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawOutlinedLabel(ctx, { ...data, size: data.size + 3 }, { ...settings, labelWeight: "600" });
}

export default function GraphView(props: Props) {
  const { contrast, setContrast, setFocus } = props;
  if (contrast)
    return (
      <Contrast
        base={contrast.base}
        head={contrast.head}
        theme={props.theme}
        onChange={(base, head) => setContrast({ base, head })}
        onExit={() => setContrast(null)}
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

function MapView({ focus, setFocus, onChanged, version, theme, setContrast, go }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const [level, setLevel] = useState<"symbol" | "file">("symbol");
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cluster, setCluster] = useState<number | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [showLegend, setShowLegend] = useState(() => window.innerWidth > 760);
  const [settling, setSettling] = useState(false);
  const fx = useRef<ReturnType<typeof attachFx> | null>(null);
  const state = useRef({ hover: null as string | null, focus: null as number | null, cluster: null as number | null, impact: null as Set<string> | null, neigh: new Set<string>() });

  useEffect(() => {
    setData(null);
    setErr(null);
    api.graph(level).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [level, version]);

  // Build graph with a golden-angle cluster seed (the live layout refines it).
  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph({ multi: false, type: "directed" });
    const byComm = new Map<number, number>();
    data.nodes.forEach((n) => byComm.set(n.community, (byComm.get(n.community) ?? 0) + 1));
    const order = [...byComm.keys()].sort((a, b) => byComm.get(b)! - byComm.get(a)!);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const spread = Math.sqrt(data.nodes.length) * 14;
    const centre = new Map(order.map((c, i) => {
      const r = spread * Math.sqrt((i + 0.5) / order.length);
      return [c, { x: r * Math.cos(i * golden), y: r * Math.sin(i * golden) }];
    }));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of data.nodes) {
      const c = centre.get(n.community)!;
      const j = Math.sqrt(byComm.get(n.community) ?? 1) * 5;
      g.addNode(String(n.id), { x: c.x + (rnd() - 0.5) * j, y: c.y + (rnd() - 0.5) * j, label: n.name, color: colorFor(n.community), size: 2, node: n });
    }
    const neutral = withAlpha(cssVar("--text-3"), 0.3);
    for (const e of data.edges) {
      const s = String(e.src), t = String(e.dst);
      if (s === t || !g.hasNode(s) || !g.hasNode(t) || g.hasEdge(s, t)) continue;
      const cs = g.getNodeAttribute(s, "node").community, ct = g.getNodeAttribute(t, "node").community;
      const same = cs === ct;
      // Intra-cluster edges take the cluster's hue; bridges stay neutral.
      g.addEdge(s, t, { kind: e.kind, size: e.kind === "CALLS" ? 0.7 : 0.45, color: same ? withAlpha(colorFor(cs), 0.42) : neutral, weight: same ? 3 : 0.35 });
    }
    let maxDeg = 1;
    g.forEachNode((id) => { maxDeg = Math.max(maxDeg, g.degree(id)); });
    g.forEachNode((id, attr) => {
      const deg = g.degree(id);
      const base = attr.node.kind === "file" ? 4 : attr.node.kind === "class" ? 4 : 2.6;
      g.setNodeAttribute(id, "size", Math.min(20, base + Math.sqrt(deg) * 1.5));
      g.setNodeAttribute(id, "hub", deg >= Math.max(6, maxDeg * 0.35));
    });
    if (g.order > 1) {
      // A short warm-up so the first frame is already shaped; the worker finishes it live.
      forceAtlas2.assign(g, { iterations: 40, settings: layoutSettings(g) });
    }
    return g;
  }, [data, level, theme]); // theme: node colours come from the active palette

  // Sigma renderer + effects + live layout.
  useEffect(() => {
    if (!graph || !box.current) return;
    let s: Sigma;
    try {
      s = new Sigma(graph, box.current, {
        renderEdgeLabels: false,
        labelFont: "Geist Variable, system-ui, sans-serif",
        labelSize: 11.5,
        labelWeight: "500",
        labelColor: { color: cssVar("--text") },
        labelDensity: 0.7,
        labelGridCellSize: 100,
        labelRenderedSizeThreshold: 6,
        defaultEdgeType: "curved",
        edgeProgramClasses: { curved: EdgeCurveProgram },
        defaultDrawNodeLabel: drawOutlinedLabel,
        defaultDrawNodeHover: drawHover,
        hideEdgesOnMove: true,
        zIndex: true,
        minCameraRatio: 0.03,
        maxCameraRatio: 6,
      });
    } catch {
      setErr("This browser could not start WebGL, which the graph needs. Other views still work.");
      return;
    }
    const faded = cssVar("--node-faded");
    const accent = cssVar("--accent");
    s.setSetting("nodeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      const dim = () => { res.color = faded; res.label = ""; res.zIndex = 0; res.size = Math.max(1.4, attr.size * 0.4); };
      if (st.impact) {
        if (id === String(st.focus)) { res.highlighted = true; res.zIndex = 3; }
        else if (st.impact.has(id)) { res.color = accent; res.zIndex = 2; res.forceLabel = true; }
        else dim();
        return res;
      }
      if (st.cluster != null && attr.node.community !== st.cluster) { dim(); return res; }
      if (active) {
        if (id === active) { res.highlighted = true; res.zIndex = 3; res.forceLabel = true; }
        else if (st.neigh.has(id)) { res.zIndex = 2; res.forceLabel = true; }
        else dim();
      }
      return res;
    });
    s.setSetting("edgeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      const [src, dst] = graph.extremities(id);
      if (st.impact) {
        const on = (st.impact.has(src) || src === String(st.focus)) && (st.impact.has(dst) || dst === String(st.focus));
        if (on) { res.color = withAlpha(accent, 0.75); res.size = 1.5; res.zIndex = 2; } else res.hidden = true;
        return res;
      }
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      if (st.cluster != null) {
        const a = graph.getNodeAttribute(src, "node").community, b = graph.getNodeAttribute(dst, "node").community;
        if (a !== st.cluster && b !== st.cluster) res.hidden = true;
      } else if (active) {
        if (src === active || dst === active) {
          res.color = withAlpha(colorFor(graph.getNodeAttribute(active, "node").community), 0.85);
          res.size = 1.4;
          res.zIndex = 2;
        } else res.hidden = true;
      }
      return res;
    });
    s.on("enterNode", ({ node }) => { setHover(node); box.current!.style.cursor = "pointer"; });
    s.on("leaveNode", () => { setHover(null); box.current!.style.cursor = ""; });
    s.on("clickNode", ({ node }) => setFocus(Number(node)));
    s.on("clickStage", () => { setFocus(null); setImpact(null); });

    // "src/views · MetaViews" → "MetaViews": the distinctive half of the cluster name.
    const labels = new Map(data?.communities.map((c) => [c.id, c.label.split(" · ").pop()!.split("/").pop()!]) ?? []);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const effects = attachFx(s, graph, {
      clusterOf: (a) => a.node.community,
      clusterLabel: (c) => labels.get(c),
      clusterColor: colorFor,
      glow: (id, a) => {
        const st = state.current;
        if (st.impact?.has(id)) return 1;
        return a.hub ? 1 : 0;
      },
      reducedMotion: reduced,
    });
    fx.current = effects;

    // Live layout: the graph settles on screen in a worker thread.
    let worker: FA2Layout | null = null;
    let timer = 0;
    if (!reduced && graph.order > 2) {
      worker = new FA2Layout(graph, { settings: layoutSettings(graph) });
      worker.start();
      setSettling(true);
      timer = window.setTimeout(() => {
        worker?.stop();
        noverlap.assign(graph, { maxIterations: 40, settings: { margin: 2, ratio: 1.1 } });
        setSettling(false);
      }, Math.min(4500, 1400 + graph.order * 4));
    } else {
      forceAtlas2.assign(graph, { iterations: 200, settings: layoutSettings(graph) });
      noverlap.assign(graph, { maxIterations: 40, settings: { margin: 2, ratio: 1.1 } });
    }
    sigma.current = s;
    return () => {
      clearTimeout(timer);
      worker?.kill();
      effects.kill();
      fx.current = null;
      s.kill();
      sigma.current = null;
      setSettling(false);
    };
  }, [graph, setFocus]);

  // Push interaction state to the reducers and the effects layer.
  useEffect(() => {
    const st = state.current;
    st.hover = hover;
    st.focus = focus;
    st.cluster = cluster;
    st.impact = impact ? new Set(impact.hits.map((h) => String(h.node.id))) : null;
    const active = hover ?? (focus != null ? String(focus) : null);
    st.neigh = new Set(active && graph?.hasNode(active) ? graph.neighbors(active) : []);
    sigma.current?.refresh({ skipIndexation: true });
    if (!graph || !fx.current) return;
    // Particles run along the focused symbol's calls (or the whole impact cone).
    const flows: [string, string][] = [];
    const f = focus != null ? String(focus) : null;
    if (st.impact && f) {
      graph.forEachEdge((_e, _a, src, dst) => {
        if (flows.length < 160 && (st.impact!.has(src) || src === f) && (st.impact!.has(dst) || dst === f)) flows.push([src, dst]);
      });
    } else if (f && graph.hasNode(f)) {
      graph.forEachEdge(f, (_e, _a, src, dst) => { if (flows.length < 120) flows.push([src, dst]); });
    }
    fx.current.set({ focus: f && graph.hasNode(f) ? f : null, flows, dimOthers: active || st.impact ? new Set([...(st.impact ?? []), ...st.neigh, ...(active ? [active] : [])]) : null });
  }, [hover, focus, cluster, impact, graph]);

  // Fly to focused node.
  useEffect(() => {
    if (focus == null || !sigma.current || !graph?.hasNode(String(focus))) return;
    const pos = sigma.current.getNodeDisplayData(String(focus));
    if (pos) sigma.current.getCamera().animate({ x: pos.x, y: pos.y, ratio: Math.min(sigma.current.getCamera().ratio, 0.45) }, { duration: 650 });
  }, [focus, graph, settling]);

  useEffect(() => { if (focus == null) setImpact(null); }, [focus]);

  const cam = (f: (c: ReturnType<Sigma["getCamera"]>) => void) => sigma.current && f(sigma.current.getCamera());
  const hoverNode: Node | null = hover && graph?.hasNode(hover) && hover !== String(focus) ? graph.getNodeAttribute(hover, "node") : null;
  const hoverIn = hover && graph?.hasNode(hover) ? graph.inDegree(hover) : 0;
  const hoverOut = hover && graph?.hasNode(hover) ? graph.outDegree(hover) : 0;
  const communities = data?.communities.filter((c) => c.size > 1 && data.nodes.some((n) => n.community === c.id)) ?? [];

  return (
    <div className="graph-wrap">
      <div ref={box} className="graph-canvas" />
      {!data && !err && <div className="loading"><div className="stack" style={{ alignItems: "center" }}><Logo spin /><span>Laying out the graph…</span></div></div>}
      {err && <div className="loading"><Empty title={err.includes("WebGL") ? "Graph unavailable" : "No graph yet"}>{err}{!err.includes("WebGL") && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => api.reindex().then(onChanged)}>Build graph</button></div>}</Empty></div>}

      <div className="graph-overlay hud">
        <div className="seg">
          <button className={level === "symbol" ? "on" : ""} onClick={() => setLevel("symbol")}>Symbols</button>
          <button className={level === "file" ? "on" : ""} onClick={() => setLevel("file")}>Files</button>
        </div>
        <div className="seg"><button className={showLegend ? "on" : ""} onClick={() => setShowLegend((v) => !v)}>Clusters</button></div>
        <button className="btn sm" onClick={() => setContrast({ base: "HEAD", head: "WORKTREE" })} title="Overlay two revisions' graphs"><Icon.compare /> Contrast</button>
        {data && <span className="chip hide-sm">{settling ? <><span className="dot warn pulse" /> settling layout…</> : <>{data.nodes.length.toLocaleString()} nodes · {data.edges.length.toLocaleString()} edges{data.truncated ? " · top by degree" : ""}</>}</span>}
      </div>

      {hoverNode && (
        <div className="hover-card" key={hover!}>
          <Kind kind={hoverNode.kind} community={hoverNode.community} size={18} />
          <div>
            <div className="hc-name mono">{hoverNode.name}</div>
            <div className="hc-path mono">{hoverNode.path}:{hoverNode.start_line}</div>
          </div>
          <div className="hc-stats"><span><b>{hoverIn}</b> in</span><span><b>{hoverOut}</b> out</span></div>
        </div>
      )}

      {showLegend && communities.length > 0 && (
        <div className="graph-overlay legend">
          <div className="section-title" style={{ marginTop: 0 }}>Clusters <span className="count">{communities.length}</span></div>
          {communities.slice(0, 40).map((c) => (
            <div key={c.id} className={`li ${cluster === c.id ? "on" : ""}`} onClick={() => setCluster(cluster === c.id ? null : c.id)}>
              <span className="sw" style={{ background: colorFor(c.id), color: colorFor(c.id) }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              <span className="n">{c.size}</span>
            </div>
          ))}
        </div>
      )}

      <div className="graph-overlay zoom">
        <button className="btn" aria-label="Zoom in" onClick={() => cam((c) => c.animatedZoom({ duration: 200 }))}><Icon.plus /></button>
        <button className="btn" aria-label="Zoom out" onClick={() => cam((c) => c.animatedUnzoom({ duration: 200 }))}><Icon.minus /></button>
        <button className="btn" aria-label="Reset view" onClick={() => cam((c) => c.animatedReset({ duration: 300 }))}><Icon.target /></button>
        <button className="btn" aria-label="Re-run layout" title="Re-run layout" onClick={() => setData((d) => (d ? { ...d } : d))}><Icon.refresh /></button>
      </div>

      {focus != null && <Inspector id={focus} onClose={() => setFocus(null)} setFocus={setFocus} impact={impact} setImpact={setImpact} go={go} />}
    </div>
  );
}

function Inspector({ id, onClose, setFocus, impact, setImpact, go: goView }: { id: number; onClose: () => void; setFocus: (id: number) => void; impact: Impact | null; setImpact: (i: Impact | null) => void; go: Go }) {
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
  const lists: [string, Node[]][] = ctx ? [["Called by", ctx.callers], ["Calls", ctx.callees], ["Contains", ctx.children], ["Imports", ctx.imports], ["Imported by", ctx.imported_by]] : [];
  const target = ctx ? (ctx.node.kind === "file" ? `file:${ctx.node.path}` : `symbol:${ctx.node.path}:${ctx.node.name}`) : "";

  return (
    <aside className="inspector" aria-label="Symbol inspector">
      <header>
        <div className="row">
          <div className="kind">{ctx && <Kind kind={ctx.node.kind} community={ctx.node.community} size={15} />}{ctx?.node.kind ?? "loading"}</div>
          <span className="spacer" />
          <button className="btn ghost sm" disabled={trail.current.at <= 0} onClick={() => step(-1)} aria-label="Back" title="Back  [">←</button>
          <button className="btn ghost sm" disabled={trail.current.at >= trail.current.stack.length - 1} onClick={() => step(1)} aria-label="Forward" title="Forward  ]">→</button>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close" title="Close  esc"><Icon.close /></button>
        </div>
        <h2>{ctx?.node.name ?? "…"}</h2>
        {ctx && <div className="muted mono" style={{ fontSize: 11.5 }}>{ctx.node.path}:{ctx.node.start_line}–{ctx.node.end_line}</div>}
        {ctx?.community && <div style={{ marginTop: 8 }}><span className="tag" style={{ color: colorFor(ctx.node.community) }}>■ {ctx.community}</span></div>}
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
            {lists.filter(([, l]) => l.length).map(([t, l]) => (
              <div key={t}>
                <div className="section-title">{t} <span className="count">{l.length}</span></div>
                {l.slice(0, 60).map((n) => <Sym key={n.id} n={n} onClick={go} />)}
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
