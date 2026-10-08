// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Skills tab – the unified agent config view (src/skills.rs, src/agent_config.rs):
// one set of skills for every agent (src/skills.rs), the matrix shows each skill
// against each agent's copy with a diff before a sync overwrites one; below it,
// every agent's MCP servers and rules files against the shared source, with a
// one-server sync; and the memory layers, derived from the memories that exist.

import { useCallback, useEffect, useState } from "react";
import type { AgentsInfo, ConfigMatrix, McpAgentRow, MemoryLayer, Skill, SkillDiff, SkillDetail, SkillState } from "../../api";
import { api } from "../../api";
import { Icon } from "../../ui";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark, Card, TabStrip } from "./parts";

const WHERE: Record<string, string> = { claude: ".claude/skills/", gemini: ".gemini/skills/", cursor: ".cursor/rules/*.mdc", codex: "reads .agents/skills" };
const STATE: Record<SkillState, [string, string]> = {
  synced: ["=", "has the current copy"], native: ["≡", "reads the shared copy itself"], differs: ["≠", "its copy was edited – sync overwrites it"], missing: ["–", "does not have it yet"],
};
const SCOPE: Record<MemoryLayer["scope"], string> = { task: "task", workflow: "workflow", repo: "repo" };

const SKILL_TEMPLATES: { name: string; description: string; body: string }[] = [
  { name: "code-review", description: "Review a change before it merges: correctness, tests, fences, naming", body: "1. Read the diff and the task.\n2. Run `kula check` and the tests.\n3. Report problems by severity with file:line; suggest, do not rewrite." },
  { name: "release-notes", description: "Write release notes from the commits since the last tag", body: "1. `git log $(git describe --tags --abbrev=0)..HEAD --oneline`\n2. Group by Added, Changed, Fixed.\n3. One line each, user-facing words, no hashes." },
  { name: "triage", description: "Sort a new issue: reproduce, label, find the owning code", body: "1. Reproduce with the smallest input.\n2. Find the symbol with kula search and its callers.\n3. Comment the cause, the files, and a size estimate." },
  { name: "migration", description: "Write a database migration that can be rolled back", body: "1. Write up and down.\n2. Never drop data in the same release that stops writing it.\n3. Test both directions on a copy." },
];

export default function Skills({ info, act, open }: { info: AgentsInfo; act: Act; open: (t: string) => void }) {
  const skills = info.skills ?? [];
  const strays = info.skill_strays ?? [];
  const agents = [...new Set(skills.flatMap((s) => Object.keys(s.targets)).concat(strays.map((s) => s.agent)))];
  const [cur, setCur] = useState(skills[0]?.name ?? "");
  const [adding, setAdding] = useState(skills.length === 0);
  const [matrix, setMatrix] = useState<ConfigMatrix | null>(null);
  const [layers, setLayers] = useState<MemoryLayer[] | null>(null);
  const [layerScope, setLayerScope] = useState<"all" | MemoryLayer["scope"]>("all");
  const s = skills.find((x) => x.name === cur);
  const behind = skills.filter((x) => Object.values(x.targets).some((t) => t === "missing" || t === "differs")).length;
  const reload = useCallback(() => {
    api.configMatrix().then(setMatrix).catch(() => {});
    api.memoryLayers().then(setLayers).catch(() => {});
  }, []);
  useEffect(reload, [reload, info.skills]);
  const done = (fn: () => void) => { fn(); reload(); };
  return (
    <div className="ag-wide">
      <Card title="Skills" sub=".agents/skills – one set, every agent"
        right={behind > 0 ? <button className="btn sm primary" onClick={() => done(() => act("skills_sync", {}, "Every agent has the current skills").catch(() => {}))}>Sync {behind} to every agent</button> : skills.length ? <span className="tag">all in sync</span> : undefined}>
        <div className="sk">
          <Matrix skills={skills} agents={agents} cur={adding ? "" : cur} pick={(n) => { setCur(n); setAdding(false); }} />
          {strays.length > 0 && (
            <div className="sk-strays">
              <h3>only in one agent – adopt to share</h3>
              {strays.map((x) => (
                <div key={x.path} className="sk-stray">
                  <AgentMark id={x.agent} size={13} />
                  <b className="mono">{x.name}</b>
                  <span className="muted sk-desc">{x.description || "no description"}</span>
                  <button className="linkish mono" onClick={() => open(`file:${x.path}`)}>{x.path}</button>
                  <button className="btn sm" onClick={() => done(() => act("skill_adopt", { agent: x.agent, name: x.name }, `${x.name} shared with every agent`).then(() => { setCur(x.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")); setAdding(false); }).catch(() => {}))}>Adopt</button>
                </div>
              ))}
            </div>
          )}
          <TabStrip label="Skills" addLabel="New skill" cur={adding ? "" : cur}
            items={skills.map((x) => ({ key: x.name, label: x.name }))} onPick={(k) => { setCur(k); setAdding(false); }} onAdd={() => setAdding(true)}
            onRename={(from, to) => {
              const x = skills.find((y) => y.name === from)!;
              act("skill_save", { name: to, description: x.description, text: x.body }, `${from} renamed to ${to}`)
                .then(() => act("skill_delete", { name: from }, "")).then(() => setCur(to)).catch(() => {});
            }} />
          {adding || !s ? <Editor key="new" act={act} done={(n) => { setCur(n); setAdding(false); }} taken={skills.map((x) => x.name)} />
            : <Editor key={s.name} skill={s} act={act} open={open} done={setCur} taken={[]} />}
          {s && s.targets && <DiffView skill={s} act={act} reload={reload} />}
        </div>
      </Card>
      <Card title="Agent config" sub="mcp servers and rules – per agent, against the shared source" className="ag-wide k2-config">
        {matrix ? <ConfigMatrixView m={matrix} act={act} reload={reload} /> : <div className="muted">reading the agent configs…</div>}
      </Card>
      <Card title="Memory layers" sub="scope and provenance, derived from the memories that exist" className="ag-wide k2-layers">
        {layers === null ? <div className="muted">reading memories…</div>
          : layers.length === 0 ? <div className="muted">no memories yet</div> : (
            <>
              <div className="wf-from k2-scope-pick">
                <span className="muted">scope</span>
                {(["all", "task", "workflow", "repo"] as const).map((k) => (
                  <button key={k} className={`chip-toggle${layerScope === k ? " on" : ""}`} onClick={() => setLayerScope(k)}>{k}</button>
                ))}
              </div>
              <table className="k2-layers-t">
                <thead><tr><th>memory</th><th>target</th><th>scope</th><th>agent</th><th>commit</th><th>state</th></tr></thead>
                <tbody>
                  {layers.filter((l) => layerScope === "all" || l.scope === layerScope).map((l) => (
                    <tr key={l.id} className={l.stale ? "is-stale" : ""}>
                      <td className="k2-mem-body" title={l.body}>{l.body}</td>
                      <td><button className="linkish mono" onClick={() => open(l.target)}>{l.symbol ?? l.target}</button></td>
                      <td><span className={`tag k2-scope-${l.scope}`}>{SCOPE[l.scope]}{l.scope_name ? <small className="mono"> {l.scope_name}</small> : null}</span></td>
                      <td className="mono">{l.agent}</td>
                      <td className="mono muted">{l.commit || "–"}</td>
                      <td>{l.stale ? <span className="tag danger">stale</span> : <span className="tag ok">current</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
      </Card>
    </div>
  );
}

/** Skills down, agents across: who has which, at a glance. */
function Matrix({ skills, agents, cur, pick }: { skills: Skill[]; agents: string[]; cur: string; pick: (n: string) => void }) {
  if (!skills.length) return <div className="muted sk-empty">No shared skills yet. Pick a template below, or adopt one an agent already has.</div>;
  return (
    <table className="sk-matrix">
      <thead>
        <tr><th>skill</th>{agents.map((a) => <th key={a} title={WHERE[a]}><AgentMark id={a} size={13} /> {AGENT_NAME[a] ?? a}<small className="mono">{WHERE[a]}</small></th>)}</tr>
      </thead>
      <tbody>
        {skills.map((s) => (
          <tr key={s.name} className={s.name === cur ? "sel" : ""} onClick={() => pick(s.name)}>
            <th scope="row"><b className="mono">{s.name}</b><span className="sk-desc muted">{s.description}</span>{s.files.length > 0 && <small className="muted"> +{s.files.length} file{s.files.length > 1 ? "s" : ""}</small>}</th>
            {agents.map((a) => {
              const st = s.targets[a] ?? "missing";
              return <td key={a} className={`sk-st ${st}`} title={`${AGENT_NAME[a] ?? a} ${STATE[st][1]}`}>{STATE[st][0]}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Before a sync overwrites an edited copy: the diff, per agent that differs. */
function DiffView({ skill, act, reload }: { skill: Skill; act: Act; reload: () => void }) {
  const differing = Object.entries(skill.targets).filter(([, st]) => st === "differs");
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  useEffect(() => {
    setDiffs({});
    differing.forEach(([a]) => {
      api.skillDiff(skill.name, a).then((d) => setDiffs((old) => ({ ...old, [a]: d.diff ?? "" }))).catch(() => {});
    });
    // differing is a list derived from skill.targets; compare it by content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.name, differing.map(([a]) => a).join(",")]);
  if (differing.length === 0) return null;
  return (
    <div className="sk-diff" data-testid="skill-diff">
      <h3>edited copies – sync overwrites these</h3>
      {differing.map(([a]) => (
        <div key={a} className="sk-diff-row">
          <div className="row">
            <AgentMark id={a} size={13} />
            <b className="mono">{AGENT_NAME[a] ?? a}</b>
            <span className="spacer" />
            <button className="btn sm" onClick={() => act("skills_sync", {}, `${skill.name} synced to every agent`).then(reload).catch(() => {})}><Icon.up /> overwrite with sync</button>
          </div>
          <pre className="mono k2-diff">{diffs[a] ?? "loading diff…"}</pre>
        </div>
      ))}
    </div>
  );
}

/** MCP servers and rules files per agent, against .agents/mcp.json. */
function ConfigMatrixView({ m, act, reload }: { m: ConfigMatrix; act: Act; reload: () => void }) {
  const sync = (name: string) => api.mcpSync(name).then(() => reload()).catch(() => {});
  return (
    <div className="k2-matrix">
      <h3>mcp servers</h3>
      <table className="k2-cfg-t">
        <thead><tr><th>agent</th><th>config</th><th>servers</th><th>state</th></tr></thead>
        <tbody>
          <tr className="k2-src">
            <th scope="row"><span className="mono">shared source</span></th>
            <td className="mono muted">{m.source.path}</td>
            <td className="mono">{m.source.servers.length ? m.source.servers.join(", ") : "–"}</td>
            <td>{m.source.exists ? <span className="tag ok">source of truth</span> : <span className="tag">empty – sync writes this from an agent</span>}</td>
          </tr>
          {m.agents.map((a) => <McpRow key={a.agent} a={a} sync={sync} />)}
        </tbody>
      </table>
      <h3>rules files</h3>
      <table className="k2-cfg-t">
        <thead><tr><th>agent</th><th>file</th><th>size</th></tr></thead>
        <tbody>
          {m.rules.map((r) => (
            <tr key={r.path}>
              <td><AgentMark id={r.agent} size={13} /> {AGENT_NAME[r.agent] ?? r.agent}</td>
              <td className="mono">{r.path}</td>
              <td>{r.exists ? <span className="mono">{r.bytes} b</span> : <span className="muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function McpRow({ a, sync }: { a: McpAgentRow; sync: (n: string) => void }) {
  const state = !a.exists ? ["missing file", "danger"] : a.differs.length || a.missing.length ? ["differs", "warn"] : ["in sync", "ok"];
  const needs = a.missing.length > 0;
  return (
    <tr>
      <th scope="row"><AgentMark id={a.agent} size={13} /> {AGENT_NAME[a.agent] ?? a.agent}</th>
      <td className="mono muted">{a.path}</td>
      <td className="mono">{a.servers.length ? a.servers.join(", ") : "–"}</td>
      <td className="k2-mcp-state">
        <span className={`tag ${state[1]}`}>{state[0]}</span>
        {a.differs.map((n) => <button key={n} className="chip-btn mono" title={`${n} differs from the source – sync overwrites it`} onClick={() => sync(n)}>≠ {n} → sync</button>)}
        {needs && <button className="chip-btn mono" title={`write ${a.missing.join(", ")} into ${a.path} from the shared source`} onClick={() => Promise.all(a.missing.map((n) => sync(n))).catch(() => {})}>+ {a.missing.join(", ")} → sync</button>}
      </td>
    </tr>
  );
}

function Editor({ skill, act, open, done, taken }: { skill?: Skill; act: Act; open?: (t: string) => void; done: (n: string) => void; taken: string[] }) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDesc] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [usage, setUsage] = useState<SkillDetail["usage"] | null>(null);
  useEffect(() => { setDesc(skill?.description ?? ""); setBody(skill?.body ?? ""); }, [skill?.description, skill?.body]);
  useEffect(() => {
    if (!skill) { setUsage(null); return; }
    api.skillDetail(skill.name).then((d) => setUsage(d.usage)).catch(() => {});
  }, [skill?.name]);
  const dirty = !skill || description !== skill.description || body.trim() !== skill.body.trim();
  const save = () => act("skill_save", { name, description, text: body }, skill ? `${name} saved and synced` : `${name} shared with every agent`).then(() => done(name)).catch(() => {});
  return (
    <div className="sk-edit">
      {!skill && (
        <div className="wf-from">
          <span className="muted">start from</span>
          {SKILL_TEMPLATES.filter((t) => !taken.includes(t.name)).map((t) => <button key={t.name} className="chip-toggle" title={t.description} onClick={() => { setName(t.name); setDesc(t.description); setBody(t.body); }}>{t.name}</button>)}
        </div>
      )}
      {usage && (usage.workflows.length > 0 || usage.teams.length > 0) && (
        <div className="sk-usage">
          <span className="muted">used by</span>
          {usage.workflows.map((w) => <span key={w} className="chip-btn mono" title="a workflow mentions this skill">{w}</span>)}
          {usage.teams.map((t) => <span key={t} className="chip-btn mono" title="a team mentions this skill">{t}</span>)}
        </div>
      )}
      <div className="sk-form">
        {!skill && <label className="mi-field"><span>name</span><input className="input mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))} placeholder="release-notes" aria-label="Skill name" /></label>}
        <label className="mi-field"><span>when to use it – agents choose skills by this line</span><input className="input" value={description} onChange={(e) => setDesc(e.target.value)} aria-label="Description" /></label>
        <label className="mi-field"><span>instructions</span><textarea className="input mono" rows={9} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Instructions" /></label>
        {skill && skill.files.length > 0 && (
          <div className="mi-field"><span>files with it</span><div className="sk-files">{skill.files.map((f) => <button key={f} className="linkish mono" onClick={() => open?.(`file:.agents/skills/${skill.name}/${f}`)}>{f}</button>)}</div></div>
        )}
        <div className="row">
          {skill && <button className="btn sm ghost" onClick={() => open?.(`file:.agents/skills/${skill.name}/SKILL.md`)}><Icon.doc /> SKILL.md</button>}
          {skill && <button className="btn sm ghost danger" onClick={() => confirm(`Remove ${skill.name} from every agent?`) && act("skill_delete", { name: skill.name }, `${skill.name} removed`).catch(() => {})}>Remove</button>}
          <span className="spacer" />
          <span className="muted sk-cli mono">kula skill sync</span>
          <button className="btn sm primary" disabled={!name || !description.trim() || !dirty || taken.includes(name)} onClick={save}>{skill ? "Save and sync" : "Create and share"}</button>
        </div>
      </div>
    </div>
  );
}
