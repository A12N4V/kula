// U3 · The agent inspector on the map: four tabs – Setup · Script · Runs ·
// Memory (ux §6). Structured fields first, a raw-file toggle second, and the
// two are two-way: the raw JSON view edits the same draft the fields do
// (PLAN P4.2). Saves go through agents_action workflows_save on an explicit
// action with a stale-guard – never on blur, because the workspace polls
// every 5s and a blur-save would clobber a concurrent edit.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentsInfo, type Workflow } from "../../api";
import { Icon } from "../../ui";
import { AUTONOMY_LABEL, defaultAutonomy, readCfg, writeCfg, type Autonomy, type Caps } from "./agentConfig";
import { titleCase } from "./actors";

export type AgentInspectorProps = {
  info: AgentsInfo;
  agent: string;
  data: import("../map/types").MapData | null;
  onSaved: () => void;
  /** Clicking a @block chip selects the block on the canvas – same camera path as search, no re-layout (B8). */
  onFocusBlock: (id: string) => void;
  /** Open with the Setup model field focused (missing-Model red mark, §7). */
  focusModel?: boolean;
};

const TABS = ["Setup", "Script", "Runs", "Memory"] as const;
type TabT = (typeof TABS)[number];

const oneLine = (s: string) => s.split(/(?<=[.!?])\s/)[0] ?? s;

/** Autonomy defaults by role (contract §5) until the per-agent config says otherwise. */
const autonomyOf = (wf: Workflow): Autonomy => readCfg(wf.name).autonomy ?? defaultAutonomy(wf);

/** Parse a prompt into prose and live @block chips: `@name` or `@sec:name`
    resolves against the map by longest name first, so names with spaces
    ("benches · input_json") still chip. Unknown names stay plain text. */
export function promptParts(prompt: string, data: import("../map/types").MapData | null): { text: string; block?: { id: string; name: string } }[] {
  const names = data
    ? Object.values(data.blocks).map((b) => ({ id: b.id, name: b.theme || b.name })).filter((n) => n.name)
    : [];
  names.sort((a, b) => b.name.length - a.name.length);
  const parts: { text: string; block?: { id: string; name: string } }[] = [];
  let i = 0;
  while (i < prompt.length) {
    const at = prompt.indexOf("@", i);
    if (at < 0) { parts.push({ text: prompt.slice(i) }); break; }
    if (at > i) parts.push({ text: prompt.slice(i, at) });
    const hit = names.find((n) => prompt.startsWith("@" + n.name, at) || prompt.startsWith("@sec:" + n.name, at));
    if (hit) {
      const len = (prompt.startsWith("@sec:", at) ? 5 : 1) + hit.name.length;
      parts.push({ text: prompt.slice(at, at + len), block: hit });
      i = at + len;
    } else { parts.push({ text: "@" }); i = at + 1; }
  }
  return parts.filter((p) => p.text);
}

export function AgentInspector({ info, agent, data, onSaved, onFocusBlock, focusModel }: AgentInspectorProps) {
  const wf0 = info.workflows.find((w) => w.name === agent);
  const [tab, setTab] = useState<TabT>("Setup");
  const modelRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Workflow | null>(wf0 ?? null);
  const [raw, setRaw] = useState(false);
  const [autonomy, setAutonomy] = useState<Autonomy>(() => wf0 ? autonomyOf(wf0) : "ask-risky");
  const [caps, setCaps] = useState<Caps>(() => readCfg(agent).caps);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Stale-guard: the about+scope fingerprint captured when the draft loaded;
  // a save refuses to write if the server's copy moved under us.
  const base = useRef<string>("");
  useEffect(() => {
    const wf = info.workflows.find((w) => w.name === agent);
    if (!wf) return;
    setDraft(wf);
    base.current = JSON.stringify([wf.about, wf.scope, wf.prompt]);
    setAutonomy(autonomyOf(wf));
  }, [info, agent]);
  useEffect(() => { if (focusModel) modelRef.current?.focus(); }, [focusModel, tab]);

  if (!wf0 || !draft) return null;
  const missing = !info.connections.some((c) => (c.mcp || c.hook) && c.workflows.includes(agent));
  const paths = draft.scope ?? [];
  const fencedSections = useMemo(() => {
    if (!data || !paths.length) return [];
    const hits: string[] = [];
    for (const b of Object.values(data.blocks)) {
      if (!(b.depth === 0 && b.parent !== null)) continue;
      for (const sym of collectSyms(data, b.id)) {
        const p = data.leaves[sym]?.path;
        if (p && paths.some((s) => p === s || p.startsWith(s.replace(/\/?\*\*?.*$/, "") + "/") || globHit(s, p))) { hits.push(b.id); break; }
      }
    }
    return hits;
  }, [data, paths.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!draft) return;
    if (JSON.stringify([draft.about, draft.scope, draft.prompt]) !== base.current) {
      setErr("Changed elsewhere since you opened it – reload the inspector and try again.");
      return;
    }
    writeCfg(agent, { autonomy, caps });
    try {
      await api.agentAction("workflows_save", { workflows: [...info.workflows.filter((w) => !w.builtin).map((w) => w.name === agent ? draft : w)] });
      setSavedAt(Date.now()); setErr(null); onSaved();
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  };

  return (
    <div className="at-insp" data-testid="agent-inspector" data-agent={agent}>
      <div className="at-insp-summary">
        <span className="at-mark sm" data-figure aria-hidden="true"><Icon.agents /></span>
        <span>{oneLine(draft.about || `${titleCase(agent)} – a work mode with its own fences.`)}</span>
        {missing && <span className="at-missing lg" data-testid="inspector-missing-model" title="No model connected – set one below" aria-label="missing model" />}
      </div>
      <div className="at-tabs" role="tablist" aria-label="Agent inspector">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab-btn${tab === t ? " on" : ""}`}
            data-testid={`insp-tab-${t.toLowerCase()}`} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span className="spacer" />
        <button className={`tab-btn${raw ? " on" : ""}`} aria-pressed={raw} data-testid="at-raw-toggle"
          title="Edit the workflow config as raw JSON – the same draft, two ways"
          onClick={() => setRaw(!raw)}>raw</button>
      </div>
      {tab === "Setup" && (
        <div className="at-pane" data-testid="at-pane-setup">
          <label className="at-field"><span className="ws-eyebrow">model{missing ? " – required, missing" : ""}</span>
            <input ref={modelRef} className={`mono${missing ? " at-req" : ""}`} data-testid="at-model"
              placeholder="model id, e.g. minimax-m2" defaultValue={info.default_agent ?? ""}
              onChange={() => { /* model lives with the connection – surfaced, not writable here */ }} readOnly /></label>
          {missing && <p className="at-hint">No integration serves this agent – connect one in the Library (Connections) so the Model port has something to plug into.</p>}
          <div className="at-field"><span className="ws-eyebrow">autonomy</span>
            <div className="at-seg" role="radiogroup" aria-label="Autonomy" data-testid="at-autonomy">
              {(["ask", "ask-risky", "auto"] as const).map((a) => (
                <button key={a} role="radio" aria-checked={autonomy === a} data-testid={`at-auto-${a}`}
                  className={`at-seg-btn${autonomy === a ? " on" : ""}`}
                  title={a === "ask" ? "Ask before every run" : a === "ask-risky" ? "Ask only when the run writes outside the fence, deletes, touches the network or changes dependencies" : "Run without asking"}
                  onClick={() => setAutonomy(a)}>{AUTONOMY_LABEL[a]}</button>
              ))}
            </div></div>
          <p className="at-hint">Default by role: read-only roles Auto, code writers Ask on risky, gate agents Ask. Risky = writes outside the fence, deletes, network, dependency changes.</p>
          <div className="at-field"><span className="ws-eyebrow">caps</span>
            <div className="at-caps">
              {([["cost", "cost (USD)"], ["time", "time (min)"], ["files", "files changed"]] as const).map(([k, label]) => (
                <label key={k} className="at-cap"><span>{label}</span>
                  <input type="number" min="0" step="any" className="mono" data-testid={`at-cap-${k}`} value={caps[k] ?? ""}
                    onChange={(e) => setCaps({ ...caps, [k]: e.target.value === "" ? undefined : +e.target.value })} /></label>
              ))}
            </div></div>
          <div className="at-field"><span className="ws-eyebrow">fence · {paths.length} paths</span>
            <ul className="at-paths mono">{paths.length ? paths.slice(0, 12).map((p) => <li key={p}>{p}</li>) : <li className="at-hint">No fence – the agent may read everything and change nothing.</li>}</ul></div>
        </div>
      )}
      {tab === "Script" && (
        <div className="at-pane" data-testid="at-pane-script">
          <label className="at-field"><span className="ws-eyebrow">prompt · @block chips resolve live</span>
            <textarea className="mono at-prompt" data-testid="at-prompt" rows={5}
              value={draft.prompt ?? ""} placeholder="Describe the loop – @section-name chips link the blocks this agent works on"
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} /></label>
          {data && (
            <div className="at-chips" data-testid="at-block-chips">
              {promptParts(draft.prompt ?? "", data).filter((p) => p.block).map((p, i) => (
                <button key={i} className="ws-chip at-chip" title="Show this block on the canvas – selects and pans, never re-lays-out"
                  onClick={() => onFocusBlock(p.block!.id)}>@{p.block!.name}</button>
              ))}
              {!promptParts(draft.prompt ?? "", data).some((p) => p.block) && <span className="at-hint">No @block chips yet – type @name in the prompt.</span>}
            </div>
          )}
          <div className="at-field"><span className="ws-eyebrow">steps</span>
            <ol className="at-steps">{(draft.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol></div>
        </div>
      )}
      {tab === "Runs" && (
        <div className="at-pane" data-testid="at-pane-runs">
          {info.task?.workflow === agent ? (
            <div className="at-run-row"><span className="at-run">running</span> {info.task.title} <span className="mono">fence {info.task.scope.length} paths</span></div>
          ) : <p className="at-hint">Not running. Use the card's Run verb on the canvas.</p>}
          {info.research.filter((r) => r.workflow === agent).map((r) => (
            <div className="at-run-row" key={r.workflow}><span className={r.active ? "at-run" : ""}>{r.active ? "loop" : "loop idle"}</span>
              <span className="mono">{r.metric} {r.best} from {r.baseline} · {r.experiments.length} experiments</span></div>
          ))}
        </div>
      )}
      {tab === "Memory" && (
        <div className="at-pane" data-testid="at-pane-memory">
          {info.memories.length
            ? <ul className="lib-mem">{info.memories.filter((m) => (m as { via?: string }).via === agent || (m as { target?: string }).target === agent || info.memories.length < 6).slice(0, 8).map((m, i) => <li key={i}>{(m as { text?: string }).text ?? String(m)}</li>)}</ul>
            : <p className="at-hint">No memories yet – agents write facts here as they work.</p>}
        </div>
      )}
      {raw && (
        <div className="at-pane" data-testid="at-pane-raw">
          <label className="at-field"><span className="ws-eyebrow">raw config – the same draft, two ways</span>
            <textarea className="mono at-raw" data-testid="at-raw" rows={10}
              defaultValue={JSON.stringify({ name: draft.name, about: draft.about, scope: draft.scope, lock: draft.lock, hide: draft.hide, review: draft.review, memory: draft.memory, steps: draft.steps, docs: draft.docs, prompt: draft.prompt }, null, 2)}
              onChange={(e) => {
                try { setDraft({ ...draft, ...JSON.parse(e.target.value) as Workflow }); setErr(null); }
                catch { setErr("Raw JSON does not parse – the fields keep the last good draft."); }
              }} /></label>
        </div>
      )}
      {err && <div className="at-err" role="alert">{err}</div>}
      {savedAt != null && <div className="at-ok">Saved.</div>}
      <div className="row at-actions">
        <button className="btn sm primary" data-testid="at-save" onClick={() => void save()}>Save agent</button>
        <span className="at-hint">Explicit save – never on blur, so a concurrent edit is not clobbered.</span>
      </div>
      {fencedSections.length > 0 && <div className="at-hint mono">fence covers {fencedSections.length} sections on this map</div>}
    </div>
  );
}

function collectSyms(data: import("../map/types").MapData, id: string, out: number[] = []): number[] {
  const b = data.blocks[id];
  if (!b) return out;
  out.push(...b.symbols);
  for (const c of b.children) collectSyms(data, c, out);
  return out;
}

function globHit(scope: string, path: string): boolean {
  if (!/[*?]/.test(scope)) return false;
  const re = new RegExp("^" + scope.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(path);
}