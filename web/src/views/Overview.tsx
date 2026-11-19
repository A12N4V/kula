import { useEffect, useState } from "react";
import { api, relTime, type Overview as O, type RepoInfo } from "../api";
import { Empty, Icon, StatTable } from "../ui";
import type { Go } from "../nav";
import Coupling from "../Coupling";
import { useCode } from "../CodePanel";
import AsciiMark from "../AsciiMark";
import { Docked } from "../studio/Dock";

type Props = { repo: RepoInfo | null; version: number; go: Go };

/** Repository health at a glance; the queues themselves live in Git and Work. */
export default function Overview({ repo, version, go }: Props) {
  const [o, setO] = useState<O | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const code = useCode();
  useEffect(() => { api.overview().then(setO).catch((e) => setErr(e.message)); }, [version]);

  if (err) return <Empty title="Overview unavailable">{err}</Empty>;
  if (!o) return <div className="loading"><div className="mini-loader"><div className="ml-field"><AsciiMark period={3.2} /></div><span>Checking the repository…</span></div></div>;

  const maxScore = Math.max(1, ...o.hotspots.map((h) => h.score));
  const s = repo?.stats;
  const highRisk = o.proposals.filter((p) => p.risk === "high").length;
  const oldest = o.issues.reduce((m, i) => Math.min(m, i.created), Infinity);
  const stale = o.branches.filter((b) => b.behind > 0).length;

  return (
    <div className="overview" data-testid="overview">
      <header className="ov-head">
        <div className="ov-title">
          <h1>{repo?.name}</h1>
          <span className="muted mono">{repo?.branch}</span>
          {repo?.branch !== o.default_branch && <span className="muted">from <span className="mono">{o.default_branch}</span></span>}
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => go("graph")}><Icon.graph /> Open map</button>
        <button className="btn primary" onClick={() => go("graph", { contrast: { base: o.default_branch, head: repo?.branch === o.default_branch ? "WORKTREE" : repo?.branch ?? "WORKTREE" } })}><Icon.compare /> {repo?.branch === o.default_branch ? "Contrast HEAD with working tree" : `Contrast with ${o.default_branch}`}</button>
      </header>

      <div className="ov-body">
        <StatTable className="ov-stats" label="Repository at a glance" rows={([
            ["Proposals", o.proposals.length, highRisk ? `${highRisk} high risk` : o.proposals.length ? "none high risk" : "queue empty", () => go("proposals"), highRisk ? "bad" : ""],
            ["Issues", o.issues_open, Number.isFinite(oldest) ? `oldest ${relTime(oldest).replace(" ago", "")}` : "none open", () => go("issues"), ""],
            ["Uncommitted", o.changes, o.changes ? "files in worktree" : "clean", () => go("git"), o.changes ? "warn" : ""],
            ["Branches", o.branches.length, stale ? `${stale} behind ${o.default_branch}` : "all current", () => go("git"), ""],
            ["Hotspots", o.hotspots.length, o.hotspots[0] ? o.hotspots[0].path.split("/").pop()! : "no churn", () => go("graph", { search: o.hotspots[0]?.path }), ""],
            ["Notes", o.notes, "on symbols and files", () => go("notes"), ""],
          ] as [string, number, string, () => void, string][]).map(([label, value, note, onClick, tone]) => ({ label, value, note, onClick, tone, title: note }))} />
        <Coupling onDir={(d) => go("graph", { search: d })} />
      </div>

      {/* Index health and hotspots ride in the shell's right sidebar. */}
      <Docked label="Overview">
        <div className="ov-side" data-testid="overview-side">
          <section className="card ov-index">
            <div className="card-head"><h2>Index</h2><span className={`tag ${repo?.index === "current" ? "" : "warn"}`}>{repo?.index ?? "…"}</span></div>
            <dl className="ov-health">
              <dt>Parsed</dt><dd className="mono">{s ? `${s.parsed.toLocaleString()} / ${s.files.toLocaleString()}` : "0"}</dd>
              <dt>Symbols</dt><dd className="mono">{s?.symbols.toLocaleString() ?? "0"}</dd>
              <dt>Edges</dt><dd className="mono">{s?.edges.toLocaleString() ?? "0"}</dd>
              <dt>Communities</dt><dd className="mono">{s?.communities.toLocaleString() ?? "0"}</dd>
              <dt>Indexed</dt><dd className="mono">{repo?.indexed_head?.slice(0, 8) ?? "never"}{repo?.indexed_head && repo.indexed_head !== repo.head ? " behind HEAD" : ""}</dd>
              <dt>Build</dt><dd className="mono">{s ? `${s.millis} ms` : "0"}</dd>
            </dl>
          </section>
          <section className="card ov-hot">
            <div className="card-head" title="Churn times centrality over 90 days"><h2>Hotspots</h2></div>
            {o.hotspots.length === 0 && <div className="card-empty">Not enough history yet</div>}
            {o.hotspots.length > 0 && <div className="hot-row hot-headrow muted"><span>file</span><span>score</span><span>commits</span><span>edges</span></div>}
            <div className="ov-hot-list">
              {o.hotspots.map((h) => (
                <div key={h.path} className={`hot-row ${code.target?.path === h.path ? "on" : ""}`} onClick={() => code.open({ path: h.path })} title={`${h.churn} commits, ${h.symbols} symbols, ${h.degree} call edges`}>
                  <span className="mono hot-path">{h.path}</span>
                  <div className="hot-bar"><i style={{ width: `${(h.score / maxScore) * 100}%` }} /></div>
                  <span className="hot-n">{h.churn}</span>
                  <span className="hot-n">{h.degree}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </Docked>
    </div>
  );
}
