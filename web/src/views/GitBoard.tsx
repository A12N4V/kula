// The Git board: every git surface on one screen, as frosted widgets that share
// one selection. Picking a file, a commit, a stash or a compare in any widget
// fills Detail; picking a branch filters History. Only widget bodies scroll.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, isConflict, relTime, type Branch, type Commit, type Compare, type FileStatus, type GitOp, type Proposal } from "../api";
import type { Go, Target } from "../nav";
import { Diff, Icon, ShowOutput, Tip, useToast } from "../ui";
import { CompareReport, LANE_COLORS, computeLanes } from "./GitViews";
import "../styles/board.css";

type Sel =
  | { kind: "file"; path: string; staged: boolean }
  | { kind: "commit"; sha: string }
  | { kind: "compare"; base: string; head: string; proposal?: number }
  | { kind: "stash"; n: number }
  | null;

type Props = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

// ------------------------------------------------------------ frame pieces
export function Widget({ area, title, count, tools, foot, alert, children }: { area: string; title: string; count?: ReactNode; tools?: ReactNode; foot?: ReactNode; alert?: boolean; children: ReactNode }) {
  return (
    <section className={`widget ${alert ? "alert" : ""}`} data-area={area} data-testid={`w-${area}`} aria-label={title}>
      <header className="widget-head">
        <span className="widget-title">{title}</span>
        {count !== undefined && <span className="widget-count">{count}</span>}
        <span className="spacer" />
        {tools}
      </header>
      <div className="widget-body">{children}</div>
      {foot && <footer className="widget-foot">{foot}</footer>}
    </section>
  );
}

export function WEmpty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="w-empty">{icon}<span>{children}</span></div>;
}

/** An icon only button with a tooltip; the tooltip doubles as its accessible name. */
function IB({ tip, onClick, disabled, children, primary }: { tip: string; onClick: () => void; disabled?: boolean; children: ReactNode; primary?: boolean }) {
  return (
    <Tip tip={tip}>
      <button className={`btn sm ${primary ? "primary" : "ghost"} icon-only`} aria-label={tip} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
    </Tip>
  );
}

const OP_LABEL: Record<GitOp, string> = { merge: "Merge", rebase: "Rebase", cherry_pick: "Cherry pick", revert: "Revert" };

// ------------------------------------------------------------ the board
export default function GitBoard({ onChanged, openSymbol, version, go, target }: Props) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [op, setOp] = useState<GitOp | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stashes, setStashes] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [sel, setSel] = useState<Sel>(target?.sha ? { kind: "commit", sha: target.sha } : null);
  const [filter, setFilter] = useState<string>(""); // branch filter for History

  const refresh = () => setTick((t) => t + 1);
  const seeded = useRef(!!target?.sha);
  useEffect(() => {
    api.status().then((s) => {
      setBranch(s.branch); setFiles(s.files); setOp(s.state ?? null);
      // Detail is never blank on arrival: the first change, else the tip commit.
      if (!seeded.current) {
        seeded.current = true;
        const f = s.files[0];
        if (f) setSel({ kind: "file", path: f.path, staged: f.staged && !f.unstaged });
        else api.log(1).then((c) => c[0] && setSel((x) => x ?? { kind: "commit", sha: c[0].sha })).catch(() => {});
      }
    }).catch(() => {});
    api.branches().then((b) => { setBranches(b.branches); setStashes(b.stashes); }).catch(() => {});
    api.meta().then((m) => setProposals(m.proposals.filter((p) => p.status === "open"))).catch(() => {});
  }, [version, tick]);
  useEffect(() => { if (target?.sha) setSel({ kind: "commit", sha: target.sha }); }, [target?.sha]);

  /** Run a git action, toast, then refresh every widget. */
  const run = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    try {
      const r = await api.git(action, body);
      if (ok) toast(ok);
      refresh(); onChanged();
      return r.output;
    } catch (e: any) { toast(e.message, "err"); return null; }
  };

  const local = branches.filter((b) => !b.remote);
  const current = local.find((b) => b.current);

  return (
    <div className="board git-board" data-testid="git-board">
      <WorkingTree files={files} sel={sel} setSel={setSel} run={run} />
      <HistoryW version={version + tick} filter={filter} setFilter={setFilter} sel={sel} setSel={setSel} />
      <BranchesW branches={local} filter={filter} setFilter={setFilter} run={run} current={branch} setSel={setSel} />
      <Detail sel={sel} setSel={setSel} files={files} run={run} go={go} openSymbol={openSymbol} current={branch} version={version + tick} />
      <SyncW current={current} run={run} refresh={() => { refresh(); onChanged(); }} />
      {op ? <ConflictsW op={op} files={files.filter(isConflict)} run={run} setSel={setSel} sel={sel} />
          : <StashW stashes={stashes} run={run} sel={sel} setSel={setSel} />}
      <ReviewW proposals={proposals} branches={local} current={branch} sel={sel} setSel={setSel} />
    </div>
  );
}

type Run = (action: string, body?: Record<string, unknown>, ok?: string) => Promise<string | null>;
type SetSel = (s: Sel) => void;

// ------------------------------------------------------------ working tree
function WorkingTree({ files, sel, setSel, run }: { files: FileStatus[]; sel: Sel; setSel: SetSel; run: Run }) {
  const [msg, setMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => f.unstaged || f.untracked);
  const code = (f: FileStatus, s: boolean) => (s ? f.index : f.untracked ? "?" : f.worktree);
  const cls = (c: string) => (c === "?" ? "q" : c);
  const commit = async () => {
    if (await run("commit", { message: msg, amend }, amend ? "Amended last commit" : "Committed") !== null) { setMsg(""); setAmend(false); }
  };
  // j/k walk the rows, s stages, u unstages; typing in a field is left alone.
  const flat = [...staged.map((f) => ({ path: f.path, staged: true })), ...unstaged.map((f) => ({ path: f.path, staged: false }))];
  const keys = useRef({ flat, sel, setSel, run });
  keys.current = { flat, sel, setSel, run };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.closest("[role=dialog]")))) return;
      const { flat, sel, setSel, run } = keys.current;
      if (!flat.length || !"jksu".includes(e.key) || e.key.length !== 1) return;
      const i = sel?.kind === "file" ? flat.findIndex((r) => r.path === sel.path && r.staged === sel.staged) : -1;
      const cur = flat[i];
      if (e.key === "j") setSel({ kind: "file", ...flat[Math.min(flat.length - 1, i + 1)] });
      else if (e.key === "k") setSel({ kind: "file", ...flat[Math.max(0, i - 1)] });
      else if (e.key === "s" && cur && !cur.staged) run("stage", { paths: [cur.path] }).then(() => setSel({ kind: "file", path: cur.path, staged: true }));
      else if (e.key === "u" && cur && cur.staged) run("unstage", { paths: [cur.path] }).then(() => setSel({ kind: "file", path: cur.path, staged: false }));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const row = (f: FileStatus, s: boolean) => {
    const on = sel?.kind === "file" && sel.path === f.path && sel.staged === s;
    const c = code(f, s);
    return (
      <div key={(s ? "s:" : "u:") + f.path} className={`w-row ${on ? "on" : ""}`} onClick={() => setSel({ kind: "file", path: f.path, staged: s })} title={f.path}>
        <span className={`w-code ${cls(c)}`}>{c}</span>
        <span className="grow mono">{f.path}</span>
        <span className="acts">
          {s ? <IB tip="Unstage" onClick={() => run("unstage", { paths: [f.path] })}><Icon.minus /></IB>
             : <IB tip="Stage" onClick={() => run("stage", { paths: [f.path] })}><Icon.plus /></IB>}
        </span>
      </div>
    );
  };
  return (
    <Widget area="tree" title="Working tree" count={files.length}
      foot={
        <>
          <textarea className="input" rows={2} placeholder="Commit message" aria-label="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg.trim() && (staged.length || amend)) { e.preventDefault(); commit(); } }} style={{ resize: "none" }} />
          <div className="w-line">
            <label className="w-note" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend</label>
            <span className="spacer" />
            <button className="btn sm primary" disabled={!msg.trim() || (!staged.length && !amend)} onClick={commit}><Icon.check /> Commit {staged.length ? staged.length : ""}</button>
          </div>
        </>
      }>
      {files.length === 0 ? <WEmpty icon={<Icon.check />}>Working tree clean</WEmpty> : (
        <>
          <div className="w-sec">Staged {staged.length}<span className="spacer" />{staged.length > 0 && <IB tip="Unstage all" onClick={() => run("unstage", { paths: staged.map((f) => f.path) })}><Icon.minus /></IB>}</div>
          {staged.length === 0 ? <div className="w-note" style={{ padding: "2px 14px 6px" }}>Nothing staged</div> : staged.map((f) => row(f, true))}
          <div className="w-sec">Changes {unstaged.length}<span className="spacer" />{unstaged.length > 0 && <IB tip="Stage all" onClick={() => run("stage", { paths: unstaged.map((f) => f.path) })}><Icon.plus /></IB>}</div>
          {unstaged.map((f) => row(f, false))}
        </>
      )}
    </Widget>
  );
}

// ------------------------------------------------------------ history
function HistoryW({ version, filter, setFilter, sel, setSel }: { version: number; filter: string; setFilter: (b: string) => void; sel: Sel; setSel: SetSel }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { api.log(400, filter || undefined).then(setCommits).catch(() => setCommits([])); }, [version, filter]);
  const lanes = useMemo(() => computeLanes(commits), [commits]);
  const width = Math.min(8, Math.max(1, ...lanes.map((l) => Math.max(l.before.length, l.after.length, l.lane + 1)))) * 12 + 8;
  const ROW = 34;
  const x = (l: number) => 10 + l * 12;
  const visible = commits.map((c, i) => ({ c, i })).filter(({ c }) => !q || (c.subject + c.author + c.short).toLowerCase().includes(q.toLowerCase()));
  const selSha = sel?.kind === "commit" ? sel.sha : null;
  return (
    <Widget area="hist" title="History" count={commits.length}
      tools={<>
        {filter && <Tip tip="Show every branch"><button className="tag accent" style={{ cursor: "pointer" }} onClick={() => setFilter("")}>{filter} <Icon.close /></button></Tip>}
        <input className="input" style={{ width: 140 }} placeholder="Filter" aria-label="Filter commits" value={q} onChange={(e) => setQ(e.target.value)} />
      </>}>
      {commits.length === 0 ? <WEmpty icon={<Icon.history />}>No commits yet</WEmpty> : visible.map(({ c, i }) => {
        const L = lanes[i];
        return (
          <div key={c.sha} className={`w-row w-commit ${selSha === c.sha || (selSha && c.sha.startsWith(selSha)) ? "on" : ""}`} onClick={() => setSel({ kind: "commit", sha: c.sha })}>
            {!q && (
              <svg data-figure width={width} height={ROW}>
                {L.before.map((s, l) => s && l < 8 && <line key={"b" + l} x1={x(l)} y1={0} x2={x(l === L.lane || s === c.sha ? L.lane : l)} y2={ROW / 2} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                {L.after.map((s, l) => s && l < 8 && <line key={"a" + l} x1={x(l === L.lane || (L.extra.includes(l) && L.before[l] !== s) ? L.lane : l)} y1={ROW / 2} x2={x(l)} y2={ROW} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                <circle cx={x(L.lane)} cy={ROW / 2} r={c.parents.length > 1 ? 4.5 : 4} fill={c.parents.length > 1 ? "var(--bg-2)" : LANE_COLORS[L.lane % 7]} stroke={LANE_COLORS[L.lane % 7]} strokeWidth="2" />
              </svg>
            )}
            <span className="grow">{c.subject}</span>
            {c.refs.slice(0, 2).map((r) => <span key={r} className={`tag ${r.startsWith("HEAD") ? "accent" : r.startsWith("tag:") ? "yellow" : ""}`} style={{ height: 17, fontSize: 10.5, flexShrink: 0 }}>{r.replace("HEAD -> ", "")}</span>)}
            <span className="dim mono">{c.short}</span>
            <span className="dim">{relTime(c.time)}</span>
          </div>
        );
      })}
    </Widget>
  );
}

// ------------------------------------------------------------ branches
function BranchesW({ branches, filter, setFilter, run, current, setSel }: { branches: Branch[]; filter: string; setFilter: (b: string) => void; run: Run; current: string; setSel: SetSel }) {
  const [name, setName] = useState("");
  const make = async () => { const n = name.trim(); if (n && await run("branch", { name: n }, `Branch ${n} created`) !== null) setName(""); };
  return (
    <Widget area="br" title="Branches" count={branches.length}
      foot={
        <div className="w-line" style={{ flexWrap: "nowrap" }}>
          <input className="input" style={{ flex: 1, height: 26 }} placeholder="New branch" aria-label="New branch name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()} />
          <IB tip="Create branch" onClick={make} disabled={!name.trim()}><Icon.plus /></IB>
        </div>
      }>
      {branches.length === 0 ? <WEmpty icon={<Icon.branches />}>No branches</WEmpty> : branches.map((b) => (
        <div key={b.name} className={`w-row ${filter === b.name ? "on" : ""}`} onClick={() => setFilter(filter === b.name ? "" : b.name)} title={b.subject}>
          <span className="w-code" style={{ color: b.current ? "var(--accent)" : "var(--text-3)" }}>{b.current ? "●" : "○"}</span>
          <span className="grow mono">{b.name}</span>
          {b.track && <span className="dim mono">{b.track.replace(/[[\]]/g, "")}</span>}
          <span className="acts">
            {!b.current && <IB tip="Check out" onClick={() => run("checkout", { name: b.name }, `On ${b.name}`)}><Icon.arrow /></IB>}
            {!b.current && <IB tip={`Compare with ${current}`} onClick={() => setSel({ kind: "compare", base: current, head: b.name })}><Icon.compare /></IB>}
            {!b.current && <IB tip={`Merge into ${current}`} onClick={() => { if (confirm(`Merge ${b.name} into ${current}?`)) run("merge", { name: b.name }, `Merged ${b.name}`); }}><Icon.branches /></IB>}
            {!b.current && <IB tip="Delete branch" onClick={() => { if (confirm(`Delete ${b.name}?`)) run("branch_delete", { name: b.name }, `Deleted ${b.name}`); }}><Icon.close /></IB>}
          </span>
        </div>
      ))}
    </Widget>
  );
}

// ------------------------------------------------------------ detail
function Detail({ sel, setSel, files, run, go, openSymbol, current, version }: { sel: Sel; setSel: SetSel; files: FileStatus[]; run: Run; go?: Go; openSymbol: (id: number) => void; current: string; version: number }) {
  const [text, setText] = useState("");
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [err, setErr] = useState("");
  const toast = useToast();
  const key = JSON.stringify(sel);
  useEffect(() => {
    setText(""); setCmp(null); setErr("");
    if (!sel) return;
    const fail = (e: any) => setErr(e.message ?? String(e));
    if (sel.kind === "file") api.diff(sel.path, sel.staged).then((d) => setText(d.diff)).catch(fail);
    else if (sel.kind === "commit") api.show(sel.sha).then((s) => setText(s.show)).catch(fail);
    else if (sel.kind === "stash") api.git("stash_show", { name: String(sel.n) }).then((r) => setText(r.output)).catch(fail);
    else api.compare(sel.base, sel.head).then(setCmp).catch(fail);
  }, [key, version]);
  // A file that left the tree (committed, discarded) clears the selection.
  useEffect(() => { if (sel?.kind === "file" && !files.some((f) => f.path === sel.path)) setSel(null); }, [files]);

  let title: ReactNode = null, tools: ReactNode = null, body: ReactNode;
  if (!sel) body = <WEmpty icon={<Icon.target />}>Pick a file, commit, stash or branch</WEmpty>;
  else if (err) body = <pre className="w-out">{err}</pre>;
  else if (sel.kind === "file") {
    title = <span className="mono">{sel.path}</span>;
    tools = <>
      <span className="tag">{sel.staged ? "staged" : "working"}</span>
      {!sel.staged && <IB tip="Discard changes" onClick={() => { if (confirm(`Discard changes to ${sel.path}?`)) run("discard", { paths: [sel.path] }, "Discarded"); }}><Icon.close /></IB>}
    </>;
    body = text ? <Diff text={text} /> : <WEmpty icon={<Icon.changes />}>No textual diff</WEmpty>;
  } else if (sel.kind === "commit") {
    const sha = sel.sha;
    title = <span className="mono">{sha.slice(0, 10)}</span>;
    tools = <>
      <IB tip="Graph against parent" primary onClick={() => go?.("graph", { contrast: { base: `${sha}^`, head: sha } })}><Icon.graph /></IB>
      <IB tip="Cherry pick" onClick={() => run("cherry_pick", { name: sha }, "Cherry picked")}><Icon.copy /></IB>
      <IB tip="Revert" onClick={() => { if (confirm("Create a revert commit?")) run("revert", { name: sha }, "Reverted"); }}><Icon.back /></IB>
      <IB tip="Tag this commit" onClick={() => { const n = prompt("Tag name"); if (n) run("tag", { name: n, from: sha }, `Tagged ${n}`); }}><Icon.check /></IB>
      <IB tip="Branch from here" onClick={() => { const n = prompt("New branch name"); if (n) run("branch", { name: n, from: sha }, `Branch ${n} created`); }}><Icon.branches /></IB>
    </>;
    body = text ? <div className="w-pad"><ShowOutput text={text} /></div> : null;
  } else if (sel.kind === "stash") {
    const n = sel.n;
    title = <span className="mono">stash@{`{${n}}`}</span>;
    tools = <>
      <IB tip="Apply" onClick={() => run("stash_apply", { name: String(n) }, "Applied")}><Icon.check /></IB>
      <IB tip="Pop" onClick={() => run("stash_pop", { name: String(n) }, "Popped").then((o) => o !== null && setSel(null))}><Icon.up /></IB>
      <IB tip="Drop" onClick={() => { if (confirm(`Drop stash ${n}?`)) run("stash_drop", { name: String(n) }, "Dropped").then((o) => o !== null && setSel(null)); }}><Icon.close /></IB>
    </>;
    body = text ? <Diff text={text} /> : <WEmpty icon={<Icon.doc />}>Empty stash</WEmpty>;
  } else {
    const { base, head, proposal } = sel;
    title = <span className="mono">{base} … {head}</span>;
    tools = <>
      <IB tip="Graph contrast" primary onClick={() => go?.("graph", { contrast: { base, head } })}><Icon.graph /></IB>
      {proposal ? <IB tip="Open proposal" onClick={() => go?.("proposals", { proposal })}><Icon.pr /></IB>
        : <IB tip="Propose this change" onClick={() => api.metaAction<Proposal>("proposals", "new", { title: `${head} into ${base}`, base, head }).then((p) => { toast("Proposal opened"); go?.("proposals", { proposal: (p as Proposal).id }); }).catch((e) => toast(e.message, "err"))}><Icon.pr /></IB>}
      {base === current && <IB tip={`Merge ${head} here`} onClick={() => { if (confirm(`Merge ${head} into ${base}?`)) run("merge", { name: head }, `Merged ${head}`); }}><Icon.branches /></IB>}
    </>;
    body = cmp ? <div className="w-pad"><CompareReport c={cmp} openSymbol={openSymbol} /></div> : null;
  }
  return (
    <section className="widget" data-area="det" data-testid="w-det" aria-label="Detail">
      <header className="widget-head"><span className="widget-title">Detail</span><span className="spacer" />{sel && <IB tip="Clear" onClick={() => setSel(null)}><Icon.close /></IB>}</header>
      {title && <div className="w-detail-bar">{title}<span className="spacer" />{tools}</div>}
      <div className="widget-body">{body}</div>
    </section>
  );
}

// ------------------------------------------------------------ sync
function SyncW({ current, run, refresh }: { current?: Branch; run: Run; refresh: () => void }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState("");
  const ahead = Number(/ahead (\d+)/.exec(current?.track ?? "")?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(current?.track ?? "")?.[1] ?? 0);
  const go = async (label: string, f: () => Promise<string | null>) => { setBusy(label); const o = await f(); setBusy(""); if (o !== null) setOut(o.trim() || `${label} done`); };
  const kula = (args: string[]) => api.kula(args).then((r) => { refresh(); return (r.stdout + r.stderr).trim(); }).catch((e) => e.message as string);
  return (
    <Widget area="sync" title="Sync" count={current?.upstream || "no upstream"}
      tools={<>
        <IB tip="Fetch" disabled={!!busy} onClick={() => go("Fetch", () => run("fetch"))}><Icon.refresh /></IB>
        <IB tip="Pull" disabled={!!busy} onClick={() => go("Pull", () => run("pull"))}><Icon.down /></IB>
        <IB tip="Push" disabled={!!busy} onClick={() => go("Push", () => run("push"))}><Icon.up /></IB>
        <IB tip="Share kula meta" disabled={!!busy} onClick={() => go("Share", () => kula(["share"]))}><Icon.team /></IB>
        <IB tip="Sync kula meta" disabled={!!busy} onClick={() => go("Sync", () => kula(["sync"]))}><Icon.workflow /></IB>
      </>}>
      <div className="w-sync">
        <div className="w-stat"><b style={{ color: ahead ? "var(--accent)" : undefined }}>{ahead}</b><span>Ahead</span></div>
        <div className="w-stat"><b style={{ color: behind ? "var(--yellow)" : undefined }}>{behind}</b><span>Behind</span></div>
        <div className="w-stat"><b>{current ? relTime(current.time) : "–"}</b><span>Last</span></div>
      </div>
      {busy ? <div className="w-note" style={{ padding: "0 10px" }}>{busy}…</div> : out && <pre className="w-out">{out}</pre>}
    </Widget>
  );
}

// ------------------------------------------------------------ stash or conflicts
function StashW({ stashes, run, sel, setSel }: { stashes: string[]; run: Run; sel: Sel; setSel: SetSel }) {
  const [msg, setMsg] = useState("");
  const save = async () => { if (await run(msg.trim() ? "stash_message" : "stash", msg.trim() ? { message: msg.trim() } : {}, "Stashed") !== null) setMsg(""); };
  return (
    <Widget area="stash" title="Stash" count={stashes.length}
      foot={
        <div className="w-line" style={{ flexWrap: "nowrap" }}>
          <input className="input" style={{ flex: 1, height: 26 }} placeholder="Stash message" aria-label="Stash message" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <IB tip="Stash changes" onClick={save}><Icon.down /></IB>
        </div>
      }>
      {stashes.length === 0 ? <WEmpty icon={<Icon.doc />}>No stashes</WEmpty> : stashes.map((s, n) => (
        <div key={s} className={`w-row ${sel?.kind === "stash" && sel.n === n ? "on" : ""}`} onClick={() => setSel({ kind: "stash", n })} title={s}>
          <span className="w-code mono" style={{ color: "var(--text-3)" }}>{n}</span>
          <span className="grow">{s.replace(/^stash@\{\d+\}:\s*/, "")}</span>
          <span className="acts"><IB tip="Pop" onClick={() => run("stash_pop", { name: String(n) }, "Popped")}><Icon.up /></IB></span>
        </div>
      ))}
    </Widget>
  );
}

function ConflictsW({ op, files, run, sel, setSel }: { op: GitOp; files: FileStatus[]; run: Run; sel: Sel; setSel: SetSel }) {
  return (
    <Widget area="stash" title={`${OP_LABEL[op]} in progress`} count={files.length} alert
      tools={<>
        <IB tip={`Abort ${OP_LABEL[op].toLowerCase()}`} onClick={() => { if (confirm(`Abort the ${OP_LABEL[op].toLowerCase()}?`)) run("abort", {}, "Aborted"); }}><Icon.close /></IB>
        <IB tip="Continue" primary disabled={files.length > 0} onClick={() => run("continue", {}, "Continued")}><Icon.play /></IB>
      </>}>
      {files.length === 0 ? <WEmpty icon={<Icon.check />}>All conflicts resolved</WEmpty> : files.map((f) => (
        <div key={f.path} className={`w-row ${sel?.kind === "file" && sel.path === f.path ? "on" : ""}`} onClick={() => setSel({ kind: "file", path: f.path, staged: false })} title={f.path}>
          <span className="w-code U">{f.index}{f.worktree}</span>
          <span className="grow mono">{f.path}</span>
          <span className="acts">
            <IB tip="Keep ours" onClick={() => run("resolve", { name: "ours", paths: [f.path] }, "Kept ours")}><Icon.back /></IB>
            <IB tip="Take theirs" onClick={() => run("resolve", { name: "theirs", paths: [f.path] }, "Took theirs")}><Icon.arrow /></IB>
            <IB tip="Mark resolved" onClick={() => run("stage", { paths: [f.path] }, "Marked resolved")}><Icon.check /></IB>
          </span>
        </div>
      ))}
    </Widget>
  );
}

// ------------------------------------------------------------ review queue
function ReviewW({ proposals, branches, current, sel, setSel }: { proposals: Proposal[]; branches: Branch[]; current: string; sel: Sel; setSel: SetSel }) {
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const b = base || current, h = head || branches.find((x) => x.name !== b)?.name || "";
  return (
    <Widget area="rev" title="Review" count={proposals.length}
      foot={
        <div className="w-line" style={{ flexWrap: "nowrap" }}>
          <select className="input" style={{ flex: 1, height: 26, minWidth: 0 }} aria-label="Base" value={b} onChange={(e) => setBase(e.target.value)}>{branches.map((x) => <option key={x.name}>{x.name}</option>)}</select>
          <select className="input" style={{ flex: 1, height: 26, minWidth: 0 }} aria-label="Head" value={h} onChange={(e) => setHead(e.target.value)}>{branches.map((x) => <option key={x.name}>{x.name}</option>)}</select>
          <IB tip="Compare" disabled={!b || !h || b === h} onClick={() => setSel({ kind: "compare", base: b, head: h })}><Icon.compare /></IB>
        </div>
      }>
      {proposals.length === 0 ? <WEmpty icon={<Icon.pr />}>No open proposals</WEmpty> : proposals.map((p) => (
        <div key={p.id} className={`w-row ${sel?.kind === "compare" && sel.proposal === p.id ? "on" : ""}`} onClick={() => setSel({ kind: "compare", base: p.base, head: p.head, proposal: p.id })} title={p.title}>
          <span className="w-code mono" style={{ color: "var(--text-3)" }}>#{p.id}</span>
          <span className="grow">{p.title}</span>
          <span className="dim mono">{p.head}</span>
        </div>
      ))}
    </Widget>
  );
}
