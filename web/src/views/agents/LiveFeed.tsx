// Live mode's side card (P3.17): how the log arrives, the run to replay, a
// scrubber over its events and the newest lines up to the moment shown.

import type { KulaEvent } from "../../api";
import { line, type Via } from "./live";

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function LiveFeed({ events, via, runs, run, setRun, cursor, setCursor }: {
  events: KulaEvent[]; via: Via; runs: string[]; run: string; setRun: (r: string) => void;
  cursor: number | null; setCursor: (c: number | null) => void;
}) {
  const n = events.length;
  const upto = cursor ?? n - 1;
  const shown = events.slice(Math.max(0, upto - 11), upto + 1).reverse();
  return (
    <section className="card cv-live" aria-label="Live">
      <div className="card-head">
        <h2>Live</h2>
        <span className={`cv-live-via ${via}`} data-via={via}>{via === "stream" ? "streaming" : via === "poll" ? "polling every 5 s" : "off"}</span>
        <span className="spacer" />
        {runs.length > 0 && (
          <select className="input sm mono" aria-label="Run" value={run} onChange={(e) => { setRun(e.target.value); setCursor(null); }}>
            <option value="">all events</option>
            {runs.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </div>
      {n > 1 && (
        <div className="cv-replay">
          <input type="range" aria-label="Replay" min={0} max={n - 1} value={upto} onChange={(e) => { const v = Number(e.target.value); setCursor(v >= n - 1 ? null : v); }} />
          <span className="mono muted">{upto + 1}/{n}</span>
          <button className="btn sm ghost" disabled={cursor === null} onClick={() => setCursor(null)}>now</button>
        </div>
      )}
      {n === 0
        ? <p className="muted">Nothing has happened yet</p>
        : <ol className="cv-events" aria-label="Events">{shown.map((e) => (
            <li key={e.seq} className={`ev-${e.kind} ${e.verdict ? `v-${e.verdict}` : ""}`} title={e.msg || undefined}>
              <span className="mono">{clock(e.ts)}</span><span>{line(e)}</span>
            </li>
          ))}</ol>}
    </section>
  );
}
