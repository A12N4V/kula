// Edge renderer – bezier forward, rounded smooth-step routed below the nodes
// for backward edges (loops never cut through a node), dashed non-main edges,
// midpoint labels, weight → 1–4 px stroke zoom-compensated so it stays crisp.
// docs/design/flow-canvas.md §3.2.
import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type EdgeProps } from "@xyflow/react";
import { useFc } from "./fcContext";

/** Rounded orthogonal path through points (8 px corners). */
export function roundedPath(pts: { x: number; y: number }[], r = 8): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const n = pts[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y);
    const outLen = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.max(0, Math.min(r, inLen / 2, outLen / 2));
    const a = { x: c.x - ((c.x - p.x) / (inLen || 1)) * rr, y: c.y - ((c.y - p.y) / (inLen || 1)) * rr };
    const b = { x: c.x + ((n.x - c.x) / (outLen || 1)) * rr, y: c.y + ((n.y - c.y) / (outLen || 1)) * rr };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Backward edge: drop below both endpoints, run back, rise into the target. */
export function backwardPath(sx: number, sy: number, tx: number, ty: number, r = 8): string {
  const drop = Math.max(sy, ty) + 48;
  return roundedPath([
    { x: sx, y: sy },
    { x: sx + 16, y: sy },
    { x: sx + 16, y: drop },
    { x: tx - 16, y: drop },
    { x: tx - 16, y: ty },
    { x: tx, y: ty },
  ], r);
}

const clampW = (w: number | undefined) => Math.max(1, Math.min(4, w ?? 1));

const FlowEdgeView = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props;
  const zoom = useStore((s) => s.transform[2]);
  const main = data?.main !== false;
  const dashed = data?.dashed === true;
  const weight = clampW(data?.weight as number | undefined);
  const base = main ? Math.max(weight, dashed ? 1 : 2) : 1;
  const stroke = base / zoom; // zoom-compensated: visual px stays constant
  const backward = data?.backward === true || targetX < sourceX;

  let path: string;
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;
  if (backward) {
    path = backwardPath(sourceX, sourceY, targetX, targetY);
    labelY = Math.max(sourceY, targetY) + 48;
  } else {
    const [p, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetPosition, targetX, targetY });
    path = p;
    labelX = lx;
    labelY = ly;
  }

  const { hoverEdge, setHoverEdge, hovered } = useFc();
  const touch = hovered ? (props.source === hovered || props.target === hovered ? " fc-edge-lit" : " fc-edge-faint") : "";
  const flow = data?.flow as string | undefined;
  const tools = data?.tools as React.ReactNode | undefined;
  const hot = hoverEdge === props.id;
  const cls = `fc-edge${backward ? " fc-back" : ""}${dashed || !main ? " fc-dashed" : ""}${selected ? " fc-edge-sel" : ""}${flow ? ` fc-flow-${flow}` : ""}${hot ? " fc-edge-hot" : ""}${touch}`;
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} className={cls} style={{ strokeWidth: stroke }} data-testid={data?.testid as string | undefined} />
      {tools && <path d={path} className="fc-edge-hit" onPointerEnter={() => setHoverEdge?.(props.id)} onPointerLeave={() => setHoverEdge?.(null)} />}
      {tools && (
        <EdgeLabelRenderer>
          <div className={`fc-edge-tools nodrag nopan${hot ? " on" : ""}`} style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY + (data?.label != null ? 26 : 0)}px)` }}
            onPointerEnter={() => setHoverEdge?.(props.id)} onPointerLeave={() => setHoverEdge?.(null)}>{tools}</div>
        </EdgeLabelRenderer>
      )}
      {data?.label != null && (
        <EdgeLabelRenderer>
          <div className="fc-edge-label" style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}>
            {data.label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
FlowEdgeView.displayName = "FlowEdgeView";

export const edgeTypes = { "flow-edge": FlowEdgeView };
