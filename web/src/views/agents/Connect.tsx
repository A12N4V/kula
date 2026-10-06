// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Connect tab: the harnesses, the enforcement points and the tools (module S1).

import { type ReactNode } from "react";
import { type AgentsInfo } from "../../api";
import { BRANDS, Mark } from "../../brands";
import { Icon } from "../../ui";
import type { Act } from "./data";
import { Card, Snippet } from "./parts";

const TOOLS: [string, string][] = [
  ["workflows", "how this kind of work is done here: steps, docs, fences"],
  ["research · experiment", "an autoresearch loop: kula runs the metric, keeps what's better"],
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
const WIRING: Record<string, { mcp: string; hook: string }> = {
  claude: { mcp: ".mcp.json", hook: "PreToolUse: Edit, Write, Read and Bash" },
  cursor: { mcp: ".cursor/mcp.json", hook: "preToolUse, beforeReadFile, beforeShellExecution" },
  codex: { mcp: ".codex/config.toml [mcp_servers.kula]", hook: "PreToolUse: apply_patch and shell" },
  gemini: { mcp: ".gemini/settings.json mcpServers", hook: "BeforeTool: file tools and run_shell_command" },
};

export default function Connect({ info, act }: { info: AgentsInfo; act: Act }) {
  const hooks = info.git_hooks ?? [];
  const pre = hooks.find(([h]) => h === "pre-commit")?.[1];
  const reindex = hooks.filter(([h, on]) => h !== "pre-commit" && on).length;
  const brief = info.docs.find((d) => d.path === "AGENTS.md");
  return (
    <div className="ag-grid">
      <Card title="Harnesses" className="ag-wide"
        right={<button className="btn sm" onClick={async () => { for (const c of info.connections) if (!(c.mcp && c.hook)) await act("connect", { agent: c.id }, "").catch(() => {}); }}><Icon.plug /> Connect all</button>}>
        <div className="conn-grid">
          {info.connections.map((c) => (
            <div key={c.id} className={`conn ${c.mcp && c.hook ? "ok" : ""}`}>
              <div className="row conn-title">
                <a className="conn-brand" href={c.docs} target="_blank" rel="noreferrer" title={`${c.name} docs`}><Mark id={c.id} size={22} /><b>{c.name}</b></a>
                <span className="spacer" /><span className={`dot ${c.mcp && c.hook ? "ok" : c.mcp || c.hook ? "warn" : ""}`} title={c.mcp && c.hook ? "connected" : "not connected"} />
              </div>
              <ul className="conn-wires">
                <li className={c.mcp ? "on" : ""}><span>{c.mcp ? <Icon.check /> : "–"}</span><b>MCP</b><span className="mono muted">{WIRING[c.id]?.mcp}</span></li>
                <li className={c.hook ? "on" : ""}><span>{c.hook ? <Icon.check /> : "–"}</span><b>fence hook</b><span className="muted">{WIRING[c.id]?.hook}</span></li>
                <li className={c.workflows.length ? "on" : ""}><span>{c.workflows.length ? <Icon.check /> : "–"}</span><b>workflows</b><span className="muted">{c.workflows.length ? c.workflows.join(" · ") : c.id === "codex" ? "reads AGENTS.md" : "install from Workflows"}</span></li>
                <li className={brief?.current ? "on" : ""}><span>{brief?.current ? <Icon.check /> : "–"}</span><b>brief</b><span className="muted">{c.id === "claude" ? "CLAUDE.md / AGENTS.md" : c.id === "gemini" ? "GEMINI.md / AGENTS.md" : "AGENTS.md"}</span></li>
              </ul>
              <div className="row">
                <a className="btn sm ghost" href={c.docs} target="_blank" rel="noreferrer">docs <Icon.arrow /></a><span className="spacer" />
                <button className={`btn sm ${c.mcp && c.hook ? "ghost" : "primary"}`} onClick={() => act("connect", { agent: c.id }, `${c.name} connected`).catch(() => {})}>{c.mcp && c.hook ? "Rewrite" : "Connect"}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Enforced everywhere" className="ag-wide">
        <div className="mod-grid">
          <Module id="mcp" name="MCP server" on what={<><code>kula mcp</code> – the graph, fences, memory and research as 23 tools, for any MCP client</>} />
          <Module id="git" name="git hooks" on={!!pre} what={<>pre-commit refuses an agent's commit of fenced changes{reindex ? `; ${reindex} more keep the graph current` : ""}</>}
            action={!pre ? <button className="btn sm primary" onClick={() => act("hooks_install", {}, "git hooks installed").catch(() => {})}>Install</button> : undefined} />
          <Module id="githubactions" name="CI gate" on={!!info.ci} what={info.ci ? <><code>{info.ci}</code> runs <code>kula check</code> on every pull request</> : <>add it with <code>kula init --ci github</code></>} />
          <Module icon={<Icon.shield />} name="kula run" on what={<>any other harness – Aider, OpenCode, Goose, a script: <code>kula run -w fix -- aider</code> holds fenced files and puts back what it changed</>} docs="https://github.com/A12N4V/kula/blob/main/docs/AGENTS.md" />
          <Module icon={<Icon.doc />} name="AGENTS.md" on={!!brief?.current} what={<>the brief: tools, fences, workflows and teams, for agents that read instructions</>} docs="https://agents.md" />
          <Module id="rdf" name="RDF · SPARQL" on what={<>the graph as W3C RDF: <code>sparql</code> for any structural question</>} />
        </div>
      </Card>

      <Card title="Tools">
        {TOOLS.map(([t, d]) => <div key={t} className="ag-tool"><span className="mono">{t}</span><span className="muted">{d}</span></div>)}
      </Card>
      <Card title="Any other agent" sub="MCP, or the shell">
        <Snippet text={MCP} />
        <Snippet text={`kula run -w refactor -- opencode   # fenced for the run
kula workflow prompt refactor       # the workflow, for a system prompt
kula verify                         # after the edit`} />
      </Card>
    </div>
  );
}

/** One piece of kula's enforcement: its mark opens its docs. */
function Module({ id, icon, name, on, what, action, docs }: { id?: string; icon?: ReactNode; name: string; on: boolean; what: ReactNode; action?: ReactNode; docs?: string }) {
  const href = docs ?? (id ? BRANDS[id]?.docs : undefined);
  return (
    <div className={`mod ${on ? "on" : ""}`}>
      <a className="mod-mark" href={href} target="_blank" rel="noreferrer" title={href ? `${name} docs` : name}>{id ? <Mark id={id} size={20} /> : icon}</a>
      <div className="mod-body">
        <div className="row"><a className="mod-name" href={href} target="_blank" rel="noreferrer">{name}</a><span className={`dot ${on ? "ok" : ""}`} /><span className="spacer" />{action}</div>
        <div className="muted">{what}</div>
      </div>
    </div>
  );
}
