// The code graph's renderer for small agent graphs – a team, a research loop.
// Same sigma setup, same hub tiles and labels, same territories (here: tinted by
// workflow instead of directory), same moving dots (here: hand-offs instead of
// calls). Nodes are placed by the caller; clicking one selects it, the way a
// symbol opens the inspector on the code graph.

import { useEffect, useRef } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { EdgeRectangleProgram } from "sigma/rendering";
import EdgeCurveProgram from "@sigma/edge-curve";
import { attachOverlay, drawHover, drawOutlinedLabel } from "../graphfx";

export type MapNode = { id: string; label: string; x: number; y: number; size?: number; color: string; group?: string | null; glyph?: string; hub?: boolean };
export type MapEdge = { a: string; b: string; kind: "tree" | "hand" | "link"; color?: string };

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export default function AgentMap({ nodes, edges, groupColor, groupLabel, selected, onSelect, height = 340, label }: {
  nodes: MapNode[]; edges: MapEdge[]; groupColor: (k: string) => string | null; groupLabel?: (k: string) => string;
  selected: string | null; onSelect: (id: string | null) => void; height?: number; label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const sel = useRef(selected);
  const view = useRef<{ s: Sigma; ov: ReturnType<typeof attachOverlay>; g: Graph } | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const key = JSON.stringify([nodes, edges]);

  useEffect(() => {
    if (!box.current) return;
    const g = new Graph({ multi: true, type: "directed" });
    for (const n of nodes) g.addNode(n.id, { x: n.x, y: n.y, size: n.size ?? 9, color: n.color, label: n.label, forceLabel: true, data: n });
    for (const e of edges) {
      if (!g.hasNode(e.a) || !g.hasNode(e.b)) continue;
      g.addDirectedEdge(e.a, e.b, {
        type: e.kind === "hand" ? "curved" : "line",
        size: e.kind === "tree" ? 1.6 : 1.2,
        color: e.color ?? (e.kind === "hand" ? css("--accent") : css("--line-2") || "#332d28"),
        kind: e.kind,
      });
    }
    let s: Sigma;
    try {
      s = new Sigma(g, box.current, {
        renderEdgeLabels: false,
        labelFont: "JetBrains Mono Variable, ui-monospace, monospace",
        labelSize: 11.5,
        labelWeight: "500",
        labelColor: { color: css("--text") },
        defaultEdgeType: "line",
        edgeProgramClasses: { line: EdgeRectangleProgram, curved: EdgeCurveProgram },
        defaultDrawNodeLabel: drawOutlinedLabel,
        defaultDrawNodeHover: drawHover,
        zIndex: true,
        minCameraRatio: 0.4,
        maxCameraRatio: 3,
        stagePadding: 80,
      });
    } catch {
      return;
    }
    s.setSetting("nodeReducer", (id, a) => (id === sel.current ? { ...a, zIndex: 2 } : a));
    const ov = attachOverlay(s, g, {
      group: (a) => a.data.group ?? null,
      groupColor,
      groupLabel,
      hub: (_id, a) => !!a.data.hub,
      glyph: (a) => a.data.glyph ?? "·",
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const flows: [string, string][] = [];
    g.forEachEdge((_e, a, src, dst) => { if (a.kind === "hand") flows.push([src, dst]); });
    ov.set({ curvature: 0.25, flows, focus: sel.current });
    s.on("clickNode", ({ node }) => pick.current(node === sel.current ? null : node));
    s.on("clickStage", () => pick.current(null));
    s.on("enterNode", () => { if (box.current) box.current.style.cursor = "pointer"; });
    s.on("leaveNode", () => { if (box.current) box.current.style.cursor = ""; });
    view.current = { s, ov, g };
    return () => { ov.kill(); s.kill(); view.current = null; };
  }, [key]);

  useEffect(() => {
    sel.current = selected;
    const v = view.current;
    if (!v) return;
    v.ov.set({ focus: selected && v.g.hasNode(selected) ? selected : null });
    v.s.refresh();
  }, [selected, key]);

  return <div ref={box} className="agent-map" style={{ height }} role="img" aria-label={label} />;
}
