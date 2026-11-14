// A seat's memory (P3.16): the pocket it carries, anchored to files and
// symbols, and a recall preview that asks the server what this seat would get
// back for a target under its own fences. Recalled areas light up on the
// canvas with their rank.

import { useEffect, useMemo, useState } from "react";
import { api, type AgentsInfo, type Memory, type Team, type Territory } from "../../api";
import { areaOf, pathOf, pocket, seatScope } from "./territory";

type Member = Team["members"][number];

export function SeatMemory({ info, areas, m, onRank }: { info: AgentsInfo; areas: Territory[]; m: Member; onRank: (r: Map<string, number>) => void }) {
  const mine = useMemo(() => pocket(info, areas, m), [info, areas, m]);
  const targets = useMemo(() => [...new Set(info.memories.map((x) => x.target).filter((t) => t !== "repo"))].sort(), [info.memories]);
  const [target, setTarget] = useState("");
  const [got, setGot] = useState<Memory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const scope = seatScope(info, m);
  useEffect(() => { setGot(null); setErr(null); }, [m.workflow, scope.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const recall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    setErr(null);
    api.agentAction<{ recalled: Memory[] }>("recall", { target: target.trim(), workflow: m.workflow ?? "", scope })
      .then((r) => {
        setGot(r.recalled);
        const rank = new Map<string, number>();
        r.recalled.forEach((x, i) => { const p = pathOf(x.target); const a = p ? areaOf(areas, p) : null; if (a && !rank.has(a)) rank.set(a, i + 1); });
        onRank(rank);
      })
      .catch((x: Error) => { setGot(null); onRank(new Map()); setErr(x.message); });
  };

  return (
    <section className="card cv-mem" aria-label="Seat memory">
      <div className="card-head"><h2>Memory</h2><span className="muted">{mine.length} in reach</span></div>
      {mine.length > 0
        ? <ul className="cv-pocket-list" aria-label="Pocket">{mine.slice(0, 6).map((x) => (
            <li key={x.id} className={x.stale ? "stale" : ""} title={x.body}><code>{x.target === "repo" ? "repo" : x.target.replace(/^(file|symbol):/, "")}</code><span>{x.body}</span></li>
          ))}</ul>
        : <p className="muted">Nothing kept in this seat's reach</p>}
      <form className="cv-recall" onSubmit={recall}>
        <input className="input mono" list="cv-recall-targets" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="file:src/lib.rs or a symbol" aria-label="Recall target" />
        <datalist id="cv-recall-targets">{targets.map((t) => <option key={t} value={t} />)}</datalist>
        <button className="btn sm" type="submit" disabled={!target.trim()}>Recall</button>
      </form>
      {err && <div className="team-err" role="alert">{err}</div>}
      {got && (got.length === 0
        ? <p className="muted">Nothing comes back for this seat</p>
        : <ol className="cv-recalled" aria-label="Recalled">{got.map((x) => (
            <li key={x.id} className={x.stale ? "stale" : ""}><span className="cv-via">{x.via}</span><code>{x.target.replace(/^(file|symbol):/, "")}</code><span className="cv-body">{x.body}</span></li>
          ))}</ol>)}
    </section>
  );
}
