// Agents: what AI agents are told and allowed in this repository – the fences
// from kula.toml, the task scope, the memories they keep about the code, and
// whether they are wired up (MCP server, pre-edit hook). The same state the
// MCP tools and `kula guard hook` read (src/guard.rs, src/memory.rs).

import { useEffect, useMemo, useState } from "react";
import { api, relTime, type AgentsInfo, type GuardLevel, type Memory, type Node } from "../api";
import { useCode } from "../CodePanel";
import type { Go, Target } from "../nav";
import { Empty, Icon, Sym, useToast } from "../ui";

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

export const LEVEL_TEXT: Record<GuardLevel, string> = {
  open: "open",
  review: "review",
  scope: "out of scope",
  locked: "locked",
  hidden: "hidden",
};

export function GuardTag({ level }: { level: GuardLevel }) {
  return <span className={`guard-tag ${level}`}>{LEVEL_TEXT[level]}</span>;
}

/** A target input that suggests symbols and files as you type. */
function TargetInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [hits, setHits] = useState<Node[]>([]);
  useEffect(() => {
    const t = value.replace(/^(symbol|file):/, "");
    if (t.length < 2 || t === "repo") { setHits([]); return; }
    const h = setTimeout(() => api.search(t).then((r) => setHits(r.slice(0, 6))).catch(() => {}), 140);
    return () => clearTimeout(h);
  }, [value]);
  return (
    <div className="ti">
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
      {hits.length > 0 && (
        <div className="ti-pop">
          {hits.map((n) => <Sym key={n.id} n={n} onClick={() => { onChange(n.kind === "file" ? `file:${n.path}` : `${n.path}:${n.name}`); setHits([]); }} />)}
        </div>
      )}
    </div>
  );
}

const TOML = `[[guard]]
paths = ["migrations/**"]       # globs, like .gitignore
level = "locked"                # read, never edit
reason = "schema changes go through the DBA"

[[guard]]
symbols = ["charge_card"]       # or path:name
level = "review"                # editable, flagged in kula check

[[guard]]
paths = ["data/customers/**"]
level = "hidden"                # never shown to an agent`;

const MCP = `{
  "mcpServers": {
    "kula": { "command": "kula", "args": ["mcp"] }
  }
}`;

const TOOLS: [string, string][] = [
  ["context_pack", "the code a task needs, fitted to a budget"],
  ["pre_edit", "callers, tests, risk, guards and memories before a change"],
  ["verify_edit", "what moved, what broke, what was fenced"],
  ["guards", "what the agent may change"],
  ["remember · recall", "facts about the code, marked stale when it changes"],
  ["sparql", "any structural question over the graph"],
  ["query · context · impact · trace", "the graph itself"],
];

export default function Agents({ version, onChanged, openSymbol }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [memTarget, setMemTarget] = useState("repo");
  const [memText, setMemText] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);
  const [q, setQ] = useState("");
  const toast = useToast();
  const code = useCode();
  const load = () => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]);

  const act = async (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => {
    try { await api.agentAction(action, body); toast(done); await load(); onChanged(); }
    catch (e: any) { toast(e.message, "err"); }
  };
  const open = async (target: string) => {
    if (target === "repo") return;
    if (target.startsWith("file:")) { code.open({ path: target.slice(5) }); return; }
    const raw = target.replace(/^symbol:/, "");
    const [path, name] = [raw.slice(0, raw.lastIndexOf(":")), raw.slice(raw.lastIndexOf(":") + 1)];
    const hits = await api.search(name || raw).catch(() => []);
    const hit = hits.find((h) => h.path === path && h.name === name) ?? hits[0];
    if (hit) openSymbol(hit.id);
  };

  const mems = useMemo(() => (info?.memories ?? [])
    .filter((m) => !onlyStale || m.stale)
    .filter((m) => !q || `${m.target} ${m.body} ${m.author}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || b.created - a.created), [info, onlyStale, q]);
  if (err) return <div className="page"><Empty title="Agent state unavailable">{err}</Empty></div>;
  if (!info) return <div className="page"><div className="muted">Reading guards, task and memories…</div></div>;
  const stale = info.memories.filter((m) => m.stale).length;
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const byLevel = (l: GuardLevel) => fenced.filter((f) => f.verdict.level === l).length;

  return (
    <div className="page agents">
      <header className="page-head">
        <div>
          <div className="eyebrow">for AI agents</div>
          <h1>Agents</h1>
          <p className="muted">What agents working in this repository are told and allowed. MCP tools, the pre-edit hook and <code>kula check</code> all read this.</p>
        </div>
        <div className="ag-status">
          <Status ok={info.mcp_registered} label="MCP server" hint=".mcp.json" />
          <Status ok={info.hook_installed} label="pre-edit hook" hint=".claude/settings.json" />
          <Status ok={info.secrets_hidden} label="secrets hidden" hint="agents.hide_secrets" />
          <Status ok={info.memory_enabled} label="memory" hint="agents.memory" />
        </div>
      </header>

      <div className="ag-strip">
        <div className="kpi-cell"><b>{info.rules.length}</b><span>guard rules</span></div>
        <div className="kpi-cell"><b className={byLevel("locked") ? "lv-locked" : ""}>{byLevel("locked")}</b><span>locked files</span></div>
        <div className="kpi-cell"><b className={byLevel("hidden") ? "lv-hidden" : ""}>{byLevel("hidden")}</b><span>hidden files</span></div>
        <div className="kpi-cell"><b>{info.memories.length}</b><span>memories</span></div>
        <div className="kpi-cell"><b className={stale ? "lv-review" : ""}>{stale}</b><span>stale</span></div>
      </div>

      <div className="ag-grid">
        <div className="ag-col">
        <section className="card ag-task">
          <div className="card-head"><h2>Task</h2><span className="muted">limits what agents may change</span></div>
          {info.task ? (
            <div className="ag-body">
              <div className="ag-task-title">{info.task.title}</div>
              <div className="ag-chips">
                {info.task.scope.length ? info.task.scope.map((s) => <span key={s} className="tag mono">{s}</span>) : <span className="tag">whole repository</span>}
              </div>
              <div className="muted ag-meta">started {relTime(info.task.started)} by {info.task.by} · everything outside the scope is read-only for agents</div>
              <div className="row"><span className="spacer" /><button className="btn sm" onClick={() => act("task_done", {}, "Task done – scope lifted")}>Finish task</button></div>
            </div>
          ) : (
            <form className="ag-body stack" onSubmit={(e) => { e.preventDefault(); act("task_start", { title, scope: scope.split(",") }, "Task started"); setTitle(""); setScope(""); }}>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the agent is doing, e.g. speed up login" />
              <input className="input mono" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="scope: src/auth/**, login, session.ts" spellCheck={false} />
              <div className="row"><span className="muted ag-meta">globs and symbol names, comma separated; empty means the whole repo</span><span className="spacer" /><button className="btn sm primary" disabled={!title.trim()}>Start task</button></div>
            </form>
          )}
        </section>

        <section className="card ag-connect">
            <div className="card-head"><h2>Connect an agent</h2><span className="spacer" /><span className="mono muted">kula init --agents</span></div>
            <div className="ag-body">
              <p className="muted">Claude Code, Cursor, Codex and any MCP client read <code>.mcp.json</code>:</p>
              <Snippet text={MCP} />
              <p className="muted">The hook blocks edits to locked or out-of-scope files and reads of hidden ones, before they happen:</p>
              <Snippet text={`kula guard hook   # PreToolUse, matcher Edit|MultiEdit|Write|NotebookEdit|Read`} />
              <div className="section-title">Tools</div>
              {TOOLS.map(([t, d]) => <div key={t} className="ag-tool"><span className="mono">{t}</span><span className="muted">{d}</span></div>)}
            </div>
          </section>
        </div>

        <section className="card ag-fences">
          <div className="card-head"><h2>Fences</h2><span className="muted">kula.toml</span><span className="spacer" /><span className="count">{info.rules.length}</span></div>
          {info.rules.length === 0 ? (
            <div className="ag-body">
              <p className="muted">No guard rules yet{info.secrets_hidden ? " – secrets (.env, keys, certificates) are still hidden from agents" : ""}. Add rules to <code>kula.toml</code>:</p>
              <Snippet text={TOML} />
            </div>
          ) : (
            <div className="ag-body">
              {info.rules.map((r, i) => (
                <div key={i} className="ag-rule">
                  <span className="mono muted">#{i + 1}</span>
                  <GuardTag level={r.level} />
                  <span className="mono ag-what">{[...r.paths, ...r.symbols].join(", ")}</span>
                  <span className="muted ag-why">{r.reason}</span>
                </div>
              ))}
              {fenced.length > 0 && <div className="section-title">Fenced files <span className="count">{fenced.length}</span></div>}
              {fenced.slice(0, 30).map((f) => (
                <button key={f.path} className="ag-file" onClick={() => code.open({ path: f.path })} title={f.verdict.reason}>
                  <GuardTag level={f.verdict.level} /><span className="mono">{f.path}</span>
                </button>
              ))}
              {fenced.length > 30 && <div className="muted ag-meta">and {fenced.length - 30} more – `kula guard list`</div>}
            </div>
          )}
        </section>

        <section className="card ag-memory">
          <div className="card-head">
            <h2>Memory</h2><span className="muted">pinned to code · stored in refs/kula/meta</span><span className="spacer" />
            <div className="seg">
              <button className={!onlyStale ? "on" : ""} onClick={() => setOnlyStale(false)}>All {info.memories.length}</button>
              <button className={onlyStale ? "on" : ""} onClick={() => setOnlyStale(true)}>Stale {stale}</button>
            </div>
          </div>
          <div className="ag-body">
            <form className="ag-remember" onSubmit={(e) => { e.preventDefault(); act("remember", { target: memTarget, text: memText }, "Remembered"); setMemText(""); }}>
              <TargetInput value={memTarget} onChange={setMemTarget} placeholder="repo · file:path · symbol" />
              <input className="input" value={memText} onChange={(e) => setMemText(e.target.value)} placeholder="One fact agents should know, e.g. tokens are hashed twice for legacy clients" />
              <button className="btn sm primary" disabled={!memText.trim() || !info.memory_enabled}>Remember</button>
            </form>
            {info.memories.length > 4 && <input className="input ag-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter memories…" />}
            {mems.length === 0 && <div className="muted ag-empty">{info.memories.length ? "Nothing matches." : "No memories yet. Agents add them with the `remember` tool; so can you."}</div>}
            {mems.map((m) => <MemoryRow key={m.id} m={m} open={open} act={act} />)}
          </div>
        </section>

      </div>
    </div>
  );
}

function Status({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return <span className={`ag-st ${ok ? "ok" : ""}`} title={hint}><i className={`dot ${ok ? "ok" : ""}`} />{label}</span>;
}

function MemoryRow({ m, open, act }: { m: Memory; open: (t: string) => void; act: (a: "confirm" | "forget", b: Record<string, unknown>, done: string) => void }) {
  return (
    <div className={`ag-mem ${m.stale ? "stale" : ""}`}>
      <div className="row ag-mem-head">
        <span className={`tag ${m.stale ? "yellow" : "green"}`} title={m.stale ? "The code changed after this was written" : "Written about the code as it is"}>{m.stale ? "stale" : "fresh"}</span>
        <button className="ag-target mono" onClick={() => open(m.target)} title="Open">{m.target.replace(/^symbol:/, "")}</button>
        <span className="spacer" />
        <span className="muted ag-meta">#{m.id} · {m.author} · {relTime(m.created)}</span>
        {m.stale && <button className="btn sm" onClick={() => act("confirm", { id: m.id }, "Still true – re-anchored")} title="It still holds: anchor it to the code as it is now">Still true</button>}
        <button className="btn sm ghost danger" onClick={() => { if (confirm("Forget this memory?")) act("forget", { id: m.id }, "Forgotten"); }}>Forget</button>
      </div>
      <div className="ag-mem-body">{m.body}</div>
    </div>
  );
}

export function Snippet({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="snippet">
      <pre className="code">{text}</pre>
      <button className="btn sm ghost snippet-copy" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }} aria-label="Copy">
        {done ? "copied" : <><Icon.copy /> copy</>}
      </button>
    </div>
  );
}
