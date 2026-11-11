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
import SkillIndex, { Instructions, useSkillIndex } from "./agents/SkillIndex";
import { Grip, listWidth } from "../resize";

// A menu, not a dashboard: configure first – the agents, their teams, the
// skills and instruction files they load, fences, wiring and settings – then
// what agents have done. Each entry opens a listing on the right.
const TABS = [
  { id: "workflows", label: "Agents", icon: Icon.workflow, group: "Configure", hint: "Work modes: role, scope, steps" },
  { id: "teams", label: "Teams", icon: Icon.team, group: "Configure", hint: "Agents that work together" },
  { id: "skills", label: "Skills", icon: Icon.box, group: "Configure", hint: "Every SKILL.md an agent loads" },
  { id: "instructions", label: "Instructions", icon: Icon.doc, group: "Configure", hint: "CLAUDE.md, AGENTS.md, GEMINI.md" },
  { id: "fences", label: "Fences", icon: Icon.fence, group: "Configure", hint: "What agents may not touch" },
  { id: "connect", label: "Connect", icon: Icon.plug, group: "Configure", hint: "MCP and hooks per agent" },
  { id: "settings", label: "Settings", icon: Icon.gear, group: "Configure", hint: "Memory, secrets, default agent" },
  { id: "overview", label: "Overview", icon: Icon.agents, group: "Activity", hint: "The task and the roster" },
  { id: "research", label: "Research", icon: Icon.flask, group: "Activity", hint: "Research loops" },
  { id: "memory", label: "Memory", icon: Icon.memory, group: "Activity", hint: "What agents remember" },
  { id: "docs", label: "Docs", icon: Icon.doc, group: "Activity", hint: "Docs agents read" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export { LEVEL_TEXT, LEVEL_MEANS, GuardTag, Snippet };

export default function Agents({ version, onChanged, openSymbol, go, target }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(() => (TABS.some((t) => t.id === target?.tab) ? target!.tab : "workflows") as Tab);
  const toast = useToast();
  const sx = useSkillIndex(version);
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

  const counts: Partial<Record<Tab, number>> = { workflows: info.workflows.length, teams: info.teams?.length, skills: sx.ix?.skills.length, instructions: sx.ix?.instructions.length };
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <div className="split agents ag-split" style={listWidth("agents", 260)}>
      <div className="list ag-menu">
        <div className="list-head"><h2>Agents</h2><span className="spacer" />
          <button className="btn sm ghost icon-only" onClick={() => onWorkspace()} title="Open the Workspace – where these agents work" aria-label="Open Workspace" data-testid="ag-to-workspace"><Icon.workspace /></button>
        </div>
        <nav className="ag-tabs" role="tablist" aria-label="Agents" aria-orientation="vertical">
          {TABS.map((t, i) => (
            <span key={t.id} className="ag-tab-wrap">
              {(i === 0 || TABS[i - 1].group !== t.group) && <div className="ag-group" aria-hidden="true">{t.group}</div>}
              <button role="tab" aria-selected={tab === t.id} aria-label={t.label} className={`ag-mi ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} title={t.hint}>
                <t.icon /><span className="ag-mi-label">{t.label}</span>
                {!!badge[t.id] ? <span className="badge">{badge[t.id]}</span> : counts[t.id] != null && <span className="ag-mi-n">{counts[t.id]}</span>}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <Grip id="agents" edge="right" target="prev" min={200} max={420} label="Resize menu" />
      <div className="detail">
        <div className="detail-pad ag-detail">
          <header className="page-head">
            <div><h1>{cur.label}</h1><div className="muted">{cur.hint}</div></div>
            {tab === "workflows" && <button className="btn sm" onClick={() => onWorkspace()}><Icon.workspace /> Open Workspace</button>}
          </header>
          <div className="ag-panel" key={tab}>
            {tab === "overview" && <Overview info={info} act={act} setTab={setTab} onGraph={onGraph} open={open} />}
            {tab === "workflows" && <Workflows info={info} act={act} onGraph={onGraph} setTab={setTab} onWorkspace={onWorkspace} />}
            {tab === "research" && <ResearchTab info={info} act={act} open={open} go={go} />}
            {tab === "teams" && <Teams info={info} act={act} setTab={setTab} />}
            {tab === "skills" && <>
              <SkillIndex ix={sx.ix} err={sx.err} act={act} shared={(info.skills ?? []).map((x) => x.name)} />
              <details className="sx-more"><summary>Copies per agent, MCP and memory layers</summary><Skills info={info} act={act} open={open} /></details>
              <ImportSkill info={info} act={act} />
            </>}
            {tab === "instructions" && <Instructions ix={sx.ix} err={sx.err} />}
            {tab === "settings" && <Settings info={info} act={act} setTab={setTab} />}
            {tab === "fences" && <Fences info={info} act={act} onGraph={onGraph} />}
            {tab === "memory" && <MemoryTab info={info} act={act} open={open} />}
            {tab === "docs" && <Docs info={info} act={act} />}
            {tab === "connect" && <Connect info={info} act={act} />}
          </div>
        </div>
      </div>
    </div>
  );
}
