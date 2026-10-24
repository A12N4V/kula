// Skills index – every skill an agent would load here, as a searchable list.
// Found the way the agents find them (src/skill_index.rs): a folder with a
// SKILL.md under .agents/skills (Codex, shared), .claude/skills (Claude Code,
// also nested and in plugins), .gemini/skills, legacy .claude/commands, Cursor
// rules, and the user-wide folders in ~. A row opens its instructions; a
// skill that lives outside the shared set can be added to it in one click.

import { useEffect, useMemo, useState } from "react";
import { api, type IndexedSkill, type SkillIndex as Ix } from "../../api";
import { Empty, Icon } from "../../ui";
import { useCode } from "../../CodePanel";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark } from "./parts";

const SCOPES = [["all", "All"], ["repo", "This repo"], ["user", "Yours"], ["plugin", "Plugins"]] as const;
type Scope = (typeof SCOPES)[number][0];
const SCOPE_TAG: Record<IndexedSkill["scope"], string> = { repo: "repo", nested: "nested", plugin: "plugin", user: "yours", admin: "admin" };
const WHO: Record<IndexedSkill["agent"], string> = { shared: "Every agent", claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", cursor: "Cursor" };
const inScope = (s: IndexedSkill, f: Scope) => f === "all" || (f === "repo" ? s.scope === "repo" || s.scope === "nested" : f === "user" ? s.scope === "user" || s.scope === "admin" : s.scope === f);
const outside = (p: string) => p.startsWith("~") || p.startsWith("/");

/** Load the index once per change of `version`. */
export function useSkillIndex(version: unknown) {
  const [ix, setIx] = useState<Ix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.skillIndex().then((v) => { setIx(v); setErr(null); }).catch((e) => setErr(e.message)); }, [version]);
  return { ix, err };
}

export default function SkillIndex({ ix, err, act, shared }: { ix: Ix | null; err: string | null; act: Act; shared: string[] }) {
  const code = useCode();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [agent, setAgent] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);
  const skills = ix?.skills ?? [];
  const agents = useMemo(() => [...new Set(skills.map((s) => s.agent))], [skills]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return skills.filter((s) => inScope(s, scope) && (!agent || s.agent === agent) && (!t || `${s.name} ${s.description} ${s.plugin ?? ""}`.toLowerCase().includes(t)));
  }, [skills, q, scope, agent]);
  const count = (f: Scope) => skills.filter((s) => inScope(s, f)).length;
  if (err) return <Empty title="Skills index unavailable">{err}</Empty>;
  if (!ix) return <div className="muted">Looking where Claude Code, Codex, Gemini and Cursor look…</div>;
  const cur = shown.find((s) => s.path === sel) ?? null;
  const addShared = (s: IndexedSkill) => act("skill_save", { name: s.name.toLowerCase().replace(/[^\w-]+/g, "-"), description: s.description, text: s.body }, `${s.name} added for every agent`).catch(() => {});
  return (
    <div className="sx" data-testid="skill-index">
      <div className="sx-bar">
        <label className="sx-q"><Icon.search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${skills.length} skills`} aria-label="Search skills" data-testid="sx-q" /></label>
        <div className="seg sm" role="radiogroup" aria-label="Where the skill lives">
          {SCOPES.map(([k, l]) => <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? "on" : ""} onClick={() => setScope(k)} data-testid={`sx-scope-${k}`}>{l} <span className="sx-n">{count(k)}</span></button>)}
        </div>
        <div className="sx-agents" role="group" aria-label="Agent">
          {agents.map((a) => (
            <button key={a} className={`sx-agent ${agent === a ? "on" : ""}`} aria-pressed={agent === a} title={WHO[a]} aria-label={WHO[a]} onClick={() => setAgent(agent === a ? "" : a)}>
              {a === "shared" ? <Icon.box /> : <AgentMark id={a} size={14} />}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <Empty title={skills.length ? "No skill matches" : "No skills yet"}>{skills.length ? "Clear the search or the filters." : "Add a SKILL.md under .agents/skills, or import one from Settings."}</Empty>}
      <div className="sx-list" role="list">
        {shown.map((s) => {
          const open = cur?.path === s.path;
          return (
            <div key={s.path} role="listitem" className={`sx-row ${open ? "on" : ""}`}>
              <button className="sx-head" aria-expanded={open} onClick={() => setSel(open ? null : s.path)} data-testid={`sx-row-${s.name}`}>
                <span className="sx-mark" title={WHO[s.agent]}>{s.agent === "shared" ? <Icon.box /> : <AgentMark id={s.agent} size={14} />}</span>
                <span className="sx-main">
                  <span className="sx-name mono">{s.plugin ? <span className="muted">{s.plugin}:</span> : null}{s.name}</span>
                  <span className="sx-desc">{s.description || <span className="muted">no description</span>}</span>
                </span>
                <span className="sx-tags">
                  {s.kind !== "skill" && <span className="tag">{s.kind}</span>}
                  <span className={`tag ${s.scope === "repo" || s.scope === "nested" ? "" : "accent"}`}>{SCOPE_TAG[s.scope]}</span>
                </span>
                <span className={`sx-caret ${open ? "on" : ""}`}><Icon.chevron /></span>
              </button>
              {open && (
                <div className="sx-detail">
                  <div className="sx-facts">
                    <span><b>Loaded by</b> {WHO[s.agent]}</span>
                    <span className="mono sx-path" title={s.path}>{s.path}</span>
                    {Object.entries(s.meta).map(([k, v]) => <span key={k} className="sx-meta"><b>{k}</b> <span className="mono">{v || "…"}</span></span>)}
                  </div>
                  <pre className="sx-body">{s.body.trim() || "(empty)"}</pre>
                  <div className="row">
                    {!outside(s.path) && <button className="btn sm" onClick={() => code.open({ path: s.path })}><Icon.edit /> Edit</button>}
                    {s.agent !== "shared" && s.kind === "skill" && !shared.includes(s.name) && <button className="btn sm primary" onClick={() => addShared(s)} data-testid={`sx-share-${s.name}`}><Icon.plus /> Use for every agent</button>}
                    {shared.includes(s.name) && s.agent !== "shared" && <span className="muted">also in the shared set</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <details className="sx-where">
        <summary>Where we looked</summary>
        <ul>{ix.searched.map((w) => <li key={w} className="mono">{w}</li>)}</ul>
      </details>
    </div>
  );
}

/** CLAUDE.md, AGENTS.md, GEMINI.md – the instruction files each agent reads first. */
export function Instructions({ ix, err }: { ix: Ix | null; err: string | null }) {
  const code = useCode();
  if (err) return <Empty title="Instructions unavailable">{err}</Empty>;
  if (!ix) return <div className="muted">Reading instruction files…</div>;
  const order = ["claude", "codex", "gemini"] as const;
  return (
    <div className="sx" data-testid="instructions">
      <p className="muted sx-lede">What each agent reads before anything else: Claude Code reads CLAUDE.md, Codex AGENTS.override.md then AGENTS.md in each folder from the repo root down, Gemini CLI GEMINI.md – plus a user-wide copy in your home folder.</p>
      {ix.instructions.length === 0 && <Empty title="No instruction files">Sync the brief from Docs to write CLAUDE.md and AGENTS.md.</Empty>}
      {order.map((a) => {
        const rows = ix.instructions.filter((i) => i.agent === a);
        return rows.length ? (
          <div key={a} className="sx-group">
            <div className="section-title"><AgentMark id={a} size={14} /> {AGENT_NAME[a] ?? a} <span className="count">{rows.length}</span></div>
            <div className="sx-list" role="list">
              {rows.map((i) => (
                <div key={i.path} role="listitem" className="sx-row">
                  <button className="sx-head" disabled={outside(i.path)} onClick={() => code.open({ path: i.path })} title={outside(i.path) ? "Outside this repo – open it in your editor" : "Open in the editor"}>
                    <span className="sx-mark"><Icon.doc /></span>
                    <span className="sx-main"><span className="sx-name mono">{i.path}</span><span className="sx-desc">{i.headline || <span className="muted">empty</span>}</span></span>
                    <span className="sx-tags"><span className={`tag ${i.scope === "user" ? "accent" : ""}`}>{i.scope === "user" ? "yours" : i.scope}</span><span className="muted sx-n">{(i.bytes / 1024).toFixed(1)} KB</span></span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })}
    </div>
  );
}
