// The team as a map canvas (module U16): React Flow, the same dotted ground,
// zoom controls and pan as the Workspace map. Every member is an agent square
// with its harmonograph; the lead sits on top and an edge runs lead → member.
// Dragging arranges the members, and the arrangement is saved per team in
// kula.toml (team_layout) 500 ms after the last drag stops – never per move.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Handle, Panel, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Edge, type Node, type NodeChange } from "@xyflow/react";
import { AgentHarmonograph, agentGradient } from "../../flow/agentMark";
import { openLogoStudio } from "./LogoStudio";
import { Icon } from "../../ui";
import { seatKey, titleFor } from "../../roster";
import type { AgentsInfo, Team } from "../../api";

const W = 148, H = 92; // the agent square
const GAP = 48;

export type Member = Team["members"][number];

/** Where a member sits when nothing is saved: the lead on top, members below. */
function defaultLayout(members: Member[]): Record<string, [number, number]> {
  const lead = Math.max(0, members.findIndex((m) => !m.reports_to));
  const out: Record<string, [number, number]> = {};
  const rest = members.length - 1;
  let col = 0;
  members.forEach((m, i) => {
    if (i === lead) out[key(m)] = [0, 0];
    else out[key(m)] = [(col++ - (rest - 1) / 2) * (W + GAP), H + GAP * 1.5];
  });
  return out;
}

const key = (m: Member) => seatKey(m) || `seat-${m.workflow || "none"}-${m.agent || "any"}`;

function SquareNode({ data }: { data: { member: Member; live: boolean; lead: boolean; teamName?: string; onSeatDrop?: (source: string, target: Member, shift: boolean) => void } }) {
  const m = data.member;
  const isLead = data.lead;
  const [a, b] = agentGradient(key(m), "team");
  return (
    <div className={`tc-node${data.live ? " live" : ""} tc-drop`} style={{ ["--tc-a" as string]: a, ["--tc-b" as string]: b }}
      onDragOver={(e) => { if (data.onSeatDrop && e.dataTransfer.types.includes("application/x-kula-drag")) { e.preventDefault(); e.currentTarget.classList.add("drop-ok"); } }}
      onDragLeave={(e) => e.currentTarget.classList.remove("drop-ok")}
      onDrop={(e) => {
        e.currentTarget.classList.remove("drop-ok");
        try {
          const p = JSON.parse(e.dataTransfer.getData("application/x-kula-drag")) as { kind: string; member?: string; name?: string };
          if (p.kind === "seat" && p.member && data.onSeatDrop) data.onSeatDrop(p.member, data.member, e.shiftKey);
        } catch { /* not ours */ }
      }}>
      {/* dropping a seat here sets reports_to (shift-drag sets hands_off); the seat itself drags as its key */}
      <div className="tc-drag" draggable onDragStart={(e) => {
        try { e.dataTransfer.setData("application/x-kula-drag", JSON.stringify({ kind: "seat", team: data.teamName, member: key(m) })); e.dataTransfer.setData("text/plain", key(m)); } catch { /* */ }
      }} aria-hidden="true" />
      {/* the handles are what an edge anchors to – hidden, the square is the anchor */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <div className="tc-node-mark logo-click" role="button" tabIndex={0} aria-label={`Open the logo studio for ${m.name || m.agent || "any agent"}`}
        data-testid={`tc-mark-${key(m)}`} onClick={(e) => { e.stopPropagation(); openLogoStudio("team", key(m)); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); openLogoStudio("team", key(m)); } }}>
        <AgentHarmonograph name={key(m)} size={30} family="team" />
      </div>
      <div className="tc-node-body">
        {/* the seat's role only: the name and the mark already say which agent
            this is, and a duplicated workflow line made every label truncate */}
        <span className="tc-node-name mono">{m.name || m.agent || "any agent"}</span>
        <span className="tc-node-sub">{isLead ? "lead" : titleFor(m.role || "member")}</span>
      </div>
    </div>
  );
}

const nodeTypes = { tc: SquareNode };

function Canvas({ team, info, live, onMove, onOpen, onDropAgent, onSeatDrop }: {
  team: Team; info?: AgentsInfo; live: boolean; onMove: (positions: Record<string, [number, number]>) => void; onOpen: (k: string) => void;
  onDropAgent?: (name: string) => void; onSeatDrop?: (source: string, target: Member, shift: boolean) => void;
}) {
  const rf = useReactFlow();
  const reduced = useRef(false);
  useEffect(() => { reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);
  // The team is refetched on every poll: key the drawing on its content, so
  // an unchanged team never resets the flow state (and the squares stay put).
  const sig = JSON.stringify([team.members, team.positions ?? null]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const members = useMemo(() => team.members, [sig]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => team.positions, [sig]);
  const nodes = useMemo<Node[]>(() => {
    const saved = { ...defaultLayout(members), ...(positions ?? {}) };
    const lead = members.find((m) => !m.reports_to);
    return members.map((m) => {
      const k = key(m);
      const [x, y] = saved[k] ?? [0, H + GAP];
      return {
        id: k, type: "tc", position: { x, y },
        zIndex: m === lead ? 2 : 0, // the lead on top
        data: { member: m, live, lead: m === lead, teamName: team.name, onSeatDrop: onSeatDrop },
        draggable: true,
        style: { width: W, height: H },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });
  }, [members, positions, live]);
  const edges = useMemo<Edge[]>(() => {
    // A seat's reports_to may name the lead by agent, name or seat key – the
    // same fixture may hold any of them. Resolve it to the node id we drew.
    const resolve = (rep: string): string | null => {
      const target = members.find((x) => key(x) === rep || x.agent === rep || x.name === rep);
      return target ? key(target) : null;
    };
    // A seat with no answers-to hangs off the lead (the first seat without
    // one), so every team reads as lead → members.
    const lead = members.find((m) => !m.reports_to);
    return members.flatMap((m) => {
      const src = m.reports_to ? resolve(m.reports_to) : lead && m !== lead ? key(lead) : null;
      return src && src !== key(m) ? [{
        id: `${src}->${key(m)}`, source: src, target: key(m),
        style: { stroke: "var(--line-2)" }, animated: false,
      }] : [];
    });
  }, [members]);
  // Controlled flow state: the nodes and edges follow the team (the effects
  // sync on every team change), so a tab switch redraws exactly its members.
  const [rfNodes, setRfNodes, onNodesState] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesState] = useEdgesState<Edge>([]);
  useEffect(() => { setRfNodes(nodes); }, [setRfNodes, nodes]);
  useEffect(() => { setRfEdges(edges); }, [setRfEdges, edges]);
  const count = members.length;
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      // On a phone the fitted zoom shrinks the squares until their marks are
      // untouchable: keep the real size and let the canvas pan instead.
      const floor = () => { if (window.innerWidth <= 600 && rf.getZoom() < 1) rf.zoomTo(1, { duration: 0 }); };
      rf.fitView({ padding: 0.25, maxZoom: 1.1 }).then(floor).catch(() => {});
    });
    return () => window.cancelAnimationFrame(id);
  }, [rf, team.name, count]);
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
    <div className="tc-canvas tc-drop" data-testid="team-canvas" tabIndex={0} aria-label={`Team ${team.name} canvas`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-kula-drag")) e.preventDefault(); }}
      onDrop={(e) => {
        try {
          const raw = e.dataTransfer.getData("application/x-kula-drag");
          if (!raw) return;
          const p = JSON.parse(raw) as { kind: string; name?: string };
          if (p.kind === "agent" && p.name && onDropAgent) { e.preventDefault(); onDropAgent(p.name); }
        } catch { /* not ours */ }
      }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesState}
        onNodeClick={(_, n) => onOpen(n.id)}
        nodesConnectable={false} edgesFocusable={false} nodesFocusable={false}
        fitView fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }} panOnDrag minZoom={0.4} maxZoom={2}
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

// ── Every team in one space ─────────────────────────────────────────────
// Each team is a tinted rectangle (a React Flow parent node) holding its
// seats; drag the rectangle to move the team, drag a seat to arrange it
// inside (the rectangle grows to fit). The team's own corner is saved with
// its seats under the reserved key TEAM_AT, so one team_layout write keeps both.
const PAD = 22, HEAD = 34, TEAM_GAP = 72;
export const TEAM_AT = "@team";
// One distinct tint per team, in tab order, from the palette tokens.
const TINTS = ["var(--accent)", "var(--blue)", "var(--green)", "var(--violet)", "var(--yellow)", "var(--red)"];

function TeamGroup({ data }: { data: { team: Team; on: boolean; live: boolean; tint: string; onPick: () => void } }) {
  return (
    <div className={`tg${data.on ? " on" : ""}${data.live ? " live" : ""}`} style={{ ["--tg" as string]: data.tint }} data-testid={`team-group-${data.team.name}`}>
      <button className="tg-head mono" onClick={(e) => { e.stopPropagation(); data.onPick(); }} title={`Select ${data.team.name}`}>
        <span className="tg-dot" />{data.team.name}<span className="tg-n">{data.team.members.length}</span>
        {data.live && <span className="tag accent">at work</span>}
      </button>
    </div>
  );
}
const allTypes = { tc: SquareNode, tg: TeamGroup };

function AllCanvas({ teams, cur, live, onPick, onMove, onOpen, onDropAgent, onSeatDrop }: {
  teams: Team[]; cur: number; live?: string;
  onPick: (i: number) => void;
  onMove: (i: number, positions: Record<string, [number, number]>) => void;
  onOpen: (i: number, k: string) => void;
  onDropAgent?: (i: number, name: string) => void;
  onSeatDrop?: (i: number, source: string, target: Member, shift: boolean) => void;
}) {
  const rf = useReactFlow();
  const sig = JSON.stringify(teams.map((t) => [t.name, t.members, t.positions ?? null]));
  // Per team: seat positions relative to the rectangle, its size and corner.
  const frames = useMemo(() => {
    let nextX = 0;
    return teams.map((t) => {
      const raw = { ...defaultLayout(t.members), ...(t.positions ?? {}) };
      const pts = t.members.map((m) => raw[key(m)] ?? [0, H + GAP]);
      const minX = Math.min(0, ...pts.map((p) => p[0])), minY = Math.min(0, ...pts.map((p) => p[1]));
      const maxX = Math.max(0, ...pts.map((p) => p[0])), maxY = Math.max(0, ...pts.map((p) => p[1]));
      const w = Math.max(W + 2 * PAD, maxX - minX + W + 2 * PAD), h = Math.max(H + 2 * PAD, maxY - minY + H + 2 * PAD) + HEAD;
      const at = (t.positions?.[TEAM_AT] as [number, number] | undefined) ?? [nextX, 0];
      nextX = Math.max(nextX, at[0] + w + TEAM_GAP);
      return { t, raw, minX, minY, w, h, at };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const nodes = useMemo<Node[]>(() => frames.flatMap((f, i) => {
    const gid = `team:${i}`;
    const lead = f.t.members.find((m) => !m.reports_to);
    const group: Node = {
      id: gid, type: "tg", position: { x: f.at[0], y: f.at[1] }, zIndex: -1, selectable: false,
      style: { width: f.w, height: f.h }, dragHandle: ".tg-head",
      data: { team: f.t, on: i === cur, live: live === f.t.name, tint: TINTS[i % TINTS.length], onPick: () => onPick(i) },
    };
    const seats: Node[] = f.t.members.map((m) => {
      const [x, y] = f.raw[key(m)] ?? [0, H + GAP];
      return {
        id: `${i}|${key(m)}`, type: "tc", parentId: gid, expandParent: true,
        position: { x: x - f.minX + PAD, y: y - f.minY + PAD + HEAD },
        zIndex: m === lead ? 2 : 1, style: { width: W, height: H },
        data: { member: m, live: live === f.t.name, lead: m === lead, teamName: f.t.name, onSeatDrop: onSeatDrop ? (s: string, tg: Member, sh: boolean) => onSeatDrop(i, s, tg, sh) : undefined },
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
      };
    });
    return [group, ...seats];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [frames, cur, live]);
  const edges = useMemo<Edge[]>(() => teams.flatMap((t, i) => {
    const lead = t.members.find((m) => !m.reports_to);
    const resolve = (rep: string) => { const x = t.members.find((y) => key(y) === rep || y.agent === rep || y.name === rep); return x ? key(x) : null; };
    return t.members.flatMap((m) => {
      const src = m.reports_to ? resolve(m.reports_to) : lead && m !== lead ? key(lead) : null;
      return src && src !== key(m) ? [{ id: `${i}|${src}->${key(m)}`, source: `${i}|${src}`, target: `${i}|${key(m)}`, style: { stroke: "var(--line-2)" } }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sig]);
  const [rfNodes, setRfNodes, onNodesState] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesState] = useEdgesState<Edge>([]);
  useEffect(() => { setRfNodes(nodes); }, [setRfNodes, nodes]);
  useEffect(() => { setRfEdges(edges); }, [setRfEdges, edges]);
  // Fit everything once, then zoom to the picked team when the pick changes.
  const fitted = useRef(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      if (!fitted.current) { fitted.current = true; rf.fitView({ padding: 0.12, maxZoom: 1 }).catch(() => {}); return; }
      rf.fitView({ nodes: [{ id: `team:${cur}` }], padding: 0.3, maxZoom: 1, duration: 200 }).catch(() => {});
    });
    return () => window.cancelAnimationFrame(id);
  }, [rf, cur, teams.length]);
  // Drag-stop → one team_layout write per team, debounced.
  const timer = useRef<number>(0);
  const pending = useRef<Map<number, Record<string, [number, number]>>>(new Map());
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesState(changes);
    const done = changes.filter((c) => c.type === "position" && c.dragging === false) as { id: string; position?: { x: number; y: number } }[];
    for (const c of done) {
      if (!c.position) continue;
      if (c.id.startsWith("team:")) {
        const i = Number(c.id.slice(5));
        const acc = pending.current.get(i) ?? {};
        acc[TEAM_AT] = [Math.round(c.position.x), Math.round(c.position.y)];
        pending.current.set(i, acc);
      } else {
        const [si, k] = [Number(c.id.slice(0, c.id.indexOf("|"))), c.id.slice(c.id.indexOf("|") + 1)];
        const f = frames[si]; if (!f) continue;
        const acc = pending.current.get(si) ?? {};
        acc[k] = [Math.round(c.position.x - PAD + f.minX), Math.round(c.position.y - PAD - HEAD + f.minY)];
        pending.current.set(si, acc);
      }
    }
    if (done.length) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        pending.current.forEach((p, i) => { const t = teams[i]; if (t) onMove(i, { ...(t.positions ?? {}), ...p }); });
        pending.current.clear();
      }, 500);
    }
  }, [onNodesState, onMove, frames, teams]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // An agent card dropped on a rectangle joins that team; anywhere else, the picked one.
  const dropAt = (e: React.DragEvent) => {
    try {
      const raw = e.dataTransfer.getData("application/x-kula-drag");
      if (!raw) return;
      const p = JSON.parse(raw) as { kind: string; name?: string };
      if (p.kind !== "agent" || !p.name || !onDropAgent) return;
      e.preventDefault();
      const g = (e.target as HTMLElement).closest("[data-id^='team:']") as HTMLElement | null;
      onDropAgent(g ? Number(g.dataset.id!.slice(5)) : cur, p.name);
    } catch { /* not ours */ }
  };
  return (
    <div className="tc-canvas tc-all tc-drop" data-testid="team-canvas" tabIndex={0} aria-label="Teams canvas"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-kula-drag")) e.preventDefault(); }} onDrop={dropAt}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={allTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesState}
        onNodeClick={(_, n) => { if (n.type === "tc") { const i = Number(n.id.slice(0, n.id.indexOf("|"))); onOpen(i, n.id.slice(n.id.indexOf("|") + 1)); } }}
        nodesConnectable={false} edgesFocusable={false} nodesFocusable={false}
        panOnDrag minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={16} size={2} color="var(--line)" />
        <Panel position="bottom-left" className="fc-controls">
          <button className="fc-ctl" data-testid="team-zoom-in" onClick={() => rf.zoomIn({ duration: 120 })} title="Zoom in">+</button>
          <button className="fc-ctl" data-testid="team-zoom-out" onClick={() => rf.zoomOut({ duration: 120 })} title="Zoom out">−</button>
          <button className="fc-ctl" data-testid="team-fit" onClick={() => rf.fitView({ padding: 0.12, duration: 120 })} title="Fit every team">⤢</button>
        </Panel>
      </ReactFlow>
      {teams[cur] && teams[cur].members.length === 0 && <div className="tc-empty muted">{teams[cur].name} has no members yet – drag an agent onto it, or add one in Details.</div>}
    </div>
  );
}

export function TeamsCanvas(props: Parameters<typeof AllCanvas>[0]) {
  return <ReactFlowProvider><AllCanvas {...props} /></ReactFlowProvider>;
}

/** The canvas header row: limits chips (cost, turns, autonomy, fences) so the
 *  team's own rules are visible before you deploy, the sidebar toggle and the
 *  team action – "Deploy to Workspace" starts the whole team (B2: run requires
 *  a team; an agent alone is refused). */
export function CanvasHead({ team, onSide, sideOpen, onDeploy, onStop, live }: {
  team: Team; onSide: () => void; sideOpen: boolean; live: boolean; onDeploy: () => void; onStop: () => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => { if (!confirmStop) return; const id = setTimeout(() => setConfirmStop(false), 3000); return () => clearTimeout(id); }, [confirmStop]);
  const chips: string[] = [];
  if (team.limits?.max_cost != null) chips.push(`≤ $${team.limits.max_cost}`);
  if (team.limits?.max_turns != null) chips.push(`≤ ${team.limits.max_turns} turns`);
  chips.push(team.limits?.autonomy ? team.limits.autonomy : "ask");
  if (team.fences?.length) chips.push(`${team.fences.length} fence${team.fences.length === 1 ? "" : "s"}`);
  if (team.domains?.length) chips.push(`${team.domains.length} domain${team.domains.length === 1 ? "" : "s"}`);
  return (
    <div className="tc-head">
      <span className="tc-head-name mono">{team.name}</span>
      {team.about && <span className="tc-head-about muted">{team.about}</span>}
      <span className="tc-chips" aria-label="Team limits">
        {chips.map((c) => <span key={c} className="tc-chip mono" data-testid="tc-limit-chip">{c}</span>)}
      </span>
      <span className="spacer" />
      {live
        ? <button className="btn sm" onClick={() => (confirmStop ? (setConfirmStop(false), onStop()) : setConfirmStop(true))}>{confirmStop ? "Confirm stand down" : "Stand down"}</button>
        : <button className="btn sm primary" data-testid="team-work" onClick={onDeploy}><Icon.workspace /> Deploy to Workspace</button>}
      <button className={`btn sm ghost${sideOpen ? " on" : ""}`} data-testid="team-side-toggle" aria-expanded={sideOpen} onClick={onSide} title="Team details"><Icon.sidebar /> Details</button>
    </div>
  );
}

export { key as memberKey, defaultLayout };
