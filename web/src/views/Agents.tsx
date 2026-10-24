// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Thin composition of the agents tabs (module S1): one file per tab in
// agents/, shared pieces in agents/parts, shared data plumbing in agents/data.

import { useEffect, useState } from "react";
import { api, type AgentsInfo } from "../api";
import { Empty, Icon, useToast } from "../ui";
import { useCode } from "../CodePanel";
import type { Nav } from "./agents/data";
import { LEVEL_TEXT, LEVEL_MEANS, GuardTag, Snippet } from "./agents/parts";
import Overview from "./agents/Overview";
import Workflows from "./agents/Workflows";
import ResearchTab from "./agents/Research";
import Teams from "./agents/Teams";
import Fences from "./agents/Fences";
import MemoryTab from "./agents/Memory";
import Docs from "./agents/Docs";
import Connect from "./agents/Connect";
import Skills from "./agents/Skills";
import Settings, { ImportSkill } from "./agents/Settings";

// Configure first – what an agent is, which team it sits in, the skills it
// has, its fences, wiring and settings. What agents have done (overview,
// research runs, memory, docs) follows as compact icon tabs.
const TABS = [
  { id: "workflows", label: "Agents", icon: Icon.workflow },
  { id: "teams", label: "Teams", icon: Icon.team },
  { id: "skills", label: "Skills", icon: Icon.box },
  { id: "fences", label: "Fences", icon: Icon.fence },
  { id: "connect", label: "Connect", icon: Icon.plug },
  { id: "settings", label: "Settings", icon: Icon.gear },
  { id: "overview", label: "Overview", icon: Icon.agents, compact: true },
  { id: "research", label: "Research", icon: Icon.flask, compact: true },
  { id: "memory", label: "Memory", icon: Icon.memory, compact: true },
  { id: "docs", label: "Docs", icon: Icon.doc, compact: true },
] as const;
type Tab = (typeof TABS)[number]["id"];

export { LEVEL_TEXT, LEVEL_MEANS, GuardTag, Snippet };

export default function Agents({ version, onChanged, openSymbol, go, target }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(() => (TABS.some((t) => t.id === target?.tab) ? target!.tab : "workflows") as Tab);
  const toast = useToast();
  const code = useCode();
  const load = () => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]);
  // The URL is the tab: back and forward move between them.
  useEffect(() => { setTabState((TABS.some((t) => t.id === target?.tab) ? target!.tab : "workflows") as Tab); }, [target?.tab]);
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
  const onWorkspace = (agent?: string) => go?.("map", agent ? { agent } : {});

  if (err) return <div className="page"><Empty title="Agent state unavailable">{err}</Empty></div>;
  if (!info) return <div className="page"><div className="muted">Reading workflows, fences and memories…</div></div>;
  const stale = info.memories.filter((m) => m.stale).length;
  const outdated = info.docs.filter((d) => d.synced && !d.current).length;
  const badge: Partial<Record<Tab, number>> = { memory: stale, docs: outdated, fences: info.suggestions.filter((s) => s.kind === "guard").length, workflows: info.suggestions.filter((s) => s.kind === "workflow").length, skills: (info.skills ?? []).filter((s) => Object.values(s.targets).some((t) => t === "missing" || t === "differs")).length + (info.skill_strays?.length ?? 0) };

  return (
    <div className="page agents">
      <header className="page-head">
        <div>
          <h1>Agents</h1>
          <div className="muted">Configure agents, teams and skills here – the Workspace puts them to work.</div>
        </div>
        <button className="btn sm" onClick={() => onWorkspace()} data-testid="ag-to-workspace"><Icon.workspace /> Open Workspace</button>
      </header>

      <nav className="ag-tabs" role="tablist" aria-label="Agents">
        {TABS.map((t, i) => {
          const compact = "compact" in t;
          return (<span key={t.id} className="ag-tab-wrap">
            {compact && !("compact" in TABS[i - 1]) && <span className="ag-tabs-sep" aria-hidden="true" />}
            <button role="tab" aria-selected={tab === t.id} aria-label={compact ? t.label : undefined} title={compact ? t.label : undefined} className={`${tab === t.id ? "on" : ""}${compact ? " compact" : ""}`} onClick={() => setTab(t.id)}>
              <t.icon />{!compact && <> {t.label}</>}{!!badge[t.id] && <span className="badge">{badge[t.id]}</span>}
            </button>
          </span>);
        })}
      </nav>

      <div className="ag-panel" key={tab}>
        {tab === "overview" && <Overview info={info} act={act} setTab={setTab} onGraph={onGraph} open={open} />}
        {tab === "workflows" && <Workflows info={info} act={act} onGraph={onGraph} setTab={setTab} onWorkspace={onWorkspace} />}
        {tab === "research" && <ResearchTab info={info} act={act} open={open} go={go} />}
        {tab === "teams" && <Teams info={info} act={act} setTab={setTab} />}
        {tab === "skills" && <><Skills info={info} act={act} open={open} /><ImportSkill info={info} act={act} /></>}
        {tab === "settings" && <Settings info={info} act={act} setTab={setTab} />}
        {tab === "fences" && <Fences info={info} act={act} onGraph={onGraph} />}
        {tab === "memory" && <MemoryTab info={info} act={act} open={open} />}
        {tab === "docs" && <Docs info={info} act={act} />}
        {tab === "connect" && <Connect info={info} act={act} />}
      </div>
    </div>
  );
}
