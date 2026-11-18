// Commit history with the lane graph; a branch filter narrows it to one line.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, relTime, type Commit } from "../../api";
import { Icon, Tip } from "../../ui";
import { LANE_COLORS, computeLanes } from "../GitViews";
import { WEmpty, Widget, type Sel, type SetSel } from "./parts";

const ROW = 34;
const x = (l: number) => 10 + l * 12;

export function History({ version, filter, setFilter, sel, setSel }: { version: number; filter: string; setFilter: (b: string) => void; sel: Sel; setSel: SetSel }) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api.log(400, filter || undefined).then(setCommits).catch(() => setCommits([])); }, [version, filter]);
  const list = commits ?? [];
  const lanes = useMemo(() => computeLanes(list), [list]);
  const width = Math.min(8, Math.max(1, ...lanes.map((l) => Math.max(l.before.length, l.after.length, l.lane + 1)))) * 12 + 8;
  const needle = q.toLowerCase();
  const visible = list.map((c, i) => ({ c, i })).filter(({ c }) => !q || (c.subject + c.author + c.short).toLowerCase().includes(needle));
  const selSha = sel?.kind === "commit" ? sel.sha : null;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.querySelector(".w-row.on")?.scrollIntoView({ block: "nearest" }); }, [selSha, commits]);

  return (
    <Widget area="hist" title="History" count={commits ? (q ? `${visible.length} of ${list.length}` : list.length) : undefined}
      tools={<>
        {filter && <Tip tip="Show every branch"><button className="gv-chip on" onClick={() => setFilter("")}><Icon.branches />{filter}<Icon.close /></button></Tip>}
        <input className="input gv-filter" placeholder="Filter" aria-label="Filter commits" value={q} onChange={(e) => setQ(e.target.value)} />
      </>}>
      <div ref={body}>
        {commits && list.length === 0 ? <WEmpty icon={<Icon.history />}>No commits yet</WEmpty>
          : commits && !visible.length ? <WEmpty icon={<Icon.search />}>No commit matches</WEmpty>
          : visible.map(({ c, i }) => {
            const L = lanes[i];
            const on = !!selSha && (selSha === c.sha || c.sha.startsWith(selSha));
            return (
              <div key={c.sha} className={`w-row w-commit${on ? " on" : ""}`} onClick={() => setSel({ kind: "commit", sha: c.sha })} title={`${c.subject}\n${c.author}`}>
                {!q && (
                  <svg data-figure width={width} height={ROW} aria-hidden>
                    {L.before.map((s, l) => s && l < 8 && <line key={"b" + l} x1={x(l)} y1={0} x2={x(l === L.lane || s === c.sha ? L.lane : l)} y2={ROW / 2} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                    {L.after.map((s, l) => s && l < 8 && <line key={"a" + l} x1={x(l === L.lane || (L.extra.includes(l) && L.before[l] !== s) ? L.lane : l)} y1={ROW / 2} x2={x(l)} y2={ROW} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                    <circle cx={x(L.lane)} cy={ROW / 2} r={c.parents.length > 1 ? 4.5 : 4} fill={c.parents.length > 1 ? "var(--bg)" : LANE_COLORS[L.lane % 7]} stroke={LANE_COLORS[L.lane % 7]} strokeWidth="2" />
                  </svg>
                )}
                <span className="grow">{c.subject}</span>
                {c.refs.slice(0, 2).map((r) => <span key={r} className={`gv-ref${r.startsWith("HEAD") ? " head" : r.startsWith("tag:") ? " tag" : ""}`}>{r.replace("HEAD -> ", "").replace("tag: ", "")}</span>)}
                <span className="dim mono">{c.short}</span>
                <span className="dim gv-when">{relTime(c.time)}</span>
              </div>
            );
          })}
      </div>
    </Widget>
  );
}
