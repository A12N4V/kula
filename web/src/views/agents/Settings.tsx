// Settings tab – every agent-wide switch in one place: the [agents] policy in
// kula.toml (memory, secrets, the default agent), how each agent is wired in
// (MCP server, pre-edit hook), and skill imports – a SKILL.md from disk or a
// paste, or a skill an agent already keeps in its own folder. Every change
// writes the same files the CLI does, so the Workspace picks it up at once.

import { useState } from "react";
import type { AgentsInfo } from "../../api";
import { Icon, Toggle } from "../../ui";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark, Card } from "./parts";

/** name/description from a SKILL.md's front matter; the rest is the body. */
export function parseSkill(src: string, fallback = ""): { name: string; description: string; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(src);
  const meta = m ? m[1] : "";
  const field = (k: string) => (new RegExp(`^${k}:\\s*["']?(.*?)["']?\\s*$`, "m").exec(meta)?.[1] ?? "");
  const name = (field("name") || fallback).toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return { name, description: field("description"), body: (m ? m[2] : src).trim() };
}

export function ImportSkill({ info, act }: { info: AgentsInfo; act: Act }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState("");
  const strays = info.skill_strays ?? [];
  const parsed = parseSkill(text, file.replace(/\.(md|mdc)$/i, "").replace(/^SKILL$/i, ""));
  const save = () => act("skill_save", { name: parsed.name, description: parsed.description, text: parsed.body }, `Imported ${parsed.name}`).then(() => { setText(""); setFile(""); }).catch(() => {});
  return (
    <Card title="Import a skill" sub="SKILL.md → .agents/skills, copied to every agent" className="ag-wide set-import">
      <div className="row set-import-src">
        <label className="btn sm" data-testid="set-skill-file"><Icon.doc /> From file
          <input type="file" accept=".md,.mdc,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile(f.name); setText(await f.text()); } e.target.value = ""; }} />
        </label>
        <span className="muted">or paste it below</span>
      </div>
      <textarea className="input mono set-import-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"---\nname: code-review\ndescription: Review a change before it merges\n---\n1. Read the diff…"} aria-label="Skill source" data-testid="set-skill-text" />
      <div className="row">
        {text.trim() && <span className="muted">{parsed.name ? <>as <b className="mono">{parsed.name}</b>{parsed.description && <> – {parsed.description}</>}</> : "add a name: line to the front matter"}</span>}
        <span className="spacer" />
        <button className="btn sm primary" disabled={!parsed.name || !parsed.body} onClick={save} data-testid="set-skill-import"><Icon.plus /> Import</button>
      </div>
      {strays.length > 0 && <>
        <div className="section-title">Found in an agent's own folder <span className="count">{strays.length}</span></div>
        {strays.map((s) => (
          <div key={`${s.agent}:${s.name}`} className="set-row">
            <AgentMark id={s.agent} /><span className="mono">{s.name}</span><span className="muted set-desc" title={s.path}>{s.description || s.path}</span><span className="spacer" />
            <button className="btn sm" onClick={() => act("skill_adopt", { agent: s.agent, name: s.name }, `${s.name} is shared now`).catch(() => {})}>Share</button>
          </div>
        ))}
      </>}
    </Card>
  );
}

export default function Settings({ info, act, setTab }: { info: AgentsInfo; act: Act; setTab: (t: "connect" | "skills") => void }) {
  const base = { hide_secrets: info.secrets_hidden, memory: info.memory_enabled, docs: info.docs_list };
  const save = (agents: Record<string, unknown>, done: string) => act("settings_save", { agents: { ...base, ...agents } }, done).catch(() => {});
  const wired = info.connections.filter((c) => c.mcp);
  return (
    <div className="ag-grid set-grid">
      <Card title="Policy" sub="[agents] in kula.toml">
        <div className="set-row"><span>Agents may keep memories</span><span className="spacer" />
          <Toggle label="" checked={info.memory_enabled} onChange={(v) => save({ memory: v }, v ? "Agent memory on" : "Agent memory off")} hint="Let agents remember facts about the code" testId="set-memory" className="sm" /></div>
        <div className="set-row"><span>Hide likely secrets</span><span className="muted set-desc">.env, keys, certificates</span><span className="spacer" />
          <Toggle label="" checked={info.secrets_hidden} onChange={(v) => save({ hide_secrets: v }, v ? "Secrets hidden from agents" : "Secrets visible to agents")} hint="Keep secrets out of every agent answer" testId="set-secrets" className="sm" /></div>
        <div className="set-row"><span>Default agent</span><span className="spacer" />
          {wired.length === 0 ? <button className="btn sm ghost" onClick={() => setTab("connect")}>Connect one first</button> : (
            <div className="seg sm" role="radiogroup" aria-label="Default agent">
              {wired.map((c) => (
                <button key={c.id} role="radio" aria-checked={info.default_agent === c.id} className={info.default_agent === c.id ? "on" : ""} title={c.name} onClick={() => save({ default: c.id }, `${c.name} is the default`)} data-testid={`set-default-${c.id}`}>
                  <AgentMark id={c.id} />{AGENT_NAME[c.id] ?? c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>
      <Card title="Wiring" sub="what each agent reads" right={<button className="btn sm ghost" onClick={() => setTab("connect")}><Icon.plug /> Connect</button>}>
        {info.connections.map((c) => (
          <div key={c.id} className="set-row">
            <AgentMark id={c.id} /><span>{c.name}</span><span className="spacer" />
            <span className={`tag ${c.mcp ? "green" : ""}`}>{c.mcp ? "MCP" : "no MCP"}</span>
            <span className={`tag ${c.hook ? "green" : ""}`}>{c.hook ? "hook" : "no hook"}</span>
            {!(c.mcp && c.hook) && <button className="btn sm" onClick={() => act("connect", { agent: c.id }, `${c.name} connected`).catch(() => {})}>Connect</button>}
          </div>
        ))}
      </Card>
      <ImportSkill info={info} act={act} />
    </div>
  );
}
