// The workspace layer on the map: one canvas for code and agents. Four modes
// (Explore · Build · Run · Review) change the sidebar and the overlays, never
// the ground. Agents are deployed onto the map – a template dropped on a
// section (or clicked with a section selected) opens a deploy card whose fence
// is that section's files, and Start goes through the same agents API the CLI
// and MCP use (`task_start`, `team_start`, `research_start`). Live state comes
// from /api/agents and /api/git/status, polled while a mode needs it.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type AgentsInfo, type FileStatus, type Team, type Workflow } from "../../api";
import type { Block, MapData } from "./types";
import { Icon, Harmonograph } from "../../ui";
import type { Go } from "../../nav";
import { ITEM_DRAG, type Item } from "./pipeline";
import { blank } from "../agents/data";
import { AddForm } from "../agents/AddForm";

export type Mode = "explore" | "build" | "run" | "review";

export type Template =
  | { kind: "agent"; id: string; name: string; about: string; workflow: string }
  | { kind: "crew"; id: string; name: string; about: string; team: string; size: number }
  | { kind: "loop"; id: string; name: string; about: string; workflow: string; metric: string };

/** Per-section overlay marks the canvas draws: an agent badge, a fence ring, changed files. */
export type Marks = Record<string, { agent?: string; fence?: boolean; changed?: number; drop?: boolean }>;


/* ---- Map ↔ files ------------------------------------------------------ */

/** The top-level section a block belongs to. */
export function sectionOf(data: MapData, id: string): string | null {
  let b: Block | undefined = data.blocks[id];
  while (b && !(b.depth === 0 && b.parent !== null) && b.parent) b = data.blocks[b.parent];
  return b && b.depth === 0 ? b.id : null;
}

function symbolsUnder(data: MapData, id: string, out: number[] = []): number[] {
  const b = data.blocks[id];
  if (!b) return out;
  out.push(...b.symbols);
  for (const c of b.children) symbolsUnder(data, c, out);
  return out;
}

/** Every file a block (and its children) defines symbols in – a fence scope. */
export function filesOf(data: MapData, id: string): string[] {
  const set = new Set<string>();
  for (const s of symbolsUnder(data, id)) { const p = data.leaves[s]?.path; if (p) set.add(p); }
  return [...set].sort();
}

/** path → section ids, for overlays (fences, changes). */
export function useFileIndex(data: MapData | null) {
  return useMemo(() => {
    const idx = new Map<string, string[]>();
    if (!data) return idx;
    for (const b of Object.values(data.blocks)) {
      if (!(b.depth === 0 && b.parent !== null)) continue;
      for (const f of filesOf(data, b.id)) (idx.get(f) ?? idx.set(f, []).get(f)!).push(b.id);
    }
    return idx;
  }, [data]);
}

/* ---- Live state ------------------------------------------------------- */

export function useLive(enabled: boolean) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const reload = useCallback(() => {
    api.agents().then(setInfo).catch(() => { /* agents API optional */ });
    api.status().then((s) => setFiles(s.files)).catch(() => { /* not a git repo */ });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    reload();
    const t = window.setInterval(reload, 5000);
    return () => window.clearInterval(t);
  }, [enabled, reload]);
  return { info, files, reload };
}

/** Glob-ish match of a task scope entry against a path (exact, dir prefix or * / **). */
function scopeHits(scope: string[], path: string): boolean {
  if (!scope.length) return false;
  return scope.some((s) => {
    if (s === path || path.startsWith(s.replace(/\/?\*\*?.*$/, "") + "/")) return true;
    if (!/[*?]/.test(s)) return false;
    const re = new RegExp("^" + s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".") + "$");
    return re.test(path);
  });
}

/** Overlay marks from live state: the active task's fence and agent, changed files. */
export function useMarks(data: MapData | null, mode: Mode, info: AgentsInfo | null, files: FileStatus[], dropTarget: string | null): Marks {
  const idx = useFileIndex(data);
  const marks = useMemo(() => {
    const m: Marks = {};
    const put = (id: string, v: Marks[string]) => { m[id] = { ...m[id], ...v }; };
    if (mode !== "explore" && info?.task?.scope.length) {
      const who = (info.task.workflow || info.task.by || "agent").slice(0, 1).toUpperCase();
      for (const [path, secs] of idx) if (scopeHits(info.task.scope, path)) for (const s of secs) put(s, { fence: true, agent: who });
    }
    if (mode === "review" || mode === "run") {
      for (const f of files) for (const s of idx.get(f.path) ?? []) put(s, { changed: (m[s]?.changed ?? 0) + 1 });
    }
    if (dropTarget) put(dropTarget, { drop: true });
    return m;
  }, [idx, mode, info, files, dropTarget]);
  // Polls hand back new objects with the same content; keep the identity so
  // the canvas does not rebuild (and re-layout) every five seconds.
  const sig = JSON.stringify(marks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => marks, [sig]);
}

/* ---- Templates -------------------------------------------------------- */

export function templatesFrom(info: AgentsInfo | null): Record<Template["kind"], Template[]> {
  const wfs: Workflow[] = info?.workflows ?? [];
  const teams: Team[] = info?.teams ?? [];
  return {
    agent: wfs.filter((w) => !w.research).map((w) => ({ kind: "agent", id: `wf:${w.name}`, name: title(w.name), about: w.about || "", workflow: w.name })),
    crew: teams.map((t) => ({ kind: "crew", id: `team:${t.name}`, name: title(t.name), about: t.about || `${t.members.length} agents`, team: t.name, size: t.members.length })),
    loop: wfs.filter((w) => !!w.research).map((w) => ({ kind: "loop", id: `loop:${w.name}`, name: title(w.name), about: w.about || "", workflow: w.name, metric: w.research?.metric ?? "" })),
  };
}
const title = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** The map node under a point → its section. */
export function sectionAtPoint(data: MapData, x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-testid^='fc-node-']");
  const id = el?.getAttribute("data-testid")?.slice("fc-node-".length);
  if (!id) return null;
  const clean = id.startsWith("sec:") ? id.slice(4) : id;
  return data.blocks[clean] ? sectionOf(data, clean) ?? clean : null;
}

/* ---- Sidebar panels --------------------------------------------------- */

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="ws-kv"><span>{k}</span><span>{v}</span></div>;
}

/** The Agents page, folded into the sidebar: what kula knows about agents as
    compact disclosures – each block draggable or clickable onto the map, each
    section a link to its full editor. The page itself stays as the library's
    "open full" target, not a tab of its own. */
/** Hand the agents page the item just created from the rail, so its editor
    opens on the new thing rather than on whatever was selected before. */
export const stashNewItem = (kind: "team" | "agent", name: string) => {
  try { sessionStorage.setItem("kula.agents.new", JSON.stringify({ kind, name })); } catch { /* private mode */ }
};

export function Library({ info, go, onPick }: { info: AgentsInfo | null; go?: Go; onPick: (it: Item) => void }) {
  const [open, setOpen] = useState<string>("workflows");
  // The one add flow (module R1): the rail's + opens the same compact AddForm
  // the agents tabs use, right here in the rail; Enter creates and the agents
  // editor opens on the new item, selected and scrolled into view.
  const [addKind, setAddKind] = useState<"team" | "agent" | null>(null);
  if (!info) return <section className="ws-card"><p className="ws-note">Loading agents…</p></section>;
  const conns = info.connections.filter((c) => c.mcp || c.hook);
  const unique = (base: string, taken: string[]) => { let n = base, i = 2; while (taken.includes(n)) n = `${base}-${i++}`; return n; };
  const createTeam = (team: Team) => {
    if (!go) return;
    api.agentAction("teams_save", { teams: [...info.teams, team] }).catch(() => { /* the editor shows the server's state */ })
      .then(() => { stashNewItem("team", team.name); go("agents", { tab: "teams" }); });
  };
  const createAgent = (wf: Workflow) => {
    if (!go) return;
    api.agentAction("workflows_save", { workflows: [...info.workflows.filter((w) => !w.builtin), wf] }).catch(() => { /* the editor shows the server's state */ })
      .then(() => { stashNewItem("agent", wf.name); go("agents", { tab: "workflows" }); });
  };
  const wf = info.workflows.filter((w) => !w.research);
  const loops = info.workflows.filter((w) => !!w.research);
  const sec = (id: string, label: string, n: number | string, tab: string, body: ReactNode) => (
    <div className={`dd-sec${open === id ? " open" : ""}`} key={id}>
      <button className="dd-head" aria-expanded={open === id} data-testid={`lib-${id}`} onClick={() => setOpen(open === id ? "" : id)}>
        <span className="dd-label">{label}</span><span className="dd-hint mono">{n}</span>
        <span className={`ws-chev${open === id ? " up" : ""}`} aria-hidden="true"><Icon.chevron /></span>
      </button>
      <div className="dd-body"><div className="dd-inner">
        {body}
        {go && <button className="ws-link lib-full" onClick={() => go("agents", { tab })}>Open {label.toLowerCase()} editor</button>}
      </div></div>
    </div>
  );
  const item = (it: Item, sub?: string) => (
    <button key={it.kind + it.ref} className="lib-item" draggable onClick={() => onPick(it)}
      onDragStart={(e) => { e.dataTransfer.setData(ITEM_DRAG, JSON.stringify(it)); e.dataTransfer.effectAllowed = "copy"; }}>
      <span className="lib-mark"><Harmonograph seed={it.ref} size={16} /></span>
      <span className="lib-name">{it.name}</span><span className="lib-sub">{sub ?? it.about}</span>
    </button>
  );
  return (
    <section className="ws-card ws-lib" data-testid="ws-library">
      <div className="ws-card-head"><span className="ws-eyebrow">Library</span>
        <span className={`lib-conn${conns.length ? " on" : ""}`} title="agents connected over MCP and hooks">{conns.length ? `${conns.map((c) => c.name).join(", ")} connected` : "no agent connected"}</span>
        <span className="spacer" />
        <button className="lib-add" data-testid="lib-add-team" onClick={() => setAddKind("team")} title="Add a team – a compact form right here in the rail"><Icon.plus /> team</button>
        <button className="lib-add" data-testid="lib-add-agent" onClick={() => setAddKind("agent")} title="Add an agent – a compact form right here in the rail"><Icon.plus /> agent</button></div>
      {addKind === "team" && <AddForm kind="team" info={info} onCreate={createTeam} onCancel={() => setAddKind(null)} />}
      {addKind === "agent" && <AddForm kind="agent" info={info} onCreate={createAgent} onCancel={() => setAddKind(null)} />}
      <div className="dd">
        {sec("workflows", "Workflows", wf.length, "workflows", wf.map((w) => item({ kind: "agent", ref: w.name, name: title(w.name), about: w.about ?? "" })))}
        {sec("teams", "Teams", info.teams.length, "teams", info.teams.length ? info.teams.map((t) => item({ kind: "crew", ref: t.name, name: title(t.name), about: t.about ?? "" }, `${t.members.length} agents`)) : <p className="ws-note">No teams yet.</p>)}
        {sec("research", "Research loops", loops.length, "research", loops.length ? loops.map((w) => item({ kind: "loop", ref: w.name, name: title(w.name), about: w.about ?? "" }, `metric ${w.research?.metric}`)) : <p className="ws-note">No research workflows.</p>)}
        {sec("skills", "Skills", info.skills?.length ?? 0, "skills", <div className="ws-chips">{(info.skills ?? []).slice(0, 24).map((k) => <span key={k.name} className="ws-chip" title={k.description}>{k.name}</span>)}</div>)}
        {sec("memory", "Memory", info.memories.length, "memory", info.memories.length ? <ul className="lib-mem">{info.memories.slice(0, 6).map((m, i) => <li key={i}>{(m as { text?: string }).text ?? String(m)}</li>)}</ul> : <p className="ws-note">Agents write facts here as they work; none yet.</p>)}
        {sec("fences", "Fences", info.rules.length, "fences", <p className="ws-note">{info.rules.length} rules · {info.files.length} guarded files. Fences also appear on the map while a task runs.</p>)}
        {sec("connect", "Connections", `${conns.length}/${info.connections.length}`, "connect", <div className="ws-chips">{info.connections.map((c) => <span key={c.id} className={`ws-chip${c.mcp || c.hook ? " on" : ""}`}>{c.name}</span>)}</div>)}
      </div>
    </section>
  );
}

/** Run mode: what is active, with stop controls. */
export function RunPanel({ data, info, onChanged, onSection }: { data: MapData; info: AgentsInfo | null; onChanged: () => void; onSection: (id: string) => void }) {
  const idx = useFileIndex(data);
  const task = info?.task;
  const secs = useMemo(() => {
    if (!task?.scope.length) return [];
    const s = new Set<string>();
    for (const [p, ids] of idx) if (scopeHits(task.scope, p)) ids.forEach((i) => s.add(i));
    return [...s];
  }, [idx, task]);
  const act = (a: "task_done" | "team_stop" | "research_stop") => api.agentAction(a, {}).then(onChanged).catch(() => onChanged());
  const loops = (info?.research ?? []).filter((r) => r.active);
  const nothing = !task && !info?.team && !loops.length;
  return (
    <section className="ws-card" data-testid="ws-run">
      <div className="ws-card-head"><span className="ws-eyebrow">Running</span></div>
      {nothing && <p className="ws-note">Nothing is running. Switch to <b>Build</b> and drop an agent on a section.</p>}
      {task && (
        <div className="ws-run-item">
          <h3 className="ws-title">{task.title}</h3>
          <Row k="workflow" v={task.workflow || "–"} />
          <Row k="by" v={task.by} />
          <Row k="fence" v={`${task.scope.length} paths · ${secs.length} sections`} />
          <div className="ws-chips">{secs.slice(0, 8).map((s) => <button key={s} className="ws-chip" onClick={() => onSection(s)}>{data.blocks[s]?.theme || data.blocks[s]?.name}</button>)}</div>
          <button className="btn sm" onClick={() => act("task_done")} data-testid="ws-task-done">Finish task</button>
        </div>
      )}
      {info?.team && (
        <div className="ws-run-item"><h3 className="ws-title">Team {info.team.name}</h3><Row k="by" v={info.team.by} />
          <button className="btn sm" onClick={() => act("team_stop")}>Stop team</button></div>
      )}
      {loops.map((r) => (
        <div className="ws-run-item" key={r.workflow}><h3 className="ws-title">Loop {r.workflow}</h3>
          <Row k={r.metric} v={`${r.best} (from ${r.baseline})`} /><Row k="experiments" v={r.experiments.length} />
          <button className="btn sm" onClick={() => act("research_stop")}>Stop loop</button></div>
      ))}
    </section>
  );
}

/** Review mode: uncommitted changes grouped by section; a file opens in the editor. */
export function ReviewPanel({ data, files, onFile, onSection }: { data: MapData; files: FileStatus[]; onFile: (p: string) => void; onSection: (id: string) => void }) {
  const idx = useFileIndex(data);
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const f of files) {
      const secs = idx.get(f.path) ?? ["(outside the map)"];
      (g.get(secs[0]) ?? g.set(secs[0], []).get(secs[0])!).push(f.path);
    }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [files, idx]);
  return (
    <section className="ws-card" data-testid="ws-review">
      <div className="ws-card-head"><span className="ws-eyebrow">Changes · {files.length} files</span></div>
      {!files.length && <p className="ws-note">The working tree is clean.</p>}
      {groups.map(([sec, paths]) => (
        <div key={sec} className="ws-group">
          <button className="ws-group-name" onClick={() => data.blocks[sec] && onSection(sec)}>{data.blocks[sec]?.theme || data.blocks[sec]?.name || sec}<span className="mono">{paths.length}</span></button>
          {paths.map((p) => <button key={p} className="ws-file mono" onClick={() => onFile(p)}>{p}</button>)}
        </div>
      ))}
    </section>
  );
}
