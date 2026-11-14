// The agent canvas proper (P3.14): every team as a hairline frame, nested by
// kula.toml's `under`, every seat as a near black entity inside it. `reports_to` is a
// solid line from the lead down; `hands_off` is an orange arrow. Workflows are
// lenses: picking one tints the seats that run it and dims the rest. Layout is
// elkjs layered, top down, with the frames as compound nodes. Read only here;
// P3.15 turns the same canvas into the editor. Loaded on demand so neither
// xyflow nor elk weighs on the first paint.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, type Node, type Edge, type NodeProps, type Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import type { AgentsInfo, Team } from "../../api";
import { AGENT_NAME, GLYPHS } from "./data";
import { workflowColor } from "./TeamOrg";
import { fenceSummary, seatName } from "./parts";
import { seatKey, titleFor } from "../../roster";

type Member = Team["members"][number];
export type Seat = { team: string; m: Member; key: string };
type AgentData = { seat: Seat; color: string; role: string; fence?: { t: string; l: string }; dim: boolean; lit: boolean; live: boolean };
type TeamData = { team: Team; live: boolean; depth: number };

const W = 208, H = 70, PAD_TOP = 40, PAD = 18;
const elk = new ELK();

/** Architect mode's hooks into the drawing; absent when the canvas only shows. */
export type CanvasEdit = {
  /** a drag from one seat to another in the same team */
  connect: (team: string, from: string, to: string) => void;
  /** an edge removed with Delete or Backspace */
  dropEdge: (kind: "rt" | "ho", team: string, from: string, to: string) => void;
  addSeat: (team: string) => void;
  pickTeam: (team: string) => void;
  team: string | null;
};
const EditCtx = createContext<CanvasEdit | null>(null);

function AgentNode({ data, selected }: NodeProps<Node<AgentData>>) {
  const { seat: { m }, color, role, fence, dim, lit, live } = data;
  const edit = useContext(EditCtx);
  return (
    <div className={`cv-agent ${dim ? "dim" : ""} ${lit ? "lit" : ""} ${live ? "live" : ""} ${selected ? "sel" : ""}`} style={{ ["--wf" as string]: color }} data-seat={seatName(m)}>
      <Handle type="target" position={Position.Top} className="cv-handle" isConnectable={!!edit} />
      <div className="cv-agent-top">
        <span className="cv-glyph" title={AGENT_NAME[m.agent] ?? m.agent ?? "any agent"}>{GLYPHS[m.agent] ?? "·"}</span>
        <b className="cv-name">{seatName(m)}</b>
        {fence && <span className={`cv-fence ${fence.l}`}>{fence.t}</span>}
      </div>
      <div className="cv-agent-sub">
        <span className="cv-role">{role}</span>
        {m.workflow ? <span className="cv-wf"><i />{m.workflow}</span> : <span className="cv-wf none">no workflow</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="cv-handle" isConnectable={!!edit} />
    </div>
  );
}

function TeamNode({ data }: NodeProps<Node<TeamData>>) {
  const edit = useContext(EditCtx);
  const name = data.team.name;
  return (
    <div className={`cv-team ${data.live ? "live" : ""} ${edit?.team === name ? "sel" : ""}`} data-depth={data.depth} data-team={name}>
      <div className="cv-team-head" onClick={edit ? (e) => { e.stopPropagation(); edit.pickTeam(name); } : undefined}>
        <b>{name}</b>
        <span className="cv-team-n">{data.team.members.length}</span>
        {data.live && <span className="cv-team-live">at work</span>}
        {edit && <button className="cv-add nodrag" title={`Add a seat to ${name}`} aria-label={`Add a seat to ${name}`} onClick={(e) => { e.stopPropagation(); edit.addSeat(name); }}>+</button>}
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode, team: TeamNode };

/** The teams as an elk compound graph, then as xyflow nodes and edges with positions. */
async function layout(info: AgentsInfo, lens: Set<string>): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const teams = info.teams;
  const names = new Set(teams.map((t) => t.name));
  const parentOf = (t: Team) => (t.under && names.has(t.under) && t.under !== t.name ? t.under : "");
  const tid = (n: string) => `team:${n}`;
  const sid = (team: string, key: string) => `seat:${team}/${key}`;

  // elk compound graph
  type EN = { id: string; width?: number; height?: number; children?: EN[]; layoutOptions?: Record<string, string>; x?: number; y?: number };
  const enodes = new Map<string, EN>();
  for (const t of teams) {
    enodes.set(tid(t.name), {
      id: tid(t.name), children: t.members.map((m) => ({ id: sid(t.name, seatKey(m)), width: W, height: H })),
      layoutOptions: { "elk.padding": `[top=${PAD_TOP},left=${PAD},bottom=${PAD},right=${PAD}]`, "elk.direction": "DOWN", "elk.algorithm": "layered", "elk.layered.spacing.nodeNodeBetweenLayers": "48", "elk.spacing.nodeNode": "22" },
    });
  }
  const roots: EN[] = [];
  // a cycle in `under` would nest forever: walk up and cut it at the first repeat
  const depthOf = (t: Team) => { let d = 0, c = parentOf(t); const seen = new Set([t.name]); while (c && !seen.has(c)) { seen.add(c); d++; c = parentOf(teams.find((x) => x.name === c)!); } return d; };
  const cyclic = (t: Team) => { let c = parentOf(t); const seen = new Set([t.name]); while (c) { if (seen.has(c)) return true; seen.add(c); c = parentOf(teams.find((x) => x.name === c)!); } return false; };
  for (const t of teams) {
    const p = cyclic(t) ? "" : parentOf(t);
    if (p) enodes.get(tid(p))!.children!.push(enodes.get(tid(t.name))!); else roots.push(enodes.get(tid(t.name))!);
  }

  const edges: Edge[] = [];
  const eEdges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const t of teams) {
    const keys = new Set(t.members.map(seatKey));
    for (const m of t.members) {
      const k = seatKey(m);
      if (m.reports_to && keys.has(m.reports_to)) {
        const id = `rt:${t.name}/${k}`;
        eEdges.push({ id, sources: [sid(t.name, m.reports_to)], targets: [sid(t.name, k)] });
        edges.push({ id, source: sid(t.name, m.reports_to), target: sid(t.name, k), type: "smoothstep", className: "cv-edge-rt", data: { kind: "reports_to" } });
      }
      for (const h of m.hands_off ?? []) {
        if (!keys.has(h) || h === k) continue;
        const id = `ho:${t.name}/${k}>${h}`;
        edges.push({ id, source: sid(t.name, k), target: sid(t.name, h), type: "default", className: "cv-edge-ho", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#f97f3a" }, data: { kind: "hands_off" } });
      }
    }
  }

  const g = await elk.layout({
    id: "root", children: roots, edges: eEdges,
    layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.spacing.nodeNode": "40", "elk.layered.spacing.nodeNodeBetweenLayers": "56", "elk.padding": "[top=10,left=10,bottom=10,right=10]" },
  } as Parameters<typeof elk.layout>[0]);

  const nodes: Node[] = [];
  const liveTeam = info.team?.name;
  const visit = (n: EN, parent?: string) => {
    if (n.id.startsWith("team:")) {
      const t = teams.find((x) => tid(x.name) === n.id)!;
      nodes.push({ id: n.id, type: "team", position: { x: n.x ?? 0, y: n.y ?? 0 }, parentId: parent, data: { team: t, live: liveTeam === t.name, depth: depthOf(t) }, style: { width: n.width, height: n.height }, selectable: false, draggable: false, zIndex: 0 });
      for (const c of n.children ?? []) visit(c, n.id);
    } else {
      const [team, key] = n.id.slice(5).split(/\/(.*)/s);
      const t = teams.find((x) => x.name === team)!;
      const m = t.members.find((x) => seatKey(x) === key)!;
      const w = info.workflows.find((x) => x.name === m.workflow);
      const f = w ? fenceSummary(w)[0] : undefined;
      const on = lens.size === 0 || (!!m.workflow && lens.has(m.workflow));
      nodes.push({
        id: n.id, type: "agent", position: { x: n.x ?? 0, y: n.y ?? 0 }, parentId: parent, extent: "parent", draggable: false, zIndex: 2,
        data: { seat: { team, m, key }, color: workflowColor(info.workflows, m.workflow), role: titleFor(m.role || (m.reports_to ? "member" : "lead")), fence: f, dim: !on, lit: lens.size > 0 && on, live: liveTeam === team },
      });
    }
  };
  for (const r of g.children ?? []) visit(r as EN);
  // a parent must precede its children in xyflow's list
  return { nodes, edges: edges.map((e) => ({ ...e, zIndex: 1 })) };
}

const parseEdge = (id: string) => {
  const kind = id.slice(0, 2) as "rt" | "ho";
  const [team, rest] = id.slice(3).split(/\/(.*)/s);
  if (kind === "rt") return { kind, team, from: "", to: rest };
  const [from, to] = rest.split(">");
  return { kind, team, from, to };
};

export default function CanvasFlow({ info, lens, onSelect, selected, edit }: { info: AgentsInfo; lens: Set<string>; onSelect: (s: Seat | null) => void; selected: string | null; edit?: CanvasEdit }) {
  const [graph, setGraph] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lensKey = [...lens].sort().join(",");
  const shape = useMemo(() => JSON.stringify(info.teams) + (info.team?.name ?? ""), [info.teams, info.team?.name]);
  useEffect(() => {
    let live = true;
    layout(info, lens).then((g) => { if (live) { setGraph(g); setErr(null); } }).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, lensKey, info.workflows]);

  const nodes = useMemo(() => graph?.nodes.map((n) => (n.type === "agent" ? { ...n, selected: n.id === selected } : n)) ?? [], [graph, selected]);
  const edges = useMemo(() => {
    if (!graph) return [];
    if (!lens.size) return graph.edges;
    const dim = new Set(graph.nodes.filter((n) => n.type === "agent" && (n.data as AgentData).dim).map((n) => n.id));
    return graph.edges.map((e) => (dim.has(e.source) || dim.has(e.target) ? { ...e, className: `${e.className} dim` } : e));
  }, [graph, lens.size]);

  const [selEdge, setSelEdge] = useState<string | null>(null);
  const seatOf = (id: string) => { const [team, key] = id.slice(5).split(/\/(.*)/s); return { team, key }; };
  const onConnect = (c: Connection) => {
    if (!edit || !c.source || !c.target || c.source === c.target) return;
    const a = seatOf(c.source), b = seatOf(c.target);
    if (a.team === b.team) edit.connect(a.team, a.key, b.key);
  };

  if (err) return <div className="cv-msg">Layout failed: {err}</div>;
  if (!graph) return <div className="cv-msg">Laying out the teams</div>;
  return (
    <EditCtx.Provider value={edit ?? null}>
    <ReactFlow
      nodes={nodes} edges={edit ? edges.map((e) => ({ ...e, deletable: true, focusable: true, selected: e.id === selEdge })) : edges}
      onEdgesChange={edit ? (cs) => { for (const c of cs) if (c.type === "select") setSelEdge((cur) => (c.selected ? c.id : cur === c.id ? null : cur)); } : undefined} nodeTypes={nodeTypes} colorMode="dark"
      nodesDraggable={false} nodesConnectable={!!edit} edgesFocusable={!!edit} elementsSelectable
      isValidConnection={(c) => !!c.source && !!c.target && c.source !== c.target && seatOf(c.source).team === seatOf(c.target).team}
      onConnect={onConnect}
      onBeforeDelete={async ({ nodes: ns, edges: es }) => ns.length === 0 && es.length > 0}
      onEdgesDelete={(es) => { for (const e of es) { const p = parseEdge(e.id); edit?.dropEdge(p.kind, p.team, p.from, p.to); } }}
      deleteKeyCode={edit ? ["Backspace", "Delete"] : null}
      fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }} minZoom={0.2} maxZoom={2}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => { if (n.type === "agent") onSelect((n.data as AgentData).seat); }}
      onPaneClick={() => onSelect(null)}
    >
      <Background gap={22} size={1} color="#1a1715" />
      <MiniMap pannable zoomable position="bottom-right" style={{ width: 150, height: 96 }} className="cv-minimap" nodeColor={(n) => (n.type === "team" ? "#1a1715" : (n.data as AgentData).color)} nodeStrokeColor="transparent" maskColor="rgba(0,0,0,0.6)" />
      <Controls showInteractive={false} position="top-left" className="cv-controls" />
    </ReactFlow>
    </EditCtx.Provider>
  );
}
