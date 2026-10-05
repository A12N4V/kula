// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime, type AgentDoc, type AgentsInfo, type GuardLevel, type Memory, type RawRule, type ResearchRun, type Suggestion, type Team, type Workflow } from "../api";
import { BRANDS, Mark } from "../brands";
import { teamLayout, workflowColor } from "./TeamFlow";
import AgentMap from "./AgentMap";
import { Chips, CodeField, HereHint, LinkArea } from "../Autofill";
import { useCode } from "../CodePanel";
import type { Go, Target } from "../nav";
import { Empty, Icon, useToast } from "../ui";

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

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

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];
const TABS = [
  { id: "overview", label: "Overview", icon: Icon.agents },
  { id: "workflows", label: "Workflows", icon: Icon.workflow },
  { id: "research", label: "Research", icon: Icon.flask },
  { id: "teams", label: "Teams", icon: Icon.team },
  { id: "fences", label: "Fences", icon: Icon.fence },
  { id: "memory", label: "Memory", icon: Icon.memory },
  { id: "docs", label: "Docs", icon: Icon.doc },
  { id: "connect", label: "Connect", icon: Icon.plug },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The agents kula wires up itself; anything else speaks MCP or runs under `kula run`. */
const AGENT_IDS = ["claude", "cursor", "codex", "gemini"];
const AGENT_NAME: Record<string, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex", gemini: "Gemini CLI" };
/** Where a workflow becomes each agent's own: a subagent, a rule, a command. */
const NATIVE: [string, string, string][] = [["claude", "Claude Code subagent", ".claude/agents/kula-"], ["cursor", "Cursor rule", ".cursor/rules/kula-"], ["gemini", "Gemini CLI command", ".gemini/commands/kula/"]];

const TOOLS: [string, string][] = [
  ["workflows", "how this kind of work is done here: steps, docs, fences"],
  ["research · experiment", "an autoresearch loop: kula runs the metric, keeps what's better"],
  ["start_task · finish_task", "declare the task; its workflow's fences apply"],
  ["context_pack", "the code a task needs, fitted to a budget"],
  ["pre_edit", "callers, tests, risk, guards and memories before a change"],
  ["verify_edit", "what moved, what broke, what was fenced"],
  ["guards", "what the agent may change, and why"],
  ["remember · recall · update_memory", "facts about the code, marked stale when it changes"],
  ["suggest", "propose a fence or a workflow; a person decides"],
  ["sparql", "any structural question over the graph"],
  ["query · context · impact · trace", "the graph itself"],
];

const MCP = `{
  "mcpServers": {
    "kula": { "command": "kula", "args": ["mcp"] }
  }
}`;

/** One pass of an agent through a task, as kula sees it. */
const LOOP: { tool: string; what: string; gate?: boolean }[] = [
  { tool: "workflows", what: "learn how" },
  { tool: "context_pack", what: "read" },
  { tool: "pre_edit", what: "before a change" },
  { tool: "edit", what: "the hook enforces fences", gate: true },
  { tool: "verify_edit", what: "after" },
  { tool: "remember", what: "keep what was learned" },
];

export default function Agents({ version, onChanged, openSymbol, go, target }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(() => (TABS.some((t) => t.id === target?.tab) ? target!.tab : "overview") as Tab);
  const toast = useToast();
  const code = useCode();
  const load = () => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]);
  // The URL is the tab: back and forward move between them.
  useEffect(() => { setTabState((TABS.some((t) => t.id === target?.tab) ? target!.tab : "overview") as Tab); }, [target?.tab]);
  const setTab = (t: Tab) => { setTabState(t); go?.("agents", { tab: t }); };

  const act = async (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => {
    try { const r = await api.agentAction(action, body); if (done) toast(done); await load(); onChanged(); return r; }
    catch (e: any) { toast(e.message, "err"); throw e; }
  };
  const open = async (t: string) => {
    if (t === "repo") return;
    if (t.startsWith("file:")) { code.open({ path: t.slice(5) }); return; }
    const raw = t.replace(/^symbol:/, "");
    const [path, name] = [raw.slice(0, raw.lastIndexOf(":")), raw.slice(raw.lastIndexOf(":") + 1)];
    const hits = await api.search(name || raw).catch(() => []);
    const hit = hits.find((h) => h.path === path && h.name === name) ?? hits[0];
    if (hit) openSymbol(hit.id);
  };
  const onGraph = (wf = "") => go?.("graph", { fences: wf });

  if (err) return <div className="page"><Empty title="Agent state unavailable">{err}</Empty></div>;
  if (!info) return <div className="page"><div className="muted">Reading workflows, fences and memories…</div></div>;
  const stale = info.memories.filter((m) => m.stale).length;
  const outdated = info.docs.filter((d) => d.synced && !d.current).length;
  const badge: Partial<Record<Tab, number>> = { memory: stale, docs: outdated, fences: info.suggestions.filter((s) => s.kind === "guard").length, workflows: info.suggestions.filter((s) => s.kind === "workflow").length };

  return (
    <div className="page agents">
      <header className="page-head">
        <div>
          <h1>Agents</h1>
        </div>
      </header>

      <nav className="ag-tabs" role="tablist" aria-label="Agents">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            <t.icon /> {t.label}{!!badge[t.id] && <span className="badge">{badge[t.id]}</span>}
          </button>
        ))}
      </nav>

      <div className="ag-panel" key={tab}>
        {tab === "overview" && <Overview info={info} act={act} setTab={setTab} onGraph={onGraph} open={open} />}
        {tab === "workflows" && <Workflows info={info} act={act} onGraph={onGraph} />}
        {tab === "research" && <ResearchTab info={info} act={act} />}
        {tab === "teams" && <Teams info={info} act={act} />}
        {tab === "fences" && <Fences info={info} act={act} onGraph={onGraph} />}
        {tab === "memory" && <MemoryTab info={info} act={act} open={open} />}
        {tab === "docs" && <Docs info={info} act={act} />}
        {tab === "connect" && <Connect info={info} act={act} />}
      </div>
    </div>
  );
}

type Act = (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => Promise<unknown>;

function Card({ title, sub, right, children, className = "" }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head"><h2>{title}</h2>{sub && <span className="muted">{sub}</span>}<span className="spacer" />{right}</div>
      <div className="ag-body">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ overview

function Overview({ info, act, setTab, onGraph, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; onGraph: (wf?: string) => void; open: (t: string) => void }) {
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const by = (l: GuardLevel) => fenced.filter((f) => f.verdict.level === l).length;
  const stale = info.memories.filter((m) => m.stale);
  const wf = info.workflow;
  return (
    <>
      <div className="ag-strip">
        <Kpi n={info.workflows.length} label="workflows" onClick={() => setTab("workflows")} />
        <Kpi n={info.rules.length} label="fence rules" onClick={() => setTab("fences")} />
        <Kpi n={by("locked")} label="locked files" tone={by("locked") ? "locked" : ""} onClick={() => onGraph()} />
        <Kpi n={by("hidden")} label="hidden files" tone={by("hidden") ? "hidden" : ""} onClick={() => onGraph()} />
        <Kpi n={info.memories.length} label="memories" onClick={() => setTab("memory")} />
        <Kpi n={stale.length} label="stale" tone={stale.length ? "review" : ""} onClick={() => setTab("memory")} />
      </div>

      <div className="ag-grid">
        <Card title={info.task ? "Now" : "Start a task"} sub={info.task ? `${info.task.by} · ${relTime(info.task.started)}` : undefined} className="ag-now">
          {info.task ? (
            <>
              <div className="ag-task-title">{info.task.title}</div>
              <div className="ag-chips">
                {wf && <span className="tag accent"><Icon.workflow />&nbsp;{wf.name}</span>}
                {info.task.scope.length ? info.task.scope.slice(0, 6).map((s) => <span key={s} className="tag mono">{s}</span>) : <span className="tag">whole repository</span>}
                {info.task.scope.length > 6 && <span className="tag">+{info.task.scope.length - 6}</span>}
              </div>
              <Loop wf={wf} locked={by("locked") + info.files.filter((f) => f.verdict.level === "scope").length} />
              {wf?.steps?.length ? (
                <ol className="ag-steps">{wf.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              ) : null}
              <div className="row">
                <button className="btn sm" onClick={() => onGraph()}><Icon.fence /> See it on the graph</button>
                <span className="spacer" />
                <button className="btn sm" onClick={() => act("task_done", {}, "Task done – its fences are lifted")}>Finish task</button>
              </div>
            </>
          ) : <StartTask info={info} act={act} />}
        </Card>

        <Card title="Needs you" className="ag-needs">
          {info.suggestions.length === 0 && stale.length === 0 && info.docs.every((d) => d.current || !d.synced) && info.connections.some((c) => c.mcp) ? (
            <div className="muted ag-empty">Nothing waiting.</div>
          ) : null}
          {info.suggestions.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
          {stale.slice(0, 4).map((m) => (
            <div key={m.id} className="need">
              <span className="tag yellow">stale</span>
              <button className="ag-target mono" onClick={() => open(m.target)}>{m.target.replace(/^(symbol|file):/, "")}</button>
              <span className="need-what">{m.body}</span>
              <button className="btn sm" onClick={() => act("confirm", { id: m.id }, "Still true – re-anchored")}>Still true</button>
            </div>
          ))}
          {stale.length > 4 && <button className="btn sm ghost" onClick={() => setTab("memory")}>{stale.length - 4} more stale memories <Icon.arrow /></button>}
          {info.docs.filter((d) => d.synced && !d.current).map((d) => (
            <div key={d.path} className="need">
              <span className="tag yellow">outdated</span><span className="mono">{d.path}</span><span className="need-what">the brief no longer matches kula.toml</span>
              <button className="btn sm" onClick={() => act("docs_sync", {}, "Brief synced")}>Sync</button>
            </div>
          ))}
          {!info.connections.some((c) => c.mcp) && (
            <div className="need"><span className="tag">setup</span><span className="need-what">No agent is connected yet.</span><button className="btn sm primary" onClick={() => setTab("connect")}>Connect</button></div>
          )}
        </Card>

        <Card title="Autoresearch" right={<button className="btn sm ghost" onClick={() => setTab("research")}>Open <Icon.arrow /></button>}>
          {info.research[0] ? <RunSummary run={info.research[0]} /> : (
            <div className="stack">
              <div className="row"><button className="btn sm primary" onClick={() => setTab("research")}><Icon.flask /> Set up a loop</button></div>
            </div>
          )}
        </Card>

        <Card title="Team" sub={info.team ? `${info.team.name} · since ${relTime(info.team.started)}` : undefined} right={<button className="btn sm ghost" onClick={() => setTab("teams")}>{info.teams.length ? "Edit" : "Set up"} <Icon.arrow /></button>}>
          {info.team ? (
            <div className="team-mini">
              {(info.teams.find((t) => t.name === info.team!.name)?.members ?? []).map((m, i) => (
                <div key={i} className="row"><AgentMark id={m.agent} /><b>{AGENT_NAME[m.agent] ?? m.agent}</b><span className="tag accent">{m.workflow || "no workflow"}</span><span className="muted">{m.role}</span></div>
              ))}
            </div>
          ) : <div className="muted ag-meta">{info.teams.length ? `${info.teams.length} saved – none at work` : "No teams."}</div>}
        </Card>

        <Card title="Workflows" right={<button className="btn sm ghost" onClick={() => setTab("workflows")}>Edit <Icon.arrow /></button>} className="ag-wide">
          <div className="wf-grid">
            {info.workflows.map((w) => <WorkflowTile key={w.name} w={w} active={info.workflow?.name === w.name} onPreview={() => onGraph(w.name)} />)}
          </div>
        </Card>
      </div>
    </>
  );
}

function Kpi({ n, label, tone = "", onClick }: { n: number; label: string; tone?: string; onClick?: () => void }) {
  return <button className="kpi-cell" onClick={onClick}><b className={tone ? `lv-${tone}` : ""}>{n}</b><span>{label}</span></button>;
}

/** The agent loop, with the fence gate where edits happen. */
function Loop({ wf, locked }: { wf: Workflow | null; locked: number }) {
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

function WorkflowTile({ w, active, onPreview, onClick, on }: { w: Workflow; active: boolean; onPreview?: () => void; onClick?: () => void; on?: boolean }) {
  const f = fenceSummary(w);
  return (
    <div className={`wf-tile ${active ? "active" : ""} ${on ? "on" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
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

function StartTask({ info, act, initial = "" }: { info: AgentsInfo; act: Act; initial?: string }) {
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

function SuggestionRow({ s, act }: { s: Suggestion; act: Act }) {
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

// ------------------------------------------------------------------ workflows

const blank = (): Workflow => ({ name: "", about: "", scope: [], lock: [], hide: [], review: [], memory: "write", steps: [], docs: [] });

function Workflows({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void }) {
  const [sel, setSel] = useState<string>(info.workflow?.name ?? info.workflows[0]?.name ?? "");
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const cur = info.workflows.find((w) => w.name === sel);
  useEffect(() => { if (cur) { setDraft({ ...blank(), ...cur, memory: cur.memory || "write" }); setOrig(cur.name); } }, [sel, info]);
  const own = info.workflows.filter((w) => !w.builtin);
  const dirty = !!draft && !!cur && JSON.stringify({ ...blank(), ...cur, memory: cur.memory || "write", builtin: undefined }) !== JSON.stringify({ ...draft, builtin: undefined });
  const isNew = orig === null;

  const save = async () => {
    if (!draft) return;
    const next = [...own.filter((w) => w.name !== orig && w.name !== draft.name), { ...draft, builtin: undefined, memory: draft.memory === "write" ? "" : draft.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${draft.name} to kula.toml`).catch(() => {});
    setSel(draft.name);
  };
  const remove = async () => {
    if (!draft || !orig) return;
    const builtin = BUILTIN.includes(orig);
    if (!confirm(builtin ? `Reset ${orig} to kula's built-in?` : `Delete the ${orig} workflow from kula.toml?`)) return;
    await act("workflows_save", { workflows: own.filter((w) => w.name !== orig) }, builtin ? "Reset to built-in" : "Deleted").catch(() => {});
    if (!builtin) setSel(info.workflows[0]?.name ?? "");
  };
  const set = (k: keyof Workflow, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const sugg = info.suggestions.filter((s) => s.kind === "workflow");

  return (
    <div className="wf-split">
      <div className="wf-list">
        {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
        {info.workflows.map((w) => <WorkflowTile key={w.name} w={w} active={info.workflow?.name === w.name} on={sel === w.name && !isNew} onClick={() => setSel(w.name)} />)}
        <button className="btn sm wf-new" onClick={() => { setDraft(blank()); setOrig(null); setSel(""); }}><Icon.plus /> New workflow</button>
      </div>
      {draft ? (
        <section className="card wf-edit">
          <div className="card-head">
            <h2>{isNew ? "New workflow" : draft.name}</h2>
            {!isNew && (cur?.builtin ? <span className="tag">built in – saving overrides it in kula.toml</span> : BUILTIN.includes(orig!) ? <span className="tag accent">overrides the built-in</span> : <span className="tag">kula.toml</span>)}
            <span className="spacer" />
            {!isNew && <button className="btn sm ghost" onClick={() => onGraph(orig!)}><Icon.graph /> Preview fences</button>}
          </div>
          <div className="ag-body wf-form">
            <label><span>name</span><input className="input mono" value={draft.name} onChange={(e) => set("name", e.target.value.replace(/[^\w-]/g, ""))} placeholder="db-migrate" /></label>
            <label><span>about</span><input className="input" value={draft.about ?? ""} onChange={(e) => set("about", e.target.value)} placeholder="One line: what this kind of work is" /></label>
            <label className="wf-prompt"><span>prompt</span><textarea className="input" rows={2} value={draft.prompt ?? ""} onChange={(e) => set("prompt", e.target.value)} placeholder="system prompt for every agent in this workflow" aria-label="System prompt" /></label>
            <div className="wf-fence-grid">
              <FenceField level="open" label="scope" hint="agents may change only this" values={draft.scope ?? []} onChange={(v) => set("scope", v)} />
              <FenceField level="locked" label="lock" hint="read, never edit" values={draft.lock ?? []} onChange={(v) => set("lock", v)} />
              <FenceField level="hidden" label="hide" hint="never shown" values={draft.hide ?? []} onChange={(v) => set("hide", v)} />
              <FenceField level="review" label="review" hint="editable, a person checks" values={draft.review ?? []} onChange={(v) => set("review", v)} />
            </div>
            <label><span>memory</span>
              <div className="seg">
                {(["write", "read", "off"] as const).map((m) => <button key={m} type="button" className={(draft.memory || "write") === m ? "on" : ""} onClick={() => set("memory", m)}>{m === "write" ? "recall + remember" : m === "read" ? "recall only" : "off"}</button>)}
              </div>
            </label>
            <div className="wf-steps">
              <span className="wf-lbl">steps</span>
              <ol>
                {(draft.steps ?? []).map((s, i) => (
                  <li key={i}>
                    <span className="loop-n">{String(i + 1).padStart(2, "0")}</span>
                    <input className="input" value={s} onChange={(e) => set("steps", draft.steps!.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Step ${i + 1}`} />
                    <button className="btn sm ghost icon-only" disabled={i === 0} onClick={() => { const v = [...draft.steps!]; [v[i - 1], v[i]] = [v[i], v[i - 1]]; set("steps", v); }} aria-label="Move up"><Icon.up /></button>
                    <button className="btn sm ghost icon-only" disabled={i === draft.steps!.length - 1} onClick={() => { const v = [...draft.steps!]; [v[i + 1], v[i]] = [v[i], v[i + 1]]; set("steps", v); }} aria-label="Move down"><Icon.down /></button>
                    <button className="btn sm ghost icon-only danger" onClick={() => set("steps", draft.steps!.filter((_, j) => j !== i))} aria-label="Remove step"><Icon.close /></button>
                  </li>
                ))}
              </ol>
              <button className="btn sm ghost" onClick={() => set("steps", [...(draft.steps ?? []), ""])}><Icon.plus /> Add step</button>
            </div>
            <label><span>docs</span><Chips values={draft.docs ?? []} onChange={(v) => set("docs", v)} placeholder="files to read first, e.g. docs/ARCHITECTURE.md" label="Docs" /></label>
            <div className={`wf-research ${draft.research ? "on" : ""}`}>
              <label className="toggle"><input type="checkbox" checked={!!draft.research} onChange={(e) => set("research", e.target.checked ? { metric: "", goal: "min" } : null)} /> <Icon.flask /> autoresearch loop – kula runs a metric and keeps only what improves it</label>
              {draft.research && (
                <div className="wf-research-grid">
                  <label><span>metric</span><input className="input mono" value={draft.research.metric} onChange={(e) => set("research", { ...draft.research!, metric: e.target.value })} placeholder="a command whose last number is the result, e.g. cargo bench 2>&1 | grep -o '[0-9.]* ms' | tail -1" aria-label="Metric" /></label>
                  <label><span>better</span>
                    <div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={(draft.research!.goal || "min") === g ? "on" : ""} onClick={() => set("research", { ...draft.research!, goal: g })}>{g === "min" ? "lower" : "higher"}</button>)}</div>
                  </label>
                  <label><span>budget</span><input className="input mono" type="number" min={0} value={draft.research.budget ?? 0} onChange={(e) => set("research", { ...draft.research!, budget: Math.max(0, Number(e.target.value) || 0) })} aria-label="Budget" title="experiments before it stops; 0 for no limit" /></label>
                </div>
              )}
            </div>
            {!isNew && !dirty && (
              <div className="wf-native">
                <span className="wf-lbl">use it in</span>
                <div className="wf-native-row">
                  {NATIVE.map(([id, label, dir]) => {
                    const done = info.connections.find((c) => c.id === id)?.workflows.includes(orig!);
                    return (
                      <button key={id} className={`btn sm ${done ? "ghost" : ""}`} title={`${dir}${orig}`} onClick={() => act("workflow_install", { workflow: orig, targets: [id] }, `${orig} installed as a ${label}`).catch(() => {})}>
                        <Mark id={id} size={14} /> {label}{done && " ✓"}
                      </button>
                    );
                  })}
                  <code className="wf-run" title="any other harness">kula run -w {orig} -- &lt;agent&gt;</code>
                </div>
              </div>
            )}
            <div className="row wf-actions">
              {!isNew && (BUILTIN.includes(orig!) ? !cur?.builtin : true) && <button className="btn sm ghost danger" onClick={remove}>{BUILTIN.includes(orig!) ? "Reset to built-in" : "Delete"}</button>}
              <span className="spacer" />
              {!isNew && !dirty && !info.task && <StartIn wf={orig!} act={act} />}
              <button className="btn sm primary" disabled={!draft.name || (!dirty && !isNew)} onClick={save}>{isNew ? "Create" : "Save"}</button>
            </div>
          </div>
        </section>
      ) : <Empty title="Pick a workflow" />}
    </div>
  );
}

function FenceField({ level, label, hint, values, onChange }: { level: GuardLevel; label: string; hint: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className={`ff ff-${level}`}>
      <div className="ff-head"><span className={`guard-tag ${level}`}>{label}</span><span className="muted">{hint}</span></div>
      <Chips values={values} onChange={onChange} placeholder="globs, paths or symbols" label={label} />
    </div>
  );
}

function StartIn({ wf, act }: { wf: string; act: Act }) {
  const [title, setTitle] = useState("");
  return (
    <form className="row start-in" onSubmit={(e) => { e.preventDefault(); act("task_start", { title, workflow: wf }, `Task started in ${wf}`).catch(() => {}); }}>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Start a task in ${wf}…`} aria-label="Task title" />
      <button className="btn sm" disabled={!title.trim()}><Icon.play /> Start</button>
    </form>
  );
}

// ------------------------------------------------------------------ research

function AgentMark({ id, size = 16 }: { id: string; size?: number }) {
  return BRANDS[id] ? <Mark id={id} size={size} /> : <span className="agent-glyph" style={{ width: size, height: size }}>{id.slice(0, 1).toUpperCase()}</span>;
}

const pct = (r: ResearchRun) => {
  if (!r.baseline) return 0;
  const d = (r.best - r.baseline) / Math.abs(r.baseline);
  return (r.goal === "max" ? d : -d) * 100;
};
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));

/** Every experiment as a dot, the best-so-far as a step line: kept ones in the accent. */
function RunChart({ run, w = 1200, h = 120 }: { run: ResearchRun; w?: number; h?: number }) {
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
    <svg className="run-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${run.workflow}: baseline ${num(run.baseline)}, best ${num(run.best)}`}>
      <line x1={pad} x2={W - pad} y1={y(run.baseline)} y2={y(run.baseline)} className="rc-base" />
      <path d={steps.join("")} className="rc-best" />
      {run.experiments.map((e, i) => e.value === null
        ? <rect key={i} x={x(i + 1) - 3} y={h - pad - 3} width={6} height={6} className="rc-fail"><title>#{e.n} {e.hypothesis} – {e.note}</title></rect>
        : <rect key={i} x={x(i + 1) - 4} y={y(e.value) - 4} width={8} height={8} className={e.kept ? "rc-kept" : "rc-dot"}><title>#{e.n} {e.hypothesis} – {num(e.value)}{e.kept ? " kept" : ""}</title></rect>)}
    </svg>
  );
}

function RunSummary({ run }: { run: ResearchRun }) {
  const kept = run.experiments.filter((e) => e.kept).length;
  return (
    <div className="run-sum">
      <div className="row"><b className="mono">{run.workflow}</b>{run.active ? <span className="tag accent">running</span> : <span className="tag">finished</span>}<span className="spacer" /><span className="muted mono">{run.branch}</span></div>
      <RunChart run={run} w={560} h={110} />
      <div className="run-kpis">
        <span><b>{num(run.baseline)}</b> baseline</span><span><b className="lv-open">{num(run.best)}</b> best</span>
        <span><b>{pct(run).toFixed(1)}%</b> better</span><span><b>{kept}/{run.experiments.length}</b> kept</span>
      </div>
    </div>
  );
}

const RESEARCH_LOOP: { tool: string; what: string; gate?: boolean }[] = [
  { tool: "research", what: "baseline, best, what failed" },
  { tool: "hypothesis", what: "one idea" },
  { tool: "edit", what: "only the scope", gate: true },
  { tool: "experiment", what: "kula runs the metric" },
  { tool: "keep · revert", what: "a commit, or nothing" },
  { tool: "remember", what: "why it worked" },
];

const GREEN = "#8fd694", RED = "#f0827a", ACCENT = "#f97f3a", DIM = "#867d73";

function ResearchTab({ info, act }: { info: AgentsInfo; act: Act }) {
  const loops = info.workflows.filter((w) => w.research?.metric);
  const [cur, setCur] = useState(loops[0]?.name ?? "");
  const [adding, setAdding] = useState(loops.length === 0);
  const w = loops.find((x) => x.name === cur) ?? loops[0];
  return (
    <Card title="Research" sub={w ? `${loops.length} loop${loops.length > 1 ? "s" : ""}` : undefined} className="ag-wide team-card"
      right={<button className="btn sm ghost" onClick={() => setAdding(true)}><Icon.plus /> loop</button>}>
      {loops.length > 1 && (
        <div className="team-tabs" role="tablist" aria-label="Loops">
          {loops.map((x) => <button key={x.name} role="tab" aria-selected={x.name === w?.name} className={x.name === w?.name ? "on" : ""} onClick={() => { setCur(x.name); setAdding(false); }}>{x.name}{info.research.some((r) => r.workflow === x.name && r.active) && <i className="dot ok" title="running" />}</button>)}
        </div>
      )}
      {adding || !w ? <NewLoop info={info} act={act} done={(n) => { setCur(n); setAdding(false); }} cancel={loops.length ? () => setAdding(false) : undefined} />
        : <LoopMap key={w.name} w={w} info={info} act={act} />}
    </Card>
  );
}

function LoopMap({ w, info, act }: { w: Workflow; info: AgentsInfo; act: Act }) {
  const [sel, setSel] = useState<string | null>("metric");
  const runs = info.research.filter((r) => r.workflow === w.name);
  const run = runs.find((r) => r.active) ?? runs[0];
  const exps = runs.flatMap((r) => r.experiments);
  const scope = info.research_scope?.[w.name];
  const files = scope?.files.slice(0, 9) ?? [];
  const team = info.teams.find((t) => t.name === info.team?.name);
  const agents = new Map<string, number>();
  for (const e of exps) { const id = e.by.replace(/^agent:/, "").replace(/^user:/, "you:"); agents.set(id, (agents.get(id) ?? 0) + 1); }
  for (const m of team?.members.filter((m) => m.workflow === w.name) ?? []) if (![...agents.keys()].some((k) => k.startsWith(m.agent))) agents.set(m.agent, 0);
  const agentId = (s: string) => AGENT_IDS.find((a) => s.startsWith(a)) ?? s;
  const color = workflowColor(info.workflows, w.name);
  const kept = exps.filter((e) => e.kept), failed = exps.filter((e) => e.value === null), reverted = exps.filter((e) => !e.kept && e.value !== null);
  const spread = (n: number, i: number, gap = 0.55) => (i - (n - 1) / 2) * -gap;
  const ag = [...agents.keys()];
  const nodes = [
    ...ag.map((id, i) => ({ id: `a:${id}`, label: AGENT_NAME[agentId(id)] ?? id, x: -3, y: spread(ag.length, i, 0.8), size: 12, color, group: "agents", glyph: GLYPHS[agentId(id)] ?? id.slice(0, 1).toUpperCase(), hub: true })),
    { id: "wf", label: w.name, x: -1.2, y: 0, size: 15, color, group: "agents", glyph: "↻", hub: true },
    ...files.map((f, i) => ({ id: `f:${f}`, label: f.split("/").pop()!, x: 0.8, y: spread(files.length + 1, i), size: 7, color: GREEN, group: "may edit" })),
    { id: "fenced", label: `${scope?.fenced ?? 0} fenced`, x: 0.8, y: spread(files.length + 1, files.length), size: 6, color: RED, group: null },
    { id: "metric", label: "benchmark", x: 2.7, y: 0, size: 15, color: ACCENT, group: "kula runs it", glyph: "≈", hub: true },
    { id: "kept", label: `${kept.length} kept`, x: 4.4, y: 0.7, size: 10, color: ACCENT, group: "results", glyph: "✓", hub: true },
    { id: "reverted", label: `${reverted.length} reverted`, x: 4.4, y: 0, size: 8, color: DIM, group: "results" },
    { id: "failed", label: `${failed.length} failed`, x: 4.4, y: -0.7, size: 8, color: RED, group: "results" },
  ];
  const touched = new Set(exps.flatMap((e) => e.files));
  const edges = [
    ...ag.map((id) => ({ a: `a:${id}`, b: "wf", kind: "hand" as const })),
    ...files.map((f) => ({ a: "wf", b: `f:${f}`, kind: "link" as const })),
    ...files.map((f) => ({ a: `f:${f}`, b: "metric", kind: touched.has(f) ? ("hand" as const) : ("link" as const) })),
    { a: "metric", b: "kept", kind: "hand" as const }, { a: "metric", b: "reverted", kind: "link" as const }, { a: "metric", b: "failed", kind: "link" as const },
    { a: "kept", b: "wf", kind: "hand" as const },
  ];
  const tint: Record<string, string> = { agents: color, "may edit": GREEN, "kula runs it": ACCENT, results: DIM };
  const save = (x: Partial<Workflow>) => {
    const own = info.workflows.filter((y) => !y.builtin && y.name !== w.name);
    return act("workflows_save", { workflows: [...own, { ...w, ...x, builtin: undefined }] }, `${w.name} saved`).catch(() => {});
  };
  const list = (es: typeof exps) => (
    <div className="mi-list">{es.length === 0 && <span className="muted">none</span>}{[...es].reverse().slice(0, 14).map((e) => (
      <div key={`${e.n}-${e.at}`} className={`mi-exp ${e.kept ? "kept" : ""}`}><span className="mono">{e.value === null ? "–" : num(e.value)}</span><span>{e.hypothesis}</span>{e.note && <small className="muted">{e.note}</small>}</div>
    ))}</div>
  );
  let panel: ReactNode;
  if (sel === "wf") panel = <LoopSettings w={w} save={save} />;
  else if (sel === "metric") panel = (
    <>
      <div className="mi-kind">benchmark · kula runs it</div>
      <MetricEdit w={w} save={save} />
      {run && <><RunChart run={run} w={560} h={150} />
        <div className="run-kpis"><span><b>{num(run.baseline)}</b> base</span><span><b className="lv-open">{num(run.best)}</b> best</span><span><b>{pct(run).toFixed(1)}%</b></span>{run.budget > 0 && <span><b>{Math.max(0, run.budget - run.experiments.length)}</b> left</span>}</div></>}
    </>
  );
  else if (sel?.startsWith("a:")) { const id = sel.slice(2); panel = <><div className="mi-kind"><AgentMark id={agentId(id)} size={13} /> agent</div><div className="mi-title">{AGENT_NAME[agentId(id)] ?? id}</div>{list(exps.filter((e) => e.by.replace(/^agent:/, "").replace(/^user:/, "you:") === id))}</>; }
  else if (sel?.startsWith("f:")) { const f = sel.slice(2); panel = <><div className="mi-kind">may edit</div><div className="mi-title mono">{f}</div>{list(exps.filter((e) => e.files.includes(f)))}</>; }
  else if (sel === "fenced") panel = <><div className="mi-kind">fenced</div><div className="mi-title">{scope?.fenced ?? 0} files</div><span className="muted">everything outside the scope: read only; an experiment that touches it is reverted unrun</span></>;
  else if (sel === "kept" || sel === "reverted" || sel === "failed") panel = <><div className="mi-kind">{sel}</div>{list(sel === "kept" ? kept : sel === "reverted" ? reverted : failed)}</>;
  else panel = <div className="muted mi-hint">select a node</div>;
  return (
    <div className="team-stage">
      <div className="team-graph">
        <AgentMap nodes={nodes} edges={edges} selected={sel} onSelect={setSel} height={380} label={`Research loop ${w.name}`}
          groupColor={(g) => tint[g] ?? null} groupLabel={(g) => g} />
        <div className="map-legend">
          {run ? <span className="mono">{run.branch}</span> : <span className="muted">not started</span>}
          {run && <span><b className="lv-open">{num(run.best)}</b>&nbsp;best · {pct(run).toFixed(1)}%</span>}
          <span className="spacer" />
          {run?.active
            ? <button className="btn sm" onClick={() => act("research_stop", {}, `${w.name} stopped`)}>Stop</button>
            : <button className="btn sm primary" onClick={() => act("research_start", { workflow: w.name }, `${w.name} running – baseline measured`).catch(() => {})}><Icon.play /> Start</button>}
        </div>
      </div>
      <aside className="map-inspector">{panel}</aside>
    </div>
  );
}

function LoopSettings({ w, save }: { w: Workflow; save: (x: Partial<Workflow>) => Promise<unknown> }) {
  const [prompt, setPrompt] = useState(w.prompt ?? "");
  const [scope, setScope] = useState<string[]>(w.scope ?? []);
  const dirty = prompt !== (w.prompt ?? "") || JSON.stringify(scope) !== JSON.stringify(w.scope ?? []);
  return (
    <>
      <div className="mi-kind">loop</div>
      <div className="mi-title mono">{w.name}</div>
      <label className="mi-field"><span>system prompt</span><textarea className="input" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
      <div className="mi-field"><span>may edit</span><Chips values={scope} onChange={setScope} placeholder="src/index/**, tokenize" label="Scope" /></div>
      {w.steps?.length ? <ol className="ag-steps">{w.steps.map((x, i) => <li key={i}>{x}</li>)}</ol> : null}
      <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!dirty} onClick={() => save({ prompt, scope })}>Save</button></div>
    </>
  );
}

function MetricEdit({ w, save }: { w: Workflow; save: (x: Partial<Workflow>) => Promise<unknown> }) {
  const [r, setR] = useState(w.research!);
  const dirty = JSON.stringify(r) !== JSON.stringify(w.research);
  return (
    <div className="stack">
      <input className="input mono" value={r.metric} onChange={(e) => setR({ ...r, metric: e.target.value })} aria-label="Metric command" />
      <div className="row">
        <div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={(r.goal || "min") === g ? "on" : ""} onClick={() => setR({ ...r, goal: g })}>{g === "min" ? "lower" : "higher"}</button>)}</div>
        <input className="input mono research-budget" type="number" min={0} value={r.budget ?? 0} onChange={(e) => setR({ ...r, budget: Math.max(0, Number(e.target.value) || 0) })} aria-label="Budget" title="budget: experiments, 0 for no limit" />
        <span className="spacer" /><button className="btn sm primary" disabled={!dirty} onClick={() => save({ research: r })}>Save</button>
      </div>
    </div>
  );
}

function NewLoop({ info, act, done, cancel }: { info: AgentsInfo; act: Act; done: (name: string) => void; cancel?: () => void }) {
  const own = info.workflows.filter((w) => !w.builtin);
  const taken = info.workflows.filter((w) => w.research?.metric).map((w) => w.name);
  const [name, setName] = useState(taken.includes("autoresearch") ? `research-${taken.length + 1}` : "autoresearch");
  const [metric, setMetric] = useState("");
  const [goal, setGoal] = useState<"min" | "max">("min");
  const [budget, setBudget] = useState(20);
  const [scope, setScope] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const auto = info.workflows.find((w) => w.name === "autoresearch");
  const save = () => {
    const b = info.workflows.find((w) => w.name === name) ?? { ...blank(), name, about: auto?.about ?? "" };
    const w: Workflow = { ...blank(), ...b, builtin: undefined, scope, prompt, steps: b.steps?.length ? b.steps : auto?.steps ?? [], research: { metric, goal, budget } };
    act("workflows_save", { workflows: [...own.filter((x) => x.name !== name), w] }, `${name} saved`).then(() => done(name)).catch(() => {});
  };
  return (
    <div className="team-stage">
      <div className="team-graph">
        <div className="loop">
          {RESEARCH_LOOP.map((st, i) => (
            <div key={st.tool} className={`loop-step ${st.gate ? "gate" : ""}`}>
              {i > 0 && <span className="loop-arrow" aria-hidden="true" />}
              <span className="loop-n">{String(i + 1).padStart(2, "0")}</span><b className="mono">{st.tool}</b><span>{st.what}</span>
            </div>
          ))}
        </div>
      </div>
      <form className="map-inspector" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="mi-kind">new loop{cancel && <><span className="spacer" /><button type="button" className="btn sm ghost icon-only" onClick={cancel} aria-label="Cancel"><Icon.close /></button></>}</div>
        <input className="input mono mi-title" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ""))} aria-label="Workflow name" />
        <label className="mi-field"><span>benchmark</span><input className="input mono" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="cmd whose last number is the score" aria-label="Metric command" /></label>
        <div className="row"><div className="seg">{(["min", "max"] as const).map((g) => <button key={g} type="button" className={goal === g ? "on" : ""} onClick={() => setGoal(g)}>{g === "min" ? "lower" : "higher"}</button>)}</div>
          <input className="input mono research-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(Math.max(0, Number(e.target.value) || 0))} aria-label="Budget" title="budget" /></div>
        <div className="mi-field"><span>may edit</span><Chips values={scope} onChange={setScope} placeholder="src/index/**" label="Scope" /></div>
        <label className="mi-field"><span>system prompt</span><textarea className="input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="System prompt" /></label>
        <div className="row"><span className="spacer" /><button className="btn sm primary" disabled={!name || !metric.trim()}>Save loop</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ teams

const GLYPHS: Record<string, string> = { claude: "✻", cursor: "◆", codex: ">", gemini: "✦" };

function Teams({ info, act }: { info: AgentsInfo; act: Act }) {
  const [teams, setTeams] = useState<Team[]>(info.teams);
  const [cur, setCur] = useState(() => Math.max(0, info.teams.findIndex((t) => t.name === info.team?.name)));
  useEffect(() => setTeams(info.teams), [info]);
  const dirty = JSON.stringify(teams) !== JSON.stringify(info.teams);
  const t = teams[cur];
  const set = (x: Partial<Team>) => setTeams(teams.map((y, j) => (j === cur ? { ...y, ...x } : y)));
  const add = () => {
    setTeams([...teams, {
      name: teams.length ? `team-${teams.length + 1}` : "ship", about: "", prompt: "",
      members: [
        { agent: "claude", workflow: "autoresearch", role: "lead", hands_off: ["codex"] },
        { agent: "cursor", workflow: "tests", reports_to: "claude", hands_off: ["codex"] },
        { agent: "codex", workflow: "explore", role: "review", reports_to: "claude" },
      ],
    }]);
    setCur(teams.length);
  };
  return (
    <Card title="Teams" sub="kula.toml" className="ag-wide team-card"
      right={<>{dirty && <button className="btn sm ghost" onClick={() => setTeams(info.teams)}>Revert</button>}<button className="btn sm primary" disabled={!dirty} onClick={() => act("teams_save", { teams }, "Teams saved").catch(() => {})}>Save</button></>}>
      <div className="team-tabs" role="tablist" aria-label="Teams">
        {teams.map((x, i) => (
          <button key={i} role="tab" aria-selected={i === cur} className={i === cur ? "on" : ""} onClick={() => setCur(i)}>
            {x.name || "unnamed"}{info.team?.name === x.name && <i className="dot ok" title="at work" />}
          </button>
        ))}
        <button className="team-tab-add" onClick={add} aria-label="New team"><Icon.plus /></button>
      </div>
      {t ? <TeamEditor key={cur} team={t} info={info} on={info.team?.name === t.name} saved={info.teams.some((x) => x.name === t.name)} dirty={dirty}
        set={set} remove={() => { setTeams(teams.filter((_, j) => j !== cur)); setCur(0); }} act={act} /> : <div className="muted ag-empty">No teams.</div>}
    </Card>
  );
}

function TeamEditor({ team: t, info, on, saved, dirty, set, remove, act }: {
  team: Team; info: AgentsInfo; on: boolean; saved: boolean; dirty: boolean; set: (t: Partial<Team>) => void; remove: () => void; act: Act;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const at = teamLayout(t);
  const nodes = t.members.filter((m) => at.has(m.agent)).map((m) => ({
    id: m.agent, label: `${AGENT_NAME[m.agent] ?? m.agent}${m.reports_to ? "" : " · lead"}`, ...at.get(m.agent)!, size: 13,
    color: workflowColor(info.workflows, m.workflow), group: m.workflow || "", glyph: GLYPHS[m.agent] ?? m.agent.slice(0, 1).toUpperCase(), hub: true,
  }));
  const edges = t.members.flatMap((m) => [
    ...(m.reports_to ? [{ a: m.reports_to, b: m.agent, kind: "tree" as const }] : []),
    ...(m.hands_off ?? []).map((h) => ({ a: m.agent, b: h, kind: "hand" as const })),
  ]);
  const k = t.members.findIndex((m) => m.agent === sel);
  const setM = (i: number, m: Partial<Team["members"][number]>) => {
    const before = t.members[i].agent;
    let members = t.members.map((x, j) => (j === i ? { ...x, ...m } : x));
    if (m.agent !== undefined && m.agent !== before) {
      members = members.map((x) => ({ ...x, reports_to: x.reports_to === before ? m.agent : x.reports_to, hands_off: x.hands_off?.map((h) => (h === before ? m.agent! : h)) }));
      setSel(m.agent);
    }
    set({ members });
  };
  const drop = (i: number) => {
    const gone = t.members[i].agent;
    set({ members: t.members.filter((_, j) => j !== i).map((x) => ({ ...x, reports_to: x.reports_to === gone ? "" : x.reports_to, hands_off: x.hands_off?.filter((h) => h !== gone) })) });
    setSel(null);
  };
  const addAgent = () => {
    const agent = AGENT_IDS.find((a) => !t.members.some((m) => m.agent === a)) ?? `agent-${t.members.length + 1}`;
    set({ members: [...t.members, { agent, workflow: "", reports_to: t.members.find((m) => !m.reports_to)?.agent ?? "" }] });
    setSel(agent);
  };
  const used = [...new Set(t.members.map((m) => m.workflow ?? ""))];
  return (
    <div className="team-stage">
      <div className="team-graph">
        <AgentMap nodes={nodes} edges={edges} selected={sel} onSelect={setSel} height={380} label={`Team ${t.name}`}
          groupColor={(g) => workflowColor(info.workflows, g)} groupLabel={(g) => g || "no workflow"} />
        <div className="map-legend">
          {used.map((w) => <span key={w}><i style={{ background: workflowColor(info.workflows, w) }} />{w || "no workflow"}</span>)}
          <span><i className="k-line" />answers to</span><span><i className="k-dash" />hands off</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={addAgent}><Icon.plus /> agent</button>
          {on
            ? <button className="btn sm" onClick={() => act("team_stop", {}, `${t.name} stood down`)}>Stand down</button>
            : <button className="btn sm primary" disabled={dirty || !saved} title={dirty ? "Save first" : "Each agent works in its own workflow"} onClick={() => act("team_start", { name: t.name }, `${t.name} at work`).catch(() => {})}><Icon.play /> Put to work</button>}
        </div>
      </div>
      <aside className="map-inspector">
        {k >= 0 ? <MemberDetail team={t} k={k} info={info} setM={(m) => setM(k, m)} drop={() => drop(k)} close={() => setSel(null)} /> : (
          <>
            <div className="mi-kind">team{on && <span className="tag accent">at work</span>}</div>
            <input className="input mono mi-title" value={t.name} onChange={(e) => set({ name: e.target.value.replace(/[^\w-]/g, "") })} aria-label="Team name" />
            <input className="input" value={t.about ?? ""} onChange={(e) => set({ about: e.target.value })} placeholder="about" aria-label="Team about" />
            <label className="mi-field"><span>team prompt</span>
              <textarea className="input" rows={6} value={t.prompt ?? ""} onChange={(e) => set({ prompt: e.target.value })} placeholder="every member gets this first" aria-label="Team prompt" />
            </label>
            <div className="mi-hint muted">select an agent to edit it</div>
            <div className="row"><span className="spacer" /><button className="btn sm ghost danger" onClick={remove}>Delete team</button></div>
          </>
        )}
      </aside>
    </div>
  );
}

/** An agent's place and prompt, with the instructions kula will hand it. */
function MemberDetail({ team, k, info, setM, drop, close }: { team: Team; k: number; info: AgentsInfo; setM: (m: Partial<Team["members"][number]>) => void; drop: () => void; close: () => void }) {
  const m = team.members[k];
  const others = team.members.filter((_, j) => j !== k).map((x) => x.agent).filter(Boolean);
  const known = AGENT_IDS.includes(m.agent);
  const [preview, setPreview] = useState<string | null>(null);
  const toast = useToast();
  const show = () => api.agentAction<{ text: string }>("team_prompt", { teams: [team], agent: m.agent }).then((r) => setPreview(r.text)).catch((e) => toast(e.message, "err"));
  useEffect(() => { if (preview !== null) show(); }, [JSON.stringify(team)]); // keep an open preview current
  return (
    <>
      <div className="mi-kind"><AgentMark id={m.agent} size={13} /> agent<span className="spacer" /><button className="btn sm ghost icon-only" onClick={close} aria-label="Back to the team"><Icon.close /></button></div>
      <div className="mi-row">
        <select className="input" value={known ? m.agent : "other"} onChange={(e) => setM({ agent: e.target.value === "other" ? "aider" : e.target.value })} aria-label="Agent">
          {AGENT_IDS.map((a) => <option key={a} value={a}>{AGENT_NAME[a]}</option>)}<option value="other">other…</option>
        </select>
        {!known && <input className="input mono" value={m.agent} onChange={(e) => setM({ agent: e.target.value })} aria-label="Agent name" />}
      </div>
      <label className="mi-field"><span>workflow</span>
        <select className="input" value={m.workflow ?? ""} onChange={(e) => setM({ workflow: e.target.value })} aria-label="Workflow" style={{ borderLeft: `3px solid ${workflowColor(info.workflows, m.workflow)}` }}>
          <option value="">none – kula.toml's fences</option>{info.workflows.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
        </select>
      </label>
      <label className="mi-field"><span>role</span><input className="input" value={m.role ?? ""} onChange={(e) => setM({ role: e.target.value })} aria-label="Role" /></label>
      <label className="mi-field"><span>answers to</span>
        <select className="input" value={m.reports_to ?? ""} onChange={(e) => setM({ reports_to: e.target.value })} aria-label="Answers to">
          <option value="">nobody – leads</option>{others.map((o) => <option key={o} value={o}>{AGENT_NAME[o] ?? o}</option>)}
        </select>
      </label>
      <div className="mi-field"><span>hands off to</span>
        <div className="team-hands">
          {others.map((o) => {
            const on = (m.hands_off ?? []).includes(o);
            return <button key={o} className={`chip-toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setM({ hands_off: on ? (m.hands_off ?? []).filter((h) => h !== o) : [...(m.hands_off ?? []), o] })}><AgentMark id={o} size={12} /> {AGENT_NAME[o] ?? o}</button>;
          })}
        </div>
      </div>
      <label className="mi-field"><span>system prompt</span>
        <textarea className="input" rows={5} value={m.prompt ?? ""} onChange={(e) => setM({ prompt: e.target.value })} aria-label="System prompt" />
      </label>
      <div className="row">
        <button className="btn sm ghost" onClick={() => (preview === null ? show() : setPreview(null))}>{preview === null ? "Full instructions" : "Hide"}</button>
        <span className="spacer" /><button className="btn sm ghost danger" onClick={drop}>Remove</button>
      </div>
      {preview !== null && <pre className="code team-preview">{preview}</pre>}
    </>
  );
}

// ------------------------------------------------------------------ fences

function Fences({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void }) {
  const [rules, setRules] = useState<RawRule[]>(info.raw_rules);
  useEffect(() => setRules(info.raw_rules), [info]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(info.raw_rules);
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const set = (i: number, r: Partial<RawRule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const code = useCode();
  const sugg = info.suggestions.filter((s) => s.kind === "guard");
  return (
    <div className="ag-grid">
      <Card title="Fences" sub="kula.toml" className="ag-wide"
        right={<><button className="btn sm ghost" onClick={() => onGraph()}><Icon.graph /> On the graph</button>{dirty && <button className="btn sm ghost" onClick={() => setRules(info.raw_rules)}>Revert</button>}<button className="btn sm primary" disabled={!dirty} onClick={() => act("guards_save", { rules }, "Fences saved to kula.toml").catch(() => {})}>Save</button></>}>
        {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
        <div className="fence-legend">
          {(["locked", "hidden", "review"] as GuardLevel[]).map((l) => <span key={l}><GuardTag level={l} /> {LEVEL_MEANS[l]}</span>)}
        </div>
        {rules.length === 0 && <div className="muted ag-empty">No fences.</div>}
        {rules.map((r, i) => (
          <div key={i} className={`fence-row fr-${r.level}`}>
            <span className="loop-n">{String(i + 1).padStart(2, "0")}</span>
            <select className="input fence-level" value={r.level} onChange={(e) => set(i, { level: e.target.value as RawRule["level"] })} aria-label="Level">
              <option value="locked">locked</option><option value="hidden">hidden</option><option value="review">review</option>
            </select>
            <div className="fence-what">
              <Chips values={r.paths ?? []} onChange={(v) => set(i, { paths: v })} placeholder="paths: migrations/**, src/gen/" label="Paths" />
              <Chips values={r.symbols ?? []} onChange={(v) => set(i, { symbols: v })} placeholder="symbols: charge_card or src/pay.rs:charge" as="name" label="Symbols" />
            </div>
            <input className="input fence-why" value={r.reason ?? ""} onChange={(e) => set(i, { reason: e.target.value })} placeholder="why – agents are told this" aria-label="Reason" />
            <button className="btn sm ghost icon-only danger" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove fence"><Icon.close /></button>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setRules([...rules, { level: "locked", paths: [], symbols: [], reason: "" }])}><Icon.plus /> Add fence</button>
          <span className="spacer" />
          <label className="toggle"><input type="checkbox" checked={info.secrets_hidden} onChange={(e) => act("settings_save", { agents: { hide_secrets: e.target.checked, memory: info.memory_enabled, docs: info.docs_list } }, e.target.checked ? "Secrets hidden from agents" : "Secrets visible to agents")} /> hide likely secrets (.env, keys, certificates)</label>
        </div>
      </Card>
      {info.workflow && info.workflow_rules.length > 0 && (
        <Card title={`From the ${info.workflow.name} workflow`}>
          {info.workflow_rules.map((r, i) => (
            <div key={i} className="ag-rule"><span className="mono muted">w{i + 1}</span><GuardTag level={r.level} /><span className="mono ag-what">{[...r.paths, ...r.symbols].join(", ")}</span></div>
          ))}
        </Card>
      )}
      <Card title="Fenced right now" sub={`${fenced.length} file${fenced.length === 1 ? "" : "s"}`}>
        {fenced.length === 0 && <div className="muted ag-empty">Nothing fenced in the graph.</div>}
        {fenced.slice(0, 40).map((f) => (
          <button key={f.path} className="ag-file" onClick={() => code.open({ path: f.path })} title={`${f.verdict.reason} (${f.verdict.rule})`}>
            <GuardTag level={f.verdict.level} /><span className="mono">{f.path}</span><span className="muted ag-rule-src">{f.verdict.rule}</span>
          </button>
        ))}
        {fenced.length > 40 && <div className="muted ag-meta">and {fenced.length - 40} more – <code>kula guard list</code></div>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ memory

function MemoryTab({ info, act, open }: { info: AgentsInfo; act: Act; open: (t: string) => void }) {
  const [filter, setFilter] = useState<"all" | "stale" | "agents" | "people">("all");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("repo");
  const [text, setText] = useState("");
  const mems = useMemo(() => info.memories
    .filter((m) => filter === "all" || (filter === "stale" ? m.stale : filter === "agents" ? m.author.startsWith("agent:") : !m.author.startsWith("agent:")))
    .filter((m) => !q || `${m.target} ${m.body} ${m.author}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || b.created - a.created), [info, filter, q]);
  const n = (f: typeof filter) => info.memories.filter((m) => f === "all" || (f === "stale" ? m.stale : f === "agents" ? m.author.startsWith("agent:") : !m.author.startsWith("agent:"))).length;
  const remember = () => act("remember", { target, text }, "Remembered – anchored to this code").then(() => setText("")).catch(() => {});
  return (
    <Card title="Memory" sub="refs/kula/meta" className="ag-memory"
      right={<div className="seg">{(["all", "stale", "agents", "people"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f} {n(f)}</button>)}</div>}>
      <form className="ag-remember" onSubmit={(e) => { e.preventDefault(); remember(); }}>
        <div className="stack-tight">
          <CodeField value={target} onChange={setTarget} placeholder="repo · file:path · symbol" label="Memory target" />
          <HereHint onUse={setTarget} />
        </div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="One fact agents should know, e.g. tokens are hashed twice for legacy clients" aria-label="Memory text" />
        <button className="btn sm primary" disabled={!text.trim() || !info.memory_enabled}>Remember</button>
      </form>
      {info.memories.length > 4 && <input className="input ag-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter memories…" aria-label="Filter memories" />}
      {mems.length === 0 && <div className="muted ag-empty">{info.memories.length ? "Nothing matches." : "No memories yet."}</div>}
      {mems.map((m) => <MemoryRow key={m.id} m={m} open={open} act={act} />)}
    </Card>
  );
}

function MemoryRow({ m, open, act }: { m: Memory; open: (t: string) => void; act: Act }) {
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(m.body);
  const [target, setTarget] = useState(m.target);
  useEffect(() => { setBody(m.body); setTarget(m.target); }, [m]);
  const save = () => act("memory_edit", { id: m.id, text: body !== m.body ? body : "", target: target !== m.target ? target : "" }, "Memory updated").then(() => setEdit(false)).catch(() => {});
  return (
    <div className={`ag-mem ${m.stale ? "stale" : ""}`}>
      <div className="row ag-mem-head">
        <span className={`tag ${m.stale ? "yellow" : "green"}`} title={m.stale ? "The code changed after this was written" : "Written about the code as it is"}>{m.stale ? "stale" : "fresh"}</span>
        <button className="ag-target mono" onClick={() => open(m.target)} title="Open">{m.target.replace(/^symbol:/, "")}</button>
        <span className="spacer" />
        <span className="muted ag-meta">#{m.id} · {m.author} · {relTime(m.created)}</span>
        {m.stale
          ? <button className="btn sm" onClick={() => act("confirm", { id: m.id }, "Still true – re-anchored")} title="It still holds: anchor it to the code as it is now">Still true</button>
          : <button className="btn sm ghost" onClick={() => act("memory_stale", { id: m.id }, "Marked stale")} title="Agents will verify it before relying on it">Mark stale</button>}
        <button className="btn sm ghost" onClick={() => setEdit(!edit)} aria-expanded={edit}><Icon.edit /> Edit</button>
        <button className="btn sm ghost danger" onClick={() => { if (confirm("Forget this memory?")) act("forget", { id: m.id }, "Forgotten"); }}>Forget</button>
      </div>
      {edit ? (
        <div className="stack ag-mem-edit">
          <CodeField value={target} onChange={setTarget} placeholder="target" label="Target" />
          <LinkArea value={body} onChange={setBody} onSubmit={save} minHeight={70} label="Memory text" />
          <div className="row"><span className="muted ag-meta">moving it re-anchors to the new target · ⌘↵ saves</span><span className="spacer" /><button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button><button className="btn sm primary" disabled={!body.trim() || (body === m.body && target === m.target)} onClick={save}>Save</button></div>
        </div>
      ) : <div className="ag-mem-body">{m.body}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ docs

function Docs({ info, act }: { info: AgentsInfo; act: Act }) {
  const [sel, setSel] = useState<string>(info.docs[0]?.path ?? "AGENTS.md");
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [brief, setBrief] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const toast = useToast();
  useEffect(() => {
    setText(null);
    api.agentAction<{ text: string }>("doc_read", { path: sel }).then((r) => { setText(r.text); setSaved(r.text); }).catch((e) => toast(e.message, "err"));
  }, [sel, info]);
  const doc = info.docs.find((d) => d.path === sel);
  const state = (d: AgentDoc) => (!d.exists ? ["missing", ""] : d.current ? ["brief current", "green"] : d.synced ? ["brief outdated", "yellow"] : ["no brief", ""]);
  const settings = (docs: string[]) => act("settings_save", { agents: { hide_secrets: info.secrets_hidden, memory: info.memory_enabled, docs } }, "Saved to kula.toml");
  return (
    <div className="docs-split">
      <div className="docs-list">
        <div className="section-title">Read by agents <span className="count">{info.docs.length}</span></div>
        {info.docs.map((d) => (
          <button key={d.path} className={`doc-item ${sel === d.path ? "on" : ""}`} onClick={() => setSel(d.path)}>
            <span className="mono">{d.path}</span>
            <span className={`tag ${state(d)[1]}`}>{state(d)[0]}</span>
            <span className="muted doc-readers">{d.readers}</span>
          </button>
        ))}
        <form className="row doc-add" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) { settings([...info.docs_list, adding.trim()]); setAdding(""); } }}>
          <CodeField value={adding} onChange={setAdding} as="pattern" placeholder="add a doc every agent reads" label="Add a doc" />
          <button className="btn sm" disabled={!adding.trim()}><Icon.plus /></button>
        </form>
        <div className="section-title">Settings</div>
        <label className="toggle"><input type="checkbox" checked={info.memory_enabled} onChange={(e) => act("settings_save", { agents: { hide_secrets: info.secrets_hidden, memory: e.target.checked, docs: info.docs_list } }, e.target.checked ? "Agent memory on" : "Agent memory off")} /> agents may keep memories</label>
        <label className="toggle"><input type="checkbox" checked={info.secrets_hidden} onChange={(e) => act("settings_save", { agents: { hide_secrets: e.target.checked, memory: info.memory_enabled, docs: info.docs_list } }, "Saved")} /> hide likely secrets</label>
        <div className="section-title">Brief</div>
        <div className="row"><button className="btn sm primary" onClick={() => act("docs_sync", {}, "Brief synced into the instruction files")}>Sync brief</button><button className="btn sm ghost" onClick={() => api.agentAction<{ text: string }>("brief").then((r) => setBrief(r.text))}>Preview</button></div>
      </div>
      <section className="card docs-edit">
        <div className="card-head">
          <h2 className="mono">{sel}</h2>{doc && <span className="muted">{doc.readers}</span>}<span className="spacer" />
          {info.docs_list.includes(sel) && <button className="btn sm ghost" onClick={() => settings(info.docs_list.filter((d) => d !== sel))}>Stop pointing agents here</button>}
          {text !== null && text !== saved && <button className="btn sm ghost" onClick={() => setText(saved)}>Revert</button>}
          <button className="btn sm primary" disabled={text === null || text === saved} onClick={() => act("doc_save", { path: sel, text }, `Saved ${sel}`).then(() => setSaved(text ?? "")).catch(() => {})}>Save</button>
        </div>
        {brief !== null && (
          <div className="brief-preview">
            <div className="row"><span className="eyebrow">generated brief</span><span className="spacer" /><button className="btn sm ghost" onClick={() => setBrief(null)} aria-label="Close preview"><Icon.close /></button></div>
            <pre className="code">{brief}</pre>
          </div>
        )}
        {text === null ? <div className="muted ag-empty">Loading…</div> : (
          <LinkArea value={text} onChange={setText} className="doc-text" placeholder={doc?.exists ? "" : `${sel} does not exist yet – write it, or Sync brief to start it.`} label={`Edit ${sel}`}
            onSubmit={() => act("doc_save", { path: sel, text }, `Saved ${sel}`).then(() => setSaved(text)).catch(() => {})} />
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ connect

const WIRING: Record<string, { mcp: string; hook: string }> = {
  claude: { mcp: ".mcp.json", hook: "PreToolUse: Edit, Write, Read and Bash" },
  cursor: { mcp: ".cursor/mcp.json", hook: "preToolUse, beforeReadFile, beforeShellExecution" },
  codex: { mcp: ".codex/config.toml [mcp_servers.kula]", hook: "PreToolUse: apply_patch and shell" },
  gemini: { mcp: ".gemini/settings.json mcpServers", hook: "BeforeTool: file tools and run_shell_command" },
};

function Connect({ info, act }: { info: AgentsInfo; act: Act }) {
  const hooks = info.git_hooks ?? [];
  const pre = hooks.find(([h]) => h === "pre-commit")?.[1];
  const reindex = hooks.filter(([h, on]) => h !== "pre-commit" && on).length;
  const brief = info.docs.find((d) => d.path === "AGENTS.md");
  return (
    <div className="ag-grid">
      <Card title="Harnesses" className="ag-wide"
        right={<button className="btn sm" onClick={async () => { for (const c of info.connections) if (!(c.mcp && c.hook)) await act("connect", { agent: c.id }, "").catch(() => {}); }}><Icon.plug /> Connect all</button>}>
        <div className="conn-grid">
          {info.connections.map((c) => (
            <div key={c.id} className={`conn ${c.mcp && c.hook ? "ok" : ""}`}>
              <div className="row conn-title">
                <a className="conn-brand" href={c.docs} target="_blank" rel="noreferrer" title={`${c.name} docs`}><Mark id={c.id} size={22} /><b>{c.name}</b></a>
                <span className="spacer" /><span className={`dot ${c.mcp && c.hook ? "ok" : c.mcp || c.hook ? "warn" : ""}`} title={c.mcp && c.hook ? "connected" : "not connected"} />
              </div>
              <ul className="conn-wires">
                <li className={c.mcp ? "on" : ""}><span>{c.mcp ? "✓" : "·"}</span><b>MCP</b><span className="mono muted">{WIRING[c.id]?.mcp}</span></li>
                <li className={c.hook ? "on" : ""}><span>{c.hook ? "✓" : "·"}</span><b>fence hook</b><span className="muted">{WIRING[c.id]?.hook}</span></li>
                <li className={c.workflows.length ? "on" : ""}><span>{c.workflows.length ? "✓" : "·"}</span><b>workflows</b><span className="muted">{c.workflows.length ? c.workflows.join(" · ") : c.id === "codex" ? "reads AGENTS.md" : "install from Workflows"}</span></li>
                <li className={brief?.current ? "on" : ""}><span>{brief?.current ? "✓" : "·"}</span><b>brief</b><span className="muted">{c.id === "claude" ? "CLAUDE.md / AGENTS.md" : c.id === "gemini" ? "GEMINI.md / AGENTS.md" : "AGENTS.md"}</span></li>
              </ul>
              <div className="row">
                <a className="btn sm ghost" href={c.docs} target="_blank" rel="noreferrer">docs <Icon.arrow /></a><span className="spacer" />
                <button className={`btn sm ${c.mcp && c.hook ? "ghost" : "primary"}`} onClick={() => act("connect", { agent: c.id }, `${c.name} connected`).catch(() => {})}>{c.mcp && c.hook ? "Rewrite" : "Connect"}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Enforced everywhere" className="ag-wide">
        <div className="mod-grid">
          <Module id="mcp" name="MCP server" on what={<><code>kula mcp</code> – the graph, fences, memory and research as 23 tools, for any MCP client</>} />
          <Module id="git" name="git hooks" on={!!pre} what={<>pre-commit refuses an agent's commit of fenced changes{reindex ? `; ${reindex} more keep the graph current` : ""}</>}
            action={!pre ? <button className="btn sm primary" onClick={() => act("hooks_install", {}, "git hooks installed").catch(() => {})}>Install</button> : undefined} />
          <Module id="githubactions" name="CI gate" on={!!info.ci} what={info.ci ? <><code>{info.ci}</code> runs <code>kula check</code> on every pull request</> : <>add it with <code>kula init --ci github</code></>} />
          <Module icon={<Icon.shield />} name="kula run" on what={<>any other harness – Aider, OpenCode, Goose, a script: <code>kula run -w fix -- aider</code> holds fenced files and puts back what it changed</>} docs="https://github.com/A12N4V/kula/blob/main/docs/AGENTS.md" />
          <Module icon={<Icon.doc />} name="AGENTS.md" on={!!brief?.current} what={<>the brief: tools, fences, workflows and teams, for agents that read instructions</>} docs="https://agents.md" />
          <Module id="rdf" name="RDF · SPARQL" on what={<>the graph as W3C RDF: <code>sparql</code> for any structural question</>} />
        </div>
      </Card>

      <Card title="Tools">
        {TOOLS.map(([t, d]) => <div key={t} className="ag-tool"><span className="mono">{t}</span><span className="muted">{d}</span></div>)}
      </Card>
      <Card title="Any other agent" sub="MCP, or the shell">
        <Snippet text={MCP} />
        <Snippet text={`kula run -w refactor -- opencode   # fenced for the run
kula workflow prompt refactor       # the workflow, for a system prompt
kula verify                         # after the edit`} />
      </Card>
    </div>
  );
}

/** One piece of kula's enforcement: its mark opens its docs. */
function Module({ id, icon, name, on, what, action, docs }: { id?: string; icon?: ReactNode; name: string; on: boolean; what: ReactNode; action?: ReactNode; docs?: string }) {
  const href = docs ?? (id ? BRANDS[id]?.docs : undefined);
  return (
    <div className={`mod ${on ? "on" : ""}`}>
      <a className="mod-mark" href={href} target="_blank" rel="noreferrer" title={href ? `${name} docs` : name}>{id ? <Mark id={id} size={20} /> : icon}</a>
      <div className="mod-body">
        <div className="row"><a className="mod-name" href={href} target="_blank" rel="noreferrer">{name}</a><span className={`dot ${on ? "ok" : ""}`} /><span className="spacer" />{action}</div>
        <div className="muted">{what}</div>
      </div>
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
