import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { api, relTime, type LangRow, type Overview as O, type RepoInfo } from "../api";
import { Empty, Icon, Logo } from "../ui";
import Canvas, { type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import type { Go, View } from "../nav";
import Coupling from "../Coupling";
import { useCode } from "../CodePanel";
import AsciiMark from "../AsciiMark";
import { CountUp, DitherDissolve, Stagger } from "../motion";
import Runs, { RunDetail, useRuns } from "./Runs";

const Life = lazy(() => import("../Life"));

type Props = { repo: RepoInfo | null; version: number; go: Go };
type Ic = () => React.ReactElement;

export function useOverview(version: number) {
  const [o, setO] = useState<O | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.overview().then((x) => { setO(x); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load, version]);
  return { o, err, load };
}

export type StatDef = { id: string; label: string; value: number; note: string; view: View; tone?: "warn" | "bad"; icon: Ic; search?: string };
export function statDefs(o: O): StatDef[] {
  const highRisk = o.proposals.filter((p) => p.risk === "high").length;
  const oldest = o.issues.reduce((m, i) => Math.min(m, i.created), Infinity);
  const stale = o.branches.filter((b) => b.behind > 0).length;
  return [
    { id: "proposals", label: "Proposals", value: o.proposals.length, note: highRisk ? `${highRisk} high risk` : o.proposals.length ? "none high risk" : "queue empty", view: "proposals", tone: highRisk ? "bad" : undefined, icon: Icon.pr },
    { id: "issues", label: "Issues", value: o.issues_open, note: Number.isFinite(oldest) ? `oldest ${relTime(oldest).replace(" ago", "")}` : "none open", view: "issues", icon: Icon.issues },
    { id: "changes", label: "Uncommitted", value: o.changes, note: o.changes ? "files in worktree" : "clean", view: "changes", tone: o.changes ? "warn" : undefined, icon: Icon.changes },
    { id: "branches", label: "Branches", value: o.branches.length, note: stale ? `${stale} behind ${o.default_branch}` : "all current", view: "branches", icon: Icon.branches },
    { id: "hotspots", label: "Hotspots", value: o.hotspots.length, note: o.hotspots[0] ? o.hotspots[0].path.split("/").pop()! : "no churn", view: "graph", icon: Icon.flame, search: o.hotspots[0]?.path },
    { id: "notes", label: "Notes", value: o.notes, note: "on symbols and files", view: "notes", icon: Icon.notes },
  ];
}

/** One stat: icon and label over a counted-up number; the note is a hover tooltip. */
export function StatCard({ s, onClick, on }: { s: StatDef; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" className={`stat-card ${s.tone ?? ""} ${on ? "on" : ""}`} onClick={onClick} data-tip={s.note} aria-label={`${s.label}: ${s.value}, ${s.note}`} data-stat={s.id}>
      <span className="sc-label"><s.icon />{s.label}</span>
      <span className="sc-num"><CountUp value={s.value} /></span>
    </button>
  );
}

export function StatCards({ o, go }: { o: O; go: Go }) {
  return (
    <div className="ov-stats" aria-label="Repository at a glance" data-testid="overview-stats">
      {statDefs(o).map((s) => <StatCard key={s.id} s={s} onClick={() => go(s.view, s.search ? { search: s.search } : {})} />)}
    </div>
  );
}

export function Review({ o, go }: { o: O; go: Go }) {
  return (
    <section className="card widget">
      <div className="card-head"><span className="w-ico"><Icon.pr /></span><h2>Needs review</h2><span className="muted tnum">{o.proposals.length}</span><span className="spacer" /><button className="btn sm ghost icon-only" data-tip="All proposals" aria-label="All proposals" onClick={() => go("proposals")}><Icon.arrow /></button></div>
      {o.proposals.length === 0 && <div className="card-empty">Nothing waiting. Open a proposal from Branches or <code>kula pr new</code>.</div>}
      {o.proposals.map(({ proposal: p, ...m }) => (
        <div key={p.id} className="ov-row" onClick={() => go("proposals", { proposal: p.id })} title={`${m.ahead ?? "–"} ahead · ${m.files ?? "–"} files · ${m.affected ?? "–"} ripples`}>
          <span className="w-ico"><Icon.pr /></span>
          <div className="grow"><div className="title">{p.title}</div><div className="sub mono">#{p.id} · {p.head} → {p.base} · {relTime(p.created)}</div></div>
          <span className={`risk-pill ${m.risk}`}>{m.risk === "unknown" ? "?" : m.risk}</span>
        </div>
      ))}
    </section>
  );
}

export function Hotspots({ o, go }: { o: O; go: Go }) {
  const code = useCode();
  const max = Math.max(1, ...o.hotspots.map((h) => h.score));
  return (
    <section className="card widget">
      <div className="card-head"><span className="w-ico"><Icon.flame /></span><h2>Hotspots</h2><span className="spacer" /><button className="btn sm ghost icon-only" data-tip="Churn × centrality, 90 days. Open in graph" aria-label="Open hotspots in graph" onClick={() => go("graph", { search: o.hotspots[0]?.path })}><Icon.graph /></button></div>
      {o.hotspots.length === 0 && <div className="card-empty">Not enough history yet.</div>}
      {o.hotspots.slice(0, 8).map((h) => (
        <div key={h.path} data-testid="hotspot" className={`hot-row ${code.target?.path === h.path ? "on" : ""}`} onClick={() => code.open({ path: h.path })} title={`${h.path}\n${h.churn} commits · ${h.symbols} symbols · ${h.degree} call edges`}>
          <span className="mono hot-path">{h.path.split("/").pop()}<span className="muted"> {h.path.split("/").slice(0, -1).join("/")}</span></span>
          <div className="hot-bar"><i style={{ width: `${(h.score / max) * 100}%` }} /></div>
        </div>
      ))}
    </section>
  );
}

const LANG_TONES = ["var(--accent)", "var(--blue)", "var(--green)", "var(--yellow)", "var(--text-3)"];
function Languages({ rows }: { rows: LangRow[] }) {
  const total = rows.reduce((n, r) => n + r.files, 0) || 1;
  const top = rows.slice(0, 4);
  const rest = rows.slice(4).reduce((n, r) => n + r.files, 0);
  const parts = rest ? [...top, { id: "other", name: "Other", files: rest } as LangRow] : top;
  return (
    <div className="langs" data-testid="overview-langs">
      <div className="langs-bar" aria-hidden="true">{parts.map((r, i) => <i key={r.id} style={{ width: `${(r.files / total) * 100}%`, background: LANG_TONES[i] }} />)}</div>
      <ul>{parts.map((r, i) => <li key={r.id}><i style={{ background: LANG_TONES[i] }} /><span className="grow">{r.name}</span><span className="tnum muted">{Math.round((r.files / total) * 100)}%</span></li>)}</ul>
    </div>
  );
}

type MoreKey = "branches" | "commits" | "issues" | "langs" | "coupling";
const MORE: [MoreKey, string, Ic][] = [
  ["branches", "Branches", Icon.branches], ["commits", "Recent commits", Icon.history], ["issues", "Open issues", Icon.issues], ["langs", "Languages", Icon.langs], ["coupling", "Coupling", Icon.link],
];

/** Secondary readouts behind icon toggles; switching dissolves through the dither. */
export function MorePanel({ o, go, version, initial = "branches" }: { o: O; go: Go; version: number; initial?: MoreKey }) {
  const [k, setK] = useState<MoreKey>(initial);
  const [langs, setLangs] = useState<LangRow[] | null>(null);
  useEffect(() => { api.langs().then((l) => setLangs(l.detected.filter((x) => x.files > 0).sort((a, b) => b.files - a.files))).catch(() => setLangs([])); }, [version]);
  const maxAB = Math.max(1, ...o.branches.map((b) => Math.max(b.ahead, b.behind)));
  const cur = MORE.find((m) => m[0] === k)!;
  const Cur = cur[2];
  const body: Record<MoreKey, ReactNode> = {
    branches: <div className="br-table" data-testid="overview-branches">{o.branches.slice(0, 8).map((b) => (
      <div key={b.name} className="br-row" title={`${b.behind} behind · ${b.ahead} ahead · ${relTime(b.time)}`}>
        <span className={`dot ${b.current ? "ok" : ""}`} />
        <span className="mono br-name">{b.name}</span>
        <div className="ab"><div className="ab-behind"><i style={{ width: `${(b.behind / maxAB) * 100}%` }} /></div><div className="ab-mid" /><div className="ab-ahead"><i style={{ width: `${(b.ahead / maxAB) * 100}%` }} /></div></div>
        <span className="muted ab-n tnum">−{b.behind}/+{b.ahead}</span>
        {b.name !== o.default_branch
          ? <button className="btn sm ghost icon-only" data-tip={`Contrast with ${o.default_branch}`} aria-label={`Contrast ${b.name} with ${o.default_branch}`} onClick={() => go("graph", { contrast: { base: o.default_branch, head: b.name } })}><Icon.compare /></button>
          : <span className="tag">default</span>}
      </div>))}</div>,
    commits: o.recent.length === 0 ? <div className="card-empty">No commits yet.</div> : <>{o.recent.map((c) => (
      <div key={c.sha} className="ov-row" onClick={() => go("history", { sha: c.sha })} title={`${c.author} · ${relTime(c.time)}`}>
        <span className="mono accent">{c.short}</span><div className="grow title">{c.subject}</div><span className="muted sub">{relTime(c.time)}</span>
      </div>))}</>,
    issues: o.issues.length === 0 ? <div className="card-empty">No open issues.</div> : <>{o.issues.map((i) => (
      <div key={i.id} className="ov-row" onClick={() => go("issues", { issue: i.id })}>
        <span className="mono muted">#{i.id}</span><div className="grow title">{i.title}</div>{i.labels[0] && <span className="tag">{i.labels[0]}</span>}
      </div>))}</>,
    langs: !langs ? <div className="card-empty" aria-busy="true">loading…</div> : !langs.length ? <div className="card-empty">No source files detected.</div> : <Languages rows={langs} />,
    coupling: <Coupling onDir={(d) => go("graph", { search: d })} />,
  };
  return (
    <section className="card widget more">
      <div className="card-head">
        <span className="w-ico"><Cur /></span><h2>{cur[1]}</h2><span className="spacer" />
        <div className="icon-toggles" role="group" aria-label="More readouts">
          {MORE.map(([id, label, I]) => <button key={id} className={`btn sm ghost icon-only ${k === id ? "on" : ""}`} aria-pressed={k === id} aria-label={label} data-tip={label} onClick={() => setK(id)}><I /></button>)}
        </div>
      </div>
      <DitherDissolve k={k}>{body[k]}</DitherDissolve>
    </section>
  );
}

export function Hero({ repo, o, go }: { repo: RepoInfo | null; o: O; go: Go }) {
  const s = repo?.stats;
  const onDefault = repo?.branch === o.default_branch;
  return (
    <header className="ov-head card">
      <Suspense fallback={null}><div className="ov-life" aria-hidden="true"><Life /></div></Suspense>
      <div className="ov-title">
        <div className="eyebrow"><span className="accent">$</span> kula status</div>
        <h1>{repo?.name}</h1>
        <div className="ov-sub">
          <span className="mono">⎇ {repo?.branch}</span>
          {!onDefault && <span className="muted">from <span className="mono">{o.default_branch}</span></span>}
          {s && <span className="muted ov-facts tnum" title={`indexed in ${s.millis}ms`}><CountUp value={s.files} /> files · <CountUp value={s.symbols} /> symbols</span>}
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn sm ghost icon-only" aria-label="Open map" data-tip="Open map" onClick={() => go("flows")}><Icon.map /></button>
        <button className="btn sm ghost icon-only" aria-label={onDefault ? "Contrast HEAD with working tree" : `Contrast with ${o.default_branch}`} data-tip={onDefault ? "Contrast HEAD with working tree" : `Contrast with ${o.default_branch}`}
          onClick={() => go("graph", { contrast: { base: o.default_branch, head: onDefault ? "WORKTREE" : repo?.branch ?? "WORKTREE" } })}><Icon.compare /></button>
      </div>
    </header>
  );
}

export function Loading({ text }: { text: string }) {
  return <div className="loading"><div className="mini-loader"><div className="ml-field"><AsciiMark period={3.2} /></div><span>{text}</span></div></div>;
}

// The overview canvas: the repository as a system. Work flows from branches
// through the worktree into proposals; issues become runs, runs become edits.
type OvNode = "repo" | StatDef["id"] | "runs";
const LAYOUT: Record<OvNode, [number, number]> = {
  repo: [0, 150], branches: [300, 0], changes: [540, 0], proposals: [780, 0],
  issues: [300, 150], runs: [540, 150], hotspots: [300, 300], notes: [540, 300],
};
const LINKS: [OvNode, OvNode, string][] = [
  ["repo", "branches", ""], ["branches", "changes", "worktree"], ["changes", "proposals", "propose"],
  ["repo", "issues", ""], ["issues", "runs", "assign"], ["runs", "changes", "edits"], ["runs", "proposals", "review"],
  ["repo", "hotspots", ""], ["hotspots", "notes", "annotate"],
];
/** Which pane tab tells the story of each node. */
const PANE_OF: Record<OvNode, string> = { repo: "summary", branches: "readouts", changes: "summary", proposals: "review", issues: "readouts", runs: "runs", hotspots: "hotspots", notes: "summary" };

/** Everything that needs a human, on one canvas: the review queue. */
export default function Overview({ repo, version, go }: Props) {
  const { o, err } = useOverview(version);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("summary");
  const [run, setRun] = useState<string | null>(null);
  const { runs } = useRuns(version);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  if (err && !o) return <Empty title="Overview unavailable">{err}</Empty>;
  if (!o) return <Loading text="Gathering the review queue…" />;

  const stats = statDefs(o);
  const active = runs.filter((r) => r.state === "running").length;
  const W = 190, H = 92;
  const nodes: CNode[] = [
    { id: "repo", x: 0, y: LAYOUT.repo[1] - 10, w: 220, h: 112, icon: <Logo size={14} />, title: repo?.name ?? "repo", sub: `⎇ ${repo?.branch ?? ""}`, tone: "accent", label: "Repository",
      body: repo?.stats ? <span className="tnum"><CountUp value={repo.stats.files} /> files · <CountUp value={repo.stats.symbols} /> symbols</span> : null },
    ...stats.map((s): CNode => ({ id: s.id, x: LAYOUT[s.id as OvNode][0], y: LAYOUT[s.id as OvNode][1], w: W, h: H, icon: <s.icon />, title: s.label, label: s.label, sub: s.note,
      tone: s.tone === "bad" ? "bad" : s.tone === "warn" ? "warn" : undefined, body: <span className="kc-num"><CountUp value={s.value} /></span> })),
    { id: "runs", x: LAYOUT.runs[0], y: LAYOUT.runs[1], w: W, h: H, icon: <Icon.runs />, title: "Runs", label: "Runs", sub: active ? `${active} active` : "none active", live: active > 0, body: <span className="kc-num"><CountUp value={runs.length} /></span> },
  ];
  const edges: CEdge[] = LINKS.map(([a, b, l]) => ({ id: `${a}>${b}`, from: a, to: b, label: l || undefined }));
  const hl = new Set(Object.entries(PANE_OF).filter(([, t]) => t === tab).map(([k]) => k));

  const pick = (id: string | null) => { setSel(id); if (id) setTab(PANE_OF[id as OvNode]); };
  const st = stats.find((s) => s.id === sel);
  const list = (rows: [string, string, () => void][]) => rows.length ? rows.map(([k, t, f]) => <button key={k} className="side-link" onClick={f}><span className="mono">{t}</span></button>) : <div className="muted">Nothing here.</div>;
  const detail: Record<string, ReactNode> = {
    repo: <dl className="kv"><div><dt>Branch</dt><dd>{repo?.branch}</dd></div><div><dt>Default</dt><dd>{o.default_branch}</dd></div><div><dt>Head</dt><dd className="mono">{repo?.head?.slice(0, 10)}</dd></div>{repo?.stats && <><div><dt>Files</dt><dd>{repo.stats.files}</dd></div><div><dt>Symbols</dt><dd>{repo.stats.symbols}</dd></div><div><dt>Edges</dt><dd>{repo.stats.edges}</dd></div></>}</dl>,
    proposals: list(o.proposals.map(({ proposal: p }) => [String(p.id), `#${p.id} ${p.title}`, () => go("proposals", { proposal: p.id })])),
    issues: list(o.issues.map((i) => [String(i.id), `#${i.id} ${i.title}`, () => go("issues", { issue: i.id })])),
    branches: list(o.branches.slice(0, 10).map((b) => [b.name, `${b.name}  −${b.behind}/+${b.ahead}`, () => go("graph", { contrast: { base: o.default_branch, head: b.name } })])),
    hotspots: list(o.hotspots.slice(0, 10).map((h) => [h.path, h.path, () => go("graph", { search: h.path })])),
    changes: <div className="muted">{o.changes ? `${o.changes} files differ from HEAD.` : "The worktree is clean."}</div>,
    notes: <div className="muted">{o.notes} notes on symbols and files.</div>,
    runs: list(runs.map((r) => [r.id, `${r.kind}: ${r.task}`, () => { setTab("runs"); setRun(r.id); }])),
  };
  const side = sel ? {
    title: sel === "repo" ? repo?.name : sel === "runs" ? "Runs" : st?.label, sub: sel === "repo" ? `⎇ ${repo?.branch}` : sel === "runs" ? `${runs.length} runs` : st?.note,
    icon: sel === "repo" ? <Logo size={16} /> : sel === "runs" ? <Icon.runs /> : st ? <st.icon /> : null,
    body: detail[sel], onClose: () => setSel(null),
    actions: sel === "repo" ? <button className="btn sm" onClick={() => go("flows")}><Icon.map /> Open map</button>
      : sel === "runs" ? <button className="btn sm" onClick={() => go("agents", { tab: "teams" })}><Icon.agents /> Open agents</button>
      : st ? <button className="btn sm" onClick={() => go(st.view, st.search ? { search: st.search } : {})}><st.icon /> Open {st.label.toLowerCase()}</button> : null,
  } : null;

  return (
    <Workspace id="overview" testid="overview" side={side} tab={tab} onTab={(t) => { setTab(t); }}
      canvas={<Canvas testid="overview-canvas" label="Overview canvas" nodes={nodes} edges={edges} selected={sel} onSelect={pick} highlight={hl} fitKey="overview" />}
      tabs={[
        { id: "summary", label: "Summary", icon: Icon.home, render: () => <div className="overview pane-pad"><Stagger className="ov-stack"><Hero repo={repo} o={o} go={go} /><StatCards o={o} go={go} /><MorePanel o={o} go={go} version={version} /></Stagger></div> },
        { id: "runs", label: "Runs", icon: Icon.runs, count: runs.length, render: () => <div className="pane-pad"><Runs version={version} go={go} selected={run} onSelect={(r) => { setRun(r?.id ?? null); if (r) setSel("runs"); }} />{run && runs.find((r) => r.id === run) && <RunDetail run={runs.find((r) => r.id === run)!} go={go} />}</div> },
        { id: "review", label: "Review", icon: Icon.pr, count: o.proposals.length, render: () => <div className="pane-pad"><Review o={o} go={go} /></div> },
        { id: "hotspots", label: "Hotspots", icon: Icon.flame, render: () => <div className="pane-pad"><Hotspots o={o} go={go} /></div> },
        { id: "readouts", label: "Readouts", icon: Icon.langs, render: () => <div className="pane-pad"><MorePanel key={sel ?? ""} o={o} go={go} version={version} initial={sel === "issues" ? "issues" : "branches"} /></div> },
      ]} />
  );
}
