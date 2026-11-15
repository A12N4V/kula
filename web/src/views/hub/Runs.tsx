// Runs mode (H.6): the run ledger read back. The board lists runs with a
// score line over time and a pinned card for any run still going; a run opens
// into its synopsis, its seats and the kept changes grouped by domain and flow.
// The side card holds trends per seat, agent and team, and the score weights.

import { useEffect, useMemo, useState } from "react";
import { MetricChart } from "./MetricChart";
import { api, type CurrentRun, type RunDetail, type RunsInfo, type RunSummary, type Trend, type Usage, type Weights } from "../../api";

/** "840ms", "5s", "3m 12s", "1h 4m": the same spans the server writes. */
export function span(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const tokens = (u: Usage) => u.tokens_in + u.tokens_out;
const kilo = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const usd = (n: number) => `$${n === 0 ? "0" : n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
const when = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const tone = (score: number) => (score >= 80 ? "good" : score >= 50 ? "mid" : "low");

/** Scores 0 to 100 as a line, oldest first. */
export function Spark({ values, w = 120, h = 22, label }: { values: number[]; w?: number; h?: number; label: string }) {
  if (values.length === 0) return null;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const y = (v: number) => (h - 2) - (Math.max(0, Math.min(100, v)) / 100) * (h - 4);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg className="runs-spark" width={w} height={h} viewBox={`-2 0 ${w + 4} ${h}`} role="img" aria-label={label}>
      <line x1={0} x2={w} y1={y(50)} y2={y(50)} className="runs-spark-mid" />
      {values.length > 1 && <polyline points={pts} />}
      <circle cx={(values.length - 1) * step} cy={y(last)} r={2} className={tone(last)} />
    </svg>
  );
}

/** The runs ledger, polled while Runs is open. */
export function useRuns(on: boolean): { info: RunsInfo | null; err: string | null } {
  const [info, setInfo] = useState<RunsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let t: number | undefined;
    let live = true;
    const load = () => api.runs()
      .then((r) => { if (live) { setInfo(r); setErr(null); } })
      .catch((e: Error) => { if (live) setErr(e.message); })
      .finally(() => { if (live) t = window.setTimeout(load, 5000); });
    load();
    return () => { live = false; window.clearTimeout(t); };
  }, [on]);
  return { info, err };
}

function CurrentCard({ c, onReplay }: { c: CurrentRun; onReplay: (id: string) => void }) {
  return (
    <div className="runs-current" data-run={c.id} aria-label={`Run ${c.id} is running`}>
      <span className="runs-pulse" aria-hidden />
      <div className="runs-current-main">
        <div className="runs-current-head"><b>{c.team || c.plan}</b><span className="mono muted">{c.id}</span></div>
        <div className="mono muted">{c.passed} of {c.slices} slices passed · {c.attempts} attempts · {kilo(tokens(c.usage))} tokens · {usd(c.usage.cost_usd)} · {span(Math.max(0, c.last - c.started))}</div>
      </div>
      <button className="btn sm" onClick={() => onReplay(c.id)}>Watch</button>
    </div>
  );
}

function RunRow({ r, on, pick }: { r: RunSummary; on: boolean; pick: (id: string) => void }) {
  return (
    <li>
      <button className={`runs-row${on ? " on" : ""}`} aria-pressed={on} data-run={r.id} onClick={() => pick(r.id)}>
        <span className={`runs-state ${r.state}`} title={r.state} />
        <span className={`runs-score mono ${tone(r.score)}`}>{Math.round(r.score)}</span>
        <span className="runs-row-main">
          <span className="runs-row-title">{r.goal || r.plan}</span>
          <span className="mono muted">{r.team || "no team"} · {r.trigger} · {when(r.started)}</span>
        </span>
        <span className="runs-row-nums mono">
          <span>{r.passed}/{r.seats}</span>
          <span>{usd(r.usage.cost_usd)}</span>
          <span>{span(Math.max(0, r.ended - r.started))}</span>
        </span>
      </button>
    </li>
  );
}

function Detail({ id, onReplay }: { id: string; onReplay: (id: string) => void }) {
  const [d, setD] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setD(null); setErr(null);
    api.run(id).then((x) => { if (live) setD(x); }).catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [id]);
  if (err) return <div className="runs-detail"><p className="err-text">{err}</p></div>;
  if (!d) return <div className="runs-detail"><p className="muted">Reading the ledger</p></div>;
  const { run, synopsis, changelog } = d;
  return (
    <div className="runs-detail" aria-label="Run detail">
      <div className="runs-detail-head">
        <span className={`runs-score big mono ${tone(run.score)}`}>{Math.round(run.score)}</span>
        <div className="runs-detail-title">
          <h3>{run.goal || run.plan}</h3>
          <span className="mono muted">{run.id}</span>
        </div>
        <button className="btn sm" onClick={() => onReplay(run.id)}>Replay</button>
      </div>
      <p className="runs-headline" aria-label="Synopsis">{synopsis.headline}</p>
      <ul className="runs-lines">{synopsis.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {run.research && (
        <section className="runs-research" aria-label="Metric">
          <h4>{run.research.metric}</h4>
          <MetricChart points={run.research.points} baseline={run.research.baseline} metric={run.research.metric} goal={run.research.goal} h={100} />
        </section>
      )}

      <h4>{run.research ? "Experiments" : "Seats"}</h4>
      <table className="runs-seats">
        <thead><tr><th>seat</th><th>verdict</th><th>score</th><th>tokens</th><th>cost</th><th>diff</th><th>tries</th></tr></thead>
        <tbody>{run.seats.map((s) => (
          <tr key={s.slice} data-slice={s.slice}>
            <td className="runs-seat-name"><span className="mono">{s.seat || s.slice}</span><small className="muted">{s.agent}</small>{s.note && <small className="runs-note" title={s.note}>{s.note}</small>}</td>
            <td className={`runs-seat-name v-${s.verdict}`}>{s.verdict}{s.refusals > 0 && <small className="muted">{s.refusals} refused</small>}</td>
            <td className={`mono ${tone(s.score)}`}>{Math.round(s.score)}</td>
            <td className="mono">{kilo(tokens(s.usage))}</td>
            <td className="mono">{usd(s.usage.cost_usd)}</td>
            <td className="mono"><span className="add">+{s.added}</span> <span className="del">-{s.removed}</span></td>
            <td className="mono">{s.attempts}</td>
          </tr>
        ))}</tbody>
      </table>

      <h4>Changelog</h4>
      {changelog.length === 0
        ? <p className="muted">Nothing kept</p>
        : changelog.map((sec) => (
            <section key={`${sec.domain ?? "x"}:${sec.label}`} className="runs-cl" aria-label={sec.label}>
              <div className="runs-cl-head"><b>{sec.label}</b>{sec.flows.slice(0, 6).map((f) => <span key={f.id} className="runs-chip mono" title={f.id}>{f.label}</span>)}</div>
              <ul>{sec.changes.map((c) => (
                <li key={`${c.path}:${c.slice}`}><span className="mono">{c.path}</span><span className="muted mono">{c.seat || c.slice}{c.commit ? ` · ${c.commit.slice(0, 7)}` : ""}</span></li>
              ))}</ul>
            </section>
          ))}
    </div>
  );
}

/** The centre of Runs mode: current runs, the list and the opened run. */
export function RunsBoard({ info, err, onReplay, onBuild }: { info: RunsInfo | null; err: string | null; onReplay: (id: string) => void; onBuild?: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const runs = info?.runs ?? [];
  useEffect(() => { if (!pick && runs.length) setPick(runs[0].id); }, [runs, pick]);
  const scores = useMemo(() => runs.slice(0, 40).map((r) => r.score).reverse(), [runs]);
  if (err && !info) return <div className="runs-board"><p className="err-text">{err}</p></div>;
  if (!info) return <div className="runs-board"><p className="muted">Reading the ledger</p></div>;
  return (
    <div className="runs-board" aria-label="Runs">
      {info.current.length > 0 && <div className="runs-currents" aria-label="Running now">{info.current.map((c) => <CurrentCard key={c.id} c={c} onReplay={onReplay} />)}</div>}
      {runs.length === 0
        ? <div className="runs-empty"><div className="runs-empty-in"><p className="muted">No runs recorded yet</p>{onBuild && <button className="btn sm" onClick={onBuild}>Deploy a team</button>}</div></div>
        : (
          <div className="runs-split">
            <div className="runs-list">
              <div className="runs-list-head">
                <span className="mono muted">{runs.length} runs</span>
                <span className="spacer" />
                <Spark values={scores} label="Score over time" />
              </div>
              <ol>{runs.map((r) => <RunRow key={r.id} r={r} on={pick === r.id} pick={setPick} />)}</ol>
            </div>
            {pick && <Detail id={pick} onReplay={onReplay} />}
          </div>
        )}
    </div>
  );
}

const KINDS: { id: Trend["kind"]; label: string }[] = [{ id: "seat", label: "Seats" }, { id: "agent", label: "Agents" }, { id: "team", label: "Teams" }];
const WEIGHT_NAMES: (keyof Weights)[] = ["gate", "tests", "refusals", "retries", "cost", "duration"];

/** The side card in Runs mode: trends and the weights behind every score. */
export function RunsTrends({ info }: { info: RunsInfo | null }) {
  const [kind, setKind] = useState<Trend["kind"]>("seat");
  const rows = (info?.trends ?? []).filter((t) => t.kind === kind);
  return (
    <section className="hub-sec runs-trends" aria-label="Trends">
      <h3>Trends
        <span className="seg hub-sec-aside" role="group" aria-label="Trend by">
          {KINDS.map((k) => <button key={k.id} className={kind === k.id ? "on" : ""} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </span>
      </h3>
      {rows.length === 0
        ? <p className="muted">No runs recorded yet</p>
        : <ul className="runs-trend-list">{rows.map((t) => (
            <li key={t.key} data-key={t.key}>
              <div className="runs-trend-top"><span className="mono">{t.key}</span><span className="spacer" /><Spark values={t.scores} w={72} h={18} label={`${t.key} score`} /><span className={`mono ${tone(t.score)}`}>{Math.round(t.score)}</span></div>
              <div className="mono muted">{t.runs} runs · {Math.round(t.pass_rate * 100)}% pass · {t.refusal_rate.toFixed(1)} refused · {kilo(t.tokens)} tok · {usd(t.cost_usd)}</div>
            </li>
          ))}</ul>}
      {info && (
        <div className="runs-weights" aria-label="Score weights">
          <h3>Score weights</h3>
          <div className="runs-weight-bar">{WEIGHT_NAMES.map((k) => <span key={k} style={{ flexGrow: info.weights[k] }} title={`${k} ${info.weights[k]}`}><i>{k}</i><b className="mono">{info.weights[k]}</b></span>)}</div>
        </div>
      )}
    </section>
  );
}
