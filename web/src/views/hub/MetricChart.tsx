// The metric over a research run's experiments (H.7): one dot per experiment,
// kept, reverted or rejected at the fence, a best so far step line and the
// baseline. The Runs detail feeds it the ledger's points; the inspector builds
// the same points from the live research state.

import type { Point, ResearchRun } from "../../api";

/** The ledger's points, built from the live research state. */
export function pointsOf(run: ResearchRun): Point[] {
  let best = run.baseline;
  return run.experiments.map((e) => {
    if (e.kept && e.value !== null) best = e.value;
    const verdict = e.kept ? "kept" : (e.note ?? "").startsWith("rejected") ? "rejected" : "reverted";
    return { n: e.n, value: e.value, best, verdict };
  });
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$|(\.\d*?)0+$/, "$1");

export function MetricChart({ points, baseline, metric, goal, h = 96 }: { points: Point[]; baseline: number; metric: string; goal: string; h?: number }) {
  if (points.length === 0) return <p className="muted">No experiments yet</p>;
  const w = 320, padL = 4, padR = 4, padT = 8, padB = 14;
  const vals = points.flatMap((p) => (p.value === null ? [p.best] : [p.value, p.best]));
  const lo = Math.min(baseline, ...vals), hi = Math.max(baseline, ...vals);
  const y = (v: number) => (hi === lo ? (h - padB + padT) / 2 : padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB));
  // Each experiment sits in the middle of its slot, so the baseline reads before #1.
  const x = (i: number) => padL + ((i + 0.5) * (w - padL - padR)) / points.length;
  // Best so far as steps: flat until a kept experiment moves it.
  let d = `M${padL},${y(baseline).toFixed(1)}`;
  points.forEach((p, i) => { d += ` H${x(i).toFixed(1)} V${y(p.best).toFixed(1)}`; });
  d += ` H${w - padR}`;
  const best = points[points.length - 1].best;
  const kept = points.filter((p) => p.verdict === "kept").length;
  return (
    <figure className="metric-chart" aria-label={`${metric} over ${points.length} experiments`}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${metric}, ${goal === "max" ? "higher" : "lower"} is better`}>
        <line className="base" x1={0} x2={w} y1={y(baseline)} y2={y(baseline)} />
        <path className="best" d={d} />
        {points.map((p, i) => p.value === null
          ? <line key={p.n} className={`none ${p.verdict}`} x1={x(i)} x2={x(i)} y1={h - padB - 8} y2={h - padB}><title>{`#${p.n} ${p.verdict}, no value`}</title></line>
          : <circle key={p.n} cx={x(i)} cy={y(p.value)} r={3} className={p.verdict} data-n={p.n}><title>{`#${p.n} ${p.verdict} ${fmt(p.value)}`}</title></circle>)}
        <text x={x(0)} y={h - 2} className="lbl" textAnchor="middle">#{points[0].n}</text>
        {points.length > 1 && <text x={x(points.length - 1)} y={h - 2} className="lbl" textAnchor="middle">#{points[points.length - 1].n}</text>}
      </svg>
      <figcaption className="mono">
        <span><i className="k-base" />base {fmt(baseline)}</span>
        <span><i className="k-best" />best {fmt(best)}</span>
        <span><i className="k-kept" />{kept} kept</span>
        <span><i className="k-rev" />{points.length - kept} dropped</span>
      </figcaption>
    </figure>
  );
}
