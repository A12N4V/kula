// The pipeline: blocks placed on the map and run in order – kula's take on an
// n8n workflow, where the "data" every block acts on is a section of the code.
// A block is a trigger, an agent (a workflow fenced to a section), a crew, a
// research loop, a gate (a kula check that passes or fails), a retry loop that
// sends the run back to the last agent until the gate before it passes, or a
// sticky note. The map draws the blocks as a lane above the sections they act
// on; Run walks the lane and streams every step into the dock's log panel.
//
// Agents are not launched by kula: an agent block opens a fenced task and
// waits for a connected agent (Claude Code, Cursor, Codex… over MCP and the
// hooks) to finish it – or for "Done" on the block. Edits inside the fence
// stream into the log as they land.
//
// n8n parity lives here too (docs/design/n8n-parity.md): undo/redo, copy and
// paste, deactivate, rename, run from a block, execution history, the node
// panel's category → subcategory slide, the node details view and the
// right-click menu.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type AgentsInfo, type FileStatus } from "../../api";
import { log, logLines, onLog, openDock, setRunTree, type RunStep } from "../../dock/bus";
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
  /** Deactivated blocks are skipped by a run (n8n's D). */
  disabled?: boolean;
  /** Sticky notes sit where they were dropped. */
  pos?: { x: number; y: number };
  color?: string;
  status?: StepStatus;
  note?: string;
  ms?: number;
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
  { kind: "retry", ref: "retry", name: "Retry until pass", about: "Loop back to the last agent until the gate before this passes" },
  { kind: "note", ref: "note", name: "Sticky note", about: "Annotate the canvas – never runs  (Shift+S)" },
];

export type Category = { id: string; label: string; hint: string; kind: BlockKind; items: Item[] };
export function catalogue(info: AgentsInfo | null): Category[] {
  const t = templatesFrom(info);
  return [
    { id: "trigger", label: "Triggers", hint: "what starts a run", kind: "trigger", items: TRIGGERS },
    { id: "agent", label: "Agents", hint: "one agent, fenced to a section", kind: "agent", items: t.agent.map((a) => ({ kind: "agent", ref: a.kind === "agent" ? a.workflow : "", name: a.name, about: a.about })) },
    { id: "crew", label: "Crews", hint: "a team, each member in its workflow", kind: "crew", items: t.crew.map((c) => ({ kind: "crew", ref: c.kind === "crew" ? c.team : "", name: c.name, about: c.about })) },
    { id: "loop", label: "Research loops", hint: "measure, try, keep what improves", kind: "loop", items: t.loop.map((l) => ({ kind: "loop", ref: l.kind === "loop" ? l.workflow : "", name: l.name, about: l.about })) },
    { id: "gate", label: "Gates", hint: "pass or stop the run", kind: "gate", items: GATES },
    { id: "flow", label: "Flow", hint: "loops and notes", kind: "retry", items: FLOW },
  ];
}

const ICONS: Record<BlockKind, () => React.ReactElement> = { trigger: Icon.play, agent: Icon.agents, crew: Icon.team, loop: Icon.flask, gate: Icon.shield, retry: Icon.refresh, note: Icon.notes };
export function KindIco({ kind }: { kind: BlockKind }) { const I = ICONS[kind]; return <I />; }
export const KIND_COLOR: Record<BlockKind, string> = {
  trigger: "var(--green)", agent: "var(--accent)", crew: "var(--purple, #a98bf0)", loop: "var(--blue, #6ea8fe)",
  gate: "var(--yellow, #d9b54a)", retry: "var(--blue, #6ea8fe)", note: "var(--yellow, #d9b54a)",
};
export const STICKY_COLORS = ["var(--yellow, #d9b54a)", "var(--accent)", "var(--green)", "var(--blue, #6ea8fe)", "var(--purple, #a98bf0)", "var(--red)", "var(--text-3)"];
const ico = (kind: BlockKind) => (
  <span className="np-ico" style={{ background: `color-mix(in srgb, ${KIND_COLOR[kind]} 18%, transparent)`, color: KIND_COLOR[kind] }}><KindIco kind={kind} /></span>
);

/** Blocks that run, in order (stickies never run). */
export const runnable = (steps: Step[]) => steps.filter((s) => s.kind !== "note");

/* ---- State: one pipeline per repo, with undo ------------------------- */

const key = (repo: string) => `kula.pipeline.${repo}`;
let seq = 0;
const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
const strip = (xs: Step[]) => xs.map(({ status: _s, note: _n, ms: _m, ...rest }) => rest);

export function usePipeline(repo: string) {
  const [steps, setStepsRaw] = useState<Step[]>(() => {
    try { return (JSON.parse(localStorage.getItem(key(repo)) ?? "[]") as Step[]).map((s) => ({ ...s, status: "idle" })); } catch { return []; }
  });
  const past = useRef<Step[][]>([]);
  const future = useRef<Step[][]>([]);
  const clip = useRef<Step | null>(null);
  useEffect(() => { try { localStorage.setItem(key(repo), JSON.stringify(strip(steps))); } catch { /* private window */ } }, [repo, steps]);
  /** An edit the user made – undoable. Run-state patches go through `patch`. */
  const edit = useCallback((f: (xs: Step[]) => Step[]) => setStepsRaw((xs) => {
    const n = f(xs);
    if (n !== xs) { past.current.push(xs); if (past.current.length > 100) past.current.shift(); future.current = []; }
    return n;
  }), []);
  const add = useCallback((it: Item, section: string | null, at?: number, pos?: { x: number; y: number }) => {
    const s: Step = {
      id: newId(), kind: it.kind, ref: it.ref, name: it.kind === "note" ? "Note" : it.name, section, status: "idle",
      ...(it.kind === "retry" ? { max: 3 } : {}), ...(it.kind === "note" ? { task: "Double-click to edit", pos, color: STICKY_COLORS[0] } : {}),
    };
    edit((xs) => { const n = [...xs]; n.splice(at ?? n.length, 0, s); return n; });
    return s.id;
  }, [edit]);
  const patch = useCallback((id: string, p: Partial<Step>) => setStepsRaw((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s))), []);
  const update = useCallback((id: string, p: Partial<Step>) => edit((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s))), [edit]);
  const remove = useCallback((id: string) => edit((xs) => xs.filter((s) => s.id !== id)), [edit]);
  const move = useCallback((id: string, d: -1 | 1) => edit((xs) => {
    const i = xs.findIndex((s) => s.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= xs.length) return xs;
    const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n;
  }), [edit]);
  const duplicate = useCallback((id: string) => {
    const nid = newId();
    edit((xs) => {
      const i = xs.findIndex((s) => s.id === id);
      if (i < 0) return xs;
      const c = { ...xs[i], id: nid, status: "idle" as const, note: undefined, pos: xs[i].pos ? { x: xs[i].pos!.x + 32, y: xs[i].pos!.y + 32 } : undefined };
      const n = [...xs]; n.splice(i + 1, 0, c); return n;
    });
    return nid;
  }, [edit]);
  const copy = useCallback((id: string) => { clip.current = steps.find((s) => s.id === id) ?? null; return !!clip.current; }, [steps]);
  const paste = useCallback((after?: string | null) => {
    const c = clip.current;
    if (!c) return null;
    const nid = newId();
    edit((xs) => {
      const i = after ? xs.findIndex((s) => s.id === after) : xs.length - 1;
      const n = [...xs]; n.splice(i + 1, 0, { ...c, id: nid, status: "idle", note: undefined, pos: c.pos ? { x: c.pos.x + 32, y: c.pos.y + 32 } : undefined }); return n;
    });
    return nid;
  }, [edit]);
  const undo = useCallback(() => setStepsRaw((xs) => { const p = past.current.pop(); if (!p) return xs; future.current.push(xs); return p; }), []);
  const redo = useCallback(() => setStepsRaw((xs) => { const f = future.current.pop(); if (!f) return xs; past.current.push(xs); return f; }), []);
  const clear = useCallback(() => edit(() => []), [edit]);
  const setSteps = setStepsRaw;
  return { steps, setSteps, add, patch, update, remove, move, duplicate, copy, paste, undo, redo, clear };
}

/* ---- Runner ----------------------------------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Execution = { id: string; at: number; ms: number; status: "passed" | "failed" | "stopped"; trigger: string; steps: { name: string; kind: BlockKind; status: StepStatus; ms?: number }[] };
const RUNS = "kula.pipeline.runs";
const readRuns = (): Execution[] => { try { return JSON.parse(localStorage.getItem(RUNS) ?? "[]"); } catch { return []; } };

type Pipe = ReturnType<typeof usePipeline>;
export function useRunner(data: MapData | null, pipe: Pipe, onChanged: () => void) {
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Execution[]>(readRuns);
  // Transport: pause holds the run between blocks (a block in flight finishes),
  // step runs exactly one block then pauses – a debugger's continue and step over.
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const stepOnce = useRef(false);
  const setPaused = (p: boolean) => { pausedRef.current = p; setPausedState(p); };
  const [cursor, setCursor] = useState<{ at: number; of: number; t0: number } | null>(null);
  const abort = useRef(false);
  const done = useRef(new Set<string>()); // steps a user marked done by hand
  const stepsRef = useRef(pipe.steps);
  stepsRef.current = pipe.steps;
  const secName = (id: string | null) => (id && data ? data.blocks[id]?.theme || data.blocks[id]?.name : null) ?? "whole repo";

  const runGate = async (s: Step) => {
    const r = await api.kula([s.ref]);
    const out = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim();
    log(s.name, out.split("\n").slice(-40).join("\n") || "(no output)", r.code === 0 ? "info" : "err", s.id);
    return r.code === 0;
  };

  /** Wait for a task/team/loop to end, streaming fence edits as they land. */
  const waitFor = async (s: Step, ended: (a: AgentsInfo) => boolean, scope: string[]) => {
    const seen = new Set<string>();
    const first = await api.status().catch(() => ({ files: [] as FileStatus[] }));
    first.files.forEach((f) => seen.add(f.path));
    for (;;) {
      if (abort.current) return false;
      if (done.current.has(s.id)) { done.current.delete(s.id); log(s.name, "marked done", "ok", s.id); return true; }
      await sleep(2500);
      const [info, st] = await Promise.all([api.agents().catch(() => null), api.status().catch(() => null)]);
      for (const f of st?.files ?? []) if (!seen.has(f.path)) {
        seen.add(f.path);
        const inside = !scope.length || scope.includes(f.path);
        log(s.name, `${inside ? "edited" : "edited OUTSIDE the fence"} ${f.path}`, inside ? "info" : "warn", s.id);
        onChanged();
      }
      if (info && ended(info)) return true;
    }
  };

  const run = useCallback(async (fromId?: string, trigger = "manual", stepping = false) => {
    if (!data || running) return;
    stepOnce.current = stepping;
    setPaused(false);
    const steps = runnable(stepsRef.current);
    if (!steps.length) { log("run", "Nothing to run – add blocks from the pipeline panel.", "warn"); openDock("run"); return; }
    const from = fromId ? Math.max(0, steps.findIndex((s) => s.id === fromId)) : 0;
    abort.current = false;
    setRunning(true);
    openDock("run");
    for (const s of stepsRef.current) pipe.patch(s.id, { status: "idle", note: undefined, ms: undefined });
    const t0 = Date.now();
    const state = new Map<string, RunStep>(steps.map((s) => [s.id, { id: s.id, name: s.name, kind: s.kind, status: "idle" }]));
    const tree = (status: string) => setRunTree({ started: t0, ms: status === "running" ? undefined : Date.now() - t0, status, steps: [...state.values()] });
    const mark = (s: Step, p: Partial<Step>) => { pipe.patch(s.id, p); const r = state.get(s.id)!; state.set(s.id, { ...r, status: p.status ?? r.status, ms: p.ms ?? r.ms }); tree("running"); };
    tree("running");
    log("run", `run started${from ? ` from ${steps[from].name}` : ""} – ${steps.length - from} blocks`, "ok");
    let lastGate: boolean | null = null;
    const rounds = new Map<string, number>();
    let ok = true;
    for (let i = from; i < steps.length; i++) {
      if (abort.current) { ok = false; break; }
      const s = steps[i];
      setCursor({ at: i + 1, of: steps.length, t0 });
      if (pausedRef.current) {
        log("run", `paused before ${s.name} – continue or step`, "warn");
        tree("paused");
        while (pausedRef.current && !abort.current) await sleep(150);
        if (abort.current) { ok = false; break; }
        tree("running");
      }
      if (s.disabled) { mark(s, { status: "skipped" }); log(s.name, "deactivated – skipped", "info", s.id); continue; }
      const ts = Date.now();
      mark(s, { status: "running" });
      log(s.name, `block ${i + 1}/${steps.length} · ${s.kind}${s.section ? ` on ${secName(s.section)}` : ""}`, "info", s.id);
      let pass = true;
      try {
        if (s.kind === "trigger") {
          log(s.name, s.ref === "manual" ? `started by ${trigger === "manual" ? "hand" : trigger}` : s.ref === "change" ? "armed – it also starts a run when its section changes" : "timer armed (every 15 min while open)", "info", s.id);
        } else if (s.kind === "gate") {
          pass = lastGate = await runGate(s);
        } else if (s.kind === "agent") {
          const scope = s.section ? filesOf(data, s.section) : [];
          const title = s.task?.trim() || `${s.name} on ${secName(s.section)}`;
          await api.agentAction("task_start", { title, scope, workflow: s.ref });
          log(s.name, `task “${title}” open · workflow ${s.ref} · fence ${scope.length || "all"} files`, "info", s.id);
          log(s.name, "waiting for a connected agent to finish it (or press Done)", "warn", s.id);
          mark(s, { status: "waiting" });
          pass = await waitFor(s, (a) => !a.task || a.task.title !== title, scope);
          if (pass) await api.agentAction("task_done", {}).catch(() => {});
        } else if (s.kind === "crew") {
          await api.agentAction("team_start", { name: s.ref });
          log(s.name, `team ${s.ref} started`, "info", s.id);
          mark(s, { status: "waiting" });
          pass = await waitFor(s, (a) => !a.team, []);
        } else if (s.kind === "loop") {
          await api.agentAction("research_start", { workflow: s.ref });
          log(s.name, `loop ${s.ref} started`, "info", s.id);
          mark(s, { status: "waiting" });
          pass = await waitFor(s, (a) => !(a.research ?? []).some((r) => r.active && r.workflow === s.ref), []);
        } else if (s.kind === "retry") {
          const n = (rounds.get(s.id) ?? 0) + 1;
          if (lastGate === false && n <= (s.max ?? 3)) {
            rounds.set(s.id, n);
            const back = steps.slice(0, i).map((x, j) => ({ x, j })).reverse().find(({ x }) => (x.kind === "agent" || x.kind === "crew") && !x.disabled);
            if (back) {
              log(s.name, `gate failed – round ${n + 1} of ${(s.max ?? 3) + 1}, back to ${back.x.name}`, "warn", s.id);
              mark(s, { status: "success", note: `round ${n + 1}`, ms: Date.now() - ts });
              lastGate = null;
              i = back.j - 1;
              continue;
            }
          }
          if (lastGate === false) { pass = false; log(s.name, "out of rounds", "err", s.id); }
        }
      } catch (e) {
        pass = false;
        log(s.name, String((e as Error).message ?? e), "err", s.id);
      }
      mark(s, { status: abort.current ? "error" : pass ? "success" : "error", ms: Date.now() - ts });
      if (stepOnce.current) setPaused(true);
      if (!pass) {
        // a failed gate followed by a retry block hands control to the retry
        if (s.kind === "gate" && steps[i + 1]?.kind === "retry" && !steps[i + 1].disabled) continue;
        ok = false; break;
      }
    }
    const status = abort.current ? "stopped" : ok ? "passed" : "failed";
    log("run", `run ${status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, abort.current ? "warn" : ok ? "ok" : "err");
    tree(status);
    const exec: Execution = { id: `r${t0}`, at: t0, ms: Date.now() - t0, status, trigger, steps: steps.map((s) => ({ name: s.name, kind: s.kind, status: (state.get(s.id)?.status ?? "idle") as StepStatus, ms: state.get(s.id)?.ms })) };
    setRuns((r) => { const n = [exec, ...r].slice(0, 25); try { localStorage.setItem(RUNS, JSON.stringify(n)); } catch { /* private */ } return n; });
    setRunning(false);
    setPaused(false);
    setCursor(null);
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, running, pipe]);

  /** Pause between blocks, or continue. */
  const togglePause = useCallback(() => { stepOnce.current = false; setPaused(!pausedRef.current); }, []);
  /** Run the next block then pause; from idle, start a run in step mode. */
  const step = useCallback((fromId?: string) => {
    if (!running) { void run(fromId, "manual", true); return; }
    stepOnce.current = true; setPaused(false);
  }, [running, run]);
  /** Re-run from the first block that failed in the last run. */
  const failedAt = pipe.steps.find((x) => x.status === "error")?.id ?? null;
  const rerunFailed = useCallback(() => { if (failedAt) void run(failedAt, "re-run"); }, [failedAt, run]);

  const stop = useCallback(() => { abort.current = true; setPaused(false); api.agentAction("task_done", {}).catch(() => {}); }, []);
  const markDone = useCallback((id: string) => { done.current.add(id); }, []);

  // Automations: an armed "On change" trigger reruns when its section's files
  // change; "Every 15 min" reruns on a timer.
  const auto = useMemo(() => pipe.steps.find((s) => s.kind === "trigger" && s.ref !== "manual" && !s.disabled), [pipe.steps]);
  const armedSig = useRef<string | null>(null);
  useEffect(() => {
    if (!auto || !data) return;
    if (auto.ref === "every") {
      const t = window.setInterval(() => { if (!running) { log(auto.name, "timer fired"); void run(undefined, "timer"); } }, 15 * 60 * 1000);
      return () => window.clearInterval(t);
    }
    const scope = new Set(auto.section ? filesOf(data, auto.section) : []);
    const t = window.setInterval(async () => {
      if (running) return;
      const st = await api.status().catch(() => null);
      const sig = (st?.files ?? []).filter((f) => !scope.size || scope.has(f.path)).map((f) => f.path).sort().join("|");
      if (armedSig.current === null) { armedSig.current = sig; return; }
      if (sig !== armedSig.current) { armedSig.current = sig; log(auto.name, "files changed – starting a run", "warn"); void run(undefined, "change"); }
    }, 4000);
    return () => window.clearInterval(t);
  }, [auto, data, running, run]);

  return { running, run, stop, markDone, runs, paused, togglePause, step, failedAt, rerunFailed, cursor, clearRuns: () => { setRuns([]); try { localStorage.removeItem(RUNS); } catch { /* private */ } } };
}

/* ---- Node panel: n8n's node creator ----------------------------------- */

/** Categories first; a category slides in its blocks (with a back arrow);
    typing searches everything flat. Arrow keys move, Enter inserts, Esc
    backs out a level, then closes. Blocks drag onto the map too. */
export function NodePanel({ info, open, onClose, onPick, hint }: { info: AgentsInfo | null; open: boolean; onClose: () => void; onPick: (it: Item) => void; hint: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [hi, setHi] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cats = useMemo(() => catalogue(info), [info]);
  useEffect(() => { if (open) { setQ(""); setCat(null); setHi(0); window.setTimeout(() => input.current?.focus(), 30); } }, [open]);
  const s = q.trim().toLowerCase();
  const hit = (it: Item) => !s || `${it.name} ${it.about} ${it.ref} ${it.kind}`.toLowerCase().includes(s);
  const current = cats.find((c) => c.id === cat);
  // What the list shows: search hits, a category's blocks, or the categories.
  const rows: ({ t: "cat"; c: Category } | { t: "item"; it: Item })[] =
    s ? cats.flatMap((c) => c.items.filter(hit).map((it) => ({ t: "item" as const, it })))
    : current ? current.items.map((it) => ({ t: "item" as const, it }))
    : cats.map((c) => ({ t: "cat" as const, c }));
  const k = Math.min(hi, rows.length - 1);
  const enter = (r: (typeof rows)[number] | undefined) => {
    if (!r) return;
    if (r.t === "cat") { setDir("in"); setCat(r.c.id); setHi(0); } else onPick(r.it);
  };
  const back = () => { setDir("out"); setCat(null); setHi(0); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((x) => Math.min(rows.length - 1, x + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((x) => Math.max(0, x - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); enter(rows[k]); }
    else if (e.key === "ArrowRight" && rows[k]?.t === "cat") { e.preventDefault(); enter(rows[k]); }
    else if ((e.key === "ArrowLeft" || e.key === "Backspace") && !q && cat) { e.preventDefault(); back(); }
    // Esc steps back out of a category, else closes (n8n) – the search clears with the panel.
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (cat && !q) back(); else onClose(); }
  };
  return (
    <aside className={`np${open ? " open" : ""}${dragging ? " np-dragging" : ""}`} aria-hidden={!open} aria-label="Add a block" data-testid="np" onKeyDown={onKey}>
      <div className="np-head">
        {current && !s
          ? <button className="np-back" onClick={back} data-testid="np-back" aria-label="Back to categories"><span className="np-back-ico"><Icon.back /></span>{current.label}</button>
          : <span className="np-title">{hint}</span>}
        <button className="ws-x" onClick={onClose} aria-label="Close panel">×</button>
      </div>
      <input ref={input} className="np-search" placeholder="Search blocks…" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} data-testid="np-search" />
      <div className="np-list" key={s ? "search" : cat ?? "root"} data-dir={dir}>
        {!rows.length && <div className="np-empty">No blocks match “{q}”.</div>}
        {rows.map((r, i) => r.t === "cat" ? (
          <button key={r.c.id} className={`np-row np-catrow${i === k ? " hi" : ""}`} data-testid={`np-cat-${r.c.id}`} onClick={() => enter(r)} onPointerEnter={() => setHi(i)} style={{ animationDelay: `${i * 18}ms` }}>
            {ico(r.c.kind)}
            <span className="np-txt"><span className="np-name">{r.c.label}</span><span className="np-about">{r.c.hint}</span></span>
            <span className="np-n mono">{r.c.items.length}</span>
            <span className="np-chev"><Icon.chevron /></span>
          </button>
        ) : (
          <button key={r.it.kind + r.it.ref + r.it.name} className={`np-row np-item${i === k ? " hi" : ""}`} draggable style={{ animationDelay: `${i * 18}ms` }}
            data-testid={`np-item-${r.it.kind}-${r.it.ref}`} onPointerEnter={() => setHi(i)}
            onDragStart={(e) => { e.dataTransfer.setData(ITEM_DRAG, JSON.stringify(r.it)); e.dataTransfer.effectAllowed = "copy"; window.setTimeout(() => setDragging(true), 0); }}
            onDragEnd={() => setDragging(false)}
            onClick={() => onPick(r.it)}>
            {ico(r.it.kind)}
            <span className="np-txt"><span className="np-name">{r.it.name}</span><span className="np-about">{r.it.about}</span></span>
          </button>
        ))}
        {current && !current.items.length && !s && <div className="np-empty">None yet{current.id === "crew" ? " – define a team in kula.toml (Library → Teams)" : ""}.</div>}
      </div>
      <div className="np-foot"><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> insert</span><span><kbd>esc</kbd> back</span><span className="spacer" /><span>drag onto a section</span></div>
    </aside>
  );
}

export function droppedItem(e: React.DragEvent): Item | null {
  const raw = e.dataTransfer.getData(ITEM_DRAG);
  if (!raw) return null;
  try { return JSON.parse(raw) as Item; } catch { return null; }
}
export const isItemDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(ITEM_DRAG);

/* ---- Step editor: the parameters, shared by the sidebar and the NDV ---- */

const STATUS_LABEL: Record<StepStatus, string> = { idle: "", waiting: "waiting for agent", running: "running", success: "passed", error: "failed", skipped: "skipped" };
const fmtMs = (ms?: number) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function StepFields({ data, s, pipe, sections }: { data: MapData; s: Step; pipe: Pipe; sections: string[] }) {
  const name = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : "") || "–";
  return (
    <>
      <label className="ws-field"><span>Name</span>
        <input value={s.name} onChange={(e) => pipe.update(s.id, { name: e.target.value })} data-testid="pl-name" /></label>
      {(s.kind === "agent" || s.kind === "crew" || s.kind === "trigger") && (
        <label className="ws-field"><span>{s.kind === "trigger" ? "Watches" : "Section"}</span>
          <select value={s.section ?? ""} onChange={(e) => pipe.update(s.id, { section: e.target.value || null })} data-testid="pl-section">
            <option value="">{s.kind === "agent" ? "whole repo (no fence)" : "any file"}</option>
            {sections.map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select></label>
      )}
      {(s.kind === "agent" || s.kind === "note") && (
        <label className="ws-field"><span>{s.kind === "note" ? "Text" : "Task"}</span>
          <textarea rows={s.kind === "note" ? 4 : 2} value={s.task ?? ""} placeholder="What should it do here?" onChange={(e) => pipe.update(s.id, { task: e.target.value })} data-testid="pl-task" /></label>
      )}
      {s.kind === "note" && (
        <div className="ws-field"><span>Colour</span><div className="pl-colors">
          {STICKY_COLORS.map((c) => <button key={c} className={`pl-color${s.color === c ? " on" : ""}`} style={{ background: c }} aria-label="Sticky colour" onClick={() => pipe.update(s.id, { color: c })} />)}
        </div></div>
      )}
      {s.kind === "agent" && s.section && <p className="ws-hint">Fence: {filesOf(data, s.section).length} files it may edit; it reads the whole repo.</p>}
      {s.kind === "retry" && (
        <label className="ws-field"><span>Rounds</span>
          <input type="number" min={1} max={9} value={s.max ?? 3} onChange={(e) => pipe.update(s.id, { max: Math.max(1, Math.min(9, Number(e.target.value) || 3)) })} /></label>
      )}
    </>
  );
}

/* ---- Sidebar: the pipeline list and the selected block ---------------- */

export function PipelinePanel({ data, pipe, runner, sel, onSel, sections, onOpen, onAdd }: {
  data: MapData; pipe: Pipe; runner: ReturnType<typeof useRunner>; sel: string | null; onSel: (id: string | null) => void; sections: string[]; onOpen: (id: string) => void; onAdd?: () => void;
}) {
  const s = pipe.steps.find((x) => x.id === sel) ?? null;
  const name = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : "") || "–";
  return (
    <section className="ws-card" data-testid="ws-pipeline">
      <div className="ws-card-head"><span className="ws-eyebrow">Pipeline · {runnable(pipe.steps).length} blocks</span>
        <span className="spacer" />
        {!!pipe.steps.length && !runner.running && <button className="ws-link" onClick={pipe.clear}>clear</button>}
        {!runner.running && <button className="ws-link" data-testid="pl-add" onClick={() => onAdd?.()}>+ add</button>}</div>
      {!pipe.steps.length && <p className="ws-note">Empty. Use + add, then drag an agent onto a section – then a gate, then Run.</p>}
      <ol className="pl-list">
        {pipe.steps.map((x, i) => (
          <li key={x.id} className={`pl-row${x.id === sel ? " on" : ""} pl-${x.status ?? "idle"}${x.disabled ? " pl-off" : ""}`} onClick={() => onSel(x.id)} onDoubleClick={() => onOpen(x.id)} data-testid={`pl-row-${i}`}>
            <span className="pl-n mono">{x.kind === "note" ? "" : `#${runnable(pipe.steps).indexOf(x) + 1}`}</span>
            <span className="np-ico sm" style={{ background: `color-mix(in srgb, ${KIND_COLOR[x.kind]} 18%, transparent)`, color: KIND_COLOR[x.kind] }}><KindIco kind={x.kind} /></span>
            <span className="pl-name">{x.name}{x.section && <span className="pl-on"> · {name(x.section)}</span>}</span>
            <span className="pl-st">{x.disabled ? "off" : x.note ?? STATUS_LABEL[x.status ?? "idle"]}{x.ms != null && <span className="pl-ms"> {fmtMs(x.ms)}</span>}</span>
            {x.kind !== "note" && !runner.running && <button className="pl-from" title="Run from this block" onClick={(e) => { e.stopPropagation(); void runner.run(x.id); }}>run from</button>}
          </li>
        ))}
      </ol>
      {s && (
        <div className="pl-edit" data-testid="pl-edit">
          <StepFields data={data} s={s} pipe={pipe} sections={sections} />
          <div className="pl-actions">
            {s.status === "waiting" && <button className="btn sm primary" onClick={() => runner.markDone(s.id)} data-testid="pl-done">Done</button>}
            {s.kind !== "note" && <button className="btn sm" onClick={() => void runner.run(s.id)} disabled={runner.running} data-testid="pl-run-from">Run from here</button>}
            <button className="btn sm" onClick={() => onOpen(s.id)}>Open</button>
            <button className="btn sm" onClick={() => pipe.update(s.id, { disabled: !s.disabled })} data-testid="pl-toggle">{s.disabled ? "Activate" : "Deactivate"}</button>
            <span className="spacer" />
            <button className="btn sm danger" onClick={() => { pipe.remove(s.id); onSel(null); }} disabled={runner.running} data-testid="pl-remove">Remove</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Execution history (n8n's Executions tab, in the Live sidebar). */
export function Executions({ runner }: { runner: ReturnType<typeof useRunner> }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!runner.runs.length) return null;
  return (
    <section className="ws-card" data-testid="ws-execs">
      <div className="ws-card-head"><span className="ws-eyebrow">Executions · {runner.runs.length}</span><button className="ws-link" onClick={runner.clearRuns}>clear</button></div>
      {runner.runs.map((r) => (
        <div key={r.id} className={`ex-row ex-${r.status}${open === r.id ? " open" : ""}`}>
          <button className="ex-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <span className="ex-dot" /><span className="ex-st">{r.status}</span>
            <span className="ex-at">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="ex-ms mono">{fmtMs(r.ms)}</span>
          </button>
          <div className="dd-body"><div className="dd-inner">
            {r.steps.map((s, i) => <div key={i} className={`ex-step pl-${s.status}`}><span className="np-ico sm" style={{ color: KIND_COLOR[s.kind] }}><KindIco kind={s.kind} /></span><span>{s.name}</span><span className="pl-st">{STATUS_LABEL[s.status] || s.status}{s.ms != null && ` · ${fmtMs(s.ms)}`}</span></div>)}
            <p className="ws-hint">triggered by {r.trigger}</p>
          </div></div>
        </div>
      ))}
    </section>
  );
}

/* ---- Node details view (NDV): input · parameters · output ------------ */

export function StepDetails({ data, s, pipe, runner, sections, prev, onClose }: {
  data: MapData; s: Step; pipe: Pipe; runner: ReturnType<typeof useRunner>; sections: string[]; prev: Step | null; onClose: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => onLog(() => tick((x) => x + 1)), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  const files = s.section ? filesOf(data, s.section) : [];
  const out = logLines().filter((l) => l.step === s.id);
  const prevOut = prev ? logLines().filter((l) => l.step === prev.id).slice(-12) : [];
  const secName = (id: string | null) => (id ? data.blocks[id]?.theme || data.blocks[id]?.name : null);
  return createPortal(
    <div className="scrim ndv-scrim" onMouseDown={onClose}>
      <div className="ndv" role="dialog" aria-label={`${s.name} details`} data-testid="ndv" onMouseDown={(e) => e.stopPropagation()}>
        <header className="ndv-head">
          {ico(s.kind)}
          <div className="ndv-titles"><h2>{s.name}</h2><span className="ndv-sub">{s.kind}{s.ref && s.kind !== "note" ? ` · ${s.ref}` : ""}{secName(s.section) ? ` on ${secName(s.section)}` : ""}</span></div>
          <span className="spacer" />
          {s.kind !== "note" && <button className="btn sm primary" onClick={() => { onClose(); void runner.run(s.id); }} disabled={runner.running} data-testid="ndv-run"><Icon.play /> Run from here</button>}
          <button className="ws-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="ndv-cols">
          <section className="ndv-col ndv-in">
            <h3>Input</h3>
            {s.kind === "agent" || s.kind === "crew" ? (
              files.length ? <><p className="ndv-k">Fence · {files.length} files it may edit</p><ul className="ndv-files mono">{files.slice(0, 80).map((f) => <li key={f}>{f}</li>)}</ul></>
                : <p className="ws-note">No section – the whole repo, unfenced.</p>
            ) : prev ? (
              <><p className="ndv-k">From {prev.name}{prev.status && prev.status !== "idle" ? ` · ${STATUS_LABEL[prev.status]}` : ""}</p>
                {prevOut.length ? <pre className="ndv-pre">{prevOut.map((l) => l.text).join("\n")}</pre> : <p className="ws-note">Run the pipeline to see what arrives here.</p>}</>
            ) : <p className="ws-note">First block – nothing comes in.</p>}
          </section>
          <section className="ndv-col ndv-params">
            <h3>Parameters</h3>
            <StepFields data={data} s={s} pipe={pipe} sections={sections} />
            <label className="dd-row ndv-toggle"><input type="checkbox" checked={!s.disabled} onChange={() => pipe.update(s.id, { disabled: !s.disabled })} /> Active</label>
          </section>
          <section className="ndv-col ndv-out">
            <h3>Output {s.status && s.status !== "idle" && <span className={`ndv-st pl-${s.status}`}>{STATUS_LABEL[s.status]}{s.ms != null && ` · ${fmtMs(s.ms)}`}</span>}</h3>
            {out.length ? <pre className="ndv-pre" data-testid="ndv-out">{out.map((l) => `${new Date(l.t).toLocaleTimeString([], { hour12: false })}  ${l.text}`).join("\n")}</pre>
              : <p className="ws-note">No output yet. <b>Run from here</b> executes this block and everything after it.</p>}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---- Right-click menu --------------------------------------------------- */

export type MenuItem = { label: string; key?: string; run: () => void; danger?: boolean; disabled?: boolean; sep?: boolean; testid?: string };
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onClose = () => close.current();
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(at.x, window.innerWidth - r.width - 8), y: Math.min(at.y, window.innerHeight - r.height - 8) });
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("pointerdown", away, true); window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", esc, true); };
  }, [at]);
  const onKey = (e: React.KeyboardEvent) => {
    const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
  };
  return createPortal(
    <div ref={ref} className="cm" role="menu" style={{ left: pos.x, top: pos.y }} data-testid="ctx-menu" onKeyDown={onKey}>
      {items.map((it, i) => it.sep ? <div key={i} className="cm-sep" /> : (
        <button key={i} role="menuitem" className={`cm-item${it.danger ? " danger" : ""}`} disabled={it.disabled} data-testid={it.testid}
          onClick={() => { onClose(); it.run(); }}>
          <span>{it.label}</span>{it.key && <kbd>{it.key}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export type { ReactNode };
