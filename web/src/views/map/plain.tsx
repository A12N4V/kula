// U9 – the reading layer: the map speaks plain words. One shared fetch of
// GET /api/map/explain feeds the square captions (BlockNode reads the same
// store), the "Map in plain words" run control and the question box. No
// module-load side effects – plain state is module-level but nothing runs at
// import (progress.tsx's pattern), so Workers importing this file's
// neighbours stay safe.
import { useEffect, useState } from "react";
import { get, post } from "../../api";

// ––– the explain store –––

export interface ExplainBlock {
  plain?: string;
  sentence?: string;
  source?: "model" | "theme" | "name";
}
export interface ExplainPayload {
  blocks: Record<string, ExplainBlock>;
  stale?: boolean;
  status: { named: number; total: number };
  agent?: string;
}
export interface QuestionHit { id: string; plain: string; score: number }

let ex: ExplainPayload | null = null;
let loading = false;
const exSubs = new Set<() => void>();
const notifyEx = () => exSubs.forEach((f) => f());

/** Re-read /api/map/explain once and tell every subscriber (captions, panel). */
export async function refreshExplain(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    ex = await get<ExplainPayload>("/api/map/explain");
    notifyEx();
  } catch { /* offline – captions fall back to themes */ }
  loading = false;
}

/** Subscribe to the explain payload; fetches it on first use. */
export function useExplain(): ExplainPayload | null {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    exSubs.add(f);
    if (!ex) void refreshExplain();
    return () => { exSubs.delete(f); };
  }, []);
  return ex;
}

// ––– the reading-layer switches –––

/** "Show code names" – shared so the toggle (right column) and the captions
    (BlockNode) read one switch. Session-persisted. */
let showCode = (() => { try { return sessionStorage.getItem("kula.map.codeNames") === "1"; } catch { return false; } })();
const codeSubs = new Set<() => void>();
export function setShowCode(v: boolean): void {
  if (v === showCode) return;
  showCode = v;
  try { sessionStorage.setItem("kula.map.codeNames", v ? "1" : "0"); } catch { /* private */ }
  codeSubs.forEach((f) => f());
}
export function useShowCode(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    codeSubs.add(f);
    return () => { codeSubs.delete(f); };
  }, []);
  return showCode;
}

// ––– the question box's lit squares –––

let qHits: string[] = [];
let qTop: string | null = null;
const qSubs = new Set<() => void>();
const notifyQ = () => qSubs.forEach((f) => f());
export function setQuestionHits(hits: string[], top: string | null): void {
  qHits = hits;
  qTop = top;
  notifyQ();
}
export function clearQuestionHits(): void { if (qHits.length || qTop) setQuestionHits([], null); }
export function useQuestionHits(): { hits: string[]; top: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    qSubs.add(f);
    return () => { qSubs.delete(f); };
  }, []);
  return { hits: qHits, top: qTop };
}

// ––– the run control ("Map in plain words") –––

/** Kick the user's agent over the kula-map skill. `all` re-maps with another
    model; `agent` picks which agent runs it. Resolves the server's answer so
    the panel can show the reason when the run cannot start. */
export async function runExplain(opts: { all?: boolean; agent?: string } = {}): Promise<{ started: boolean; reason?: string }> {
  const r = await post<{ started: boolean; reason?: string }>("/api/map/explain/run", opts);
  return r;
}

// ––– components –––

/** The right column's reading-layer panel: run control, progress readout,
    the code-names toggle and the re-map-with-another-model option. */
export function PlainPanel({ agents, onPick }: { agents?: string[]; onPick?: (id: string) => void }) {
  const data = useExplain();
  const show = useShowCode();
  const [running, setRunning] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [remap, setRemap] = useState(false);
  const [agent, setAgent] = useState<string>(agents?.[0] ?? "");
  // Progress = status.named / total, polled while a run is under way (the
  // progress.tsx cadence, slower while idle). The readout stays visible once
  // the payload is in, so the reader can see how far the words have come.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const t = setInterval(() => {
      if (stop) return;
      void refreshExplain().then(() => {
        if (stop) return;
        if (ex && !ex.stale && ex.status.named >= ex.status.total) setRunning(false);
      });
    }, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [running]);

  const start = async (opts: { all?: boolean; agent?: string }) => {
    setReason(null);
    const r = await runExplain(opts);
    if (!r.started) { setReason(r.reason ?? "the run could not start"); return; }
    setRunning(true);
    void refreshExplain();
  };

  return (
    <div className="u9-panel" data-testid="u9-plain-panel">
      <div className="u9-row">
        <button className="btn sm" data-testid="x5-plain-run" onClick={() => void start({})}
          disabled={running} title="Name every block in plain words with your agent">
          Map in plain words
        </button>
        {remap && agents && agents.length > 0 && (
          <select className="u9-agent mono" value={agent} onChange={(e) => setAgent(e.target.value)}
            aria-label="Agent to re-map with">
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <button className="btn ghost sm" data-testid="x5-plain-remap"
          onClick={() => {
            // First click reveals the agent pick; the second re-maps with
            // another model (all: true) using the chosen agent.
            if (!remap) { setRemap(true); return; }
            setRemap(false);
            void start({ all: true, agent });
          }}
          title="Re-map with another model (all: true)">
          Re-map with another model
        </button>
      </div>
      {data && (
        <div className="u9-progress mono" data-testid="x5-plain-progress" role="status" aria-live="polite">
          {data.status.named} / {data.status.total} named{running ? " – mapping…" : data.stale ? " – some out of date" : ""}
        </div>
      )}
      {reason && <div className="u9-reason" data-testid="x5-plain-reason" role="alert">{reason}</div>}
      {/* A button with aria-pressed, not a checkbox (a checkbox's role ignores
          aria-pressed – the contract's state signal must stay readable). */}
      <button type="button" className={`u9-toggle-row${show ? " on" : ""}`} data-testid="x5-plain-toggle"
        aria-pressed={show ? "true" : "false"}
        onClick={() => setShowCode(!show)}>
        Show code names
      </button>
    </div>
  );
}

/** The rail search's "Ask in plain words" mode: the query goes to semantic
    search, the top squares light up, the results list under the box pairs
    each hit's plain name with its score, and picking one pans to its square. */
export function RailSearch({ open, value, onChange, onSubmit, onPick }: {
  open: boolean; value: string; onChange: (v: string) => void; onSubmit: () => void; onPick: (blockId: string) => void;
}) {
  const [mode, setMode] = useState(false);
  const [results, setResults] = useState<QuestionHit[] | null>(null);
  const ask = async () => {
    const s = value.trim();
    if (!s) return;
    try {
      const r = await get<{ hits: QuestionHit[]; mode: string }>(`/api/search/semantic?q=${encodeURIComponent(s)}&limit=5`);
      const hits = r.hits ?? [];
      setResults(hits);
      // Hits are block ids, but a hit folded inside a closed square has no
      // square to light – it lights its top-level ancestor instead (the
      // answer's neighbourhood). The top answer's square is ringed and the
      // camera reveals it via onPick, so the answer is on screen (X5 §4).
      let byId = new Map<string, { id: string; parent?: string | null }>();
      try {
        const raw = await get<{ blocks: Record<string, { id: string; parent?: string | null }> | { id: string; parent?: string | null }[] }>("/api/map");
        const list = Array.isArray(raw.blocks) ? raw.blocks : Object.values(raw.blocks);
        byId = new Map(list.map((b) => [b.id, b]));
      } catch { /* keep the raw ids */ }
      const topOf = (id: string): string => {
        let b = byId.get(id);
        while (b?.parent != null && b.parent !== "__root") b = byId.get(b.parent);
        return b?.id ?? id;
      };
      const lits = [...new Set(hits.map((h) => topOf(h.id)))];
      const top = hits[0] ? topOf(hits[0].id) : null;
      setQuestionHits(lits, top);
      if (top) onPick(top);
    } catch { /* offline – the box stays open */ }
  };
  const close = () => { setResults(null); clearQuestionHits(); };
  // With the box closed and the question mode off, the rail carries only the
  // "Ask in plain words" pill – the mode must be reachable with no click to
  // open anything (X5 §4; the critic's T8 finding). Turning it on opens the
  // question box in place; the rail's search icon still toggles `open`.
  if (!open && !mode) {
    return (
      <button type="button" className="u9-q-peek" data-testid="x5-question-mode"
        title="Ask in plain words – search by meaning"
        onClick={() => setMode(true)}>
        Ask in plain words
      </button>
    );
  }
  return (
    <>
      <form className="u2-rail-search" data-testid="u2-rail-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode) void ask(); else { close(); onSubmit(); }
        }}>
        <button type="button" className={`u9-q-mode${mode ? " on" : ""}`} data-testid="x5-question-mode"
          aria-pressed={mode ? "true" : "false"} title="Ask in plain words – search by meaning"
          onClick={() => { if (mode) close(); setMode((m) => !m); }}>
          Ask in plain words
        </button>
        <input autoFocus value={value} onChange={(e) => onChange(e.target.value)}
          data-testid={mode ? "x5-question-input" : "u2-rail-search-input"}
          aria-label={mode ? "Ask in plain words" : "Search the map"}
          placeholder={mode ? "Where does … happen?" : "Search code…"} />
      </form>
      {mode && results && (results.length > 0 ? (
        <ul className="u9-results">
          {results.map((h, i) => (
            <li key={h.id}>
              <button type="button" className="u9-result" data-testid="x5-question-result"
                onClick={() => { onPick(h.id); close(); }}>
                <span className="u9-result-name">{h.plain}</span>
                <span className="u9-result-score mono">{Math.round(h.score * 100)}%</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="u9-results-empty">nothing on the map answers that</div>
      ))}
    </>
  );
}
