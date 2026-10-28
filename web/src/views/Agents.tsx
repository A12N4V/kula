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
import MemoryTab from "./agents/Memory";
import Docs from "./agents/Docs";
import SkillIndex, { Instructions, useSkillIndex } from "./agents/SkillIndex";
import Skills from "./agents/Skills";
import Settings, { ImportSkill } from "./agents/Settings";

// A menu, not a dashboard: configure first – the agents, their teams, the
// skills and docs they load, memory, and the settings that wire it together –
// then what agents have done. Each entry opens a listing on the right.
// Seven icon tabs, no overflow: instructions live in Docs, fences in Teams
// (U18), Connect is a Settings section. Old links still land:
//  #agents/instructions → Docs, #agents/fences → Teams' limits,
//  #agents/connect → Settings, #agents/overview → the Agents list.
const TABS = [
  { id: "workflows", label: "Agents", icon: Icon.workflow, hint: "Work modes: role, scope, steps" },
  { id: "teams", label: "Teams", icon: Icon.team, hint: "Agents that work together" },
  { id: "research", label: "Research", icon: Icon.flask, hint: "Research loops" },
  { id: "skills", label: "Skills", icon: Icon.box, hint: "Every SKILL.md an agent loads" },
  { id: "memory", label: "Memory", icon: Icon.memory, hint: "What agents remember" },
  { id: "docs", label: "Docs", icon: Icon.doc, hint: "Docs and instruction files" },
  { id: "settings", label: "Settings", icon: Icon.gear, hint: "Memory, secrets, wiring, default agent" },
] as const;
type Tab = (typeof TABS)[number]["id"];
// Retired tab ids still arrive in the URL hash – never a dead link.
const RETIRED: Record<string, Tab> = { instructions: "docs", fences: "teams", connect: "settings", overview: "workflows" };
const isTab = (t: string | undefined): t is Tab => TABS.some((x) => x.id === t);
const routeTab = (t: string | undefined): Tab => (isTab(t) ? t : RETIRED[t ?? ""] ?? "workflows");

export { LEVEL_TEXT, LEVEL_MEANS, GuardTag, Snippet };

export default function Agents({ version, onChanged, openSymbol, go, target }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(() => routeTab(target?.tab));
  const toast = useToast();
  const sx = useSkillIndex(version);
  const code = useCode();
  const load = () => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]);
  // The URL is the tab: back and forward move between them.
  // The URL is the tab: back and forward move between them. Retired tab ids
  // (instructions, fences, connect, overview) route to their new home – and
  // the address follows through the one hash writer in App, so an old link
  // keeps working and lands where the menu can see it.
  useEffect(() => {
    const raw = target?.tab;
    // A retired id redirects through `go` so the address follows; a real tab
    // (or none – the bare `#agents` default) just sets the strip.
    if (raw && RETIRED[raw]) { go?.("agents", { tab: RETIRED[raw] }); return; }
    setTabState(routeTab(raw));
  }, [target?.tab]);
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
  // Fences moved into Teams (U18), so guard suggestions count on Teams.
  const badge: Partial<Record<Tab, number>> = { memory: stale, docs: outdated, teams: info.suggestions.filter((s) => s.kind === "guard").length, workflows: info.suggestions.filter((s) => s.kind === "workflow").length, skills: (info.skills ?? []).filter((s) => Object.values(s.targets).some((t) => t === "missing" || t === "differs")).length + (info.skill_strays?.length ?? 0) };

  const counts: Partial<Record<Tab, number>> = { workflows: info.workflows.length, teams: info.teams?.length, skills: sx.ix?.skills.length, docs: (sx.ix?.instructions.length ?? 0) + outdated };
  const cur = TABS.find((t) => t.id === tab)!;
  // One menu: the app rail picks Agents, this horizontal strip picks the
  // section. Teams and Memory are canvases, so they take the whole view.
  const full = tab === "teams";
  return (
    <div className={`agents ag-page ${full ? "ag-full" : ""}`}>
      <nav className="ag-tabs" role="tablist" aria-label="Agents" aria-orientation="horizontal" data-testid="ag-tabs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} aria-label={t.label} className={`ag-mi ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} title={t.hint}>
            <t.icon /><span className="ag-mi-label">{t.label}</span>
            {!!badge[t.id] ? <span className="badge">{badge[t.id]}</span> : counts[t.id] != null && <span className="ag-mi-n">{counts[t.id]}</span>}
          </button>
        ))}
        <span className="grow" />
        <button className="ag-mi" onClick={() => onWorkspace()} title="Open the Workspace – where these agents work" aria-label="Open Workspace" data-testid="ag-to-workspace"><Icon.workspace /><span className="ag-mi-label">Workspace</span></button>
      </nav>
      <div className="detail">
        <div className={`ag-detail ${full ? "" : "detail-pad"}`}>
          {!full && <header className="page-head">
            <div><h1>{cur.label}</h1><div className="muted">{cur.hint}</div></div>
          </header>}
          <div className="ag-panel" key={tab}>
            {/* Overview lost its menu entry – its roster and stats live here,
                under the Agents list, so nothing the agents page knew is gone. */}
            {tab === "workflows" && <Workflows info={info} act={act} onGraph={onGraph} setTab={setTab} />}
            {tab === "workflows" && <Overview info={info} act={act} setTab={setTab} onGraph={onGraph} open={open} />}
            {tab === "research" && <ResearchTab info={info} act={act} open={open} go={go} />}
            {tab === "teams" && <Teams info={info} act={act} setTab={setTab} />}
            {tab === "skills" && <>
              <SkillIndex ix={sx.ix} err={sx.err} act={act} shared={(info.skills ?? []).map((x) => x.name)} />
              <details className="sx-more"><summary>Copies per agent, MCP and memory layers</summary><Skills info={info} act={act} open={open} /></details>
              <ImportSkill info={info} act={act} />
            </>}
            {tab === "settings" && <Settings info={info} act={act} setTab={setTab} />}
            {tab === "memory" && <MemoryTab info={info} act={act} open={open} />}
            {tab === "docs" && <Docs info={info} act={act} more={[...new Set((sx.ix?.instructions ?? []).map((i) => i.path))]} instructions={<Instructions ix={sx.ix} err={sx.err} />} />}
          </div>
        </div>
      </div>
    </div>
  );
}
