// The pipeline: blocks placed on the map and run in order. A block is a
// trigger, an agent (a workflow fenced to a section), a crew, a research loop,
// a gate (a kula check that passes or fails) or a retry loop that sends the
// run back to the last agent until the gate after it passes. The map draws
// the blocks as a lane above the sections they act on; Run walks the lane and
// streams every step into the dock's run log.
//
// Agents are not launched by kula: an agent block opens a fenced task and
// waits for a connected agent (Claude Code, Cursor, Codex… over MCP and the
// hooks) to finish it – or for "Done" on the block. Edits inside the fence
// stream into the log as they land.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentsInfo, type FileStatus } from "../../api";
import { log, openDock } from "../../dock/bus";
import type { MapData } from "./types";
import { filesOf, templatesFrom } from "./workspace";
import { Icon } from "../../ui";

export type BlockKind = "trigger" | "agent" | "crew" | "loop" | "gate" | "retry" | "note";
export type StepStatus = "idle" | "waiting" | "running" | "success" | "error" | "skipped";
export type Step = {
  id: string;
  kind: BlockKind;
  name: string;
  /** workflow, team, gate command or trigger id. */
  ref: string;
  section: string | null;
  task?: string;
  /** retry: how many rounds before giving up. */
  max?: number;
  status?: StepStatus;
  note?: string;
};
/** A palette entry – what a drag carries. */
export type Item = { kind: BlockKind; ref: string; name: string; about: string };
export const ITEM_DRAG = "application/x-kula-block";

export const GATES: Item[] = [
  { kind: "gate", ref: "verify", name: "Verify edits", about: "kula verify – what moved, dangling callers, fences crossed" },
  { kind: "gate", ref: "check", name: "CI check", about: "kula check – blast radius and guarded code against main" },
  { kind: "gate", ref: "status", name: "Graph current", about: "kula status – the graph matches HEAD" },
];
export const TRIGGERS: Item[] = [
  { kind: "trigger", ref: "manual", name: "Manual", about: "Runs when you press Run" },
  { kind: "trigger", ref: "change", name: "On change", about: "Runs when files in its section change (while armed)" },
  { kind: "trigger", ref: "every", name: "Every 15 min", about: "Runs on a timer while the tab is open" },
];
export const FLOW: Item[] = [
  { kind: "retry", ref: "retry", name: "Retry until pass", about: "Loop back to the last agent until the gate before this passes (3 rounds)" },
  { kind: "note", ref: "note", name: "Sticky note", about: "Annotate the pipeline – never runs" },
];

export type Category = { id: string; label: string; hint: string; items: Item[] };
export function catalogue(info: AgentsInfo | null): Category[] {
  const t = templatesFrom(info);
  return [
    { id: "trigger", label: "Triggers", hint: "what starts a run", items: TRIGGERS },
    { id: "agent", label: "Agents", hint: "one agent, fenced to a section", items: t.agent.map((a) => ({ kind: "agent", ref: a.kind === "agent" ? a.workflow : "", name: a.name, about: a.about })) },
    { id: "crew", label: "Crews", hint: "a team, each member in its workflow", items: t.crew.map((c) => ({ kind: "crew", ref: c.kind === "crew" ? c.team : "", name: c.name, about: c.about })) },
    { id: "loop", label: "Research loops", hint: "measure, try, keep what improves", items: t.loop.map((l) => ({ kind: "loop", ref: l.kind === "loop" ? l.workflow : "", name: l.name, about: l.about })) },
    { id: "gate", label: "Gates", hint: "pass or stop the run", items: GATES },
    { id: "flow", label: "Flow", hint: "loops and notes", items: FLOW },
  ];
}

const ICONS: Record<BlockKind, () => React.ReactElement> = { trigger: Icon.play, agent: Icon.agents, crew: Icon.team, loop: Icon.flask, gate: Icon.shield, retry: Icon.refresh, note: Icon.notes };
export function KindIco({ kind }: { kind: BlockKind }) { const I = ICONS[kind]; return <I />; }
export const KIND_COLOR: Record<BlockKind, string> = {
  trigger: "var(--green)", agent: "var(--accent)", crew: "var(--purple, #a98bf0)", loop: "var(--blue, #6ea8fe)",
  gate: "var(--yellow, #d9b54a)", retry: "var(--blue, #6ea8fe)", note: "var(--text-3)",
};

/* ---- State (one pipeline per repo, kept in the browser) ---------------- */

const key = (repo: string) => `kula.pipeline.${repo}`;
let seq = 0;
const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function usePipeline(repo: string) {
  const [steps, setSteps] = useState<Step[]>(() => {
    try { return (JSON.parse(localStorage.getItem(key(repo)) ?? "[]") as Step[]).map((s) => ({ ...s, status: "idle" })); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(key(repo), JSON.stringify(steps.map(({ status: _s, note: _n, ...rest }) => rest))); } catch { /* private window */ } }, [repo, steps]);
  const add = useCallback((it: Item, section: string | null, at?: number) => {
    const s: Step = { id: newId(), kind: it.kind, ref: it.ref, name: it.name, section, status: "idle", ...(it.kind === "retry" ? { max: 3 } : {}) };
    setSteps((xs) => { const n = [...xs]; n.splice(at ?? n.length, 0, s); return n; });
    return s.id;
  }, []);
  const patch = useCallback((id: string, p: Partial<Step>) => setSteps((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s))), []);
  const remove = useCallback((id: string) => setSteps((xs) => xs.filter((s) => s.id !== id)), []);
  const move = useCallback((id: string, d: -1 | 1) => setSteps((xs) => {
    const i = xs.findIndex((s) => s.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= xs.length) return xs;
    const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n;
  }), []);
  const clear = useCallback(() => setSteps([]), []);
  return { steps, setSteps, add, patch, remove, move, clear };
}

/* ---- Runner ----------------------------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Pipe = ReturnType<typeof usePipeline>;
export function useRunner(data: MapData | null, pipe: Pipe, onChanged: () => void) {
  const [running, setRunning] = useState(false);
  const abort = useRef(false);
  const done = useRef(new Set<string>()); // steps a user marked done by hand
  const stepsRef = useRef(pipe.steps);
  stepsRef.current = pipe.steps;
  const secName = (id: string | null) => (id && data ? data.blocks[id]?.theme || data.blocks[id]?.name : null) ?? "whole repo";

  const runGate = async (s: Step) => {
    const r = await api.kula([s.ref]);
    const out = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim();
    log(s.name, out.split("\n").slice(-40).join("\n") || "(no output)", r.code === 0 ? "info" : "err");
    return r.code === 0;
  };

  /** Wait for a task/team/loop to end, streaming fence edits as they land. */
  const waitFor = async (s: Step, ended: (a: AgentsInfo) => boolean, scope: string[]) => {
    const seen = new Set<string>();
    const first = await api.status().catch(() => ({ files: [] as FileStatus[] }));
    first.files.forEach((f) => seen.add(f.path));
    for (;;) {
      if (abort.current) return false;
      if (done.current.has(s.id)) { done.current.delete(s.id); log(s.name, "marked done", "ok"); return true; }
      await sleep(2500);
      const [info, st] = await Promise.all([api.agents().catch(() => null), api.status().catch(() => null)]);
      for (const f of st?.files ?? []) if (!seen.has(f.path)) {
        seen.add(f.path);
        const inside = !scope.length || scope.includes(f.path);
        log(s.name, `${inside ? "edited" : "edited OUTSIDE the fence"} ${f.path}`, inside ? "info" : "warn");
        onChanged();
      }
      if (info && ended(info)) return true;
    }
  };

  const run = useCallback(async (from = 0) => {
    if (!data || running) return;
    const steps = stepsRef.current.filter((s) => s.kind !== "note");
    if (!steps.length) { log("run", "Nothing to run – add blocks from the + panel.", "warn"); openDock("run"); return; }
    abort.current = false;
    setRunning(true);
    openDock("run");
    for (const s of pipe.steps) pipe.patch(s.id, { status: "idle", note: undefined });
    log("run", `run started – ${steps.length} steps`, "ok");
    let lastGate: boolean | null = null;
    const rounds = new Map<string, number>();
    let ok = true;
    for (let i = from; i < steps.length; i++) {
      if (abort.current) { ok = false; break; }
      const s = steps[i];
      pipe.patch(s.id, { status: "running" });
      log(s.name, `step ${i + 1}/${steps.length} · ${s.kind}${s.section ? ` on ${secName(s.section)}` : ""}`);
      let pass = true;
      try {
        if (s.kind === "trigger") {
          if (s.ref === "manual") log(s.name, "started by hand");
          else log(s.name, s.ref === "change" ? "armed – this run started now; it also starts when its section changes" : "timer armed (every 15 min while open)");
        } else if (s.kind === "gate") {
          pass = lastGate = await runGate(s);
        } else if (s.kind === "agent") {
          const scope = s.section ? filesOf(data, s.section) : [];
          const title = s.task?.trim() || `${s.name} on ${secName(s.section)}`;
          await api.agentAction("task_start", { title, scope, workflow: s.ref });
          log(s.name, `task “${title}” open · workflow ${s.ref} · fence ${scope.length || "all"} files`);
          log(s.name, "waiting for a connected agent to finish it (or press Done on the block)", "warn");
          pipe.patch(s.id, { status: "waiting" });
          pass = await waitFor(s, (a) => !a.task || a.task.title !== title, scope);
          if (pass) await api.agentAction("task_done", {}).catch(() => {});
        } else if (s.kind === "crew") {
          await api.agentAction("team_start", { name: s.ref });
          log(s.name, `team ${s.ref} started`);
          pipe.patch(s.id, { status: "waiting" });
          pass = await waitFor(s, (a) => !a.team, []);
        } else if (s.kind === "loop") {
          await api.agentAction("research_start", { workflow: s.ref });
          log(s.name, `loop ${s.ref} started`);
          pipe.patch(s.id, { status: "waiting" });
          pass = await waitFor(s, (a) => !(a.research ?? []).some((r) => r.active && r.workflow === s.ref), []);
        } else if (s.kind === "retry") {
          const n = (rounds.get(s.id) ?? 0) + 1;
          if (lastGate === false && n <= (s.max ?? 3)) {
            rounds.set(s.id, n);
            const back = steps.slice(0, i).map((x, j) => ({ x, j })).reverse().find(({ x }) => x.kind === "agent" || x.kind === "crew");
            if (back) {
              log(s.name, `gate failed – round ${n + 1} of ${(s.max ?? 3) + 1}, back to ${back.x.name}`, "warn");
              pipe.patch(s.id, { status: "success", note: `round ${n + 1}` });
              lastGate = null;
              i = back.j - 1;
              continue;
            }
          }
          if (lastGate === false) { pass = false; log(s.name, "out of rounds", "err"); }
        }
      } catch (e) {
        pass = false;
        log(s.name, String((e as Error).message ?? e), "err");
      }
      pipe.patch(s.id, { status: pass ? "success" : "error" });
      if (!pass) {
        // a failed gate followed by a retry block hands control to the retry
        if (s.kind === "gate" && steps[i + 1]?.kind === "retry") continue;
        ok = false; break;
      }
    }
    log("run", abort.current ? "stopped" : ok ? "run passed" : "run failed", abort.current ? "warn" : ok ? "ok" : "err");
    setRunning(false);
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, running, pipe]);

  const stop = useCallback(() => { abort.current = true; api.agentAction("task_done", {}).catch(() => {}); }, []);
  const markDone = useCallback((id: string) => { done.current.add(id); }, []);

  // Automations: an armed "On change" trigger reruns when its section's files
  // change; "Every 15 min" reruns on a timer.
  const auto = useMemo(() => pipe.steps.find((s) => s.kind === "trigger" && s.ref !== "manual"), [pipe.steps]);
  const armedSig = useRef<string | null>(null);
  useEffect(() => {
    if (!auto || !data) return;
    if (auto.ref === "every") {
      const t = window.setInterval(() => { if (!running) { log(auto.name, "timer fired"); void run(); } }, 15 * 60 * 1000);
      return () => window.clearInterval(t);
    }
    const scope = new Set(auto.section ? filesOf(data, auto.section) : []);
    const t = window.setInterval(async () => {
      if (running) return;
      const st = await api.status().catch(() => null);
      const sig = (st?.files ?? []).filter((f) => !scope.size || scope.has(f.path)).map((f) => f.path).sort().join("|");
      if (armedSig.current === null) { armedSig.current = sig; return; }
      if (sig !== armedSig.current) { armedSig.current = sig; log(auto.name, "files changed – starting a run", "warn"); void run(); }
    }, 4000);
    return () => window.clearInterval(t);
  }, [auto, data, running, run]);

  return { running, run, stop, markDone };
}

/* ---- Palette: the n8n-style node panel -------------------------------- */

export function NodePanel({ info, open, onClose, onPick, hasSel }: { info: AgentsInfo | null; open: boolean; onClose: () => void; onPick: (it: Item) => void; hasSel: boolean }) {
  const [q, setQ] = useState("");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cats = useMemo(() => catalogue(info), [info]);
  useEffect(() => { if (open) { setQ(""); window.setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  const s = q.trim().toLowerCase();
  const hit = (it: Item) => !s || `${it.name} ${it.about} ${it.ref}`.toLowerCase().includes(s);
  return (
    <aside className={`np${open ? " open" : ""}${dragging ? " np-dragging" : ""}`} aria-hidden={!open} aria-label="Add a block" data-testid="np">
      <div className="np-head">
        <span className="np-title">Add a block</span>
        <button className="ws-x" onClick={onClose} aria-label="Close panel">×</button>
      </div>
      <input ref={input} className="np-search" placeholder="Search agents, gates, triggers…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="np-search"
        onKeyDown={(e) => { if (e.key === "Enter") { const first = cats.flatMap((c) => c.items).find(hit); if (first) onPick(first); } }} />
      <div className="np-hint">{hasSel ? "Click adds it on the selected section · or drag onto any section" : "Drag onto a section · click adds it to the end"}</div>
      <div className="np-list">
        {cats.map((c) => {
          const items = c.items.filter(hit);
          if (s && !items.length) return null;
          const isOpen = !!s || !shut.has(c.id);
          return (
            <section key={c.id} className={`np-cat${isOpen ? " open" : ""}`} data-testid={`np-cat-${c.id}`}>
              <button className="np-cat-head" aria-expanded={isOpen} onClick={() => setShut((x) => { const n = new Set(x); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                <span className="np-cat-ico" style={{ color: KIND_COLOR[(c.items[0]?.kind ?? (c.id === "flow" ? "retry" : c.id)) as BlockKind] ?? "var(--text-3)" }}><KindIco kind={(c.items[0]?.kind ?? (c.id === "flow" ? "retry" : c.id)) as BlockKind} /></span>
                <span className="np-cat-name">{c.label}</span>
                <span className="np-cat-hint">{c.hint}</span>
                <span className="np-cat-n mono">{items.length}</span>
              </button>
              <div className="np-cat-body"><div>
                {!items.length && <div className="np-empty">None yet{c.id === "crew" ? " – define a team in kula.toml" : ""}.</div>}
                {items.map((it, i) => (
                  <button key={it.kind + it.ref + it.name} className="np-item" draggable style={{ animationDelay: `${i * 20}ms` }}
                    data-testid={`np-item-${it.kind}-${it.ref}`}
                    onDragStart={(e) => { e.dataTransfer.setData(ITEM_DRAG, JSON.stringify(it)); e.dataTransfer.effectAllowed = "copy"; window.setTimeout(() => setDragging(true), 0); }}
                    onDragEnd={() => setDragging(false)}
                    onClick={() => onPick(it)}>
                    <span className="np-ico" style={{ background: `color-mix(in srgb, ${KIND_COLOR[it.kind]} 18%, transparent)`, color: KIND_COLOR[it.kind] }}><KindIco kind={it.kind} /></span>
                    <span className="np-txt"><span className="np-name">{it.name}</span><span className="np-about">{it.about}</span></span>
                  </button>
                ))}
              </div></div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export function droppedItem(e: React.DragEvent): Item | null {
  const raw = e.dataTransfer.getData(ITEM_DRAG);
  if (!raw) return null;
  try { return JSON.parse(raw) as Item; } catch { return null; }
}
export const isItemDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ITEM_DRAG);

/* ---- Sidebar: the pipeline and the selected block --------------------- */

const STATUS_LABEL: Record<StepStatus, string> = { idle: "", waiting: "waiting for agent", running: "running", success: "passed", error: "failed", skipped: "skipped" };

export function PipelinePanel({ data, pipe, runner, sel, onSel, sections }: {
  data: MapData; pipe: Pipe; runner: ReturnType<typeof useRunner>; sel: string | null; onSel: (id: string | null) => void; sections: string[];
}) {
  const s = pipe.steps.find((x) => x.id === sel) ?? null;
  const name = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : "") || "—";
  return (
    <section className="ws-card" data-testid="ws-pipeline">
      <div className="ws-card-head"><span className="ws-eyebrow">Pipeline · {pipe.steps.length} blocks</span>
        {!!pipe.steps.length && !runner.running && <button className="ws-link" onClick={pipe.clear}>clear</button>}</div>
      {!pipe.steps.length && <p className="ws-note">Empty. Press <b>+</b> on the canvas (or Tab) and drag an agent onto a section – then a gate, then Run.</p>}
      <ol className="pl-list">
        {pipe.steps.map((x, i) => (
          <li key={x.id} className={`pl-row${x.id === sel ? " on" : ""} pl-${x.status ?? "idle"}`} onClick={() => onSel(x.id)} data-testid={`pl-row-${i}`}>
            <span className="np-ico sm" style={{ background: `color-mix(in srgb, ${KIND_COLOR[x.kind]} 18%, transparent)`, color: KIND_COLOR[x.kind] }}><KindIco kind={x.kind} /></span>
            <span className="pl-name">{x.name}{x.section && <span className="pl-on"> · {name(x.section)}</span>}</span>
            <span className="pl-st">{x.note ?? STATUS_LABEL[x.status ?? "idle"]}</span>
          </li>
        ))}
      </ol>
      {s && (
        <div className="pl-edit" data-testid="pl-edit">
          <h3 className="ws-title">{s.name}</h3>
          {(s.kind === "agent" || s.kind === "trigger") && (
            <label className="ws-field"><span>Section</span>
              <select value={s.section ?? ""} onChange={(e) => pipe.patch(s.id, { section: e.target.value || null })} data-testid="pl-section">
                <option value="">{s.kind === "agent" ? "whole repo (no fence)" : "any file"}</option>
                {sections.map((id) => <option key={id} value={id}>{name(id)}</option>)}
              </select></label>
          )}
          {s.kind === "agent" && (
            <label className="ws-field"><span>Task</span>
              <textarea rows={2} value={s.task ?? ""} placeholder="What should it do here?" onChange={(e) => pipe.patch(s.id, { task: e.target.value })} data-testid="pl-task" /></label>
          )}
          {s.kind === "agent" && s.section && <p className="ws-hint">Fence: {filesOf(data, s.section).length} files it may edit; reads the whole repo.</p>}
          {s.kind === "retry" && (
            <label className="ws-field"><span>Rounds</span>
              <input type="number" min={1} max={9} value={s.max ?? 3} onChange={(e) => pipe.patch(s.id, { max: Math.max(1, Math.min(9, Number(e.target.value) || 3)) })} /></label>
          )}
          {s.kind === "note" && (
            <label className="ws-field"><span>Note</span>
              <textarea rows={3} value={s.task ?? ""} onChange={(e) => pipe.patch(s.id, { task: e.target.value })} /></label>
          )}
          <div className="pl-actions">
            {s.status === "waiting" && <button className="btn sm primary" onClick={() => runner.markDone(s.id)} data-testid="pl-done">Done</button>}
            <button className="btn sm" onClick={() => pipe.move(s.id, -1)} disabled={runner.running}>Earlier</button>
            <button className="btn sm" onClick={() => pipe.move(s.id, 1)} disabled={runner.running}>Later</button>
            <span className="spacer" />
            <button className="btn sm danger" onClick={() => { pipe.remove(s.id); onSel(null); }} disabled={runner.running} data-testid="pl-remove">Remove</button>
          </div>
        </div>
      )}
    </section>
  );
}
