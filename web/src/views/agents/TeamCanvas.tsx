// The team as a map canvas (module U16): React Flow, the same dotted ground,
// zoom controls and pan as the Workspace map. Every member is an agent square
// with its harmonograph; the lead sits on top and an edge runs lead → member.
// Dragging arranges the members, and the arrangement is saved per team in
// kula.toml (team_layout) 500 ms after the last drag stops – never per move.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Handle, Panel, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Edge, type Node, type NodeChange } from "@xyflow/react";
import { AgentHarmonograph, agentGradient } from "../../flow/agentMark";
import { Icon } from "../../ui";
import { seatKey, titleFor } from "../../roster";
import type { AgentsInfo, Team } from "../../api";

const W = 148, H = 92; // the agent square
const GAP = 48;

export type Member = Team["members"][number];

/** Where a member sits when nothing is saved: the lead on top, members below. */
function defaultLayout(members: Member[]): Record<string, [number, number]> {
  const lead = members.findIndex((m) => !m.reports_to);
  const out: Record<string, [number, number]> = {};
  let row = 0, col = 0;
  members.forEach((m, i) => {
    if (i === lead) out[key(m)] = [0, 0];
    else out[key(m)] = [col++ * (W + GAP) - ((members.length - 2) * (W + GAP)) / 2, H + GAP];
  });
  return out;
}

const key = (m: Member) => seatKey(m) || `seat-${m.workflow || "none"}-${m.agent || "any"}`;

function SquareNode({ data }: { data: { member: Member; live: boolean } }) {
  const m = data.member;
  const isLead = !m.reports_to;
  const [a, b] = agentGradient(key(m));
  return (
    <div className={`tc-node${data.live ? " live" : ""}`} style={{ ["--tc-a" as string]: a, ["--tc-b" as string]: b }}>
      {/* the handles are what an edge anchors to – hidden, the square is the anchor */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <div className="tc-node-mark"><AgentHarmonograph name={key(m)} size={30} /></div>
      <div className="tc-node-body">
        <span className="tc-node-name mono">{m.name || m.agent || "any agent"}</span>
        <span className="tc-node-sub">{isLead ? "lead" : titleFor(m.role || "member")}{m.workflow ? ` · ${m.workflow}` : ""}</span>
      </div>
    </div>
  );
}

const nodeTypes = { tc: SquareNode };

function Canvas({ team, info, live, onMove, onOpen }: {
  team: Team; info?: AgentsInfo; live: boolean; onMove: (positions: Record<string, [number, number]>) => void; onOpen: (k: string) => void;
}) {
  const rf = useReactFlow();
  const reduced = useRef(false);
  useEffect(() => { reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);
  const nodes = useMemo<Node[]>(() => {
    const saved = team.positions && Object.keys(team.positions).length ? team.positions : defaultLayout(team.members);
    return team.members.map((m) => {
      const k = key(m);
      const [x, y] = saved[k] ?? [0, H + GAP];
      return {
        id: k, type: "tc", position: { x, y },
        zIndex: m.reports_to ? 0 : 2, // the lead on top
        data: { member: m, live },
        draggable: true,
        style: { width: W, height: H },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });
  }, [team.members, team.positions, live]);
  const edges = useMemo<Edge[]>(() => {
    // A seat's reports_to may name the lead by agent, name or seat key – the
    // same fixture may hold any of them. Resolve it to the node id we drew.
    const resolve = (rep: string): string | null => {
      const target = team.members.find((x) => key(x) === rep || x.agent === rep || x.name === rep);
      return target ? key(target) : null;
    };
    return team.members.flatMap((m) => {
      const src = m.reports_to ? resolve(m.reports_to) : null;
      return src && src !== key(m) ? [{
        id: `${src}->${key(m)}`, source: src, target: key(m),
        style: { stroke: "var(--line-2)" }, animated: false,
      }] : [];
    });
  }, [team.members]);
  // Controlled flow state: the nodes and edges follow the team (the effects
  // sync on every team change), so a tab switch redraws exactly its members.
  const [rfNodes, setRfNodes, onNodesState] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesState] = useEdgesState<Edge>([]);
  useEffect(() => { setRfNodes(nodes); }, [setRfNodes, nodes]);
  useEffect(() => { setRfEdges(edges); }, [setRfEdges, edges]);
  // Drag-stop → save. One write per gesture, debounced 500 ms.
  const timer = useRef<number>(0);
  const pending = useRef<Record<string, [number, number]>>({});
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesState(changes);
    const pos = changes.filter((c) => c.type === "position" && c.dragging === false) as { id: string; position?: { x: number; y: number } }[];
    for (const c of pos) if (c.position) pending.current[c.id] = [Math.round(c.position.x), Math.round(c.position.y)];
    if (pos.length) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { onMove({ ...(team.positions ?? {}), ...pending.current }); pending.current = {}; }, 500);
    }
  }, [onNodesState, onMove, team.positions]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="tc-canvas" data-testid="team-canvas" tabIndex={0} aria-label={`Team ${team.name} canvas`}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesState}
        onNodeClick={(_, n) => onOpen(n.id)}
        nodesConnectable={false} edgesFocusable={false} nodesFocusable={false}
        panOnDrag minZoom={0.4} maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={2} color="var(--line)" />
        <Panel position="bottom-left" className="fc-controls">
          <button className="fc-ctl" data-testid="team-zoom-in" onClick={() => rf.zoomIn({ duration: reduced.current ? 0 : 120 })} title="Zoom in">+</button>
          <button className="fc-ctl" data-testid="team-zoom-out" onClick={() => rf.zoomOut({ duration: reduced.current ? 0 : 120 })} title="Zoom out">−</button>
          <button className="fc-ctl" data-testid="team-fit" onClick={() => rf.fitView({ padding: 0.15, duration: reduced.current ? 0 : 120 })} title="Fit">⤢</button>
        </Panel>
      </ReactFlow>
      {team.members.length === 0 && <div className="tc-empty muted">No members yet – open the sidebar and add agents.</div>}
      {live && <span className="tag accent tc-live">at work</span>}
    </div>
  );
}

export default function TeamCanvas(props: Parameters<typeof Canvas>[0]) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

/** The canvas header row: the toggle for the sidebar lives with the map's own chrome. */
export function CanvasHead({ team, onSide, sideOpen, onWork, onStop, live }: {
  team: Team; onSide: () => void; sideOpen: boolean; live: boolean; onWork: () => void; onStop: () => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => { if (!confirmStop) return; const id = setTimeout(() => setConfirmStop(false), 3000); return () => clearTimeout(id); }, [confirmStop]);
  return (
    <div className="tc-head">
      <span className="tc-head-name mono">{team.name}</span>
      {team.about && <span className="tc-head-about muted">{team.about}</span>}
      <span className="spacer" />
      {live
        ? <button className="btn sm" onClick={() => (confirmStop ? (setConfirmStop(false), onStop()) : setConfirmStop(true))}>{confirmStop ? "Confirm stand down" : "Stand down"}</button>
        : <button className="btn sm primary" data-testid="team-work" onClick={onWork}><Icon.play /> Put to work</button>}
      <button className={`btn sm ghost${sideOpen ? " on" : ""}`} data-testid="team-side-toggle" aria-expanded={sideOpen} onClick={onSide} title="Team details"><Icon.sidebar /> Details</button>
    </div>
  );
}

export { key as memberKey, defaultLayout };
