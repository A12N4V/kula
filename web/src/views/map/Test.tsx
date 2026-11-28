// The test drawer: the owner's hand A/B harness. Six tasks from the repo's
// own flowmap, answered by clicking the thing on the map, then ratings and a
// note. Results stay in localStorage; Copy results gives the JSON.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTasks, clearResults, isCorrect, loadResults, resultsJSON, saveResult, sessionOrder,
  summary, VARIANT_LABEL, type ABResult, type ABRatings, type Pick, type VariantId,
} from "./ab";
import type { MapModel } from "./model";
import type { OverlayState } from "./overlays";

type Phase = "task" | "rate" | "done";

const RATING_ROWS: { key: keyof ABRatings; label: string }[] = [
  { key: "clarity", label: "Clarity" },
  { key: "speed", label: "Speed" },
  { key: "look", label: "Look" },
];

export function Test({ model, overlays, now, pick, onVariant }: {
  model: MapModel;
  overlays: OverlayState;
  now: number;
  /** The current map selection: a click may answer the open task. */
  pick: Pick | null;
  onVariant: (v: VariantId) => void;
}) {
  const order = useMemo(() => sessionOrder(), []);
  const tasks = useMemo(() => buildTasks(model, overlays, now), [model, overlays, now]);
  const [ti, setTi] = useState(0);
  const [vi, setVi] = useState(0);
  const [phase, setPhase] = useState<Phase>("task");
  const [started, setStarted] = useState(0);
  const [result, setResult] = useState<ABResult | null>(null);
  const [ratings, setRatings] = useState<ABRatings | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const seen = useRef(false);

  const variant = order[vi] ?? "a";
  const task = tasks[ti];

  // One timer per task: starts when the task is first shown.
  useEffect(() => {
    if (!task) return;
    seen.current = false;
    setStarted(Date.now());
  }, [ti, variant, task]);

  // A click on the map answers the task, checked when the answer is checkable.
  useEffect(() => {
    if (!task || !pick || seen.current) return;
    seen.current = true;
    const r: ABResult = {
      task: task.n, prompt: task.prompt, variant, ms: Date.now() - started,
      correct: isCorrect(task, pick), ratings: null, note: "", at: Date.now(),
    };
    setResult(r);
    setPhase("rate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  const record = () => {
    if (!result) return;
    const done: ABResult = { ...result, ratings, note };
    saveResult(done);
    setResult(null);
    setRatings(null);
    setNote("");
    setPhase("task");
    if (ti + 1 < tasks.length) setTi(ti + 1);
    else if (vi + 1 < order.length) { setTi(0); setVi(vi + 1); }
    else setPhase("done");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(resultsJSON());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be blocked; the textarea below still shows the JSON */ }
  };

  const rows = summary(loadResults());

  return (
    <aside className="map-test" data-testid="ab-drawer" aria-label="Map A/B test">
      <h3 className="map-title">Map test</h3>
      {phase === "task" && task && (
        <div className="map-test-task" data-testid="ab-task">
          <p className="map-sentence">
            Task {task.n + ti * 0} of 6 · variant {VARIANT_LABEL[variant]}
          </p>
          <p className="map-task-text">{task.prompt || "No data for this task on this repo"}</p>
          <p className="map-hint">Answer by clicking the thing on the map.</p>
          <div className="map-test-actions">
            <button className="btn sm" onClick={() => onVariant(variant)}>Show {VARIANT_LABEL[variant]}</button>
            <button className="btn sm" data-testid="ab-skip" onClick={() => {
              const r: ABResult = { task: task.n, prompt: task.prompt, variant, ms: 0, correct: null, ratings: null, note: "skipped", at: Date.now() };
              setResult(r); setPhase("rate");
            }}>Skip</button>
          </div>
        </div>
      )}
      {phase === "rate" && result && (
        <div className="map-test-rate" data-testid="ab-rate">
          <p className="map-sentence">{result.correct === true ? "Found it" : result.correct === false ? "Not the asked thing" : "Skipped"} in {(result.ms / 1000).toFixed(1)} s</p>
          {RATING_ROWS.map(({ key, label }) => (
            <div key={key} className="map-rating">
              <span>{label}</span>
              <div className="map-rating-btns" role="radiogroup" aria-label={label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`btn sm map-rate${ratings?.[key] === n ? " on" : ""}`}
                    aria-checked={ratings?.[key] === n}
                    role="radio"
                    data-testid={`ab-rate-${key}-${n}`}
                    onClick={() => setRatings((r) => ({ ...(r ?? { clarity: 0, speed: 0, look: 0 }), [key]: n }))}
                  >{n}</button>
                ))}
              </div>
            </div>
          ))}
          <input
            className="map-note"
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="ab-note"
          />
          <button className="btn sm" data-testid="ab-next" onClick={record}>Next</button>
        </div>
      )}
      {phase === "done" && (
        <div className="map-test-done">
          <p className="map-sentence">All tasks done. Thank you.</p>
          <button className="btn sm" onClick={() => { setTi(0); setVi(0); setPhase("task"); }}>Again</button>
        </div>
      )}
      <div className="map-test-foot">
        <button className="btn sm" data-testid="ab-copy" onClick={copy}>Copy results</button>
        <button className="btn sm" data-testid="ab-clear" onClick={clearResults}>Clear</button>
        {copied && <span className="map-hint">copied</span>}
      </div>
      {loadResults().length > 0 && (
        <table className="map-summary" data-testid="ab-summary">
          <thead><tr><th>Variant</th><th>Runs</th><th>Median</th><th>Correct</th><th>Clarity</th><th>Speed</th><th>Look</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant}>
                <td>{VARIANT_LABEL[r.variant]}</td><td>{r.runs}</td>
                <td>{Number.isNaN(r.medianMs) ? "–" : `${(r.medianMs / 1000).toFixed(1)}s`}</td>
                <td>{r.correct}</td>
                <td>{Number.isNaN(r.clarity) ? "–" : r.clarity.toFixed(1)}</td>
                <td>{Number.isNaN(r.speed) ? "–" : r.speed.toFixed(1)}</td>
                <td>{Number.isNaN(r.look) ? "–" : r.look.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="map-json"><summary>Results JSON</summary><textarea readOnly value={resultsJSON()} rows={6} data-testid="ab-json" /></details>
    </aside>
  );
}
