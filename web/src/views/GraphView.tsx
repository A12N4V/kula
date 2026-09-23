import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { api, colorFor, type Context, type GraphData, type Impact, type Node } from "../api";
import { Empty, Icon, Kind, Logo, Md, Sym, useToast } from "../ui";

type Props = { focus: number | null; setFocus: (id: number | null) => void; onChanged: () => void; version: number; theme?: string | null };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

// Dark-aware hover label (sigma's default is a white box).
function drawHover(ctx: CanvasRenderingContext2D, data: any, settings: any) {
  const size = settings.labelSize + 1;
  ctx.font = `500 ${size}px ${settings.labelFont}`;
  const label = data.label ?? "";
  const w = ctx.measureText(label).width + 16;
  const h = size + 12;
  const x = data.x + data.size + 6;
  const y = data.y - h / 2;
  ctx.fillStyle = cssVar("--panel-2");
  ctx.strokeStyle = cssVar("--line-2");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = cssVar("--text");
  ctx.fillText(label, x + 8, data.y + size / 3);
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export default function GraphView({ focus, setFocus, onChanged, version, theme }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const [level, setLevel] = useState<"symbol" | "file">("symbol");
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cluster, setCluster] = useState<number | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [showLegend, setShowLegend] = useState(() => window.innerWidth > 760);
  const state = useRef({ hover: null as string | null, focus: null as number | null, cluster: null as number | null, impact: null as Set<string> | null, neigh: new Set<string>() });

  useEffect(() => {
    setData(null);
    setErr(null);
    api.graph(level).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [level, version]);

  // Build graph + layout.
  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph({ multi: false, type: "directed" });
    const comms = new Map(data.communities.map((c) => [c.id, c]));
    const byComm = new Map<number, number>();
    data.nodes.forEach((n) => byComm.set(n.community, (byComm.get(n.community) ?? 0) + 1));
    const order = [...byComm.keys()].sort((a, b) => (byComm.get(b)! - byComm.get(a)!));
    const angle = new Map(order.map((c, i) => [c, (i / Math.max(order.length, 1)) * Math.PI * 2]));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of data.nodes) {
      const a = angle.get(n.community) ?? 0;
      const r = 60 + (comms.get(n.community)?.size ?? 1) ** 0.5 * 4;
      g.addNode(String(n.id), {
        x: Math.cos(a) * r + (rnd() - 0.5) * 40,
        y: Math.sin(a) * r + (rnd() - 0.5) * 40,
        label: n.name,
        color: n.kind === "file" && level === "symbol" ? cssVar("--text-3") : colorFor(n.community),
        size: 2,
        node: n,
      });
    }
    for (const e of data.edges) {
      const s = String(e.src), t = String(e.dst);
      if (s === t || !g.hasNode(s) || !g.hasNode(t) || g.hasEdge(s, t)) continue;
      const same = g.getNodeAttribute(s, "node").community === g.getNodeAttribute(t, "node").community;
      g.addEdge(s, t, { kind: e.kind, size: e.kind === "CALLS" ? 0.6 : 0.4, color: cssVar("--line-2"), weight: same ? 3 : 0.35 });
    }
    g.forEachNode((id, attr) => {
      const deg = g.degree(id);
      const base = attr.node.kind === "class" ? 4 : attr.node.kind === "file" ? (level === "file" ? 4 : 2.5) : 2.5;
      g.setNodeAttribute(id, "size", Math.min(18, base + Math.sqrt(deg) * 1.4));
    });
    if (g.order > 1) {
      const settings = forceAtlas2.inferSettings(g);
      forceAtlas2.assign(g, { iterations: g.order > 3000 ? 120 : 260, settings: { ...settings, linLogMode: true, outboundAttractionDistribution: true, edgeWeightInfluence: 1, gravity: 1.2, scalingRatio: 6, barnesHutOptimize: g.order > 800, adjustSizes: false } });
      noverlap.assign(g, { maxIterations: 60, settings: { margin: 2, ratio: 1.1 } });
    }
    return g;
  }, [data, level, theme]); // theme: node colours come from the active palette

  // Sigma renderer.
  useEffect(() => {
    if (!graph || !box.current) return;
    let s: Sigma;
    try {
      s = new Sigma(graph, box.current, {
      renderEdgeLabels: false,
      labelFont: "Geist Variable, system-ui, sans-serif",
      labelSize: 11,
      labelWeight: "500",
      labelColor: { color: cssVar("--text-2") },
      labelDensity: 0.6,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 7,
      defaultEdgeType: "line",
      zIndex: true,
      defaultDrawNodeHover: drawHover,
      minCameraRatio: 0.05,
      maxCameraRatio: 8,
      });
    } catch (e) {
      setErr("This browser could not start WebGL, which the graph needs. Other views still work.");
      return;
    }
    const faded = cssVar("--line");
    const accent = cssVar("--accent");
    s.setSetting("nodeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      if (st.impact) {
        if (id === String(st.focus)) { res.highlighted = true; res.zIndex = 3; }
        else if (st.impact.has(id)) { res.color = accent; res.zIndex = 2; res.forceLabel = true; }
        else { res.color = faded; res.label = ""; res.zIndex = 0; res.size = Math.max(1.5, attr.size * 0.45); }
        return res;
      }
      if (st.cluster != null && attr.node.community !== st.cluster) { res.color = faded; res.label = ""; res.size = Math.max(1.5, attr.size * 0.45); return res; }
      if (active) {
        if (id === active) { res.highlighted = true; res.zIndex = 3; res.forceLabel = true; }
        else if (st.neigh.has(id)) { res.zIndex = 2; res.forceLabel = true; }
        else { res.color = faded; res.label = ""; res.zIndex = 0; res.size = Math.max(1.5, attr.size * 0.45); }
      }
      return res;
    });
    s.setSetting("edgeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      const [src, dst] = graph.extremities(id);
      if (st.impact) {
        const on = (st.impact.has(src) || src === String(st.focus)) && (st.impact.has(dst) || dst === String(st.focus));
        if (on) { res.color = accent; res.size = 1.4; res.zIndex = 2; } else res.hidden = true;
        return res;
      }
      const active = st.hover ?? (st.focus != null ? String(st.focus) : null);
      if (st.cluster != null) {
        const a = graph.getNodeAttribute(src, "node").community, b = graph.getNodeAttribute(dst, "node").community;
        if (a !== st.cluster && b !== st.cluster) res.hidden = true;
      } else if (active) {
        if (src === active || dst === active) {
          res.color = colorFor(graph.getNodeAttribute(active, "node").community);
          res.size = 1.2;
          res.zIndex = 2;
        } else res.hidden = true;
      }
      return res;
    });
    s.on("enterNode", ({ node }) => { setHover(node); box.current!.style.cursor = "pointer"; });
    s.on("leaveNode", () => { setHover(null); box.current!.style.cursor = ""; });
    s.on("clickNode", ({ node }) => setFocus(Number(node)));
    s.on("clickStage", () => { setFocus(null); setImpact(null); });
    sigma.current = s;
    return () => { s.kill(); sigma.current = null; };
  }, [graph, setFocus]);

  // Push interaction state to the reducers.
  useEffect(() => {
    const st = state.current;
    st.hover = hover;
    st.focus = focus;
    st.cluster = cluster;
    st.impact = impact ? new Set(impact.hits.map((h) => String(h.node.id))) : null;
    const active = hover ?? (focus != null ? String(focus) : null);
    st.neigh = new Set(active && graph?.hasNode(active) ? graph.neighbors(active) : []);
    sigma.current?.refresh({ skipIndexation: true });
  }, [hover, focus, cluster, impact, graph]);

  // Fly to focused node.
  useEffect(() => {
    if (focus == null || !sigma.current || !graph?.hasNode(String(focus))) return;
    const pos = sigma.current.getNodeDisplayData(String(focus));
    if (pos) sigma.current.getCamera().animate({ x: pos.x, y: pos.y, ratio: Math.min(sigma.current.getCamera().ratio, 0.45) }, { duration: 550 });
  }, [focus, graph]);

  useEffect(() => { if (focus == null) setImpact(null); }, [focus]);

  const cam = (f: (c: ReturnType<Sigma["getCamera"]>) => void) => sigma.current && f(sigma.current.getCamera());
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
        {data && <span className="chip hide-sm">{data.nodes.length.toLocaleString()} nodes · {data.edges.length.toLocaleString()} edges{data.truncated ? " · top by degree" : ""}</span>}
      </div>

      {showLegend && communities.length > 0 && (
        <div className="graph-overlay legend">
          <div className="section-title" style={{ marginTop: 0 }}>Clusters <span className="count">{communities.length}</span></div>
          {communities.slice(0, 40).map((c) => (
            <div key={c.id} className={`li ${cluster === c.id ? "on" : ""}`} onClick={() => setCluster(cluster === c.id ? null : c.id)}>
              <span className="sw" style={{ background: colorFor(c.id) }} />
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
      </div>

      {focus != null && <Inspector id={focus} onClose={() => setFocus(null)} setFocus={setFocus} impact={impact} setImpact={setImpact} />}
    </div>
  );
}

function Inspector({ id, onClose, setFocus, impact, setImpact }: { id: number; onClose: () => void; setFocus: (id: number) => void; impact: Impact | null; setImpact: (i: Impact | null) => void }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [tab, setTab] = useState<"context" | "impact" | "source" | "notes">("context");
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
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </div>
        <h2>{ctx?.node.name ?? "…"}</h2>
        {ctx && <div className="muted mono" style={{ fontSize: 11.5 }}>{ctx.node.path}:{ctx.node.start_line}–{ctx.node.end_line}</div>}
        {ctx?.community && <div style={{ marginTop: 8 }}><span className="tag" style={{ color: colorFor(ctx.node.community) }}>■ {ctx.community}</span></div>}
      </header>
      <div className="tabs">
        {(["context", "impact", "source", "notes"] as const).map((t) => (
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
