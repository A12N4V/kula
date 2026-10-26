// Settings tab – every agent-wide switch in one place: the [agents] policy in
// kula.toml (memory, secrets, the default agent), wiring and Connect (the old
// Connect tab, now a section: MCP, hooks and the enforcement points), and
// skill imports – a SKILL.md from disk or a paste, or a skill an agent already
// keeps in its own folder. Every change writes the same files the CLI does,
// so the Workspace picks it up at once. One 8px rhythm: rows are 8px apart,
// the label column is aligned, sections are grouped.

import { useEffect, useState } from "react";
import type { AgentsInfo } from "../../api";
import { api, type Scope } from "../../api";
import { Dropdown } from "../../ui/Dropdown";
import { Icon, IconToggle } from "../../ui";
import { GhMark } from "./SkillIndex";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark, Card } from "./parts";
import { Chips } from "../../Autofill";
import Connect from "./Connect";

/** name/description from a SKILL.md's front matter; the rest is the body. */
export function parseSkill(src: string, fallback = ""): { name: string; description: string; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(src);
  const meta = m ? m[1] : "";
  const field = (k: string) => (new RegExp(`^${k}:\\s*["']?(.*?)["']?\\s*$`, "m").exec(meta)?.[1] ?? "");
  const name = (field("name") || fallback).toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return { name, description: field("description"), body: (m ? m[2] : src).trim() };
}

export function ImportSkill({ info, act, setTab }: { info: AgentsInfo; act: Act; setTab?: (t: "skills") => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const strays = info.skill_strays ?? [];
  const parsed = parseSkill(text, file.replace(/\.(md|mdc)$/i, "").replace(/^SKILL$/i, ""));
  const save = () => act("skill_save", { name: parsed.name, description: parsed.description, text: parsed.body }, `Imported ${parsed.name}`).then(() => { setText(""); setFile(""); }).catch(() => {});
  return (
    <Card title="Import a skill" sub="SKILL.md → .agents/skills, copied to every agent" className="ag-wide set-import">
      {strays.length > 0 && <>
        <div className="section-title">Found in an agent's own folder <span className="count">{strays.length}</span></div>
        {strays.map((s) => (
          <div key={`${s.agent}:${s.name}`} className="ags-row">
            <AgentMark id={s.agent} /><span className="mono">{s.name}</span><span className="muted ags-desc" title={s.path}>{s.description || s.path}</span><span className="spacer" />
            <button className="btn sm" onClick={() => act("skill_adopt", { agent: s.agent, name: s.name }, `${s.name} is shared now`).catch(() => {})}>Share</button>
          </div>
        ))}
      </>}
      {/* Masked: the paste/file importer is one disclosure away; the first
          answer for a new skill is the Skills tab's GitHub search. */}
      <details className="set-import-more" data-testid="set-import-more">
        <summary><Icon.plus /> Paste or upload a SKILL.md <span className="muted">– or search GitHub in Skills</span></summary>
        <div className="row set-import-src">
          {setTab && <button className="btn sm ghost" onClick={() => { try { sessionStorage.setItem("kula.x10.gh", "1"); } catch { /* private mode */ } setTab("skills"); }} data-testid="set-import-github" aria-label="Search GitHub for skills"><GhMark /> Search GitHub</button>}
          <label className="btn sm" data-testid="set-skill-file"><Icon.doc /> From file
            <input type="file" accept=".md,.mdc,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile(f.name); setText(await f.text()); } e.target.value = ""; }} />
          </label>
        </div>
        <textarea className="input mono set-import-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"---\nname: code-review\ndescription: Review a change before it merges\n---\n1. Read the diff…"} aria-label="Skill source" data-testid="set-skill-text" />
        <div className="row">
          {text.trim() && <span className="muted">{parsed.name ? <>as <b className="mono">{parsed.name}</b>{parsed.description && <> – {parsed.description}</>}</> : "add a name: line to the front matter"}</span>}
          <span className="spacer" />
          <button className="btn sm primary" disabled={!parsed.name || !parsed.body} onClick={save} data-testid="set-skill-import" aria-label="Import the skill"><Icon.plus /> Import</button>
        </div>
      </details>
    </Card>
  );
}

/** Settings → Workspace: the kula.toml fields the audit found with no UI –
 *  a person never hand-edits them. Values are shown only when the agents
 *  info payload actually carries them; until the backend serves a field
 *  (B3 extends set_agents) the control shows a muted placeholder and saves
 *  through settings_save, which currently discards the unknown fields –
 *  the UI never presents a guessed value as authoritative. */
export function WorkspaceSection({ info, act }: { info: AgentsInfo; act: Act }) {
  const a = info as AgentsInfo & Record<string, unknown>;
  const has = (k: string) => k in a && a[k] !== undefined && a[k] !== null && a[k] !== "";
  const num = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : "");
  const str = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : "");
  const save = (agents: Record<string, unknown>, done: string) => act("settings_save", { agents }, done).catch(() => {});
  const [exclude, setExclude] = useState<string[]>(has("exclude") ? ((a.exclude as string[]) ?? []) : []);
  const risks = ["none", "low", "medium", "high"] as const;
  const risk = has("max_risk") && risks.includes(str("max_risk") as (typeof risks)[number]) ? (str("max_risk") as (typeof risks)[number]) : null;
  return (
    <Card title="Workspace" sub="indexing, checks and how agents start" className="ag-wide">
      <div className="ags-row set-row toggle"><span className="set-label">Let a bare agent run without a team <span className="muted ags-desc">allow_solo – teams are the default deploy</span></span><span className="spacer" />
        <IconToggle checked={a.allow_solo === true} onChange={(v) => save({ allow_solo: v }, v ? "Solo runs allowed" : "Solo runs need a team")} hint="Deploy a single agent from the Workspace" testId="set-solo"
          icon={(on) => <span className={`set-glyph${on ? " on" : ""}`}><Icon.workflow />{!on && <span className="set-glyph-off" />}</span>} />
      </div>
      <div className="ags-row set-row"><span className="set-label">Check risk ceiling <span className="muted ags-desc">kula check refuses plans above it</span></span><span className="spacer" />
        <div className="seg" role="radiogroup" aria-label="Check risk ceiling" data-testid="set-max-risk" aria-describedby={risk === null ? "set-max-risk-unknown" : undefined}>
          {risk === null && <span id="set-max-risk-unknown" className="muted">not reported yet</span>}
          {risks.map((r) => <button key={r} role="radio" aria-checked={risk === r} className={risk === r ? "on" : ""} onClick={() => save({ max_risk: r }, `Check ceiling: ${r}`)}>{r}</button>)}
        </div>
      </div>
      <div className="ags-row set-row"><span className="set-label">Index excludes <span className="muted ags-desc">globs the graph never reads</span></span>
        <span data-testid="set-exclude"><Chips values={exclude} onChange={(v) => { setExclude(v); save({ exclude: v }, "Index excludes saved"); }} placeholder="dist/**" label="Index excludes" as="name" /></span>
      </div>
      <div className="ags-row set-row"><span className="set-label">Index file size limit <span className="muted ags-desc">larger files stay out of the graph</span></span><span className="spacer" />
        <input className="input mono set-num" type="number" min={1} max={100000} value={num("max_file_kb")} placeholder={has("max_file_kb") ? undefined : "512?"} aria-label="Max file size in KB" data-testid="set-max-file-kb"
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) save({ max_file_kb: v }, `Files above ${v} KB skipped`); }} />
      </div>
      <div className="ags-row set-row"><span className="set-label">Default branch <span className="muted ags-desc">project.default_branch</span></span><span className="spacer" />
        <input className="input mono set-num" defaultValue={str("default_branch")} placeholder={has("default_branch") ? undefined : "main?"} aria-label="Default branch" data-testid="set-default-branch"
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== str("default_branch")) save({ default_branch: v }, `Default branch: ${v}`); }} />
      </div>
      <div className="ags-row set-row"><span className="set-label">Embed pause <span className="muted ags-desc">ms between embed batches – raise it on busy machines</span></span><span className="spacer" />
        <input className="input mono set-num" type="number" min={0} max={5000} value={num("pause_ms")} placeholder={has("pause_ms") ? undefined : "120?"} aria-label="Embed pause in milliseconds" data-testid="set-pause-ms"
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) save({ pause_ms: v }, `Embed pause ${v} ms`); }} />
      </div>
    </Card>
  );
}

/** Settings → Scopes: the named graph slices ([[scope]]) as name · about ·
 *  pattern count, with Forget. Agents' and teams' @name completions come
 *  from the same list (GET /api/scopes). */
export function ScopesSection({ info, act }: { info: AgentsInfo; act: Act }) {
  const [scopes, setScopes] = useState<Scope[] | null>(null);
  useEffect(() => { api.scopes().then(setScopes).catch(() => setScopes([])); }, [info]);
  const forget = (name: string) => api.scopeForget(name)
    .then(() => { act("settings_save", {}, `Scope ${name} forgotten`); return api.scopes(); })
    .then((s) => setScopes(s ?? [])).catch(() => {});
  return (
    <Card title="Scopes" sub="named graph slices – @name in agents and teams" className="ag-wide">
      <div data-testid="set-scopes">
      {(scopes ?? []).length === 0
        ? <div className="muted ag-empty">No scopes yet – a scope is a named slice of the graph an agent or team works inside.</div>
        : scopes!.map((s) => (
          <div key={s.name} className="ags-row set-scopes-row" data-testid={`set-scope-${s.name}`}>
            <span className="mono set-scope-name">@{s.name}</span>
            <span className="muted ags-desc set-scope-about">{s.about || s.paths.join(" · ")}</span>
            <span className="muted mono">{s.paths.length} pattern{s.paths.length === 1 ? "" : "s"}</span>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => forget(s.name)} data-testid={`set-scope-forget-${s.name}`}>Forget</button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Settings({ info, act, setTab }: { info: AgentsInfo; act: Act; setTab: (t: "skills") => void }) {
  const base = { hide_secrets: info.secrets_hidden, memory: info.memory_enabled, docs: info.docs_list };
  const save = (agents: Record<string, unknown>, done: string) => act("settings_save", { agents: { ...base, ...agents } }, done).catch(() => {});
  const wired = info.connections.filter((c) => c.mcp);
  // The Connect section sits further down the page – jump to it, never to a
  // tab that no longer exists.
  const toConnect = () => document.getElementById("set-connect")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="ag-grid set-grid">
      <Card title="Policy" sub="[agents] in kula.toml" className="ag-wide">
        <div className="ags-row set-row toggle"><span className="set-label">Agents may keep memories</span><span className="spacer" />
          <IconToggle checked={info.memory_enabled} onChange={(v) => save({ memory: v }, v ? "Agent memory on" : "Agent memory off")} hint="Let agents remember facts about the code" testId="set-memory"
            icon={(on) => <span className={`set-glyph${on ? " on" : ""}`}><Icon.memory />{!on && <span className="set-glyph-off" />}</span>} />
        </div>
        <div className="ags-row set-row toggle"><span className="set-label">Hide likely secrets <span className="muted ags-desc">.env, keys, certificates</span></span><span className="spacer" />
          <IconToggle checked={info.secrets_hidden} onChange={(v) => save({ hide_secrets: v }, v ? "Secrets hidden from agents" : "Secrets visible to agents")} hint="Keep secrets out of every agent answer" testId="set-secrets"
            icon={(on) => <span className={`set-glyph${on ? " on" : ""}`}><Icon.shield />{!on && <span className="set-glyph-off" />}</span>} />
        </div>
        <div className="ags-row set-row"><span className="set-label">Default agent</span><span className="spacer" />
          {wired.length === 0 ? <button className="btn sm ghost" onClick={toConnect}>Connect one first</button> : (
            <Dropdown value={info.default_agent ?? wired[0].id} options={wired.map((c) => ({ value: c.id, label: AGENT_NAME[c.id] ?? c.name, icon: <AgentMark id={c.id} /> }))}
              onChange={(id) => { const c = info.connections.find((x) => x.id === id); if (c) save({ default: id }, `${c.name} is the default`); }}
              label="Default agent" testId="set-default" className="set-default" />
          )}
        </div>
      </Card>
      <WorkspaceSection info={info} act={act} />
      <ScopesSection info={info} act={act} />
      <div id="set-connect" className="set-connect">
        <Connect info={info} act={act} />
      </div>
      <ImportSkill info={info} act={act} setTab={setTab} />
    </div>
  );
}
