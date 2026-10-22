// BlockNode (R0) – the old Blocks-lens card, as the node itself. Name, role
// mark and logo, files and symbol count, in/out degree, the flows and chains
// it belongs to. The card is the node on the one canvas: draggable by the
// kit, resizable from a corner handle (sizes persist beside positions in
// flow/positions.ts), sections render as frames with their blocks inside.
// Three size stages (BLOCK_SIZES): more room shows more detail, up to the
// function list. Nothing here talks to React Flow – the kit wraps it.
import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GLYPH } from "../colors";
import { RoleMark, ROLE_COLOR } from "../views/map/icons";
import { sectionLogo } from "../views/map/icons";
import { TBar } from "./nodes";
import type { BlockCardData, FlowNode } from "./types";
import { BLOCK_SIZES, RESIZE_MAX, RESIZE_MIN, snap } from "./types";
import { useFc } from "./fcContext";

// Kind letters come from the shared GLYPH map (same tiles the graph draws).
const kindGlyph: Record<string, string> = { fn: GLYPH.function, class: GLYPH.class, var: GLYPH.file, type: "T", method: GLYPH.method, interface: GLYPH.interface };

/** The resize handle: bottom-right, 12 px hit (40 px at touch). Drag end
    commits the size through onResize so the kit persists it once, not per
    frame – the re-measure (React Flow's ResizeObserver) then reflows the
    content and more room exposes more detail. */
function ResizeHandle({ id, w, h }: { id: string; w: number; h: number }) {
  const { onResize } = useFc();
  const start = useCallback((e: React.PointerEvent) => {
    if (!onResize) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, sw = w, sh = h;
    const move = (ev: PointerEvent) => {
      const nw = Math.min(RESIZE_MAX.w, Math.max(RESIZE_MIN.w, snap(sw + ev.clientX - sx)));
      const nh = Math.min(RESIZE_MAX.h, Math.max(RESIZE_MIN.h, snap(sh + ev.clientY - sy)));
      if (nw !== w || nh !== h) onResize(id, { w: nw, h: nh }, false);
    };
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      onResize(id, { w: sw, h: sh }, false); // settle back to the start size first
      const nw = Math.min(RESIZE_MAX.w, Math.max(RESIZE_MIN.w, snap(sw + ev.clientX - sx)));
      const nh = Math.min(RESIZE_MAX.h, Math.max(RESIZE_MIN.h, snap(sh + ev.clientY - sy)));
      onResize(id, { w: nw, h: nh }, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }, [id, w, h, onResize]);
  return <div className="fc-card-resize nodrag nopan" data-testid={`fc-resize-${id}`} onPointerDown={start} title="Drag to resize" />;
}

function Meta({ data }: { data: BlockCardData }) {
  const bits: [string, string][] = [
    ...(data.files != null ? [[String(data.files), data.files === 1 ? "file" : "files"] as [string, string]] : []),
    ...(data.symbols != null ? [[String(data.symbols), data.symbols === 1 ? "fn" : "fns"] as [string, string]] : []),
    ...(data.inDeg != null ? [["↑" + data.inDeg, "in"] as [string, string]] : []),
    ...(data.outDeg != null ? [["↓" + data.outDeg, "out"] as [string, string]] : []),
  ];
  if (!bits.length) return null;
  return <div className="fc-card-meta">{bits.map((b, i) => <span key={i}><b>{b[0]}</b> {b[1]}</span>)}</div>;
}

type BlockCardDataWithSize = Omit<FlowNode, "card"> & BlockCardData;

const BlockCard = memo((props: NodeProps) => {
  const { selected, id } = props;
  const data = props.data as unknown as BlockCardDataWithSize;
  const w = data.size?.w ?? BLOCK_SIZES[1].w;
  const h = data.size?.h ?? BLOCK_SIZES[1].h;
  const role = (data.role ?? "core") as Parameters<typeof RoleMark>[0]["role"];
  // Semantic zoom (docs/design/fused-canvas.md §zoom): far = the caption under
  // the tile, mid = role, files, symbols, in/out, flow badges, fence badge and
  // the last-run dot, near = the function list. A resize forces a level – the
  // width the user drags the card to wins over the canvas zoom, never the
  // reverse, so content is only ever revealed, never hidden by zooming in.
  const { zoomLevel = "mid" } = useFc();
  // Size against the default: full width forces near, compact forces far,
  // and a default-sized card follows the canvas zoom (semantic zoom).
  const sizeStage = w >= BLOCK_SIZES[2].w ? 3 : w <= BLOCK_SIZES[0].w ? 1 : 0;
  const zoomStage = zoomLevel === "near" ? 3 : zoomLevel === "mid" ? 2 : 1;
  const stage = Math.max(sizeStage, sizeStage === 0 ? zoomStage : Math.min(sizeStage, zoomStage));
  return (
    <div
      className={`fc-node fc-card${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${data.ring ? ` fc-ring-${data.ring}` : ""}${data.members ? " fc-card-sec" : ""} fc-stage-${stage}`}
      style={{ width: w, height: h, ["--fc-role" as string]: data.roleColor ?? ROLE_COLOR[role] }}
      data-testid={`fc-node-${id}`}
      data-fc-stage={stage}
      title={`${data.title}${data.subtitle ? ` – ${data.subtitle}` : ""}`}
    >
      <TBar id={id ?? data.id} data={data} />
      {stage === 1 ? (
        // Far zoom: the tile itself, the name as a caption under it (n8n §2).
        <div className="fc-card-tile" data-testid={`fc-card-tile-${id}`}>
          <span className="fc-card-logo" aria-hidden="true">{data.logo ?? sectionLogo(`${data.title}`, role)}</span>
          {data.status && <span className={`fc-status fc-st-${data.status === "success" ? "ok" : data.status === "error" ? "err" : "run"}`} title={data.status} />}
          {data.lastRun && <span className={`fc-lastrun fc-lastrun-${data.lastRun}`} />}
          {data.ring === "fence" && <span className="fc-card-fence-badge" title="fenced by an agent" />}
        </div>
      ) : (
        <>
          <div className="fc-card-head">
            <span className="fc-card-role"><RoleMark role={role} /></span>
            <span className="fc-card-logo" aria-hidden="true">{data.logo ?? sectionLogo(`${data.title}`, role)}</span>
            <span className="fc-card-name" title={data.title}>{data.title}</span>
            {data.status && <span className={`fc-status fc-st-${data.status === "success" ? "ok" : data.status === "error" ? "err" : "run"}`} title={data.status} />}
            {data.lastRun && <span className={`fc-lastrun fc-lastrun-${data.lastRun}`} title={data.lastRun === "ok" ? "last run – passed" : "last run – failed"} />}
            {data.ring === "fence" && <span className="fc-card-fence-badge" title="fenced by an agent" />}
          </div>
          {data.subtitle && <div className="fc-card-sub" title={data.subtitle}>{data.subtitle}</div>}
        </>
      )}
      {stage >= 2 && <Meta data={data} />}
      {stage >= 2 && (data.flows?.length || data.chains?.length) ? (
        <div className="fc-card-flows mono">
          {data.flows?.length ? <span title={`flows: ${data.flows.join(", ")}`}>{data.flows.length} flows</span> : null}
          {data.chains?.length ? <span title={`chains: ${data.chains.join(", ")}`}>{data.chains.length} chains</span> : null}
        </div>
      ) : null}
      {stage >= 3 && data.functions?.length ? (
        <ul className="fc-card-fns">
          {data.functions.slice(0, 12).map((f, i) => (
            <li key={i} title={`${f.name}${f.kind ? ` · ${f.kind}` : ""}`}><span className="fm-kind">{kindGlyph[f.kind] ?? "ƒ"}</span>{f.name}</li>
          ))}
          {data.functions.length > 12 && <li className="fc-card-more">+ {data.functions.length - 12} more</li>}
        </ul>
      ) : null}
      {data.members ? (
        <div className="fc-card-members">
          {data.members.slice(0, 24).map((m) => (
            <span key={m.id} className="fc-card-member" title={m.title} style={{ ["--fc-role" as string]: m.color }}>
              <i className="fc-card-member-dot" />{m.title}
            </span>
          ))}
          {data.members.length > 24 && <span className="fc-card-more">+ {data.members.length - 24}</span>}
        </div>
      ) : null}
      {!data.members && <ResizeHandle id={id ?? data.id} w={w} h={h} />}
      {/* The kit wires edges to handles: left accepts a dragged wire, right
          emits one. Hidden dots, like the tiles' – the card edge is the target. */}
      <Handle type="target" position={Position.Left} id="l" className="fc-dot" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r" className="fc-dot" isConnectable={false} />
    </div>
  );
});
BlockCard.displayName = "BlockCard";

export default BlockCard;
