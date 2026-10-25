// Settings tab – every agent-wide switch in one place: the [agents] policy in
// kula.toml (memory, secrets, the default agent), wiring and Connect (the old
// Connect tab, now a section: MCP, hooks and the enforcement points), and
// skill imports – a SKILL.md from disk or a paste, or a skill an agent already
// keeps in its own folder. Every change writes the same files the CLI does,
// so the Workspace picks it up at once. One 8px rhythm: rows are 8px apart,
// the label column is aligned, sections are grouped.

import { useState } from "react";
import type { AgentsInfo } from "../../api";
import { Dropdown } from "../../ui/Dropdown";
import { Icon, IconToggle } from "../../ui";
import { GhMark } from "./SkillIndex";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark, Card } from "./parts";
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
          {setTab && <button className="btn sm ghost" onClick={() => { try { sessionStorage.setItem("kula.x10.gh", "1"); } catch { /* private mode */ } setTab("skills"); }} data-testid="set-import-github"><GhMark /> Search GitHub</button>}
          <label className="btn sm" data-testid="set-skill-file"><Icon.doc /> From file
            <input type="file" accept=".md,.mdc,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile(f.name); setText(await f.text()); } e.target.value = ""; }} />
          </label>
        </div>
        <textarea className="input mono set-import-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"---\nname: code-review\ndescription: Review a change before it merges\n---\n1. Read the diff…"} aria-label="Skill source" data-testid="set-skill-text" />
        <div className="row">
          {text.trim() && <span className="muted">{parsed.name ? <>as <b className="mono">{parsed.name}</b>{parsed.description && <> – {parsed.description}</>}</> : "add a name: line to the front matter"}</span>}
          <span className="spacer" />
          <button className="btn sm primary" disabled={!parsed.name || !parsed.body} onClick={save} data-testid="set-skill-import"><Icon.plus /> Import</button>
        </div>
      </details>
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
        <div className="ags-row set-row"><span className="set-label">Agents may keep memories</span><span className="spacer" />
          <IconToggle checked={info.memory_enabled} onChange={(v) => save({ memory: v }, v ? "Agent memory on" : "Agent memory off")} hint="Let agents remember facts about the code" testId="set-memory"
            icon={(on) => <Icon.memory />} />
        </div>
        <div className="ags-row set-row"><span className="set-label">Hide likely secrets <span className="muted ags-desc">.env, keys, certificates</span></span><span className="spacer" />
          <IconToggle checked={info.secrets_hidden} onChange={(v) => save({ hide_secrets: v }, v ? "Secrets hidden from agents" : "Secrets visible to agents")} hint="Keep secrets out of every agent answer" testId="set-secrets"
            icon={(on) => <Icon.shield />} />
        </div>
        <div className="ags-row set-row"><span className="set-label">Default agent</span><span className="spacer" />
          {wired.length === 0 ? <button className="btn sm ghost" onClick={toConnect}>Connect one first</button> : (
            <Dropdown value={info.default_agent ?? wired[0].id} options={wired.map((c) => ({ value: c.id, label: AGENT_NAME[c.id] ?? c.name, icon: <AgentMark id={c.id} /> }))}
              onChange={(id) => { const c = info.connections.find((x) => x.id === id); if (c) save({ default: id }, `${c.name} is the default`); }}
              label="Default agent" testId="set-default" className="set-default" />
          )}
        </div>
      </Card>
      <div id="set-connect" className="set-connect">
        <Connect info={info} act={act} />
      </div>
      <ImportSkill info={info} act={act} setTab={setTab} />
    </div>
  );
}
