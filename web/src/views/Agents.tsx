// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime, type AgentDoc, type AgentsInfo, type GuardLevel, type Memory, type RawRule, type Suggestion, type Workflow } from "../api";
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

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs"];
const TABS = [
  { id: "overview", label: "Overview", icon: Icon.agents },
  { id: "workflows", label: "Workflows", icon: Icon.workflow },
  { id: "fences", label: "Fences", icon: Icon.fence },
  { id: "memory", label: "Memory", icon: Icon.memory },
  { id: "docs", label: "Docs", icon: Icon.doc },
  { id: "connect", label: "Connect", icon: Icon.plug },
] as const;
type Tab = (typeof TABS)[number]["id"];

const TOOLS: [string, string][] = [
  ["workflows", "how this kind of work is done here: steps, docs, fences"],
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
  { tool: "edit", what: "the hook checks fences", gate: true },
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
  const connected = info.connections.filter((c) => c.mcp && c.hook).length;
  const badge: Partial<Record<Tab, number>> = { memory: stale, docs: outdated, fences: info.suggestions.filter((s) => s.kind === "guard").length, workflows: info.suggestions.filter((s) => s.kind === "workflow").length };

  return (
    <div className="page agents">
      <header className="page-head">
        <div>
          <div className="eyebrow">for AI agents</div>
          <h1>Agents</h1>
          <p className="muted">How agents work in this repository: the workflow they follow, the code they may not touch, what they remember. Edits here write kula.toml, AGENTS.md and git – the CLI, MCP, the pre-edit hook and CI all read the same thing.</p>
        </div>
        <div className="ag-status">
          <Status ok={connected > 0} label={`${connected}/${info.connections.length} agents connected`} onClick={() => setTab("connect")} />
          <Status ok={info.secrets_hidden} label="secrets hidden" onClick={() => setTab("fences")} />
          <Status ok={info.memory_enabled} label="memory on" onClick={() => setTab("docs")} />
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
        {tab === "fences" && <Fences info={info} act={act} onGraph={onGraph} />}
        {tab === "memory" && <MemoryTab info={info} act={act} open={open} />}
        {tab === "docs" && <Docs info={info} act={act} />}
        {tab === "connect" && <Connect info={info} act={act} />}
      </div>
    </div>
  );
}

type Act = (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => Promise<unknown>;

function Status({ ok, label, onClick }: { ok: boolean; label: string; onClick?: () => void }) {
  return <button className={`ag-st ${ok ? "ok" : ""}`} onClick={onClick}><i className={`dot ${ok ? "ok" : ""}`} />{label}</button>;
}

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
        <Card title={info.task ? "Now" : "Start a task"} sub={info.task ? `started ${relTime(info.task.started)} by ${info.task.by}` : "agents follow its workflow and stay in its scope"} className="ag-now">
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

        <Card title="Needs you" sub="what agents left for a person" className="ag-needs">
          {info.suggestions.length === 0 && stale.length === 0 && info.docs.every((d) => d.current || !d.synced) && info.connections.some((c) => c.mcp) ? (
            <div className="muted ag-empty">Nothing waiting. Agents propose fences and workflows with the <code>suggest</code> tool; they land here.</div>
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

        <Card title="Workflows" sub="work modes, each with its own fences" right={<button className="btn sm ghost" onClick={() => setTab("workflows")}>Edit <Icon.arrow /></button>} className="ag-wide">
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
      <div className="row"><b className="mono">{w.name}</b>{active && <span className="tag accent">active</span>}<span className="spacer" />{w.builtin ? <span className="muted wf-src">built in</span> : <span className="muted wf-src">kula.toml</span>}</div>
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
            <div className="row wf-actions">
              {!isNew && (BUILTIN.includes(orig!) ? !cur?.builtin : true) && <button className="btn sm ghost danger" onClick={remove}>{BUILTIN.includes(orig!) ? "Reset to built-in" : "Delete"}</button>}
              <span className="spacer" />
              {!isNew && !dirty && !info.task && <StartIn wf={orig!} act={act} />}
              <button className="btn sm primary" disabled={!draft.name || (!dirty && !isNew)} onClick={save}>{isNew ? "Create" : "Save"}</button>
            </div>
          </div>
        </section>
      ) : <Empty title="Pick a workflow">Or create one: a name, the fences it brings, the steps an agent follows.</Empty>}
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
      <Card title="Fences" sub="kula.toml · shared with the team" className="ag-wide"
        right={<><button className="btn sm ghost" onClick={() => onGraph()}><Icon.graph /> On the graph</button>{dirty && <button className="btn sm ghost" onClick={() => setRules(info.raw_rules)}>Revert</button>}<button className="btn sm primary" disabled={!dirty} onClick={() => act("guards_save", { rules }, "Fences saved to kula.toml").catch(() => {})}>Save</button></>}>
        {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
        <div className="fence-legend">
          {(["locked", "hidden", "review"] as GuardLevel[]).map((l) => <span key={l}><GuardTag level={l} /> {LEVEL_MEANS[l]}</span>)}
        </div>
        {rules.length === 0 && <div className="muted ag-empty">No fences yet{info.secrets_hidden ? " – likely secrets are still hidden from agents" : ""}. Add one for generated code, migrations, vendored code or anything a person must sign off.</div>}
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
        <Card title={`From the ${info.workflow.name} workflow`} sub="while the task is open">
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
    <Card title="Memory" sub="pinned to code · stored in refs/kula/meta · stale when the code changes" className="ag-memory"
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
      {mems.length === 0 && <div className="muted ag-empty">{info.memories.length ? "Nothing matches." : "No memories yet. Agents add them with the `remember` tool; so can you."}</div>}
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
        <p className="muted ag-meta">kula writes a block into AGENTS.md (and CLAUDE.md, GEMINI.md when present) naming its tools, your fences and workflows – so agents without MCP still know the rules.</p>
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

const BLURB: Record<string, string> = {
  claude: "MCP in .mcp.json; a PreToolUse hook blocks fenced edits and reads.",
  cursor: "MCP in .cursor/mcp.json; preToolUse and beforeReadFile hooks.",
  codex: "[mcp_servers.kula] in .codex/config.toml; a PreToolUse hook reads apply_patch.",
  gemini: "mcpServers and a BeforeTool hook in .gemini/settings.json.",
};

function Connect({ info, act }: { info: AgentsInfo; act: Act }) {
  return (
    <div className="ag-grid">
      <Card title="Agents" sub="one command each – or kula agents connect all" className="ag-wide"
        right={<button className="btn sm" onClick={async () => { for (const c of info.connections) if (!(c.mcp && c.hook)) await act("connect", { agent: c.id }, "").catch(() => {}); }}><Icon.plug /> Connect all</button>}>
        <div className="conn-grid">
          {info.connections.map((c) => (
            <div key={c.id} className={`conn ${c.mcp && c.hook ? "ok" : ""}`}>
              <div className="row"><b>{c.name}</b><span className="spacer" /><span className={`dot ${c.mcp && c.hook ? "ok" : c.mcp || c.hook ? "warn" : ""}`} /></div>
              <div className="conn-checks"><span className={c.mcp ? "on" : ""}>{c.mcp ? "✓" : "·"} graph tools (MCP)</span><span className={c.hook ? "on" : ""}>{c.hook ? "✓" : "·"} fence hook</span></div>
              <p className="muted">{BLURB[c.id]}</p>
              <div className="mono muted conn-files">{c.files.join(" · ")}</div>
              <div className="row"><span className="spacer" />
                <button className={`btn sm ${c.mcp && c.hook ? "ghost" : "primary"}`} onClick={() => act("connect", { agent: c.id }, `${c.name} connected`).catch(() => {})}>{c.mcp && c.hook ? "Rewrite" : "Connect"}</button></div>
            </div>
          ))}
          <div className="conn other">
            <div className="row"><b>Any other agent</b></div>
            <p className="muted">Anything that speaks MCP – Windsurf, Zed, Copilot, Continue, Cline, Goose, Amp – runs <code>kula mcp</code>. Agents without MCP read the brief in AGENTS.md and use the shell; <code>kula check</code> in CI catches fenced edits either way.</p>
            <Snippet text={MCP} />
          </div>
        </div>
      </Card>
      <Card title="Tools" sub="what a connected agent can call">
        {TOOLS.map(([t, d]) => <div key={t} className="ag-tool"><span className="mono">{t}</span><span className="muted">{d}</span></div>)}
      </Card>
      <Card title="From the shell" sub="the same answers, for agents without MCP">
        <Snippet text={`kula workflow show refactor     # steps, docs, fences
kula task start "split auth" -w refactor
kula pack "how does login work"
kula before login               # callers, tests, risk, fences
kula verify                     # after the edit
kula memory recall login`} />
      </Card>
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
