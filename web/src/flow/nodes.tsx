// Node renderers – tile, wide, circle, group frame, loop. Anatomy per
// docs/design/flow-canvas.md §2: tile 96×96 with the title under it, entry
// "D" shape, status mark in the corner, hover toolbar slot, L/R dot handles
// and bottom/top diamonds for sub-node connections, "+" stub on unused outputs.
import { memo } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "../ui";
import { CIRCLE, TILE, WIDE, type FlowNode, type PortSpec } from "./types";
import { useFc } from "./fcContext";
import BlockCard from "./BlockNode";
import { AgentHarmonograph } from "./agentMark";

const SIDE = { bottom: Position.Bottom, right: Position.Right, left: Position.Left, top: Position.Top };

/** Typed labelled ports (n8n §3): a visible 12 px handle with its label.
    The axis says the type: horizontal = data flow, vertical = capability. */
function TypedPorts({ ports }: { ports: PortSpec[] }) {
  return (
    <>
      {ports.map((pt) => (
        <span key={pt.id} className={`fc-port fc-port-${pt.side}`} data-testid={`fc-port-${pt.id}`}>
          <Handle type="source" position={SIDE[pt.side]} id={pt.id} className="fc-dot fc-dot-typed" isConnectable />
          <span className="fc-port-label">{pt.label}</span>
        </span>
      ))}
    </>
  );
}

type FcData = FlowNode;

function Glyph({ icon, size }: { icon?: string | React.ReactNode; size: number }) {
  if (!icon) return null;
  if (typeof icon !== "string") return <>{icon}</>;
  const C = (Icon as unknown as Record<string, (p: { size?: number }) => React.ReactElement | null>)[icon];
  return C ? <C size={size} /> : <span className="fc-glyph-letter">{icon.slice(0, 1)}</span>;
}

/** The hover/selection toolbar: one per active node, never always-on.
    Renders nothing when the slot is empty – no dead chrome. Exported for the
    block card, which carries the same slot. */
export function TBar({ id, data }: { id: string; data: FcData }) {
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
      {/* a frame that wires attach to (a meaning zone's roads): invisible anchors */}
      {data.kind === "group" && data.anchors && <>
        <Handle type="target" position={Position.Left} id="l" className="fc-anchor" isConnectable={false} />
        <Handle type="source" position={Position.Right} id="r" className="fc-anchor" isConnectable={false} />
      </>}
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
        {data.lastRun && <span className={`fc-lastrun fc-lastrun-${data.lastRun}`} title={`last run – ${data.lastRun === "ok" ? "passed" : "failed"}`} data-testid={`fc-lastrun-${id}`} />}
      </div>
      {data.badge && <span className="fc-badge">{data.badge}</span>}
      <div className="fc-title">{data.title}</div>
      {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
      <Handles data={data} nodeW={w} nodeH={h} />
      {data.ports && <TypedPorts ports={data.ports} />}
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
    <div className={`fc-node fc-group${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${data.color ? " fc-group-hue" : ""}`} style={{ width: w, height: h, ["--fc-hue" as string]: data.color }} data-testid={`fc-node-${data.id}`}>
      <TBar id={data.id} data={data} />
      <div className="fc-group-head">
        <span className="fc-group-label">{data.title}</span>
        <span className="fc-group-crumb">{data.badge}</span>
        <span className="fc-group-count">{data.subtitle}</span>
        {/* U8 fold affordance: the click bubbles to the node, the kit folds
            the open path exactly as a click on the frame head does. */}
        <button className="fc-group-fold nodrag" data-testid={`fc-fold-${data.id}`} title="Fold" aria-label="Fold">–</button>
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
/** A gate: the diamond tile (shape says "a fork in the run"), its branch
    outputs labelled at the port (pass, fail) so a fork reads without
    opening the node (n8n §3). */
const GateNode = memo(({ data, selected, id }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? TILE.w, h = data.size?.h ?? TILE.h;
  return (
    <div className={`fc-node fc-gate${data.status === "disabled" ? " fc-off" : ""}${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${stCls(data)}`} style={{ width: w, height: h }} data-testid={`fc-node-${id}`}>
      <TBar id={id ?? data.id} data={data} />
      <div className="fc-gate-diamond" style={{ ["--fc-role" as string]: data.color }}>
        <Glyph icon={data.icon} size={20} />
        {data.status && <span className={`fc-status fc-st-${STATUS_MARK[data.status] ?? data.status}`} title={data.status} />}
        {data.lastRun && <span className={`fc-lastrun fc-lastrun-${data.lastRun}`} title={`last run – ${data.lastRun === "ok" ? "passed" : "failed"}`} />}
      </div>
      {data.badge && <span className="fc-badge">{data.badge}</span>}
      <div className="fc-title">{data.title}</div>
      {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
      <Handle type="target" position={Position.Left} id="l" className="fc-dot" isConnectable={!!data.accepts} />
      {data.connectable && (
        <>
          <span className="fc-port fc-port-right" data-testid={`fc-port-${id}-pass`}>
            <Handle type="source" position={Position.Right} id="pass" className="fc-dot fc-dot-typed" isConnectable />
            <span className="fc-port-label">pass</span>
          </span>
          <span className="fc-port fc-port-right fc-port-fail" data-testid={`fc-port-${id}-fail`}>
            <Handle type="source" position={Position.Right} id="fail" className="fc-dot fc-dot-typed" isConnectable />
            <span className="fc-port-label">fail</span>
          </span>
        </>
      )}
      {data.ports && <TypedPorts ports={data.ports} />}
      {data.noOut && <Stub id={id ?? data.id} />}
    </div>
  );
});
GateNode.displayName = "GateNode";

/** An agent: a wide, softer node with its harmonograph mark, and the typed
    capability ports along the bottom edge (Model, Tools, Fence, Memory) –
    the axis tells the type: capability plugs downward (n8n §3). */
const AgentNode = memo(({ data, selected, id }: NodeProps & { data: FcData }) => {
  const w = data.size?.w ?? WIDE.w, h = data.size?.h ?? 96;
  return (
    <div className={`fc-node fc-agent${data.status === "disabled" ? " fc-off" : ""}${data.dim ? " fc-dim" : ""}${selected ? " fc-sel" : ""}${stCls(data)}`} style={{ width: w, height: h }} data-testid={`fc-node-${id}`}>
      <TBar id={id ?? data.id} data={data} />
      <div className="fc-agent-in" style={{ ["--fc-role" as string]: data.color }}>
        <span className="fc-agent-hg" data-figure aria-hidden="true">{data.gradient ? <AgentHarmonograph name={data.title} size={56} /> : <Hgraph />}</span>
        <div className="fc-wide-text">
          <div className="fc-wide-title">{data.title}</div>
          {data.subtitle && <div className="fc-sub">{data.subtitle}</div>}
        </div>
        {data.status && <span className={`fc-status fc-st-${STATUS_MARK[data.status] ?? data.status}`} title={data.status} />}
        {data.lastRun && <span className={`fc-lastrun fc-lastrun-${data.lastRun}`} title={`last run – ${data.lastRun === "ok" ? "passed" : "failed"}`} />}
      </div>
      {data.badge && <span className="fc-badge">{data.badge}</span>}
      <Handles data={data} nodeW={w} nodeH={h} />
      {/* an agent on the map fans its gradient wires down into its code */}
      {data.gradient && <Handle type="source" position={Position.Bottom} id="down" className="fc-anchor" isConnectable={false} />}
      {data.ports && <TypedPorts ports={data.ports} />}
      {data.noOut && <Stub id={data.id} />}
    </div>
  );
});
AgentNode.displayName = "AgentNode";

/** The harmonograph mark (agents-teams.css draws it as an svg curve). */
function Hgraph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" data-figure>
      <path d="M12 2c6 0 10 4 10 10 0 5-4 8-8 7-3-1-4-3-4-6 0-2 1.5-3.5 3.5-3.5 1.6 0 2.8 1.1 2.8 2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5.5" cy="6" r="1.6" fill="currentColor" opacity=".55" />
      <circle cx="18.5" cy="18" r="1.6" fill="currentColor" opacity=".55" />
    </svg>
  );
}

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

export const nodeTypes = { sticky: StickyNode, tile: TileNode, wide: WideNode, circle: CircleNode, group: GroupNode, loop: LoopNode, block: BlockCard, gate: GateNode, agent: AgentNode };
