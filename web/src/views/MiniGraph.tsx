// A small graph drawn exactly like the codebase map: the same sigma renderer,
// ForceAtlas2 layout, outlined labels, territories under each group, and dots
// travelling along the edges that carry work. Teams and notes hand it plain
// nodes and edges; it lays them out once (seeded, so the same every time),
// fades everything but a hovered node's neighbourhood, and reports clicks.
import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import EdgeCurveProgram from "@sigma/edge-curve";
import { attachOverlay, drawHover, drawOutlinedLabel, type Overlay } from "../graphfx";
import { CURVATURE, cssVar } from "./GraphView";
import { useSettings } from "../settings";

export interface MiniNode { id: string; label: string; color: string; size: number; group?: string; hub?: boolean; glyph?: string; x?: number; y?: number }
export interface MiniEdge { source: string; target: string; color?: string; size?: number; flow?: boolean }

export function MiniGraph({ nodes, edges, sel, onPick, groupLabel, label, height }: {
  nodes: MiniNode[]; edges: MiniEdge[]; sel?: string; onPick?: (id: string) => void;
  groupLabel?: (g: string) => string; label: string; height?: number | string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<{ s: Sigma; ov: Overlay; g: Graph } | null>(null);
  const hover = useRef<string | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const [err, setErr] = useState("");
  const cfg = useSettings();
  const key = JSON.stringify([nodes.map((n) => [n.id, n.color, n.size, n.group, n.label]), edges.map((e) => [e.source, e.target, e.flow])]);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const g = new Graph({ multi: false, type: "directed" });
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      g.addNode(n.id, { forceLabel: !!n.hub, label: n.label, color: n.color, size: n.size, x: n.x ?? Math.cos(a) * 10, y: n.y ?? Math.sin(a) * 10, group: n.group, hub: n.hub, glyph: n.glyph ?? "" });
    });
    for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target) && e.source !== e.target && !g.hasEdge(e.source, e.target))
      g.addEdge(e.source, e.target, { color: e.color ?? cssVar("--line-2"), size: e.size ?? 1, flow: !!e.flow });
    if (g.order > 1) {
      forceAtlas2.assign(g, { iterations: 300, settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, gravity: 1.2, scalingRatio: 16 } });
      noverlap.assign(g, { maxIterations: 120, settings: { margin: 14, ratio: 1.6 } });
    }
    let s: Sigma;
    try {
      s = new Sigma(g, el, {
        labelFont: "JetBrains Mono Variable, ui-monospace, monospace", labelSize: 12, labelWeight: "500",
        labelColor: { color: cssVar("--text") }, labelRenderedSizeThreshold: 7.5, zIndex: true,
        defaultEdgeType: cfg.curved ? "curved" : "line",
        edgeProgramClasses: { line: EdgeRectangleProgram, curved: EdgeCurveProgram },
        defaultDrawNodeLabel: drawOutlinedLabel, defaultDrawNodeHover: drawHover,
      });
    } catch { setErr("This browser could not start WebGL, which the graph needs."); return; }
    const faded = cssVar("--line");
    const near = () => { const h = hover.current; return new Set(h && g.hasNode(h) ? [h, ...g.neighbors(h)] : []); };
    let nb = near();
    s.setSetting("nodeReducer", (id, a) => {
      const r: any = { ...a };
      if (hover.current && !nb.has(id)) { r.color = faded; r.label = ""; r.size = Math.max(2, a.size * 0.6); }
      if (id === hover.current) r.zIndex = 3;
      if (a.hub && r.color !== faded) { r.tile = r.color; r.hubTile = true; r.color = "rgba(0,0,0,0)"; }
      return r;
    });
    s.setSetting("edgeReducer", (id, a) => {
      const r: any = { ...a };
      const [x, y] = g.extremities(id);
      if (hover.current && !(nb.has(x) && nb.has(y))) r.color = faded;
      return r;
    });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ov = attachOverlay(s, g, {
      group: (a) => a.group ?? null, groupColor: () => null, groupLabel: (k) => groupLabel?.(k) ?? k,
      hub: (_id, a) => !!a.hub, glyph: (a) => a.glyph ?? "", reducedMotion: reduced,
    });
    const flows: [string, string][] = [];
    g.forEachEdge((_e, a, x, y) => { if (a.flow) flows.push([x, y]); });
    ov.set({ flows: cfg.flow === false ? [] : flows, territories: true, curvature: cfg.curved ? CURVATURE : 0 });
    s.on("enterNode", ({ node }) => { hover.current = node; nb = near(); s.refresh({ skipIndexation: true }); ov.set({ quiet: true }); el.style.cursor = "pointer"; });
    s.on("leaveNode", () => { hover.current = null; nb = near(); s.refresh({ skipIndexation: true }); ov.set({ quiet: false }); el.style.cursor = ""; });
    s.on("clickNode", ({ node }) => pick.current?.(node));
    view.current = { s, ov, g };
    return () => { ov.kill(); s.kill(); view.current = null; };
  }, [key, cfg.curved, cfg.flow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current; if (!v) return;
    v.ov.set({ focus: sel && v.g.hasNode(sel) ? sel : null, rings: new Map(sel && v.g.hasNode(sel) ? [[sel, cssVar("--accent")]] : []) });
  }, [sel, key]);

  return (
    <div className="mini-graph" style={height ? { height } : undefined} aria-label={label} role="img">
      {err ? <div className="muted" style={{ padding: 20 }}>{err}</div> : <div ref={box} className="mini-graph-canvas" />}
    </div>
  );
}
