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

  return (
    <div className="overview">
      <header className="ov-head">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>{repo?.name}</h1>
          <div className="row muted" style={{ gap: 10 }}>
            <span className="mono">{repo?.branch}</span>·<span>default <span className="mono">{o.default_branch}</span></span>·
            <span className="row" style={{ gap: 6 }}><span className={`dot ${repo?.index === "current" ? "ok" : "warn"}`} />{repo?.index === "current" ? "graph current" : "graph updating"}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => go("graph")}><Icon.graph /> Open map</button>
          <button className="btn primary" onClick={() => go("graph", { contrast: { base: o.default_branch, head: repo?.branch === o.default_branch ? "WORKTREE" : repo?.branch ?? "WORKTREE" } })}><Icon.compare /> Contrast with {o.default_branch}</button>
        </div>
      </header>

      <section className="kpis">
        {[
          ["Proposals open", o.proposals.length, () => go("proposals")],
          ["Issues open", o.issues_open, () => go("issues")],
          ["Uncommitted", o.changes, () => go("changes")],
          ["Symbols", s?.symbols ?? 0, () => go("graph")],
          ["Clusters", s?.communities ?? 0, () => go("graph")],
          ["Notes", o.notes, () => go("notes")],
        ].map(([label, value, fn]) => (
          <button key={label as string} className="kpi" onClick={fn as () => void}>
            <b>{(value as number).toLocaleString()}</b>
            <span>{label as string}</span>
          </button>
        ))}
      </section>

      <div className="ov-grid">
        <section className="card span2">
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

        <section className="card span2">
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
                  ? <button className="btn sm" onClick={() => go("graph", { contrast: { base: o.default_branch, head: b.name } })}>Contrast graph</button>
                  : <span className="tag">default</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Hotspots</h2><span className="muted">90 days</span></div>
          <p className="card-note">Files that change often <i>and</i> sit at the centre of the call graph. This is where review time pays off most.</p>
          {o.hotspots.length === 0 && <div className="card-empty">Not enough history yet.</div>}
          {o.hotspots.map((h) => (
            <div key={h.path} className="hot-row" onClick={() => go("graph", { search: h.path })} title={`${h.churn} commits · ${h.symbols} symbols · ${h.degree} call edges`}>
              <span className="mono hot-path">{h.path}</span>
              <div className="hot-bar"><i style={{ width: `${(h.score / maxScore) * 100}%` }} /></div>
              <span className="muted hot-n">{h.churn}×</span>
            </div>
          ))}
        </section>

        <section className="card span3">
          <div className="card-head"><h2>Recent commits</h2><span className="spacer" /><button className="btn sm ghost" onClick={() => go("history")}>History</button></div>
          <div className="commits-grid">
            {o.recent.map((c) => (
              <div key={c.sha} className="ov-row" onClick={() => go("history", { sha: c.sha })}>
                <span className="mono muted">{c.short}</span>
                <div className="grow"><div className="title">{c.subject}</div><div className="sub">{c.author} · {relTime(c.time)}</div></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
