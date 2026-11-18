// The hub canvas: teams as frames, seats as nodes inside them, the flow map as
// lanes above. Edits go to the draft (kula.toml on save); moved nodes are kept
// on refs/kula/meta straight away, so moving things never dirties the tree.

import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, applyNodeChanges, useReactFlow, useStore,
  type Connection, type Edge, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import { api, type AgentsInfo, type FlowMap, type Member, type Research, type ResearchRun, type Team } from "../../api";
import { seatKey } from "../../roster";
import { Mark } from "../../brands";
import { Icon } from "../../ui";
import type { Draft, LinkKind, Pick } from "./draft";
import type { Paint } from "./live";
import { FLOW_H, LANE_W, LAYOUT_MARK, SEAT_H, SEAT_W, lanes, matcher, place, seatId, teamId, type Saved } from "./layout";

export type Item = { kind: "agent" | "skill" | "mcp" | "memory" | "template"; value: string };
export const DND = "application/kula-hub";

type SeatData = { m: Member; team: Team; picked: boolean; live?: string; overlap: boolean; research?: Research | null; loop?: ResearchRun; add: () => void };
type TeamData = { team: Team; picked: boolean };
type LaneData = { label: string; more: number; count: number; hit: boolean };
type FlowData = { name: string; kind: string; steps: number; hit: boolean; picked: boolean };

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A seat reads like a workflow node: an icon tile, its name under it, a port each side.
// Left in takes a boss, right out feeds a report (drag to a left port, or press + for a new one).
const SeatNode = memo(({ data }: NodeProps<Node<SeatData>>) => {
  const { m, team, picked, live, overlap, research, loop, add } = data;
  const f = m.fence ?? {};
  const fenced = !!(f.lock?.length || f.hide?.length || f.review?.length || m.scope?.length);
  const attached = (m.skills?.length ?? 0) + (m.mcp?.length ?? 0) + (m.memory ? 1 : 0);
  const sub = research ? `${research.goal === "max" ? "\u2191" : "\u2193"} ${short(research.metric, 12)}${loop ? ` ${loop.best}` : ""}` : [m.agent || "any agent", m.model].filter(Boolean).join(" · ");
  return (
    <div className={`hub-seat${picked ? " picked" : ""}${live ? ` live-${live}` : ""}${research ? " research" : ""}`} style={{ "--seat": m.color || team.color || "var(--line-2)" } as React.CSSProperties} data-seat={seatKey(m)}>
      <Handle type="target" position={Position.Left} className="hub-port in" />
      <Handle type="target" id="hi" position={Position.Top} className="hub-port ho" />
      <div className="hub-tile">
        {m.agent ? <Mark id={m.agent} size={24} /> : <span className="hub-seat-dot" />}
        {attached > 0 && <span className="hub-tile-n mono" title={`${attached} skills, MCP or memory`}>{attached}</span>}
        {(fenced || overlap) && <span className={`hub-tile-fence${overlap ? " warn" : ""}`} title={overlap ? "Shares files with another seat" : "Fenced"} />}
      </div>
      <div className="hub-seat-name">{seatKey(m)}</div>
      <div className="hub-seat-sub mono">{sub}</div>
      <Handle type="source" position={Position.Right} className="hub-port out" />
      <button className="hub-plus nodrag nopan" aria-label={`Add after ${seatKey(m)}`} onClick={(e) => { e.stopPropagation(); add(); }}>+</button>
      <Handle type="source" id="ho" position={Position.Bottom} className="hub-port ho" />
    </div>
  );
});

const TeamNode = memo(({ data }: NodeProps<Node<TeamData>>) => (
  <div className={`hub-team${data.picked ? " picked" : ""}`} style={{ "--team": data.team.color || (data.picked ? "var(--accent)" : "var(--line)") } as React.CSSProperties} data-team={data.team.name}>
    <div className="hub-team-head">
      <span className="hub-team-dot" />
      <span className="hub-team-name">{data.team.name || "unnamed"}</span>
      {data.team.category && <span className="hub-team-cat mono">{data.team.category}</span>}
      <span className="spacer" />
      <span className="mono muted">{data.team.members.length}</span>
    </div>
  </div>
));

const LaneNode = memo(({ data }: NodeProps<Node<LaneData>>) => (
  <div className={`hub-lane${data.hit ? " hit" : ""}`}>
    <div className="hub-lane-head mono" title={data.label}><span className="hub-lane-label">{short(data.label, 30)}</span><span className="hub-lane-n"> {data.count}</span></div>
    <div className="hub-lane-count mono">{data.count} {data.count === 1 ? "flow" : "flows"}</div>
    {data.more > 0 && <div className="hub-lane-more mono">+{data.more} more</div>}
  </div>
));

const FlowNode = memo(({ data }: NodeProps<Node<FlowData>>) => (
  <div className={`hub-flow${data.hit ? " hit" : ""}${data.picked ? " picked" : ""}`} title={`${data.kind} ${data.name}`} style={{ "--w": Math.min(1, Math.max(0.2, data.steps / 40)) } as CSSProperties}>
    <span className={`hub-flow-kind ${data.kind}`}>{data.kind[0]}</span>
    <span className="hub-flow-name">{short(data.name, 24)}</span>
    <span className="mono muted">{data.steps}</span>
  </div>
));

const nodeTypes = { seat: SeatNode, team: TeamNode, lane: LaneNode, flow: FlowNode };

export function HubCanvas({ info, d, pick, setPick, flow, setFlow, map, paint, onItem, onAfter, onEmpty }: {
  info: AgentsInfo; d: Draft; pick: Pick; setPick: (p: Pick) => void;
  flow: string | null; setFlow: (f: string | null) => void; map: FlowMap | null;
  paint?: Paint; onItem: (it: Item, at: Pick) => void; onAfter: (at: { team: string; key: string }) => void; onEmpty: () => void;
}) {
  const rf = useReactFlow();
  const [saved, setSaved] = useState<Saved>(info.layout ?? {});
  useEffect(() => { setSaved(info.layout ?? {}); }, [info.layout]);
  const overlaps = useMemo(() => new Set((info.seat_overlaps ?? []).flatMap((o) => [seatId(o.team, o.a), seatId(o.team, o.b)])), [info.seat_overlaps]);

  // the picked seat's scope, lit up on the map
  const picked = pick?.key ? d.member(pick.team, pick.key) : undefined;
  const covers = useMemo(() => (picked?.scope?.length ? matcher(picked.scope) : null), [picked?.scope]);

  const flows = useMemo(() => new Map(info.workflows.filter((w) => w.research?.metric).map((w) => [w.name, w.research!])), [info.workflows]);
  const [width, setWidth] = useState(0);
  const [aspect, setAspect] = useState(1.6);
  const built = useMemo(() => {
    const out: Node[] = [];
    if (map) {
      for (const l of lanes(map, width ? (width <= 600 ? 2 : Math.max(1, Math.floor((width - 72) / 0.6 / (LANE_W + 14)))) : Infinity)) {
        const dom = map.domains.find((x) => x.id === l.id);
        const fs = l.flows.map((f) => ({ f, path: map.flows.find((x) => x.id === f.id)! })).filter((x) => x.path);
        const hits = fs.map(({ path }) => !!covers && path.files.some(covers));
        out.push({ id: `lane:${l.id}`, type: "lane", position: { x: l.box.x, y: l.box.y }, style: { width: l.box.w, height: l.box.h }, data: { label: l.label, more: l.more, count: l.flows.length + l.more, hit: hits.some(Boolean) || (!!covers && !!dom?.files.some(covers)) }, draggable: false, selectable: false });
        fs.forEach(({ f, path }, i) => out.push({
          id: `flow:${f.id}`, type: "flow", parentId: `lane:${l.id}`, position: { x: 8, y: f.y }, style: { width: LANE_W - 16, height: FLOW_H },
          data: { name: path.entry.name, kind: path.kind, steps: path.steps.length, hit: hits[i], picked: flow === f.id }, draggable: false, selectable: false,
        }));
      }
    }
    const isResearch = (m: Member) => !!(m.workflow && flows.has(m.workflow));
    const at = place(d.draft, saved, isResearch, aspect);
    for (const t of d.draft) {
      const b = at.teams.get(t.name)!;
      out.push({ id: teamId(t.name), type: "team", position: { x: b.x, y: b.y }, style: { width: b.w, height: b.h }, data: { team: t, picked: pick?.team === t.name && !pick.key }, selectable: false });
      for (const m of t.members) {
        const id = seatId(t.name, seatKey(m));
        out.push({ id, type: "seat", parentId: teamId(t.name), position: at.seats.get(id)!, style: { width: SEAT_W, height: SEAT_H }, data: { add: () => onAfter({ team: t.name, key: seatKey(m) }), m, team: t, picked: pick?.team === t.name && pick.key === seatKey(m), live: paint?.seats.get(id), overlap: overlaps.has(id), research: m.workflow ? flows.get(m.workflow) : null, loop: m.workflow ? info.research.find((r) => r.workflow === m.workflow) : undefined }, selectable: false });
      }
    }
    return out;
  }, [map, covers, flow, d.draft, saved, pick, paint, overlaps, flows, info.research, aspect, width, onAfter]);

  const [nodes, setNodes] = useState<Node[]>(built);
  useEffect(() => { setNodes(built); }, [built]);
  const onNodesChange = useCallback((ch: NodeChange[]) => setNodes((ns) => applyNodeChanges(ch.filter((c) => c.type !== "remove"), ns)), []);

  const edges = useMemo(() => {
    const out: Edge[] = [];
    for (const t of d.draft) {
      const keys = new Set(t.members.map(seatKey));
      for (const m of t.members) {
        const k = seatKey(m);
        if (m.reports_to && keys.has(m.reports_to)) out.push({ id: `rt:${t.name}/${m.reports_to}>${k}`, source: seatId(t.name, m.reports_to), target: seatId(t.name, k), className: "cv-edge-rt", data: { kind: "rt", team: t.name, from: m.reports_to, to: k } });
        for (const h of m.hands_off ?? []) if (keys.has(h)) out.push({ id: `ho:${t.name}/${k}>${h}`, source: seatId(t.name, k), target: seatId(t.name, h), sourceHandle: "ho", targetHandle: "hi", className: "cv-edge-ho", markerEnd: { type: MarkerType.ArrowClosed, color: "#f97f3a", width: 14, height: 14 }, data: { kind: "ho", team: t.name, from: k, to: h } });
      }
    }
    for (const h of paint?.handoffs ?? []) out.push({ ...h, className: "cv-edge-live", animated: true, deletable: false });
    return out;
  }, [d.draft, paint]);

  // fit once there is something to fit, and again when the map comes or goes
  // (only once the canvas has a size, and again when its width settles elsewhere)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width, h = e.contentRect.height; if (w > 0 && h > 0) { setWidth(Math.round(w / 80) * 80); setAspect(Math.round((w / h) * 4) / 4); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const far = useStore((s) => s.transform[2] < 0.85);
  // with the flow map on, fit no smaller than lane names can be read; the rest pans
  const floor = map ? 0.6 : 0.25;
  const builtRef = useRef(built);
  builtRef.current = built;
  const fitted = useRef("");
  useEffect(() => {
    if (!width) return;
    const key = `${!!map}:${d.draft.length}:${width}:${aspect}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const t = window.setTimeout(() => {
      // a phone starts at the graph's top left corner at a size seat names can be read, and pans from there
      const top = builtRef.current.filter((n) => !n.parentId);
      if (top.length) {
        const x0 = Math.min(...top.map((n) => n.position.x)), y0 = Math.min(...top.map((n) => n.position.y));
        // with the map on, start halfway between the lanes and the teams so both show
        const teamsY = Math.min(...top.filter((n) => n.type === "team").map((n) => n.position.y));
        const laneTops = top.filter((n) => n.type === "lane").map((n) => n.position.y);
        // snapped to a lane top so no lane starts cut at the canvas edge
        const spans = top.filter((n) => n.type === "lane").map((n) => [n.position.y, n.position.y + (Number(n.style?.height) || 0)] as const);
        const clear = (t: number) => spans.every(([a, b]) => a >= t || b <= t);
        const snap = (y: number) => Math.max(y0, ...laneTops.filter((t) => t <= y && clear(t)));
        const yAt = (z: number) => (map && Number.isFinite(teamsY) ? snap(teamsY - (width / aspect / z) * 0.5) : y0);
        if (window.matchMedia("(max-width: 600px)").matches) {
          const z = map ? 0.68 : 0.8;
          rf.setViewport({ x: 16 - x0 * z, y: 16 - yAt(z) * z, zoom: z });
          return;
        }
        // when the whole graph would fit only below the floor, start at its top left at the floor and pan from there
        const x1 = Math.max(...top.map((n) => n.position.x + (Number(n.style?.width) || 0)));
        const y1 = Math.max(...top.map((n) => n.position.y + (Number(n.style?.height) || 0)));
        const fit = Math.min(width / ((x1 - x0) * 1.28), width / aspect / ((y1 - y0) * 1.28));
        if (fit < floor) {
          rf.setViewport({ x: 16 - x0 * floor, y: 16 - yAt(floor) * floor, zoom: floor });
          return;
        }
      }
      rf.fitView({ padding: 0.14, duration: 0, maxZoom: 1, minZoom: floor });
    }, 30);
    return () => window.clearTimeout(t);
  }, [map, d.draft.length, rf, width, aspect, floor]);

  const parse = (id: string | null | undefined): { team: string; key: string } | null => {
    const m = id?.match(/^seat:([^/]*)\/(.+)$/);
    return m ? { team: m[1], key: m[2] } : null;
  };
  const onConnect = (c: Connection) => {
    const a = parse(c.source), b = parse(c.target);
    if (a && b && a.team === b.team) d.connect(c.sourceHandle === "ho" ? "ho" : "rt", a.team, a.key, b.key);
  };
  const onEdgesDelete = (es: Edge[]) => es.forEach((e) => { const x = e.data as { kind?: LinkKind; team: string; from: string; to: string } | undefined; if (x?.kind) d.dropEdge(x.kind, x.team, x.from, x.to); });

  const onNodeDragStop = (_: unknown, n: Node) => {
    if (n.type === "seat") {
      const hit = rf.getIntersectingNodes(n).find((x) => x.type === "flow") ?? rf.getIntersectingNodes(n).find((x) => x.type === "lane");
      const s = parse(n.id);
      if (hit && s && map) {
        const files = hit.type === "flow" ? map.flows.find((f) => `flow:${f.id}` === hit.id)?.files : map.domains.find((x) => `lane:${x.id}` === hit.id)?.files;
        if (files?.length) d.setMember(s.team, s.key, { scope: [...files].sort() });
        setNodes(built);
        return;
      }
    }
    if (n.type !== "seat" && n.type !== "team") return;
    const ids = new Set(built.map((x) => x.id));
    const next: Saved = { [LAYOUT_MARK]: [2, 0] };
    for (const [k, v] of Object.entries({ ...(saved[LAYOUT_MARK] ? saved : {}), [n.id]: [Math.round(n.position.x), Math.round(n.position.y)] as [number, number] })) if (ids.has(k)) next[k] = v;
    setSaved(next);
    api.agentAction("layout_save", { layout: next }).catch(() => undefined);
  };

  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DND);
    if (!raw) return;
    e.preventDefault();
    const it = JSON.parse(raw) as Item;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const under = rf.getIntersectingNodes({ x: p.x, y: p.y, width: 1, height: 1 });
    const seat = parse(under.find((x) => x.type === "seat")?.id);
    const team = (under.find((x) => x.type === "team")?.data as TeamData | undefined)?.team.name;
    onItem(it, seat ? { team: seat.team, key: seat.key } : team !== undefined ? { team } : null);
  };

  return (
    <div ref={box} className={`hub-canvas${far ? " far" : ""}${map ? " mapped" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes(DND)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onConnect={onConnect} onEdgesDelete={onEdgesDelete}
        onBeforeDelete={async ({ edges: es }) => ({ nodes: [], edges: es.filter((e) => e.deletable !== false) })}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => {
          if (n.type === "seat") { const s = parse(n.id); if (s) setPick(s); }
          else if (n.type === "team") setPick({ team: (n.data as TeamData).team.name });
          else if (n.type === "flow") setFlow(n.id.slice(5));
        }}
        onPaneClick={() => { setPick(null); setFlow(null); }}
        minZoom={0.25} maxZoom={1.6} fitView fitViewOptions={{ padding: 0.14, maxZoom: 1, minZoom: floor }} proOptions={{ hideAttribution: true }} deleteKeyCode={["Backspace", "Delete"]}
        connectionLineStyle={{ stroke: "#f97f3a", strokeWidth: 1.5 }}
      >
        <Background variant={BackgroundVariant.Dots} color="#2a2420" gap={20} size={1.2} />
        <div className="graph-overlay zoom">
          <button className="btn" aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 200 })}><Icon.plus /></button>
          <button className="btn" aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 200 })}><Icon.minus /></button>
          <button className="btn" aria-label="Fit view" title="Fit" onClick={() => rf.fitView({ padding: 0.14, duration: 300, maxZoom: 1, minZoom: floor })}><Icon.target /></button>
        </div>
      </ReactFlow>
      {d.draft.length === 0 && <button className="cv-msg" onClick={onEmpty}><span className="cv-msg-plus">+</span>Add first agent</button>}
    </div>
  );
}
