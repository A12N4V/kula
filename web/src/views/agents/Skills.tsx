// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Skills tab: one set of skills for every agent (src/skills.rs). The matrix
// shows each skill against each agent's copy; skills only one agent has can be
// adopted into the set; the editor writes .agents/skills and syncs at once.

import { useEffect, useState } from "react";
import type { AgentsInfo, Skill, SkillState } from "../../api";
import { Icon } from "../../ui";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark, Card, TabStrip } from "./parts";

const WHERE: Record<string, string> = { claude: ".claude/skills/", gemini: ".gemini/skills/", cursor: ".cursor/rules/*.mdc", codex: "reads .agents/skills" };
const STATE: Record<SkillState, [string, string]> = {
  synced: ["✓", "has the current copy"], native: ["◎", "reads the shared copy itself"], differs: ["≠", "its copy was edited – sync overwrites it"], missing: ["–", "does not have it yet"],
};

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
  const s = skills.find((x) => x.name === cur);
  const behind = skills.filter((x) => Object.values(x.targets).some((t) => t === "missing" || t === "differs")).length;
  return (
    <Card title="Skills" sub=".agents/skills – one set, every agent" className="ag-wide"
      right={behind > 0 ? <button className="btn sm primary" onClick={() => act("skills_sync", {}, "Every agent has the current skills").catch(() => {})}>Sync {behind} to every agent</button> : skills.length ? <span className="tag">all in sync</span> : undefined}>
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
                <button className="btn sm" onClick={() => act("skill_adopt", { agent: x.agent, name: x.name }, `${x.name} shared with every agent`).then(() => { setCur(x.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")); setAdding(false); }).catch(() => {})}>Adopt</button>
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
      </div>
    </Card>
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

function Editor({ skill, act, open, done, taken }: { skill?: Skill; act: Act; open?: (t: string) => void; done: (n: string) => void; taken: string[] }) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDesc] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  useEffect(() => { setDesc(skill?.description ?? ""); setBody(skill?.body ?? ""); }, [skill?.description, skill?.body]);
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
