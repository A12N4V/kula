// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Fences tab: the rules in kula.toml and what is fenced right now (module S1).

import { useEffect, useRef, useState } from "react";
import { get, type AgentsInfo, type GuardLevel, type RawRule, type Verdict } from "../../api";
import { Chips } from "../../Autofill";
import { useCode } from "../../CodePanel";
import { Icon } from "../../ui";
import type { Act } from "./data";
import { AGENT_IDS, AGENT_NAME } from "./data";
import { Card, GuardTag, LEVEL_MEANS, SuggestionRow, useListNav } from "./parts";

export default function Fences({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void }) {
  const [rules, setRules] = useState<RawRule[]>(info.raw_rules);
  // Only follow the server when the server's fences actually change – a late
  // refresh of `info` must never wipe edits the user has not saved yet.
  const serverKey = useRef(JSON.stringify(info.raw_rules));
  useEffect(() => {
    const key = JSON.stringify(info.raw_rules);
    if (key !== serverKey.current) {
      serverKey.current = key;
      setRules(info.raw_rules);
    }
  }, [info]);
  const dirty = JSON.stringify(rules) !== serverKey.current;
  const fenced = info.files.filter((f) => f.verdict.level !== "scope");
  const set = (i: number, r: Partial<RawRule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...r } : x)));
  const sugg = info.suggestions.filter((s) => s.kind === "guard");
  return (
    <div className="ag-grid">
      <Card title="Fences" sub="kula.toml" className="ag-wide"
        right={<><button className="btn sm ghost" onClick={() => onGraph()}><Icon.graph /> On the graph</button>{dirty && <button className="btn sm ghost" onClick={() => setRules(info.raw_rules)}>Revert</button>}<button className="btn sm primary" disabled={!dirty} onClick={() => act("guards_save", { rules }, "Fences saved to kula.toml").catch(() => {})}>Save</button></>}>
        {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
        <div className="fence-legend">
          {(["locked", "hidden", "review"] as GuardLevel[]).map((l) => <span key={l}><GuardTag level={l} /> {LEVEL_MEANS[l]}</span>)}
        </div>
        {rules.length === 0 && <div className="muted ag-empty">No fences.</div>}
        {rules.map((r, i) => (
          <div key={i} className={`fence-row fr-${r.level}`}>
            <span className="loop-n">{String(i + 1).padStart(2, "0")}</span>
            <select className="input fence-level" value={r.level} onChange={(e) => set(i, { level: e.target.value as RawRule["level"] })} aria-label="Level">
              <option value="locked">locked</option><option value="hidden">hidden</option><option value="review">review</option>
            </select>
            <div className="fence-what">
              <Chips values={r.paths ?? []} onChange={(v) => set(i, { paths: v })} placeholder="paths: migrations/**, src/gen/" label="Paths" />
              <Chips values={r.symbols ?? []} onChange={(v) => set(i, { symbols: v })} placeholder="symbols: charge_card or src/pay.rs:charge" as="name" label="Symbols" />
            </div>
            <input className="input fence-why" value={r.reason ?? ""} onChange={(e) => set(i, { reason: e.target.value })} placeholder="why – agents are told this" aria-label="Reason" />
            <button className="btn sm ghost icon-only danger" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove fence"><Icon.close /></button>
          </div>
        ))}
        <div className="row">
          <button className="btn sm" onClick={() => setRules([...rules, { level: "locked", paths: [], symbols: [], reason: "" }])}><Icon.plus /> Add fence</button>
          <span className="spacer" />
          <label className="toggle"><input type="checkbox" checked={info.secrets_hidden} onChange={(e) => act("settings_save", { agents: { hide_secrets: e.target.checked, memory: info.memory_enabled, docs: info.docs_list } }, e.target.checked ? "Secrets hidden from agents" : "Secrets visible to agents")} /> hide likely secrets (.env, keys, certificates)</label>
        </div>
      </Card>
      {info.workflow && info.workflow_rules.length > 0 && (
        <Card title={`From the ${info.workflow.name} workflow`}>
          {info.workflow_rules.map((r, i) => (
            <div key={i} className="ag-rule"><span className="mono muted">w{i + 1}</span><GuardTag level={r.level} /><span className="mono ag-what">{[...r.paths, ...r.symbols].join(", ")}</span></div>
          ))}
        </Card>
      )}
      <PathTest />
      <FencedList fenced={fenced} />
    </div>
  );
}

/** Test one path against the fences, as the task and as each agent would see it. */
type PathVerdict = { path: string; task: Verdict; agents: Record<string, Verdict> };

function PathTest() {
  const [path, setPath] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<PathVerdict | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const test = (p: string) => {
    setAsked(p);
    setBusy(true);
    get<PathVerdict>(`/api/agent/guard_path?path=${encodeURIComponent(p)}`)
      .then((r) => { setResult(r); setErr(null); })
      .catch((e) => { setErr(e.message); setResult(null); })
      .finally(() => setBusy(false));
  };
  return (
    <Card title="Test a path" sub="read-only – what the fences would tell each agent">
      <form className="row ag-test" onSubmit={(e) => { e.preventDefault(); if (path.trim()) test(path.trim()); }}>
        <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="src/mcp.rs or src/pay.rs:charge" aria-label="Path to test" />
        <button className="btn sm primary" disabled={!path.trim() || busy}>Test</button>
      </form>
      {err && <div className="ag-test-err">{err}</div>}
      {result && result.path === asked && (
        <div className="ag-test-out">
          <div className="ag-test-line"><span className="ag-test-who">task</span><GuardTag level={result.task.level} /><span className="muted ag-test-why">{result.task.reason}</span><span className="muted mono ag-test-rule">{result.task.rule}</span></div>
          {AGENT_IDS.map((a) => {
            const v = result.agents[a];
            return v ? <div key={a} className="ag-test-line"><span className="ag-test-who"><span className="ag-test-agent">{AGENT_NAME[a] ?? a}</span></span><GuardTag level={v.level} /><span className="muted ag-test-why">{v.reason}</span><span className="muted mono ag-test-rule">{v.rule}</span></div> : null;
          })}
        </div>
      )}
      {asked && !busy && !err && (!result || result.path !== asked) && <div className="muted ag-empty">Testing…</div>}
    </Card>
  );
}

function FencedList({ fenced }: { fenced: AgentsInfo["files"] }) {
  const code = useCode();
  const [sort, setSort] = useState<"level" | "path">("level");
  const rows = sort === "level"
    ? [...fenced].sort((a, b) => ORDER.indexOf(a.verdict.level) - ORDER.indexOf(b.verdict.level) || a.path.localeCompare(b.path))
    : [...fenced].sort((a, b) => a.path.localeCompare(b.path));
  const nav = useListNav(rows.length, (i) => code.open({ path: rows[i].path }), sort);
  return (
    <Card title="Fenced right now" sub={`${fenced.length} file${fenced.length === 1 ? "" : "s"}`}
      right={<div className="seg ag-sort" aria-label="Sort fenced files">{(["level", "path"] as const).map((s) => <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>{s}</button>)}</div>}>
      {rows.length === 0 && <div className="muted ag-empty">Nothing fenced in the graph.</div>}
      <div {...nav.props}>
        {rows.slice(0, 40).map((f, i) => (
          <button key={f.path} className={`ag-file row-hover ${nav.sel === i ? "kb-sel" : ""}`} data-idx={i} id={`list-item-${i}`} onClick={() => code.open({ path: f.path })} title={`${f.verdict.reason} (${f.verdict.rule})`}>
            <GuardTag level={f.verdict.level} /><span className="mono">{f.path}</span><span className="muted ag-rule-src">{f.verdict.rule}</span>
          </button>
        ))}
      </div>
      {rows.length > 40 && <div className="muted ag-meta">and {rows.length - 40} more – <code>kula guard list</code></div>}
    </Card>
  );
}

const ORDER: GuardLevel[] = ["locked", "hidden", "review", "scope", "open"];
