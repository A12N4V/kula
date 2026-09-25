// The overview's one figure: who depends on whom, directory by directory.
// A dependency structure matrix – row depends on column, counted in calls and
// imports; the diagonal is cohesion. Where two directories depend on each other
// both ways the pair is a loop (a feedback path: change one and the other feels
// it), marked with the ring from kula's mark.

import { useEffect, useMemo, useState } from "react";
import { api, type GraphData } from "./api";
import { groupDirs } from "./colors";

const MAX = 9;

type Model = {
  dirs: { key: string; label: string; files: number; fanIn: number; fanOut: number; inside: number }[];
  m: number[][];
  loops: [number, number][];
  peak: number;
};

function build(g: GraphData): Model | null {
  const code = g.nodes.filter((n) => n.kind !== "package");
  if (!code.length) return null;
  const groups = groupDirs(code.map((n) => n.path), 0);
  const top = groups.sizes.slice(0, MAX).map(([d]) => d);
  const at = new Map(top.map((d, i) => [d, i]));
  const dirOf = new Map(code.map((n) => [n.id, at.get(groups.of(n.path))]));
  const k = top.length;
  const m = Array.from({ length: k }, () => Array(k).fill(0));
  for (const e of g.edges) {
    if (e.kind !== "CALLS" && e.kind !== "IMPORTS") continue;
    const a = dirOf.get(e.src), b = dirOf.get(e.dst);
    if (a == null || b == null) continue;
    m[a][b]++;
  }
  const files = new Map<string, Set<string>>();
  for (const n of code) { const d = groups.of(n.path); if (!files.has(d)) files.set(d, new Set()); files.get(d)!.add(n.path); }
  const dirs = top.map((d, i) => ({
    key: d, label: groups.label(d), files: files.get(d)?.size ?? 0, inside: m[i][i],
    fanOut: m[i].reduce((s, v, j) => s + (j === i ? 0 : v), 0),
    fanIn: m.reduce((s, r, j) => s + (j === i ? 0 : r[i]), 0),
  }));
  const loops: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (m[i][j] && m[j][i]) loops.push([i, j]);
  loops.sort((x, y) => Math.min(m[y[0]][y[1]], m[y[1]][y[0]]) - Math.min(m[x[0]][x[1]], m[x[1]][x[0]]));
  const peak = Math.max(1, ...m.flatMap((r, i) => r.filter((_, j) => j !== i)));
  return { dirs, m, loops, peak };
}

/** A small ring, the mark's loop, for the cells that close one. */
const Ring = () => <svg viewBox="0 0 7 7" className="cp-ring" aria-hidden="true"><circle cx="3.5" cy="3.5" r="2.6" /></svg>;

export default function Coupling({ onDir }: { onDir: (dir: string) => void }) {
  const [g, setG] = useState<GraphData | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  useEffect(() => { api.graph("symbol").then(setG).catch(() => {}); }, []);
  const model = useMemo(() => (g ? build(g) : null), [g]);

  if (!model) return <section className="card coupling"><div className="card-head"><h2>Coupling</h2><span className="muted">reading the graph…</span></div><div className="cpl-skel" /></section>;
  const { dirs, m, loops, peak } = model;
  const k = dirs.length;
  const inst = (d: Model["dirs"][number]) => (d.fanIn + d.fanOut ? d.fanOut / (d.fanIn + d.fanOut) : 0);
  const isLoop = (i: number, j: number) => i !== j && m[i][j] > 0 && m[j][i] > 0;
  const [hi, hj] = hover ?? [-1, -1];
  const read = hover
    ? hi === hj ? `${dirs[hi].label} · ${m[hi][hi]} internal dependencies`
      : `${dirs[hi].label} → ${dirs[hj].label} · ${m[hi][hj]}${m[hj][hi] ? ` · back ${m[hj][hi]}` : ""}`
    : "row depends on column · calls + imports";

  return (
    <section className="card coupling">
      <div className="card-head" title="Dependencies between directories. Row depends on column; the diagonal is cohesion inside a directory.">
        <h2>Coupling</h2>
        <span className="muted">{k} directories</span>
        <span className="cpl-loops" title="Pairs of directories that depend on each other both ways"><Ring /> {loops.length} {loops.length === 1 ? "loop" : "loops"}</span>
        <span className="spacer" />
        <span className="muted mono cpl-read">{read}</span>
      </div>
      <div className="cpl-body">
        <div className="cpl-matrix" style={{ gridTemplateColumns: `minmax(90px, 180px) repeat(${k}, minmax(18px, 40px))` }} onMouseLeave={() => setHover(null)}>
          <span />
          {dirs.map((d, j) => <span key={d.key} className={`cpl-col ${hj === j ? "on" : ""}`} title={d.label}>{j + 1}</span>)}
          {dirs.map((d, i) => (
            <div key={d.key} className="cpl-rowwrap" style={{ display: "contents" }}>
              <button className={`cpl-row mono ${hi === i ? "on" : ""}`} onClick={() => onDir(d.key)} title={`${d.label} · open in the map`}>
                <span className="cpl-n">{i + 1}</span>{d.label}
              </button>
              {dirs.map((_, j) => {
                const v = m[i][j];
                const a = i === j ? 0 : v / peak;
                return (
                  <span key={j} className={`cpl-cell ${i === j ? "diag" : ""} ${isLoop(i, j) ? "loop" : ""} ${hi === i || hj === j ? "cross" : ""}`}
                    style={i === j ? undefined : { ["--a" as string]: v ? (0.1 + 0.62 * Math.sqrt(a)).toFixed(3) : 0 }}
                    onMouseEnter={() => setHover([i, j])}>
                    {i === j ? (v ? <b>{v}</b> : null) : isLoop(i, j) && i < j ? <Ring /> : null}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cpl-side">
          <div className="section-title">Loops <span className="count">{loops.length}</span></div>
          {loops.length === 0 && <div className="muted cpl-none">None: dependencies between directories run one way.</div>}
          {loops.slice(0, 4).map(([i, j]) => (
            <div key={`${i}-${j}`} className="cpl-loop mono" onMouseEnter={() => setHover([i, j])} onMouseLeave={() => setHover(null)}>
              <span className="cpl-lbl">{dirs[i].label}</span><Ring /><span className="cpl-lbl">{dirs[j].label}</span>
              <span className="muted">{m[i][j]}→ ←{m[j][i]}</span>
            </div>
          ))}
          <div className="section-title">Stability</div>
          {dirs.slice().sort((a, b) => b.fanIn - a.fanIn).slice(0, 5).map((d) => (
            <div key={d.key} className="cpl-stab" title={`${d.fanIn} in · ${d.fanOut} out · instability ${inst(d).toFixed(2)} (0 = everything leans on it, 1 = it leans on everything)`}>
              <span className="mono cpl-lbl">{d.label}</span>
              <span className="cpl-inst"><i style={{ left: `${inst(d) * 100}%` }} /></span>
              <span className="mono muted">{d.fanIn}↓ {d.fanOut}↑</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
