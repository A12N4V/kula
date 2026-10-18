// The workspace layer on the map: one canvas for code and agents. Four modes
// (Explore · Build · Run · Review) change the sidebar and the overlays, never
// the ground. Agents are deployed onto the map – a template dropped on a
// section (or clicked with a section selected) opens a deploy card whose fence
// is that section's files, and Start goes through the same agents API the CLI
// and MCP use (`task_start`, `team_start`, `research_start`). Live state comes
// from /api/agents and /api/git/status, polled while a mode needs it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type AgentsInfo, type FileStatus, type Team, type Workflow } from "../../api";
import type { Block, MapData } from "./types";
import { Icon } from "../../ui";

export type Mode = "explore" | "build" | "run" | "review";
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "explore", label: "Explore", hint: "Read the map – what the repo does and how it flows" },
  { id: "build", label: "Build", hint: "Deploy agents onto sections" },
  { id: "run", label: "Run", hint: "What agents are doing now" },
  { id: "review", label: "Review", hint: "What changed, where" },
];

export type Template =
  | { kind: "agent"; id: string; name: string; about: string; workflow: string }
  | { kind: "crew"; id: string; name: string; about: string; team: string; size: number }
  | { kind: "loop"; id: string; name: string; about: string; workflow: string; metric: string };

/** Per-section overlay marks the canvas draws: an agent badge, a fence ring, changed files. */
export type Marks = Record<string, { agent?: string; fence?: boolean; changed?: number; drop?: boolean }>;

const DRAG_TYPE = "application/x-kula-template";

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
  return useMemo(() => {
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
const KINDS: { id: Template["kind"]; label: string; hint: string }[] = [
  { id: "agent", label: "Agent", hint: "one agent, fenced to a section" },
  { id: "crew", label: "Crew", hint: "a team, each member in its workflow" },
  { id: "loop", label: "Loop", hint: "measure, try, keep what improves" },
];

/* ---- + Agent megamenu ------------------------------------------------- */

/** One container that morphs between kinds (it animates its own size), opens
    on click, switches kind on hover after an intent delay, and closes on Esc
    or an outside click. Templates are draggable onto the canvas; a click
    deploys onto the selected section. */
export function AgentMenu({ info, onPick, canClick }: { info: AgentsInfo | null; onPick: (t: Template) => void; canClick: boolean }) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [kind, setKind] = useState<Template["kind"]>("agent");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const intent = useRef<number | null>(null);
  const all = useMemo(() => templatesFrom(info), [info]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  // Morph: measure the content and let CSS animate the panel to it.
  useLayoutEffect(() => {
    if (!open || !inner.current) return;
    const r = inner.current.getBoundingClientRect();
    setSize({ w: Math.ceil(r.width), h: Math.ceil(r.height) });
  }, [open, kind, all]);
  const hoverKind = (k: Template["kind"]) => {
    if (intent.current) window.clearTimeout(intent.current);
    intent.current = window.setTimeout(() => setKind(k), 120);
  };
  const list = all[kind];
  return (
    <div className="ws-menu" ref={root}>
      <button className={`btn sm primary ws-add${open ? " on" : ""}`} data-testid="ws-add-agent" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>+ Agent</button>
      {open && (
        <div className={`ws-pop${dragging ? " ws-dragging" : ""}`} role="menu" aria-label="Agent templates" data-testid="ws-agent-menu"
          style={size ? { width: size.w, height: size.h } : undefined}>
          <div className="ws-pop-in" ref={inner}>
            <div className="ws-kinds" role="tablist" aria-label="Kind">
              {KINDS.map((k) => (
                <button key={k.id} role="tab" aria-selected={kind === k.id} className={`ws-kind${kind === k.id ? " on" : ""}`}
                  data-testid={`ws-kind-${k.id}`} onClick={() => setKind(k.id)} onPointerEnter={() => hoverKind(k.id)}
                  onPointerLeave={() => intent.current && window.clearTimeout(intent.current)}>
                  <span className="ws-kind-name">{k.label}</span>
                  <span className="ws-kind-hint">{k.hint}</span>
                  <span className="ws-kind-n mono">{all[k.id].length}</span>
                </button>
              ))}
            </div>
            <div className="ws-tpls" key={kind}>
              <div className="ws-tpls-head">{canClick ? "Click to deploy on the selected section, or drag onto any section" : "Drag onto a section – or select one first, then click"}</div>
              {!list.length && <div className="ws-empty">{kind === "crew" ? "No teams yet – define one in kula.toml or the Teams editor." : kind === "loop" ? "No research workflows yet." : "No workflows."}</div>}
              {list.map((t, i) => (
                <button key={t.id} role="menuitem" className="ws-tpl" style={{ animationDelay: `${i * 25}ms` }} draggable data-testid={`ws-tpl-${t.id}`}
                  onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(t)); e.dataTransfer.effectAllowed = "copy"; window.setTimeout(() => setDragging(true), 0); }}
                  onDragEnd={() => { setDragging(false); setOpen(false); }}
                  onClick={() => { onPick(t); setOpen(false); }}>
                  <span className="ws-tpl-name">{t.name}</span>
                  <span className="ws-tpl-about">{t.about || (t.kind === "loop" ? `metric: ${t.metric}` : "")}</span>
                  <span className="ws-tpl-meta mono">{t.kind === "crew" ? `${t.size} agents` : t.kind === "loop" ? "loop" : t.workflow}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Read a dropped template, if the drag carries one. */
export function droppedTemplate(e: React.DragEvent): Template | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try { return JSON.parse(raw) as Template; } catch { return null; }
}
export const isTemplateDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

/** The map node under a point → its section. */
export function sectionAtPoint(data: MapData, x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-testid^='fc-node-']");
  const id = el?.getAttribute("data-testid")?.slice("fc-node-".length);
  if (!id) return null;
  const clean = id.startsWith("sec:") ? id.slice(4) : id;
  return data.blocks[clean] ? sectionOf(data, clean) ?? clean : null;
}

/* ---- Sidebar panels --------------------------------------------------- */

type Draft = { tpl: Template; section: string };

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="ws-kv"><span>{k}</span><span>{v}</span></div>;
}

/** The deploy card: four fields, the fence it will set, and Start. */
export function DeployCard({ data, draft, info, onDone, onCancel }: { data: MapData; draft: Draft; info: AgentsInfo | null; onDone: () => void; onCancel: () => void }) {
  const sec = data.blocks[draft.section];
  const files = useMemo(() => filesOf(data, draft.section), [data, draft.section]);
  const [titleText, setTitle] = useState("");
  const [workflow, setWorkflow] = useState(draft.tpl.kind === "crew" ? "" : draft.tpl.workflow);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const active = info?.task;
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      if (draft.tpl.kind === "crew") await api.agentAction("team_start", { name: draft.tpl.team });
      else if (draft.tpl.kind === "loop") await api.agentAction("research_start", { workflow: draft.tpl.workflow });
      else await api.agentAction("task_start", { title: titleText.trim() || `${draft.tpl.name} on ${sec?.name ?? "section"}`, scope: files, workflow });
      onDone();
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  return (
    <section className="ws-card" data-testid="ws-deploy">
      <div className="ws-card-head"><span className="ws-eyebrow">New {draft.tpl.kind}</span><button className="ws-x" onClick={onCancel} aria-label="Cancel">×</button></div>
      <h3 className="ws-title">{draft.tpl.name} <span className="ws-on">on</span> {sec?.theme || sec?.name}</h3>
      {draft.tpl.kind === "agent" && (
        <>
          <label className="ws-field"><span>Task</span>
            <textarea rows={2} value={titleText} placeholder="What should it do here?" onChange={(e) => setTitle(e.target.value)} data-testid="ws-task-title" /></label>
          <label className="ws-field"><span>Workflow</span>
            <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} data-testid="ws-workflow">
              {(info?.workflows ?? []).filter((w) => !w.research).map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
            </select></label>
        </>
      )}
      {draft.tpl.kind === "crew" && <p className="ws-note">Starts team <b>{draft.tpl.team}</b>: each member works in its own workflow and fences.</p>}
      {draft.tpl.kind === "loop" && <p className="ws-note">Starts the <b>{draft.tpl.workflow}</b> loop on metric <span className="mono">{draft.tpl.metric}</span>.</p>}
      {draft.tpl.kind === "agent" && (
        <div className="ws-fence">
          <Row k="may edit" v={<button className="ws-link" onClick={() => setShowFiles((s) => !s)} data-testid="ws-fence-files">{files.length} files <span className={`ws-chev${showFiles ? " up" : ""}`} aria-hidden="true"><Icon.chevron /></span></button>} />
          <Row k="may read" v="whole repo" />
          {showFiles && <ul className="ws-files mono">{files.slice(0, 60).map((f) => <li key={f}>{f}</li>)}{files.length > 60 && <li>+ {files.length - 60} more</li>}</ul>}
        </div>
      )}
      {active && draft.tpl.kind === "agent" && <p className="ws-warn">Replaces the open task “{active.title}”.</p>}
      {err && <p className="ws-err">{err}</p>}
      <button className="btn primary ws-start" disabled={busy} onClick={start} data-testid="ws-start">{busy ? "Starting…" : "Start"}</button>
      <p className="ws-hint">Connected agents (Claude Code, Cursor, Codex…) pick this up through kula's MCP server and hooks.</p>
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
