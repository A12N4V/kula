// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Components several agents tabs share, extracted verbatim from the old
// views/Agents.tsx by module S1 – same markup, same behaviour.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { relTime, type AgentsInfo, type GuardLevel, type ResearchRun, type Suggestion, type Workflow } from "../../api";
import { BRANDS, Mark } from "../../brands";
import { Chips } from "../../Autofill";
import { Icon, StatTable } from "../../ui";
import type { Act } from "./data";

export const LEVEL_TEXT: Record<GuardLevel, string> = {
  open: "open",
  review: "review",
  scope: "out of scope",
  locked: "locked",
  hidden: "hidden",
};
/** What each level means for an agent, in one phrase. */
export const LEVEL_MEANS: Record<GuardLevel, string> = {
  open: "may change",
  review: "may change; a person reviews it",
  scope: "outside the task: read only",
  locked: "read only",
  hidden: "never shown",
};

export function GuardTag({ level }: { level: GuardLevel }) {
  return <span className={`guard-tag ${level}`}>{LEVEL_TEXT[level]}</span>;
}
export function Card({ title, sub, right, children, className = "" }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head"><h2>{title}</h2>{sub && <span className="muted">{sub}</span>}<span className="spacer" />{right}</div>
      <div className="ag-body">{children}</div>
    </section>
  );
}
export function AgentMark({ id, size = 16 }: { id: string; size?: number }) {
  return BRANDS[id] ? <Mark id={id} size={size} /> : <span className="agent-glyph" style={{ width: size, height: size }}>{id.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Keyboard navigation for one list (module A1): j/k (and the arrows) move a
 * roving selection, Enter activates the selected row, Escape clears it. The
 * container takes the returned props; each row takes `data-idx={i}` and the
 * hook marks the selected one with `data-kb-sel` and scrolls it into view.
 */
export function useListNav(count: number, onEnter?: (i: number) => void, reset?: unknown) {
  const [sel, setSel] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(-1), [reset, count]);
  useEffect(() => {
    if (sel < 0) return;
    ref.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return {
    sel,
    setSel,
    props: {
      ref,
      "data-list-nav": count > 0 ? "true" : undefined,
      "aria-activedescendant": sel >= 0 ? `list-item-${sel}` : undefined,
      tabIndex: count > 0 ? 0 : undefined,
      onKeyDown: (e: React.KeyboardEvent) => {
        // Typing in a nested edit field (a memory rewrite, a link) must never
        // move the selection or be prevented – only navigate from the list.
        const t = e.target as HTMLElement;
        if (t.isContentEditable || t.closest("input, textarea, select")) return;
        if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(count - 1, s + 1)); }
        else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
        else if (e.key === "Enter" && sel >= 0) onEnter?.(sel);
        else if (e.key === "Escape") setSel(-1);
        else return;
        e.stopPropagation();
      },
    },
  };
}

export const pct = (r: ResearchRun) => {
  if (!r.baseline) return 0;
  const d = (r.best - r.baseline) / Math.abs(r.baseline);
  return (r.goal === "max" ? d : -d) * 100;
};
export const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

/** Every experiment as a dot, the best-so-far as a step line: kept ones in the accent. */
export function RunChart({ run, w = 1200, h = 120 }: { run: ResearchRun; w?: number; h?: number }) {
  const W = w, pad = 10;
  const vals = [run.baseline, ...run.experiments.map((e) => e.value).filter((v): v is number => v !== null)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const n = Math.max(1, run.experiments.length);
  const x = (i: number) => pad + (i / n) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - 2 * pad);
  let best = run.baseline;
  const steps: string[] = [`M${x(0)},${y(best)}`];
  run.experiments.forEach((e, i) => { if (e.kept && e.value !== null) { steps.push(`H${x(i + 1)}V${y(e.value)}`); best = e.value; } });
  steps.push(`H${x(n)}`);
  return (
    <svg className="run-chart" data-figure viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${run.workflow}: baseline ${num(run.baseline)}, best ${num(run.best)}`}>
      <line x1={pad} x2={W - pad} y1={y(run.baseline)} y2={y(run.baseline)} className="rc-base" />
      <path d={steps.join("")} className="rc-best" />
      {run.experiments.map((e, i) => e.value === null
        ? <rect key={i} x={x(i + 1) - 3} y={h - pad - 3} width={6} height={6} className="rc-fail"><title>#{e.n} {e.hypothesis} – {e.note}</title></rect>
        : <rect key={i} x={x(i + 1) - 4} y={y(e.value) - 4} width={8} height={8} className={e.kept ? "rc-kept" : "rc-dot"}><title>#{e.n} {e.hypothesis} – {num(e.value)}{e.kept ? " kept" : ""}</title></rect>)}
    </svg>
  );
}

export function RunSummary({ run }: { run: ResearchRun }) {
  const kept = run.experiments.filter((e) => e.kept).length;
  return (
    <div className="run-sum">
      <div className="row"><b className="mono">{run.workflow}</b>{run.active ? <span className="tag accent">running</span> : <span className="tag">finished</span>}<span className="spacer" /><span className="muted mono">{run.branch}</span></div>
      <RunChart run={run} w={560} h={110} />
      <StatTable rows={[
        { label: "Baseline", value: num(run.baseline) },
        { label: "Best", value: num(run.best), tone: "accent" },
        { label: "Better by", value: `${pct(run).toFixed(1)}%` },
        { label: "Kept", value: `${kept} of ${run.experiments.length}` },
      ]} />
    </div>
  );
}
/** One pass of an agent through a task, as kula sees it. */
const LOOP: { tool: string; what: string; gate?: boolean }[] = [
  { tool: "workflows", what: "learn how" },
  { tool: "context_pack", what: "read" },
  { tool: "pre_edit", what: "before a change" },
  { tool: "edit", what: "the hook enforces fences", gate: true },
  { tool: "verify_edit", what: "after" },
  { tool: "remember", what: "keep what was learned" },
];
export function Loop({ wf, locked }: { wf: Workflow | null; locked: number }) {
  return (
    <div className="loop" aria-label="Agent loop">
      {LOOP.map((s, i) => (
        <div key={s.tool} className={`loop-step ${s.gate ? "gate" : ""}`}>
          {i > 0 && <span className="loop-arrow" aria-hidden="true" />}
          <span className="loop-n">{String(i + 1).padStart(2, "0")}</span>
          <b className="mono">{s.tool}</b>
          <span>{s.gate ? (locked ? `${locked} files read only${wf ? ` · ${wf.name}` : ""}` : "nothing fenced") : s.what}</span>
        </div>
      ))}
    </div>
  );
}

export function WorkflowTile({ w, active, onPreview, onClick, on, idx, sel }: { w: Workflow; active: boolean; onPreview?: () => void; onClick?: () => void; on?: boolean; idx?: number; sel?: boolean }) {
  const f = fenceSummary(w);
  return (
    <div className={`wf-tile ${active ? "active" : ""} ${on ? "on" : ""} ${sel ? "kb-sel" : ""}`} data-idx={idx} id={`list-item-${idx}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}>
      <div className="row"><b className="mono">{w.name}</b>{active && <span className="tag accent">active</span>}{w.research?.metric && <span className="tag"><Icon.flask /> loop</span>}<span className="spacer" />{w.builtin ? <span className="muted wf-src">built in</span> : <span className="muted wf-src">kula.toml</span>}</div>
      <div className="wf-about">{w.about || <span className="muted">no description</span>}</div>
      <div className="wf-fences">{f.length ? f.map((x) => <span key={x.t} className={`guard-tag ${x.l}`}>{x.t}</span>) : <span className="guard-tag open">no extra fences</span>}
        <span className="muted wf-mem">memory {w.memory || "write"}</span>
      </div>
      {onPreview && <button className="btn sm ghost wf-preview" onClick={(e) => { e.stopPropagation(); onPreview(); }} title="Preview its fences on the graph"><Icon.graph /> preview</button>}
    </div>
  );
}

function fenceSummary(w: Workflow): { t: string; l: GuardLevel }[] {
  const out: { t: string; l: GuardLevel }[] = [];
  const name = (v: string[]) => (v.length === 1 && v[0] === "**" ? "everything" : v.some((x) => x.includes("test") || x.includes("spec")) && v.length > 4 ? "tests" : v.some((x) => x.endsWith(".md")) && v.length > 3 ? "docs" : v.length === 1 ? v[0] : `${v.length} patterns`);
  if (w.scope?.length) out.push({ t: `only ${name(w.scope)}`, l: "open" });
  if (w.lock?.length) out.push({ t: `locks ${name(w.lock)}`, l: "locked" });
  if (w.hide?.length) out.push({ t: `hides ${name(w.hide)}`, l: "hidden" });
  if (w.review?.length) out.push({ t: `review ${name(w.review)}`, l: "review" });
  return out;
}

export function StartTask({ info, act, initial = "" }: { info: AgentsInfo; act: Act; initial?: string }) {
  const [title, setTitle] = useState("");
  const [wf, setWf] = useState(initial);
  const [scope, setScope] = useState<string[]>([]);
  const w = info.workflows.find((x) => x.name === wf);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); act("task_start", { title, scope, workflow: wf }, `Task started${wf ? ` in ${wf}` : ""}`).catch(() => {}); }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the agent is doing, e.g. speed up login" aria-label="Task title" />
      <div className="wf-pick" role="radiogroup" aria-label="Workflow">
        <button type="button" role="radio" aria-checked={!wf} className={!wf ? "on" : ""} onClick={() => setWf("")}>none</button>
        {info.workflows.map((x) => (
          <button type="button" key={x.name} role="radio" aria-checked={wf === x.name} className={wf === x.name ? "on" : ""} onClick={() => setWf(x.name)} title={x.about}>{x.name}</button>
        ))}
      </div>
      {w && <div className="muted ag-meta">{w.about}{w.scope?.length ? ` – scope defaults to ${w.scope.length} pattern${w.scope.length > 1 ? "s" : ""}` : ""}</div>}
      <Chips values={scope} onChange={setScope} placeholder={w?.scope?.length ? "scope: the workflow's, or name your own" : "scope: src/auth/**, login, session.ts – empty for the whole repo"} label="Scope" />
      <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!title.trim()}>Start task</button></div>
    </form>
  );
}

export function SuggestionRow({ s, act }: { s: Suggestion; act: Act }) {
  const what = s.guard ? <><GuardTag level={s.guard.level} /><span className="mono">{[...(s.guard.paths ?? []), ...(s.guard.symbols ?? [])].join(", ")}</span></> : <><span className="tag accent">workflow</span><span className="mono">{s.workflow?.name}</span></>;
  return (
    <div className="need sugg">
      <span className="tag">suggested</span>{what}
      <span className="need-what">{s.why} <span className="muted">– {s.by}, {relTime(s.created)}</span></span>
      <button className="btn sm primary" onClick={() => act("suggestion_accept", { id: s.id }, "Added to kula.toml")}>Accept</button>
      <button className="btn sm ghost" onClick={() => act("suggestion_dismiss", { id: s.id }, "Dismissed")}>Dismiss</button>
    </div>
  );
}
export function Snippet({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="snippet">
      <pre className="code">{text}</pre>
      <button className="btn sm ghost snippet-copy" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }} aria-label="Copy">
        {done ? "copied" : <><Icon.copy /> copy</>}
      </button>
    </div>
  );
}

/**
 * The tab strip Workflows, Research, Teams and Skills share: one tab per item,
 * a + right after the newest, double-click (or F2) to rename in place.
 */
export type TabItem = { key: string; label: string; dot?: boolean; depth?: number; title?: string; fixed?: boolean };
export function TabStrip({ items, cur, onPick, onAdd, onRename, label, addLabel }: {
  items: TabItem[]; cur: string; onPick: (k: string) => void; onAdd?: () => void; onRename?: (k: string, to: string) => void; label: string; addLabel: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const begin = (it: TabItem) => { if (onRename && !it.fixed) { setEditing(it.key); setVal(it.label); } };
  const commit = () => {
    const it = items.find((x) => x.key === editing);
    if (it && val && val !== it.label) onRename?.(it.key, val);
    setEditing(null);
  };
  return (
    <div className="team-tabs tab-strip" role="tablist" aria-label={label}>
      {items.map((it) => editing === it.key ? (
        <input key={it.key} className="tab-rename mono" autoFocus value={val} size={Math.max(6, val.length + 1)} aria-label={`Rename ${it.label}`}
          onChange={(e) => setVal(e.target.value.replace(/[^\w-]/g, ""))} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(null); }} />
      ) : (
        <button key={it.key} role="tab" aria-selected={it.key === cur} className={it.key === cur ? "on" : ""} data-depth={it.depth ? Math.min(it.depth, 3) : undefined}
          title={it.title ?? (onRename && !it.fixed ? "double-click to rename" : undefined)}
          onClick={() => onPick(it.key)} onDoubleClick={() => begin(it)} onKeyDown={(e) => { if (e.key === "F2") begin(it); }}>
          {!!it.depth && <span className="tab-up" aria-hidden="true">└</span>}{it.label}{it.dot && <i className="dot ok" title="running" />}
        </button>
      ))}
      {onAdd && <button className={`team-tab-add ${cur === "" ? "on" : ""}`} onClick={onAdd} aria-label={addLabel} title={addLabel}><Icon.plus /></button>}
    </div>
  );
}
