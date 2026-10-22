// U4 · Run supervision (wave 3): the run is supervised on the map, not in a
// log. Dry-run builds a plan overlay – blocks the pipeline intends to read
// (outline), write (accent tint), gates marked; a block struck from the plan
// is a temporary fence exclusion (skipped by the run) – then Approve.
// During a run, conflicts (a write outside the fence) are flagged in place on
// the block with a red corner mark, never only in the log; an ask gate docks
// above the transport ("Allow once · Allow for run · Deny", keys 1/2/3, not a
// modal); changed blocks keep a +/− badge until acknowledged. Every step's
// detail carries the decision (what the block decided and why), the diff it
// made and the cost. A fake run drives all of it against the fixture.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { log, openDock } from "../../dock/bus";
import type { MapData } from "./types";
import { filesOf } from "./workspace";
import type { Step } from "./pipeline";

export type PlanEntry = { stepId: string; name: string; kind: string; writes: string[]; reads: string[] };
export type Ask = { id: string; stepId: string; agent: string; action: string; target: string };
export type Change = { id: string; stepId: string; section: string | null; path: string; kind: "+" | "−" };
export type Conflict = { id: string; stepId: string; section: string | null; path: string; reason: string };

const secName = (data: MapData | null, id: string | null) =>
  id && data ? data.blocks[id]?.theme || data.blocks[id]?.name : null;

/** The plan: what each block would touch. Writes = its section (the fence it
    may edit); reads = the upstream block's section (the data it takes in).
    Gates read their section too – they check what the last agent wrote. */
function planOf(data: MapData | null, steps: Step[]): PlanEntry[] {
  const plan: PlanEntry[] = [];
  let prevSec: string | null = null;
  for (const s of steps) {
    if (s.kind === "note") continue;
    const entry: PlanEntry = { stepId: s.id, name: s.name, kind: s.kind, writes: [], reads: [] };
    if (s.kind === "agent" || s.kind === "crew" || s.kind === "loop") {
      if (s.section) entry.writes.push(s.section);
      if (prevSec && prevSec !== s.section) entry.reads.push(prevSec);
    } else if (s.kind === "gate" || s.kind === "retry") {
      if (s.section) entry.reads.push(s.section);
      else if (prevSec) entry.reads.push(prevSec);
    } else if (s.kind === "trigger" && s.section) {
      entry.reads.push(s.section);
    }
    plan.push(entry);
    if (s.section) prevSec = s.section;
  }
  return plan;
}

/** The whole supervision surface: plan, fake run, asks, changes, conflicts. */
export function useSupervision(data: MapData | null, steps: Step[]) {
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [planActive, setPlanActive] = useState(false);
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [asks, setAsks] = useState<Ask[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [fake, setFake] = useState(false); // a fake run is walking the lane
  const [decision, setDecision] = useState<Record<string, string>>({});
  const timers = useRef<number[]>([]);
  const changeSeq = useRef(0);
  const firstAgent = useRef<string | null>(null);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const dryRun = useCallback(() => {
    setPlan(planOf(data, steps));
    setPlanActive(true);
    log("dry-run", `plan built – ${steps.filter((s) => s.kind !== "note" && !struck.has(s.id)).length} blocks would run; strike one to exclude it`, "info");
  }, [data, steps, struck]);

  const cancelPlan = useCallback(() => { setPlanActive(false); setPlan([]); }, []);
  const toggleStrike = useCallback((stepId: string) => {
    setStruck((s0) => { const n = new Set(s0); if (n.has(stepId)) n.delete(stepId); else n.add(stepId); return n; });
  }, []);
  const approvePlan = useCallback(() => {
    setPlanActive(false);
    log("plan", `approved – ${plan.length - struck.size} blocks, ${struck.size} struck out of this run`, "ok");
    void fakeRun();
  }, [plan, struck]);

  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)) as unknown as number; };
  const [allowedRun, setAllowedRun] = useState<Set<string>>(new Set());
  const allowedRunRef = useRef<Set<string>>(allowedRun);
  allowedRunRef.current = allowedRun;

  const emitChange = useCallback((stepId: string, path: string, kind: "+" | "−", section: string | null) => {
    const id = `c${changeSeq.current++}`;
    setChanges((cs) => [...cs, { id, stepId, path, kind, section }]);
  }, []);

  const fakeRun = useCallback(async () => {
    if (fake || !data) return;
    setFake(true);
    setDecision({});
    setAsks([]);
    setConflicts([]);
    setAcked(new Set());
    firstAgent.current = null;
    openDock("run");
    const lane = planOf(data, steps).filter((p) => !struck.has(p.stepId));
    log("run", `fake run over the fixture – ${lane.length} blocks`, "ok");
    let t = 200;
    for (const entry of lane) {
      const s = steps.find((x) => x.id === entry.stepId);
      if (!s) continue;
      const started = t;
      const decide = (text: string) => setDecision((d) => ({ ...d, [entry.stepId]: text }));
      if (s.kind === "trigger" || s.kind === "gate" || s.kind === "retry") {
        later(t, () => log(entry.name, s.kind === "gate" ? `checked ${secName(data, s.section) ?? "the last block"} – pass` : s.kind === "trigger" ? "armed – started by hand" : "round ok", "info", s.id));
        decide(s.kind === "gate" ? "Pass – the check held." : s.kind === "trigger" ? "Fired by hand." : "Retry not needed.");
        t += 300;
        continue;
      }
      // agent / crew / loop: it "writes" – one edit inside its fence, and the
      // first agent also reaches outside the fence, which raises the ask gate.
      const files = s.section ? filesOf(data, s.section) : [];
      const inside = files[0] ?? "README.md";
      const outside = outsidePath(data, s.section);
      later(t, () => { log(entry.name, `task “${s.task?.trim() || `${entry.name} on ${secName(data, s.section) ?? "the repo"}`}” running (fake agent)`, "info", s.id); });
      later(t + 250, () => {
        log(entry.name, `edited ${inside}`, "info", s.id);
        emitChange(s.id, inside, "+", s.section);
        decide(`Wrote ${inside}${s.section ? ` inside the fence of ${secName(data, s.section)}` : ""}.`);
      });
      if (!firstAgent.current) {
        firstAgent.current = s.id;
        // The ask holds the write: nothing lands on the block until it is
        // answered (Allow once / Allow for run / Deny in answerAsk). A target
        // already allowed for the run does not ask again.
        later(t + 450, () => {
          if (allowedRunRef.current.has(outside)) return;
          log(entry.name, `wants to edit ${outside} – outside its fence`, "warn", s.id);
          setAsks((a) => [...a, { id: `a${changeSeq.current}`, stepId: s.id, agent: entry.name, action: "edit", target: outside }]);
        });
      }
      t += 700;
    }
    later(t, () => { setFake(false); log("run", "fake run passed in a few seconds (fixture)", "ok"); });
  }, [data, steps, struck, fake, emitChange]);

  /** Answer an ask gate: 1 = allow once, 2 = allow for the run, 3 = deny. */
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const sectionOfStep = (stepId: string) => stepsRef.current.find((x) => x.id === stepId)?.section ?? null;
  const answerAsk = useCallback((id: string, ans: "once" | "run" | "deny") => {
    setAsks((a) => a.filter((x) => x.id !== id));
    const ask = asks.find((x) => x.id === id);
    if (!ask) return;
    if (ans === "deny") {
      log(ask.agent, `denied – ${ask.action} ${ask.target} is off this run`, "warn", ask.stepId);
      setDecision((d) => ({ ...d, [ask.stepId]: `Denied the write to ${ask.target} – the edit is off this run.` }));
    } else {
      log(ask.agent, `${ans === "run" ? "allowed for this run" : "allowed once"} – ${ask.action} ${ask.target}`, "info", ask.stepId);
      if (ans === "run") { setAllowedRun((r) => { const n = new Set(r); n.add(ask.target); return n; }); }
      // The allowed write lands now: the change badges the block that made it
      // and the out-of-fence edit is flagged in place (a red corner mark).
      const sec = sectionOfStep(ask.stepId);
      emitChange(ask.stepId, ask.target, "+", sec);
      setConflicts((cs) => [...cs, { id: `k${changeSeq.current}`, stepId: ask.stepId, section: sec, path: ask.target, reason: "write outside the fence" }]);
      setDecision((d) => ({ ...d, [ask.stepId]: `Allowed ${ans === "run" ? "for the run" : "once"}: ${ask.action} ${ask.target}.` }));
    }
  }, [asks, emitChange]);
  const conflictsOf = (stepId: string) => conflicts.filter((c) => c.stepId === stepId);
  const changesOf = (stepId: string) => changes.filter((c) => c.stepId === stepId);
  const acknowledge = useCallback((id: string) => setAcked((a) => { const n = new Set(a); n.add(id); return n; }), []);
  const clearSupervision = useCallback(() => { setChanges([]); setConflicts([]); setAsks([]); setDecision({}); setAcked(new Set()); }, []);

  return { plan, planActive, struck, toggleStrike, dryRun, cancelPlan, approvePlan, fake, fakeRun, asks, answerAsk, changes, conflicts, acked, acknowledge, decision, conflictsOf, changesOf, clearSupervision };
}
export type Supervision = ReturnType<typeof useSupervision>;

/* ---- Plan overlay ------------------------------------------------------ */
// Measured from the DOM like FenceHull: the plan marks live over the section
// nodes the plan names, so they ride the camera without touching flow/*.

type Box = { left: number; top: number; width: number; height: number };

function useBoxes(canvas: React.RefObject<HTMLElement | null>, ids: string[]): Map<string, Box> {
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const key = ids.join("|");
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const measure = () => {
      const c = canvas.current!.getBoundingClientRect();
      const m = new Map<string, Box>();
      for (const id of key.split("|").filter(Boolean)) {
        const el = canvas.current!.querySelector(`[data-testid="fc-node-${CSS.escape("sec:" + id)}"]`)
          ?? canvas.current!.querySelector(`[data-testid="fc-node-${CSS.escape(id)}"]`);
        if (!el) continue;
        const n = el.getBoundingClientRect();
        m.set(id, { left: n.left - c.left, top: n.top - c.top, width: n.width, height: n.height });
      }
      setBoxes(m);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas.current!);
    window.addEventListener("scroll", measure, true);
    // The canvas re-hydrates asynchronously (cold map build): re-measure when
    // nodes appear or the camera moves, not only on resize.
    const mo = new MutationObserver(measure);
    mo.observe(canvas.current!, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("scroll", measure, true); };
  }, [canvas, key]);
  return boxes;
}

/** The dry-run plan: write sections get the accent tint, read sections an
    outline, struck blocks' sections a strike bar. The plan bar (docked above
    the transport) carries Approve and the struck count. */
export function PlanOverlay({ sup, canvas }: { sup: Supervision; canvas: React.RefObject<HTMLElement | null> }) {
  const ids = sup.planActive ? Array.from(new Set(sup.plan.flatMap((p) => [...p.writes, ...p.reads]))) : [];
  const boxes = useBoxes(canvas, ids);
  const struckSecs = new Set(sup.plan.filter((p) => sup.struck.has(p.stepId)).flatMap((p) => p.writes));
  if (!sup.planActive || !sup.plan.length) return null;
  return (
    <div className="u4-plan" data-testid="u4-plan-overlay">
      <div className="u4-plan-bar" data-testid="u4-plan-bar" role="status" aria-label="Dry-run plan">
        <span className="u4-plan-k mono">plan</span>
        <span className="u4-plan-txt">{sup.plan.length} blocks · {Array.from(new Set(sup.plan.flatMap((p) => p.writes))).length} to write · {sup.struck.size} struck</span>
        <button className="btn sm primary" onClick={sup.approvePlan} data-testid="u4-approve">Approve</button>
        <button className="btn ghost sm" onClick={sup.cancelPlan} data-testid="u4-plan-cancel">Cancel</button>
      </div>
      {[...boxes].map(([id, b]) => {
        const written = sup.plan.some((p) => p.writes.includes(id) && !sup.struck.has(p.stepId));
        const struck = struckSecs.has(id);
        const owner = sup.plan.find((p) => p.writes.includes(id) || p.reads.includes(id));
        return (
          <button key={id} className={`u4-mark${written ? " u4-write" : " u4-read"}${struck ? " u4-struck" : ""}`}
            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            data-testid={`u4-mark-${id}`}
            title={struck ? "Struck from this run – click to put it back" : "Click to strike this block from the run"}
            onClick={(e) => { e.stopPropagation(); if (owner) sup.toggleStrike(owner.stepId); }} />
        );
      })}
    </div>
  );
}

/* ---- Ask gate ----------------------------------------------------------- */
// Docks above the transport (contract §8.11): a compact prompt, keys 1/2/3,
// never a modal – the map stays live behind it.
export function AskGate({ sup }: { sup: Supervision }) {
  const ask = sup.asks[sup.asks.length - 1];
  const n = sup.asks.length;
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture phase – this must win over App's global view hotkeys (1/2/3
      // navigate views there), which fire later in the bubble phase. Never
      // hijack typing: inputs, contentEditable and modified keys are ignored.
      const t = e.target as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ans = e.key === "1" ? "once" : e.key === "2" ? "run" : e.key === "3" ? "deny" : null;
      if (!ans) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sup.answerAsk(ask.id, ans);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask, sup]);
  if (!ask) return null;
  return (
    <div className="u4-ask" data-testid="ask-gate" role="status" aria-label="Ask gate">
      <span className="u4-ask-dot" aria-hidden="true" />
      <span className="u4-ask-txt"><b>{ask.agent}</b> wants to {ask.action} <code>{ask.target}</code> (outside its fence).{n > 1 && <> <b className="mono">{sup.asks.indexOf(ask) + 1} of {n}</b> waiting</>}</span>
      <button className="btn sm" onClick={() => sup.answerAsk(ask.id, "once")} data-testid="u4-allow-once">Allow once <kbd>1</kbd></button>
      <button className="btn sm" onClick={() => sup.answerAsk(ask.id, "run")} data-testid="u4-allow-run">Allow for run <kbd>2</kbd></button>
      <button className="btn sm danger" onClick={() => sup.answerAsk(ask.id, "deny")} data-testid="u4-deny">Deny <kbd>3</kbd></button>
    </div>
  );
}

/* ---- In-place marks ----------------------------------------------------- */
// Conflicts: a red corner mark on the block (section) itself, clickable into
// the step detail. Changes: a +/− badge until acknowledged.
export function ConflictMarks({ sup, canvas, onOpen }: { sup: Supervision; canvas: React.RefObject<HTMLElement | null>; onOpen: (stepId: string) => void }) {
  const ids = Array.from(new Set(sup.conflicts.map((c) => c.section).filter(Boolean) as string[]));
  const boxes = useBoxes(canvas, ids);
  return (
    <>
      {[...boxes].map(([sec, b]) => (
        <button key={sec} className="u4-conflict" data-testid={`u4-conflict-${sec}`} title="A write landed outside the fence – open the step"
          style={{ left: b.left + b.width - 14, top: b.top - 6 }}
          onClick={() => onOpen(sup.conflicts.find((c) => c.section === sec)!.stepId)} />
      ))}
    </>
  );
}

export function ChangeBadges({ sup, canvas, onOpen }: { sup: Supervision; canvas: React.RefObject<HTMLElement | null>; onOpen: (stepId: string) => void }) {
  const live = sup.changes.filter((c) => !sup.acked.has(c.id) && c.section);
  const ids = Array.from(new Set(live.map((c) => c.section!)));
  const boxes = useBoxes(canvas, ids);
  return (
    <>
      {[...boxes].map(([sec, b]) => {
        const list = live.filter((c) => c.section === sec);
        const plus = list.some((c) => c.kind === "+");
        const minus = list.some((c) => c.kind !== "+");
        return (
          <button key={sec} className="u4-badge" data-testid={`u4-badge-${sec}`} title={list.map((c) => `${c.kind} ${c.path}`).join("\n")}
            style={{ left: b.left + b.width - 34, top: b.top - 10 }}
            onClick={() => { list.forEach((c) => sup.acknowledge(c.id)); onOpen(list[0].stepId); }}>
            <span className="mono">{plus && minus ? "+−" : plus ? "+" : "−"}</span>{list.length > 1 && <b className="mono">{list.length}</b>}
          </button>
        );
      })}
    </>
  );
}

/** A path outside a section's fence, read off the map: a file in a section
    the block does not fence (the first other section on the canvas). */
function outsidePath(data: MapData, sectionId: string | null): string {
  const other = Object.keys(data.blocks).find((id) => id !== sectionId && (data.blocks[id].symbols.length || data.blocks[id].children.length));
  const files = other ? filesOf(data, other) : [];
  return files[0] ?? "docs/fake-run.md";
}
