import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { api, type Compare as CompareT, type DiffNode, type DiffStatus, type GraphDiff } from "../api";
import { CompareReport } from "./GitViews";
import type { ContrastMode } from "../nav";
import { Empty, Icon, Kind, Logo, useToast } from "../ui";
import EdgeCurveProgram from "@sigma/edge-curve";
import { EdgeRectangleProgram } from "sigma/rendering";
import { attachOverlay, drawHover, drawOutlinedLabel, type Overlay } from "../graphfx";
import { groupDirs } from "../colors";
import { useSettings } from "../settings";
import { CURVATURE, cssVar, withAlpha } from "./GraphView";
import { Grip } from "../resize";

type Props = {
  base: string;
  head: string;
  onChange: (base: string, head: string) => void;
  onExit: () => void;
  /** Jump to a symbol in the regular map. */
  openInMap: (name: string, path: string) => void;
  openSettings: () => void;
  mode: ContrastMode;
  onMode: (m: ContrastMode) => void;
};

const STATUS: { id: Exclude<DiffStatus, "same">; label: string; sign: string; color: string }[] = [
  { id: "added", label: "Added", sign: "+", color: "--green" },
  { id: "removed", label: "Removed", sign: "−", color: "--red" },
  { id: "modified", label: "Modified", sign: "~", color: "--yellow" },
];
const colorOf = (s: DiffStatus) => (s === "same" ? cssVar("--line-2") : cssVar(STATUS.find((x) => x.id === s)!.color));

/** Two revisions' knowledge graphs, overlaid: what the change does to the architecture. */
export default function Contrast({ base, head, onChange, onExit, openInMap, openSettings, mode, onMode: setMode }: Props) {
  const cfg = useSettings();
  const theme = cfg.theme;
  const box = useRef<HTMLDivElement>(null);
  const boxA = useRef<HTMLDivElement>(null);
  const boxB = useRef<HTMLDivElement>(null);
  const views = useRef<{ s: Sigma; ov: Overlay }[]>([]);
  const [report, setReport] = useState<CompareT | null>(null);

  const [diff, setDiff] = useState<GraphDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refs, setRefs] = useState<string[]>([]);
  const [showSame, setShowSame] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const state = useRef({ hover: null as string | null, focus: null as string | null, hidden: new Set<string>(), neigh: new Set<string>() });
  const toast = useToast();

  useEffect(() => {
    api.branches().then((b) => setRefs(["WORKTREE", ...b.branches.map((x) => x.name), ...b.tags])).catch(() => {});
  }, []);

  useEffect(() => {
    setDiff(null);
    setErr(null);
    setFocus(null);
    api.graphDiff(base, head, showSame ? undefined : "changed").then(setDiff).catch((e) => setErr(e.message));
  }, [base, head, showSame]);

  const graph = useMemo(() => {
    if (!diff) return null;
    const g = new Graph({ type: "directed" });
    // Seed each directory on its own bearing so territories come out compact.
    const lay = groupDirs(diff.nodes.map((n) => n.path), 0);
    const angle = new Map(lay.sizes.map(([d], i) => [d, (i / Math.max(1, lay.sizes.length)) * Math.PI * 2]));
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Ripple halo: unchanged neighbours of a change are lit so you see what it touches.
    const near = new Set<number>();
    const changedIds = new Set(diff.nodes.filter((n) => n.status !== "same").map((n) => n.id));
    for (const e of diff.edges) {
      if (changedIds.has(e.src)) near.add(e.dst);
      if (changedIds.has(e.dst)) near.add(e.src);
    }
    for (const n of diff.nodes) {
      const a = angle.get(lay.of(n.path)) ?? 0;
      const changed = n.status !== "same";
      const halo = !changed && near.has(n.id);
      g.addNode(String(n.id), {
        x: Math.cos(a) * 80 + (rnd() - 0.5) * 50,
        y: Math.sin(a) * 80 + (rnd() - 0.5) * 50,
        color: halo ? cssVar("--text-3") : colorOf(n.status),
        size: changed ? 8 : halo ? 4 : n.kind === "file" ? 3 : 2.2,
        zIndex: changed ? 3 : halo ? 1 : 0,
        forceLabel: changed,
        label: changed || halo ? (n.container ? `${n.container}.${n.name}` : n.name) : n.name,
        diff: n,
      });
    }
    for (const e of diff.edges) {
      const s = String(e.src), t = String(e.dst);
      if (s === t || !g.hasNode(s) || !g.hasNode(t) || g.hasEdge(s, t)) continue;
      const changed = e.status !== "same";
      const touchesChange = changedIds.has(e.src) || changedIds.has(e.dst);
      g.addEdge(s, t, { color: changed ? colorOf(e.status) : touchesChange ? withAlpha(cssVar("--text-2"), 0.55) : withAlpha(cssVar("--text-3"), 0.22), size: changed ? 1.8 : touchesChange ? 0.9 : 0.4, zIndex: changed ? 2 : touchesChange ? 1 : 0, status: e.status, weight: changed ? 2 : lay.of(g.getNodeAttribute(s, "diff").path) === lay.of(g.getNodeAttribute(t, "diff").path) ? 2 : 0.4 });
    }
    if (g.order > 1) {
      forceAtlas2.assign(g, { iterations: g.order > 3000 ? 120 : 240, settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, gravity: 1.2, scalingRatio: 6, barnesHutOptimize: g.order > 800 } });
      noverlap.assign(g, { maxIterations: 50, settings: { margin: 2 } });
    }
    return g;
  }, [diff, theme]);

  // Each revision on its own: the base graph (without additions) and the head graph
  // (without removals), sharing one layout so the same symbol sits in the same place.
  const sides = useMemo(() => {
    if (!graph) return null;
    const cut = (drop: DiffStatus) => {
      const g = new Graph({ type: "directed" });
      graph.forEachNode((id, a) => { if (a.diff.status !== drop) g.addNode(id, { ...a }); });
      graph.forEachEdge((_e, a, x, y) => { if (a.status !== drop && g.hasNode(x) && g.hasNode(y) && !g.hasEdge(x, y)) g.addEdge(x, y, { ...a }); });
      return g;
    };
    return { base: cut("added"), head: cut("removed") };
  }, [graph]);

  /** Mount one renderer (reducers, overlay, events) on `el` for graph `g`. */
  const mount = (el: HTMLDivElement, g: Graph) => {
    const s = new Sigma(g, el, {
      labelFont: "Geist Variable, system-ui, sans-serif",
      labelSize: 11,
      labelWeight: "500",
      labelColor: { color: cssVar("--text") },
      labelRenderedSizeThreshold: 5,
      zIndex: true,
      defaultEdgeType: cfg.curved ? "curved" : "line",
      edgeProgramClasses: { line: EdgeRectangleProgram, curved: EdgeCurveProgram },
      defaultDrawNodeLabel: drawOutlinedLabel,
      defaultDrawNodeHover: drawHover,
      hideEdgesOnMove: true,
    });
    const faded = cssVar("--line");
    s.setSetting("nodeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      if (st.hidden.has(attr.diff.status)) { res.hidden = true; return res; }
      const active = st.hover ?? st.focus;
      if (active && id !== active && !st.neigh.has(id)) { res.color = faded; res.label = ""; res.forceLabel = false; res.size = Math.max(1.5, attr.size * 0.5); }
      if (id === active) { res.zIndex = 3; }
      // Changed symbols are tiles carrying their sign; the WebGL disc underneath stays for picking.
      if (attr.diff.status !== "same" && attr.diff.kind !== "file" && res.color !== faded) { res.tile = res.color; res.hubTile = true; res.color = "rgba(0,0,0,0)"; }
      return res;
    });
    s.setSetting("edgeReducer", (id, attr) => {
      const st = state.current;
      const res: any = { ...attr };
      const [a, b] = g.extremities(id);
      const active = st.hover ?? st.focus;
      if (st.hidden.has(g.getNodeAttribute(a, "diff").status) || st.hidden.has(g.getNodeAttribute(b, "diff").status)) res.hidden = true;
      else if (active && a !== active && b !== active) res.hidden = true;
      return res;
    });
    s.on("enterNode", ({ node }) => { setHover(node); el.style.cursor = "pointer"; });
    s.on("leaveNode", () => { setHover(null); el.style.cursor = ""; });
    s.on("clickNode", ({ node }) => setFocus(Number(node)));
    s.on("clickStage", () => setFocus(null));
    // Directories as neutral territories (hue is reserved for the change status); new calls carry moving dots.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dirs = groupDirs(g.mapNodes((_id, a) => a.diff.path), cfg.dirDepth);
    const sign: Record<string, string> = { added: "+", removed: "−", modified: "~" };
    const ov = attachOverlay(s, g, {
      group: (a) => dirs.of(a.diff.path),
      groupLabel: (k) => dirs.label(k),
      groupColor: () => null,
      hub: (_id, a) => a.diff.status !== "same" && a.diff.kind !== "file",
      glyph: (a) => sign[a.diff.status] ?? "",
      reducedMotion: reduced,
    });
    const flows: [string, string][] = [];
    if (cfg.flow) g.forEachEdge((_e, a, src, dst) => { if (a.status === "added" && flows.length < 150) flows.push([src, dst]); });
    ov.set({ flows, territories: cfg.territories, curvature: cfg.curved ? CURVATURE : 0 });
    return { s, ov };
  };

  useEffect(() => {
    if (!graph || !sides || mode === "report") return;
    const made: { s: Sigma; ov: Overlay }[] = [];
    try {
      if (mode === "overlay" && box.current) made.push(mount(box.current, graph));
      if (mode === "split" && boxA.current && boxB.current) {
        made.push(mount(boxA.current, sides.base), mount(boxB.current, sides.head));
        // One camera for both: pan or zoom either side and the other follows.
        const [a, b] = made.map((m) => m.s.getCamera());
        let syncing = false;
        const link = (from: typeof a, to: typeof a) => from.on("updated", (st) => { if (syncing) return; syncing = true; to.setState(st); syncing = false; });
        link(a, b);
        link(b, a);
      }
    } catch {
      setErr("This browser could not start WebGL, which the graph needs.");
    }
    views.current = made;
    return () => { made.forEach(({ s, ov }) => { ov.kill(); s.kill(); }); views.current = []; };
  }, [graph, sides, mode, cfg.curved, cfg.flow, cfg.territories, cfg.dirDepth]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const st = state.current;
    st.hover = hover;
    st.focus = focus != null ? String(focus) : null;
    st.hidden = hidden;
    const active = st.hover ?? st.focus;
    st.neigh = new Set(active && graph?.hasNode(active) ? graph.neighbors(active) : []);
    for (const { s, ov } of views.current) {
      s.refresh({ skipIndexation: true });
      ov.set({ focus: st.focus && s.getGraph().hasNode(st.focus) ? st.focus : null, quiet: !!active });
    }
  }, [hover, focus, hidden, graph, mode]);

  useEffect(() => {
    const s = views.current.find((v) => focus != null && v.s.getGraph().hasNode(String(focus)))?.s;
    if (focus == null || !s) return;
    const p = s.getNodeDisplayData(String(focus));
    if (p) s.getCamera().animate({ x: p.x, y: p.y, ratio: 0.4 }, { duration: 500 });
  }, [focus, graph, mode]);

  // Textual analysis: the symbol-level branch report (committed revisions only).
  const textual = base !== "WORKTREE" && head !== "WORKTREE";
  useEffect(() => {
    if (mode !== "report" || !textual) return;
    setReport(null);
    api.compare(base, head).then(setReport).catch((e) => toast(e.message, "err"));
  }, [mode, base, head]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = (diff?.nodes ?? []).filter((n) => n.status !== "same" && n.kind !== "file" && (!q || n.name.toLowerCase().includes(q.toLowerCase())));
  const sel = diff?.nodes.find((n) => n.id === focus) ?? null;
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sm = diff?.summary;
  // Where the change lands: per-directory tallies, most-changed first.
  const byDir = useMemo(() => {
    if (!diff) return [];
    const g = groupDirs(diff.nodes.map((n) => n.path), cfg.dirDepth);
    const m = new Map<string, { added: number; removed: number; modified: number; total: number }>();
    for (const n of diff.nodes) {
      if (n.kind === "file") continue;
      const d = g.of(n.path);
      const e = m.get(d) ?? { added: 0, removed: 0, modified: 0, total: 0 };
      e.total++;
      if (n.status !== "same") e[n.status]++;
      m.set(d, e);
    }
    return [...m].map(([d, e]) => [g.label(d), e] as const).filter(([, e]) => e.added + e.removed + e.modified > 0).sort((x, y) => (y[1].added + y[1].removed + y[1].modified) - (x[1].added + x[1].removed + x[1].modified));
  }, [diff, cfg.dirDepth]);

  return (
    <div className="graph-wrap">
      {mode === "overlay" && <div ref={box} className="graph-canvas contrast-canvas" />}
      {mode === "split" && (
        <div className="contrast-canvas split-canvas">
          {(["base", "head"] as const).map((k) => (
            <div key={k} className="split-pane">
              <div ref={k === "base" ? boxA : boxB} className="graph-canvas" />
              {k === "base" && <Grip id="before" edge="right" min={160} max={4000} label="Resize before and after" />}
              <div className="split-tag">
                <span className="split-k">{k === "base" ? "Before" : "After"}</span>
                <span className="mono">{k === "base" ? base : head}</span>
                {sides && <span className="muted">{sides[k].order.toLocaleString()} nodes</span>}
                {sm && k === "base" && sm.removed > 0 && <span style={{ color: "var(--red)" }}>−{sm.removed}</span>}
                {sm && k === "head" && sm.added > 0 && <span style={{ color: "var(--green)" }}>+{sm.added}</span>}
                {sm && sm.modified > 0 && <span style={{ color: "var(--yellow)" }}>~{sm.modified}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {mode === "report" && (
        <div className="contrast-canvas contrast-report">
          <div className="detail-pad">
            <div className="eyebrow">Report · {base} → {head}</div>
            {!textual && <div className="card-empty">The textual report compares committed revisions. For uncommitted work, the symbol list on the right is the report, and <b>Overlay</b> or <b>Side by side</b> show it on the graph.</div>}
            {textual && !report && <div className="muted">Comparing…</div>}
            {textual && report && <CompareReport c={report} openSymbol={(id) => { const n = report.files.flatMap((f) => f.symbols).concat(report.affected.map((h) => h.node)).find((x) => x.id === id); if (n) openInMap(n.name, n.path); }} />}
          </div>
        </div>
      )}
      {!diff && !err && <div className="loading"><div className="stack" style={{ alignItems: "center" }}><Logo spin /><span>Building both graphs from git…</span></div></div>}
      {err && <div className="loading"><Empty title="Couldn't contrast these revisions">{err}</Empty></div>}

      <div className="graph-overlay hud contrast-hud">
        <button className="btn sm hud-btn" onClick={onExit}><Icon.graph /> Map</button>
        <div className="seg" role="tablist" aria-label="Contrast view">
          <button className={mode === "overlay" ? "on" : ""} onClick={() => setMode("overlay")} title="Both revisions in one graph">Overlay</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title="Before and after, side by side, one camera">Side by side</button>
          <button className={mode === "report" ? "on" : ""} onClick={() => setMode("report")} title="Textual analysis">Report</button>
        </div>
        <div className="rev-pick">
          <select className="input" value={base} onChange={(e) => onChange(e.target.value, head)} aria-label="Base revision">
            {[...new Set([base, ...refs])].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="btn sm ghost" title="Swap" aria-label="Swap revisions" onClick={() => onChange(head, base)}>⇄</button>
          <select className="input" value={head} onChange={(e) => onChange(base, e.target.value)} aria-label="Head revision">
            {[...new Set([head, ...refs])].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        {mode !== "report" && (
          <div className="seg">
            <button className={showSame ? "on" : ""} onClick={() => setShowSame(true)}>Whole graph</button>
            <button className={!showSame ? "on" : ""} onClick={() => setShowSame(false)}>Changes only</button>
          </div>
        )}
        <button className="btn sm hud-btn icon-only" onClick={openSettings} title="Graph settings  ," aria-label="Graph settings"><Icon.sliders /></button>
      </div>

      <aside className="contrast-panel">
        <Grip id="contrast" edge="left" min={260} max={900} label="Resize contrast panel" />
        <div className="cp-head">
          <div className="eyebrow">Contrast</div>
          <div className="mono cp-revs"><span>{base}</span><span className="muted">→</span><span>{head}</span></div>
        </div>
        {sm && (
          <>
            <div className="cp-stats">
              {STATUS.map((st) => (
                <button key={st.id} className={`cp-stat ${hidden.has(st.id) ? "off" : ""}`} onClick={() => toggle(st.id)} title={`Toggle ${st.label.toLowerCase()}`}>
                  <b style={{ color: `var(${st.color})` }}>{st.sign}{sm[st.id]}</b>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
            <div className="cp-sub muted">
              <span><b style={{ color: "var(--green)" }}>+{sm.edges_added}</b> / <b style={{ color: "var(--red)" }}>−{sm.edges_removed}</b> dependencies</span>
              <span>{sm.files_touched} files</span>
              <span>{sm.same.toLocaleString()} unchanged</span>
            </div>
          </>
        )}
        {byDir.length > 0 && (
          <div className="cp-dirs">
            {byDir.slice(0, 6).map(([d, e]) => (
              <div key={d} className="cp-dir" title={`${e.added} added · ${e.removed} removed · ${e.modified} modified of ${e.total}`}>
                <span className="mono lbl">{d}</span>
                <span className="cp-dir-bar">
                  <i style={{ flexGrow: e.added, background: "var(--green)" }} />
                  <i style={{ flexGrow: e.modified, background: "var(--yellow)" }} />
                  <i style={{ flexGrow: e.removed, background: "var(--red)" }} />
                  <i style={{ flexGrow: Math.max(0, e.total - e.added - e.modified - e.removed), background: "var(--line)" }} />
                </span>
                <span className="n mono">{e.added + e.removed + e.modified}/{e.total}</span>
              </div>
            ))}
          </div>
        )}
        {sel && (
          <div className="cp-sel">
            <div className="row" style={{ gap: 8 }}>
              <Kind kind={sel.kind} community={sel.community} size={18} />
              <b className="mono">{sel.container ? `${sel.container}.` : ""}{sel.name}</b>
              <span className={`status-pill ${sel.status}`}>{sel.status}</span>
            </div>
            <div className="muted mono" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>{sel.path}:{sel.start_line}</div>
            <div className="row" style={{ gap: 6 }}>
              {sel.status !== "removed" && <button className="btn sm" onClick={() => openInMap(sel.name, sel.path)}>Open in map</button>}
              <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(`${sel.path}:${sel.start_line}`); toast("Copied location"); }}>Copy location</button>
            </div>
          </div>
        )}
        <div className="cp-list-head">
          <span className="section-title" style={{ margin: 0 }}>Changed symbols <span className="count">{changed.length}</span></span>
          <input className="input" style={{ height: 26, width: 130 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="cp-list">
          {diff && changed.length === 0 && <div className="card-empty">The two graphs are structurally identical.</div>}
          {STATUS.map((st) => {
            const list = changed.filter((n) => n.status === st.id);
            return list.length ? (
              <div key={st.id}>
                <div className="cp-group" style={{ color: `var(${st.color})` }}>{st.label} · {list.length}</div>
                {list.slice(0, 200).map((n: DiffNode) => (
                  <div key={n.id} className={`sym ${focus === n.id ? "on" : ""}`} onClick={() => setFocus(n.id)} onMouseEnter={() => setHover(String(n.id))} onMouseLeave={() => setHover(null)}>
                    <span className="diff-sign" style={{ color: `var(${st.color})` }}>{st.sign}</span>
                    <Kind kind={n.kind} community={n.community} />
                    <span className="nm">{n.container ? <span className="muted">{n.container}.</span> : null}{n.name}</span>
                    <span className="p">{n.path}</span>
                  </div>
                ))}
              </div>
            ) : null;
          })}
        </div>
      </aside>
    </div>
  );
}
