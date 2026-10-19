// Node renderers – tile, wide, circle, group frame, loop. Anatomy per
// docs/design/flow-canvas.md §2: tile 96×96 with the title under it, entry
// "D" shape, status mark in the corner, hover toolbar slot, L/R dot handles
// and bottom/top diamonds for sub-node connections, "+" stub on unused outputs.
import { memo } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "../ui";
import { CIRCLE, TILE, WIDE, type FlowNode } from "./types";
import { useFc } from "./fcContext";
import BlockCard from "./BlockNode";

type FcData = FlowNode;

function Glyph({ icon, size }: { icon?: string | React.ReactNode; size: number }) {
  if (!icon) return null;
  if (typeof icon !== "string") return <>{icon}</>;
  const C = (Icon as unknown as Record<string, (p: { size?: number }) => React.ReactElement | null>)[icon];
  return C ? <C size={size} /> : <span className="fc-glyph-letter">{icon.slice(0, 1)}</span>;
}

/** The hover/selection toolbar: one per active node, never always-on.
    Renders nothing when the slot is empty – no dead chrome. */
function TBar({ id, data }: { id: string; data: FcData }) {
  const { open, toggleGroup, activeId } = useFc();
  if (activeId !== id) return null;
  const content = data.toolbar ?? (
    data.kind === "group" && toggleGroup ? (
      <button className="fc-tool" data-testid="fc-tool-collapse" onClick={(e) => { e.stopPropagation(); toggleGroup(data.id); }} title="Collapse group">−</button>
    ) : open ? (
      <button className="fc-tool" data-testid="fc-tool-open" onClick={() => open(data.id)} title="Open">↗</button>
    ) : null
  );
  if (!content) return null;
  return (
    <NodeToolbar isVisible className="fc-toolbar-wrap">
      <div className="fc-toolbar" role="toolbar" aria-label={`${data.title} actions`}>{content}</div>
    </NodeToolbar>
  );
}

function Handles({ data }: { data: FcData; nodeW: number; nodeH: number }) {
  return (
    <>
      {data.kind !== "circle" && data.kind !== "group" && (
        <Handle type="target" position={Position.Left} id="l" className={`fc-dot${data.accepts ? " fc-dot-in" : ""}`} isConnectable={!!data.accepts} />
      )}
      {data.kind === "circle" && <Handle type="target" position={Position.Top} id="t" className="fc-diamond" isConnectable={false} />}
      {data.kind !== "group" && <Handle type="source" position={data.kind === "circle" ? Position.Bottom : Position.Right} id="r" className={`fc-dot${data.connectable ? " fc-dot-out" : ""}`} isConnectable={!!data.connectable} />}
      {data.hasSub && <Handle type="source" position={Position.Bottom} id="b" className="fc-diamond" isConnectable={false} />}
    </>
  );
}

/** The "+" on an unused output: a button when the canvas listens for it (n8n opens the node panel). */
function Stub({ id }: { id: string }) {
  const { onStub } = useFc();
  if (!onStub) return <span className="fc-stub" title="No outgoing step">+</span>;
  return <button className="fc-stub fc-stub-btn nodrag" data-testid={`fc-stub-${id}`} title="Add the next block" onClick={(e) => { e.stopPropagation(); onStub(id); }}>+</button>;
}
const stCls = (d: FcData) => (d.status && d.status !== "disabled" ? ` fc-is-${d.status}` : "");

const STATUS_MARK: Record<string, string> = { running: "run", success: "ok", error: "err", pinned: "pin" };

const TileNode = memo(({ data, selected, id }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? TILE.w;
  const h = data.size?.h ?? TILE.h;
  return (
    <div className={`fc-node fc-tile${data.ring ? ` fc-ring-${data.ring}` : ""}${data.entry ? " fc-entry" : ""}${data.status === "disabled" ? " fc-off" : ""}${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${stCls(data)}`} style={{ width: w, height: h }} data-testid={`fc-node-${id}`}>
      <TBar id={id ?? data.id} data={data} />
      <div className="fc-tile-box" style={{ ["--fc-role" as string]: data.color }}>
        <Glyph icon={data.icon} size={32} />
        {data.status && <span className={`fc-status fc-st-${STATUS_MARK[data.status] ?? data.status}`} title={data.status} />}
      </div>
      {data.badge && <span className="fc-badge">{data.badge}</span>}
      <div className="fc-title">{data.title}</div>
      {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
      <Handles data={data} nodeW={w} nodeH={h} />
      {data.noOut && data.kind !== "circle" && <Stub id={id ?? data.id} />}
    </div>
  );
});
TileNode.displayName = "TileNode";

const WideNode = memo(({ data, selected }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? WIDE.w;
  const h = data.size?.h ?? WIDE.h;
  return (
    <div className={`fc-node fc-wide${data.ring ? ` fc-ring-${data.ring}` : ""}${data.status === "disabled" ? " fc-off" : ""}${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${stCls(data)}`} style={{ width: w, height: h }} data-testid={`fc-node-${data.id}`}>
      <TBar id={data.id} data={data} />
      <div className="fc-wide-in" style={{ ["--fc-role" as string]: data.color }}>
        <Glyph icon={data.icon} size={24} />
        <div className="fc-wide-text">
          <div className="fc-wide-title">{data.title}</div>
          {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
        </div>
        {data.status && <span className={`fc-status fc-st-${STATUS_MARK[data.status] ?? data.status}`} title={data.status} />}
      </div>
      {data.badge && <span className="fc-badge">{data.badge}</span>}
      <Handles data={data} nodeW={w} nodeH={h} />
      {data.noOut && <Stub id={data.id} />}
    </div>
  );
});
WideNode.displayName = "WideNode";

const CircleNode = memo(({ data, selected }: NodeProps & { data: FcData }) => (
  <div className={`fc-node fc-circle${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}`} style={{ width: CIRCLE.w, height: CIRCLE.h }} title={`${data.title}${data.subtitle ? ` – ${data.subtitle}` : ""}`} data-testid={`fc-node-${data.id}`}>
    <div className="fc-circle-in" style={{ ["--fc-role" as string]: data.color }}>
      <Glyph icon={data.icon} size={20} />
    </div>
    <Handles data={data} nodeW={CIRCLE.w} nodeH={CIRCLE.h} />
  </div>
));
CircleNode.displayName = "CircleNode";

const GroupNode = memo(({ data, selected }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? 256;
  const h = data.size?.h ?? 128;
  return (
    <div className={`fc-node fc-group${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}`} style={{ width: w, height: h }} data-testid={`fc-node-${data.id}`}>
      <TBar id={data.id} data={data} />
      <div className="fc-group-head">
        <span className="fc-group-label">{data.title}</span>
        <span className="fc-group-count">{data.subtitle}</span>
      </div>
      <Handles data={data} nodeW={w} nodeH={h} />
    </div>
  );
});
GroupNode.displayName = "GroupNode";

const LoopNode = memo(({ data, selected }: NodeProps & { data: FcData }) => (
  <div className={`fc-node fc-loop${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}`} style={{ width: TILE.w, height: TILE.h }} data-testid={`fc-node-${data.id}`}>
    <TBar id={data.id} data={data} />
    <div className="fc-tile-box fc-loop-box" style={{ ["--fc-role" as string]: data.color }}>
      <span className="fc-loop-glyph">↻</span>
      {data.status && <span className={`fc-status fc-st-${STATUS_MARK[data.status] ?? data.status}`} title={data.status} />}
    </div>
    <div className="fc-title">{data.title}</div>
    {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
    <Handles data={data} nodeW={TILE.w} nodeH={TILE.h} />
  </div>
));
LoopNode.displayName = "LoopNode";

/** A sticky note (n8n): text on a tinted card, never wired, never run. */
const StickyNode = memo(({ data, selected }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? 240, h = data.size?.h ?? 160;
  return (
    <div className={`fc-node fc-sticky${selected ? " fc-sel" : ""}`} style={{ width: w, height: h, ["--fc-role" as string]: data.color ?? "var(--yellow, #d9b54a)" }} data-testid={`fc-node-${data.id}`}>
      <TBar id={data.id} data={data} />
      <div className="fc-sticky-title">{data.title}</div>
      {data.subtitle && <div className="fc-sticky-body">{data.subtitle}</div>}
    </div>
  );
});
StickyNode.displayName = "StickyNode";

export const nodeTypes = { sticky: StickyNode, tile: TileNode, wide: WideNode, circle: CircleNode, group: GroupNode, loop: LoopNode, block: BlockCard };
