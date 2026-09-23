import { useEffect, useState } from "react";
import { api, relTime, type Overview as O, type RepoInfo } from "../api";
import { Empty, Icon, Logo } from "../ui";
import type { Go } from "../nav";

type Props = { repo: RepoInfo | null; version: number; go: Go };

function Risk({ r }: { r: string }) {
  return <span className={`risk-pill ${r}`}>{r === "unknown" ? "?" : r}</span>;
}

/** Everything that needs a human, on one screen: the review queue. */
export default function Overview({ repo, version, go }: Props) {
  const [o, setO] = useState<O | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.overview().then(setO).catch((e) => setErr(e.message)); }, [version]);

  if (err) return <Empty title="Overview unavailable">{err}</Empty>;
  if (!o) return <div className="loading"><div className="stack" style={{ alignItems: "center" }}><Logo spin /><span>Gathering the review queue…</span></div></div>;

  const maxScore = Math.max(1, ...o.hotspots.map((h) => h.score));
  const maxAB = Math.max(1, ...o.branches.map((b) => Math.max(b.ahead, b.behind)));
  const s = repo?.stats;
  const highRisk = o.proposals.filter((p) => p.risk === "high").length;
  const oldest = o.issues.reduce((m, i) => Math.min(m, i.created), Infinity);
  const stale = o.branches.filter((b) => b.behind > 0).length;

  return (
    <div className="overview">
      <header className="ov-head">
        <div className="ov-title">
          <h1>{repo?.name}</h1>
          <span className="muted mono">{repo?.branch}</span>
          {repo?.branch !== o.default_branch && <span className="muted">from <span className="mono">{o.default_branch}</span></span>}
          {s && <span className="muted">{s.files.toLocaleString()} files · {s.symbols.toLocaleString()} symbols · indexed in {s.millis}ms</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => go("graph")}><Icon.graph /> Open map</button>
          <button className="btn primary" onClick={() => go("graph", { contrast: { base: o.default_branch, head: repo?.branch === o.default_branch ? "WORKTREE" : repo?.branch ?? "WORKTREE" } })}><Icon.compare /> Contrast with {o.default_branch}</button>
        </div>
      </header>

      <section className="kpi-strip">
        {([
          ["Proposals", o.proposals.length, highRisk ? `${highRisk} high risk` : o.proposals.length ? "none high risk" : "queue empty", () => go("proposals"), highRisk ? "bad" : ""],
          ["Issues", o.issues_open, Number.isFinite(oldest) ? `oldest ${relTime(oldest).replace(" ago", "")}` : "none open", () => go("issues"), ""],
          ["Uncommitted", o.changes, o.changes ? "files in worktree" : "clean", () => go("changes"), o.changes ? "warn" : ""],
          ["Branches", o.branches.length, stale ? `${stale} behind ${o.default_branch}` : "all current", () => go("branches"), ""],
          ["Hotspots", o.hotspots.length, o.hotspots[0] ? o.hotspots[0].path.split("/").pop()! : "no churn", () => go("graph", { search: o.hotspots[0]?.path }), ""],
          ["Notes", o.notes, "on symbols & files", () => go("notes"), ""],
        ] as [string, number, string, () => void, string][]).map(([label, value, sub, fn, tone]) => (
          <button key={label} className={`kpi-cell ${tone}`} onClick={fn}>
            <span className="kpi-label">{label}</span>
            <b>{value.toLocaleString()}</b>
            <span className="kpi-sub">{sub}</span>
          </button>
        ))}
      </section>

      <div className="ov-grid">
        <div className="ov-col">
          <section className="card">
            <div className="card-head"><h2>Needs review</h2><span className="muted">{o.proposals.length}</span><span className="spacer" /><button className="btn sm ghost" onClick={() => go("proposals")}>All proposals</button></div>
            {o.proposals.length === 0 && <div className="card-empty">Nothing waiting. Open a proposal from <b>Branches</b> or <code>kula pr new</code>.</div>}
            {o.proposals.map(({ proposal: p, ...m }) => (
              <div key={p.id} className="ov-row" onClick={() => go("proposals", { proposal: p.id })}>
                <span style={{ color: "var(--green)" }}><Icon.pr /></span>
                <div className="grow">
                  <div className="title">{p.title} <span className="muted">#{p.id}</span></div>
                  <div className="sub mono">{p.head} → {p.base} · {relTime(p.created)} · {p.author}</div>
                </div>
                <div className="ov-metrics">
                  <span title="commits ahead"><b>{m.ahead ?? "–"}</b> ahead</span>
                  <span title="files changed"><b>{m.files ?? "–"}</b> files</span>
                  <span title="dependents affected"><b>{m.affected ?? "–"}</b> ripples</span>
                  <Risk r={m.risk} />
                </div>
              </div>
            ))}
          </section>
          <section className="card">
            <div className="card-head"><h2>Branches</h2><span className="muted">vs {o.default_branch}</span><span className="spacer" /><button className="btn sm ghost" onClick={() => go("branches")}>Manage</button></div>
            <div className="br-table">
              {o.branches.slice(0, 8).map((b) => (
                <div key={b.name} className="br-row">
                  <span className={`dot ${b.current ? "ok" : ""}`} />
                  <span className="mono br-name" title={b.name}>{b.name}</span>
                  <div className="ab" title={`${b.behind} behind · ${b.ahead} ahead`}>
                    <div className="ab-behind"><i style={{ width: `${(b.behind / maxAB) * 100}%` }} /></div>
                    <div className="ab-mid" />
                    <div className="ab-ahead"><i style={{ width: `${(b.ahead / maxAB) * 100}%` }} /></div>
                  </div>
                  <span className="muted ab-n">−{b.behind} / +{b.ahead}</span>
                  <span className="muted br-time">{relTime(b.time)}</span>
                  {b.name !== o.default_branch
                    ? <button className="btn sm" onClick={() => go("graph", { contrast: { base: o.default_branch, head: b.name } })} title={`Contrast ${b.name} with ${o.default_branch}`}><Icon.compare /> Contrast</button>
                    : <span className="tag">default</span>}
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-head"><h2>Recent commits</h2><span className="spacer" /><button className="btn sm ghost" onClick={() => go("history")}>History</button></div>
            <div>
              {o.recent.map((c) => (
                <div key={c.sha} className="ov-row" onClick={() => go("history", { sha: c.sha })}>
                  <span className="mono muted">{c.short}</span>
                  <div className="grow"><div className="title">{c.subject}</div><div className="sub">{c.author} · {relTime(c.time)}</div></div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="ov-col">
          <section className="card">
            <div className="card-head"><h2>Open issues</h2><span className="muted">{o.issues_open}</span><span className="spacer" /><button className="btn sm ghost" onClick={() => go("issues")}>All</button></div>
            {o.issues.length === 0 && <div className="card-empty">No open issues.</div>}
            {o.issues.map((i) => (
              <div key={i.id} className="ov-row" onClick={() => go("issues", { issue: i.id })}>
                <span style={{ color: "var(--green)" }}><Icon.issues /></span>
                <div className="grow">
                  <div className="title">{i.title}</div>
                  <div className="sub row" style={{ gap: 6 }}>#{i.id} · {relTime(i.created)}{i.labels.slice(0, 2).map((l) => <span key={l} className="tag violet" style={{ height: 17 }}>{l}</span>)}</div>
                </div>
              </div>
            ))}
          </section>
          <section className="card">
            <div className="card-head" title="Files that change often and sit at the centre of the call graph: where review time pays off most."><h2>Hotspots</h2><span className="muted">churn × centrality · 90d</span></div>
            {o.hotspots.length === 0 && <div className="card-empty">Not enough history yet.</div>}
            {o.hotspots.length > 0 && <div className="hot-row hot-headrow muted"><span>file</span><span>score</span><span>commits</span><span>edges</span></div>}
            {o.hotspots.map((h) => (
              <div key={h.path} className="hot-row" onClick={() => go("graph", { search: h.path })} title={`${h.churn} commits · ${h.symbols} symbols · ${h.degree} call edges`}>
                <span className="mono hot-path">{h.path}</span>
                <div className="hot-bar"><i style={{ width: `${(h.score / maxScore) * 100}%` }} /></div>
                <span className="hot-n">{h.churn}</span>
                <span className="hot-n">{h.degree}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
