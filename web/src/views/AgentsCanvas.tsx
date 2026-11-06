// Agents: agentic teams painted on the canvas. A team is a frame, each agent a
// node in it, hand-offs are the wires between them and reporting lines the
// dashed ones. Drag an agent or a workflow from the palette onto a frame to
// add a seat (onto empty ground for a new team), drag a seat to another frame
// to move it, and configure a seat in the sidebar: workflow, scope and fences,
// skills, model, who it hands off to. The pane holds runs, the message board
// and the review queue. Composing work becomes wiring a system, not decoding.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, relTime, type Meta, type Team } from "../api";
import { Icon } from "../ui";
import { Harmonograph } from "../harmonograph";
import Canvas, { type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import { seatKey } from "../roster";
import { AGENT_IDS, AGENT_NAME, MODELS, type Nav } from "./agents/data";
import { fenceSummary, GuardTag, seatName } from "./agents/parts";
import { orgRows, teamProblems } from "./agents/TeamOrg";
import { useAgents } from "./useAgents";
import Runs, { useRuns } from "./Runs";
import { Loading } from "./Overview";

const Agents = lazy(() => import("./Agents"));
const Proposals = lazy(() => import("./MetaViews").then((m) => ({ default: m.Proposals })));
const Issues = lazy(() => import("./MetaViews").then((m) => ({ default: m.Issues })));
const Notes = lazy(() => import("./MetaViews").then((m) => ({ default: m.Notes })));

type Member = Team["members"][number];
const SEAT = { w: 210, h: 66 }, PAD = 18, HEAD = 34, COL = 240, ROW = 84, GAP = 60;
const CONFIG_TABS = ["overview", "workflows", "research", "teams", "skills", "fences", "memory", "docs", "connect"];
const PANE_OF_VIEW: Record<string, string> = { proposals: "proposals", issues: "issues", notes: "notes" };
const sid = (t: string, m: Member) => `seat:${t}/${seatKey(m)}`;

export default function AgentsCanvas(props: Nav & { view?: string }) {
  const { version, onChanged, go, target, view = "agents" } = props;
  const { info, err, act } = useAgents(version, onChanged);
  const { runs } = useRuns(version);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [sel, setSel] = useState<string | null>(null);
  const initialPane = PANE_OF_VIEW[view] ?? (target?.tab && CONFIG_TABS.includes(target.tab) ? "configure" : "runs");
  const [tab, setTab] = useState(initialPane);
  // a tab picked here wins over the one the URL implies when the click also navigates
  const pending = useRef<string | null>(null);
  useEffect(() => { setTab(pending.current ?? initialPane); pending.current = null; }, [initialPane]);
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, [version]);
  useEffect(() => { if (info) setTeams(info.teams); }, [info]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const dirty = !!info && !!teams && JSON.stringify(info.teams) !== JSON.stringify(teams);

  // Layout: frames side by side; inside, one column per org depth.
  const { nodes, edges } = useMemo(() => {
    const nodes: CNode[] = [], edges: CEdge[] = [];
    if (!teams) return { nodes, edges };
    let fx = 0;
    teams.forEach((t) => {
      const rows = orgRows(t.members);
      const depth = Math.max(0, ...rows.map((r) => r.depth));
      const perCol: number[] = [];
      const seats = rows.map((r) => { const i = perCol[r.depth] = (perCol[r.depth] ?? -1) + 1; return { m: r.m, x: PAD + r.depth * COL, y: HEAD + PAD + i * ROW }; });
      const w = Math.max(SEAT.w + PAD * 2, PAD * 2 + (depth + 1) * COL - (COL - SEAT.w));
      const h = Math.max(HEAD + PAD * 2 + ROW, HEAD + PAD + Math.max(1, ...perCol.map((n) => n + 1)) * ROW + PAD - (ROW - SEAT.h));
      const fid = `team:${t.name}`, off = moved[fid] ?? { x: fx, y: 0 };
      const live = info?.team?.name === t.name;
      const probs = teamProblems(t);
      nodes.push({ id: fid, x: off.x, y: off.y, w, h, frame: true, icon: <Icon.team />, title: t.name, label: `Team ${t.name}`, live,
        badge: <span className="tnum">{t.members.length} {probs.length ? "· !" : ""}</span>, kind: "team" });
      for (const s of seats) {
        const id = sid(t.name, s.m), p = moved[id] ?? { x: off.x + s.x, y: off.y + s.y };
        nodes.push({ id, x: p.x, y: p.y, ...SEAT, kind: "seat", live, label: seatName(s.m),
          icon: <Harmonograph seed={seatKey(s.m)} size={16} live={live} />, title: seatName(s.m),
          sub: `${AGENT_NAME[s.m.agent] ?? s.m.agent}${s.m.model ? ` · ${s.m.model}` : ""}`,
          body: <span className="mono">{s.m.workflow || "no workflow"}{s.m.role ? ` · ${s.m.role}` : ""}</span> });
        for (const h of s.m.hands_off ?? []) edges.push({ id: `${id}>h>${h}`, from: id, to: `seat:${t.name}/${h}`, label: "hand-off", tone: "accent" });
        if (s.m.reports_to) edges.push({ id: `${id}>r`, from: `seat:${t.name}/${s.m.reports_to}`, to: id, dashed: true });
      }
      fx = Math.max(fx, off.x) + w + GAP;
    });
    return { nodes, edges };
  }, [teams, moved, info?.team?.name]);

  if (err && !info) return <div className="page"><div className="muted">{err}</div></div>;
  if (!info || !teams) return <Loading text="Reading teams…" />;

  const edit = (next: Team[]) => setTeams(next);
  const findSeat = (id: string) => {
    const [tn, key] = id.slice(5).split("/");
    const ti = teams.findIndex((t) => t.name === tn);
    const mi = ti < 0 ? -1 : teams[ti].members.findIndex((m) => seatKey(m) === key);
    return { ti, mi, t: teams[ti], m: teams[ti]?.members[mi] };
  };
  const uniq = (t: Team, base: string) => { let n = base, i = 2; while (t.members.some((m) => seatKey(m) === n)) n = `${base}-${i++}`; return n; };
  const addSeat = (tn: string | null, data: string) => {
    const [kind, v] = data.split(":");
    const next = teams.map((t) => ({ ...t, members: [...t.members] }));
    let t = next.find((x) => x.name === tn);
    if (!t) { let n = "team", i = 1; while (next.some((x) => x.name === n)) n = `team-${++i}`; t = { name: n, members: [] }; next.push(t); }
    const agent = kind === "agent" ? v : info.default_agent ?? "claude";
    const m: Member = { name: uniq(t, kind === "workflow" ? v : agent), agent, ...(kind === "workflow" ? { workflow: v } : {}) };
    t.members.push(m); edit(next); setSel(sid(t.name, m));
  };
  const setMember = (ti: number, mi: number, patch: Partial<Member>) => {
    const old = teams[ti].members[mi], oldKey = seatKey(old);
    const next = teams.map((t, i) => i !== ti ? t : { ...t, members: t.members.map((m, j) => {
      if (j === mi) return { ...m, ...patch };
      const nk = seatKey({ ...old, ...patch });
      if (nk === oldKey) return m;
      // a rename carries its wires along
      return { ...m, reports_to: m.reports_to === oldKey ? nk : m.reports_to, hands_off: m.hands_off?.map((h) => (h === oldKey ? nk : h)) };
    }) });
    edit(next);
    const nk = seatKey({ ...old, ...patch }); if (nk !== oldKey) setSel(`seat:${teams[ti].name}/${nk}`);
  };
  const moveSeat = (id: string, toTeam: string) => {
    const { ti, mi, m } = findSeat(id); if (!m || teams[ti].name === toTeam) return;
    const next = teams.map((t, i) => i === ti ? { ...t, members: t.members.filter((_, j) => j !== mi) } : t)
      .map((t) => t.name === toTeam ? { ...t, members: [...t.members, { ...m, name: uniq(t, seatKey(m)), reports_to: undefined, hands_off: undefined }] } : t);
    edit(next); setSel(null);
  };
  const onMove = (id: string, x: number, y: number, done: boolean) => {
    if (id.startsWith("team:")) {
      const f = nodes.find((n) => n.id === id)!; const dx = x - f.x, dy = y - f.y;
      setMoved((p) => { const n = { ...p, [id]: { x, y } }; for (const s of nodes) if (s.id.startsWith(`seat:${id.slice(5)}/`)) n[s.id] = { x: s.x + dx, y: s.y + dy }; return n; });
      return;
    }
    if (!done) { setMoved((p) => ({ ...p, [id]: { x, y } })); return; }
    const n = nodes.find((v) => v.id === id)!; const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const frame = nodes.find((f) => f.frame && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h);
    if (frame && !id.startsWith(`seat:${frame.id.slice(5)}/`)) { moveSeat(id, frame.id.slice(5)); setMoved((p) => { const c = { ...p }; delete c[id]; return c; }); }
  };

  const save = () => act("teams_save", { teams }, "Teams saved").catch(() => {});
  const seat = sel?.startsWith("seat:") ? findSeat(sel) : null;
  const team = sel?.startsWith("team:") ? teams.find((t) => t.name === sel.slice(5)) : null;
  const wf = seat?.m ? info.workflows.find((w) => w.name === seat.m!.workflow) : null;
  const skills = (info.skills ?? []).filter((s) => wf && (`${wf.prompt ?? ""} ${(wf.steps ?? []).join(" ")} ${seat?.m?.prompt ?? ""}`).includes(s.name));

  const side = seat?.m ? {
    title: seatName(seat.m), sub: `${seat.t.name} · ${AGENT_NAME[seat.m.agent] ?? seat.m.agent}`, icon: <Harmonograph seed={seatKey(seat.m)} size={18} />, onClose: () => setSel(null),
    body: <div className="side-sections" data-testid="seat-config">
      <label className="side-field"><span>Name</span><input aria-label="Seat name" value={seat.m.name ?? ""} placeholder={seat.m.agent} onChange={(e) => setMember(seat.ti, seat.mi, { name: e.target.value || undefined })} /></label>
      <label className="side-field"><span>Agent</span><select aria-label="Agent" value={seat.m.agent} onChange={(e) => setMember(seat.ti, seat.mi, { agent: e.target.value, model: undefined })}>{AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAME[a]}</option>)}</select></label>
      <label className="side-field"><span>Model</span><select aria-label="Model" value={seat.m.model ?? ""} onChange={(e) => setMember(seat.ti, seat.mi, { model: e.target.value || undefined })}><option value="">agent default</option>{(MODELS[seat.m.agent] ?? []).map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="side-field"><span>Workflow</span><select aria-label="Workflow" value={seat.m.workflow ?? ""} onChange={(e) => setMember(seat.ti, seat.mi, { workflow: e.target.value || undefined })}><option value="">none</option>{info.workflows.map((w) => <option key={w.name}>{w.name}</option>)}</select></label>
      {wf && <section><h3>Fences from {wf.name}</h3><div className="side-chips">{fenceSummary(wf).map((f, i) => <span key={i} className="row" style={{ gap: 4 }}><GuardTag level={f.l} /><span className="mono">{f.t}</span></span>)}{!fenceSummary(wf).length && <span className="muted">no fences</span>}</div></section>}
      <label className="side-field"><span>Scope</span><input aria-label="Scope" value={(seat.m.scope ?? []).join(", ")} placeholder="paths or globs; empty is the workflow's" onChange={(e) => setMember(seat.ti, seat.mi, { scope: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
      <label className="side-field"><span>Role</span><input aria-label="Role" value={seat.m.role ?? ""} onChange={(e) => setMember(seat.ti, seat.mi, { role: e.target.value || undefined })} /></label>
      <label className="side-field"><span>Reports to</span><select aria-label="Reports to" value={seat.m.reports_to ?? ""} onChange={(e) => setMember(seat.ti, seat.mi, { reports_to: e.target.value || undefined })}><option value="">nobody</option>{seat.t.members.filter((_, j) => j !== seat.mi).map((o) => <option key={seatKey(o)} value={seatKey(o)}>{seatName(o)}</option>)}</select></label>
      <section><h3>Hands off to</h3><div className="side-chips">{seat.t.members.filter((_, j) => j !== seat.mi).map((o) => {
        const k = seatKey(o), on = seat.m!.hands_off?.includes(k);
        return <button key={k} className={`chip-toggle ${on ? "on" : ""}`} aria-pressed={!!on} onClick={() => setMember(seat.ti, seat.mi, { hands_off: on ? seat.m!.hands_off!.filter((h) => h !== k) : [...(seat.m!.hands_off ?? []), k] })}>{seatName(o)}</button>;
      })}{seat.t.members.length < 2 && <span className="muted">Add another seat to wire a hand-off.</span>}</div></section>
      <section><h3>Skills</h3>{skills.length ? <div className="side-chips">{skills.map((s) => <span key={s.name} className="tag">{s.name}</span>)}</div> : <span className="muted">{(info.skills ?? []).length} shared skills; none named by this seat's workflow.</span>}</section>
      <label className="side-field"><span>Prompt</span><textarea aria-label="Seat prompt" value={seat.m.prompt ?? ""} onChange={(e) => setMember(seat.ti, seat.mi, { prompt: e.target.value || undefined })} /></label>
    </div>,
    actions: <><button className="btn sm ghost" onClick={() => { edit(teams.map((t, i) => i !== seat.ti ? t : { ...t, members: t.members.filter((_, j) => j !== seat.mi) })); setSel(null); }}><Icon.close /> Remove seat</button></>,
  } : team ? {
    title: team.name, sub: `${team.members.length} seats${info.team?.name === team.name ? " · at work" : ""}`, icon: <Icon.team />, onClose: () => setSel(null),
    body: <div className="side-sections">
      <label className="side-field"><span>About</span><input aria-label="Team about" value={team.about ?? ""} onChange={(e) => edit(teams.map((t) => t.name === team.name ? { ...t, about: e.target.value || undefined } : t))} /></label>
      <label className="side-field"><span>Team prompt</span><textarea aria-label="Team prompt" value={team.prompt ?? ""} onChange={(e) => edit(teams.map((t) => t.name === team.name ? { ...t, prompt: e.target.value || undefined } : t))} /></label>
      {teamProblems(team).length > 0 && <section><h3>Problems</h3>{teamProblems(team).map((p) => <div key={p} className="muted">{p}</div>)}</section>}
      <section><h3>Seats</h3>{team.members.map((m) => <button key={seatKey(m)} className="side-link" onClick={() => setSel(sid(team.name, m))}><Harmonograph seed={seatKey(m)} size={14} /><span className="mono">{seatName(m)}</span><span className="muted">{m.workflow}</span></button>)}</section>
    </div>,
    actions: info.team?.name === team.name
      ? <button className="btn sm" onClick={() => act("team_stop", {}, `${team.name} stood down`).catch(() => {})}>Stand down</button>
      : <><button className="btn sm primary" disabled={dirty || !info.teams.some((t) => t.name === team.name)} data-tip={dirty ? "Save first" : "Each seat works in its own workflow"} data-tip-place="top" onClick={() => act("team_start", { name: team.name }, `${team.name} at work`).catch(() => {})}><Icon.play /> Put to work</button>
        <button className="btn sm ghost" onClick={() => { edit(teams.filter((t) => t.name !== team.name)); setSel(null); }}>Delete team</button></>,
  } : null;

  const palette = (
    <div className="ag-palette" data-testid="agent-palette" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ag-pal-h">Drag onto a team</div>
      {AGENT_IDS.map((a) => <div key={a} className="ag-pal-item" draggable onDragStart={(e) => e.dataTransfer.setData("text/kula", `agent:${a}`)} data-tip={`${AGENT_NAME[a]}: drop on a frame to add a seat`} data-tip-place="left" role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && addSeat(team?.name ?? seat?.t.name ?? null, `agent:${a}`)}><Harmonograph seed={a} size={14} /><span>{AGENT_NAME[a]}</span></div>)}
      <div className="ag-pal-h">Workflows</div>
      {info.workflows.slice(0, 10).map((w) => <div key={w.name} className="ag-pal-item" draggable onDragStart={(e) => e.dataTransfer.setData("text/kula", `workflow:${w.name}`)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && addSeat(team?.name ?? seat?.t.name ?? null, `workflow:${w.name}`)}><Icon.workflow /><span>{w.name}</span></div>)}
    </div>
  );
  const bar = (
    <div className="kc-pick" onPointerDown={(e) => e.stopPropagation()}>
      <button className="btn sm" onClick={() => addSeat(null, `agent:${info.default_agent ?? "claude"}`)}><Icon.plus /> Team</button>
      {dirty && <><button className="btn sm primary" data-testid="teams-save" onClick={save}>Save to kula.toml</button><button className="btn sm ghost" onClick={() => { setTeams(info.teams); setMoved({}); }}>Revert</button></>}
    </div>
  );

  const board = [...(meta?.notes ?? []).map((n) => ({ k: `n${n.id}`, at: n.created, who: n.author, text: n.body, kind: "note" })), ...(meta?.issues ?? []).filter((i) => i.status === "open").map((i) => ({ k: `i${i.id}`, at: i.created, who: i.author, text: `#${i.id} ${i.title}`, kind: "issue" }))]
    .sort((a, b) => b.at - a.at).slice(0, 60);
  const lazyView = (el: React.ReactNode) => <Suspense fallback={<div className="view-loading">loading…</div>}>{el}</Suspense>;

  return (
    <Workspace id="agents" testid="agents-ws" side={side} tab={tab} paneTall={tab !== "runs" && tab === initialPane && initialPane !== "runs"}
      onTab={(t) => {
        setTab(t);
        if (["proposals", "issues", "notes"].includes(t)) { pending.current = t; go?.(t as "proposals"); }
        else if (t === "configure") { pending.current = t; go?.("agents", { tab: CONFIG_TABS.includes(target?.tab ?? "") ? target!.tab : "overview" }); }
        else if (view !== "agents" || target?.tab) { pending.current = t; go?.("agents"); }
      }}
      canvas={<>
        <Canvas testid="agents-canvas" label="Teams canvas" nodes={nodes} edges={edges} selected={sel} onSelect={setSel} onMove={onMove} fitKey={teams.map((t) => t.name).join("|")}
          onDrop={(data, _p, over) => addSeat(over ? over.slice(5) : null, data)}
          empty={<span>No teams yet. Drag an agent from the palette onto the canvas to start one.</span>} />
        {bar}{palette}
      </>}
      tabs={[
        { id: "runs", label: "Runs", icon: Icon.runs, count: runs.length, render: () => <div className="pane-pad"><Runs version={version} go={go!} selected={null} onSelect={(r) => { if (r?.kind === "Team") setSel(`team:${r.details[0]?.[1]}`); }} /></div> },
        { id: "board", label: "Board", icon: Icon.notes, count: board.length, render: () => (
          <div className="ptable" role="grid" aria-label="Board">
            <div className="pt-row pt-head"><span>when</span><span>message</span><span>by</span></div>
            {board.map((b) => <div key={b.k} className="pt-row" onClick={() => go?.(b.kind === "note" ? "notes" : "issues", b.kind === "issue" ? { issue: Number(b.k.slice(1)) } : {})}><span className="muted">{relTime(b.at)}</span><span>{b.text}</span><span className="muted">{b.who}</span></div>)}
            {!board.length && <div className="card-empty">The board is empty. Agents post notes and issues here at hand-off.</div>}
          </div>) },
        { id: "proposals", label: "Proposals", icon: Icon.pr, render: () => lazyView(<Proposals {...props} />) },
        { id: "issues", label: "Issues", icon: Icon.issues, render: () => lazyView(<Issues {...props} />) },
        { id: "notes", label: "Notes", icon: Icon.notes, render: () => lazyView(<Notes {...props} />) },
        { id: "configure", label: "Configure", icon: Icon.gear, render: () => lazyView(<Agents {...props} />) },
      ]} />
  );
}
