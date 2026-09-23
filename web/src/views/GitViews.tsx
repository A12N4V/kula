import { useEffect, useMemo, useRef, useState } from "react";
import { api, relTime, type Branch, type Commit, type Compare, type FileStatus, type GraphData, type RepoInfo } from "../api";
import Dither from "../Dither";
import type { Go, Target } from "../nav";
import { Diff, Empty, Icon, ShowOutput, Sym, useToast } from "../ui";

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

// ============================================================ Changes
export function Changes({ onChanged, version }: Nav) {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState("");
  const [msg, setMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const toast = useToast();
  const refresh = () => api.status().then((s) => setFiles(s.files));
  useEffect(() => { refresh(); }, [version]);
  // Open the first change so the diff pane is never empty on arrival.
  useEffect(() => {
    if (sel && files.some((f) => f.path === sel.path)) return;
    const f = files[0];
    setSel(f ? { path: f.path, staged: f.staged && !f.unstaged } : null);
  }, [files]);
  useEffect(() => { if (sel) api.diff(sel.path, sel.staged).then((d) => setDiff(d.diff)); else setDiff(""); }, [sel, files]);

  const act = async (action: string, paths: string[] = []) => {
    try { await api.git(action, { paths }); await refresh(); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => f.unstaged || f.untracked);
  const code = (f: FileStatus, s: boolean) => (s ? f.index : f.untracked ? "?" : f.worktree);
  const color = (c: string) => ({ A: "green", "?": "green", D: "red", M: "yellow", R: "violet" } as Record<string, string>)[c] ?? "";

  const commit = async () => {
    try {
      await api.git("commit", { message: msg, amend });
      toast(amend ? "Amended last commit" : "Committed"); setMsg(""); setAmend(false); setSel(null);
      await refresh(); onChanged();
    } catch (e: any) { toast(e.message, "err"); }
  };

  const group = (title: string, list: FileStatus[], isStaged: boolean) => (
    <>
      <div className="list-head" style={{ position: "static", borderBottom: 0, paddingBottom: 4 }}>
        <span className="section-title" style={{ margin: 0 }}>{title} <span className="count">{list.length}</span></span>
        <span className="spacer" />
        {list.length > 0 && <button className="btn sm ghost" onClick={() => act(isStaged ? "unstage" : "stage")}>{isStaged ? "Unstage all" : "Stage all"}</button>}
      </div>
      {list.map((f) => (
        <div key={(isStaged ? "s" : "u") + f.path} className={`item ${sel?.path === f.path && sel.staged === isStaged ? "on" : ""}`} onClick={() => setSel({ path: f.path, staged: isStaged })} style={{ alignItems: "center" }}>
          <span className={`tag ${color(code(f, isStaged))}`} style={{ width: 20, justifyContent: "center", padding: 0 }}>{code(f, isStaged)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="title">{f.path.split("/").pop()}</div>
            <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</div>
          </div>
          <button className="btn sm ghost" title={isStaged ? "Unstage" : "Stage"} onClick={(e) => { e.stopPropagation(); act(isStaged ? "unstage" : "stage", [f.path]); }}>{isStaged ? <Icon.minus /> : <Icon.plus />}</button>
        </div>
      ))}
    </>
  );

  return (
    <div className="split">
      <div className="list" style={{ display: "flex", flexDirection: "column" }}>
        <div className="list-head"><h2>Changes</h2><span className="spacer" /><button className="btn sm ghost" onClick={refresh}><Icon.refresh /></button></div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {files.length === 0 ? <Empty title="Working tree clean">Nothing to commit.</Empty> : (<>{group("Staged", staged, true)}{group("Changes", unstaged, false)}</>)}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--line)" }} className="stack">
          <textarea className="textarea" placeholder="Commit message  (⌘↵ to commit)" value={msg} onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg.trim()) commit(); }} style={{ minHeight: 70 }} />
          <div className="row">
            <label className="row muted" style={{ gap: 6, cursor: "pointer" }}><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend</label>
            <span className="spacer" />
            <button className="btn primary" disabled={!msg.trim() || (!staged.length && !amend)} onClick={commit}>Commit {staged.length ? `${staged.length} file${staged.length > 1 ? "s" : ""}` : ""}</button>
          </div>
        </div>
      </div>
      <div className="detail">
        {sel ? (
          <div className="detail-pad">
            <div className="row" style={{ marginBottom: 14 }}>
              <h1 className="mono" style={{ fontSize: 15 }}>{sel.path}</h1>
              <span className="tag">{sel.staged ? "staged" : "working tree"}</span>
              <span className="spacer" />
              {!sel.staged && <button className="btn danger sm" onClick={() => { if (confirm(`Discard all changes to ${sel.path}? This cannot be undone.`)) act("discard", [sel.path]).then(() => setSel(null)); }}>Discard</button>}
            </div>
            <Diff text={diff} />
          </div>
        ) : <Empty title="Select a file">Review a diff, stage it, then commit.</Empty>}
      </div>
    </div>
  );
}

// ============================================================ History (with lane graph)
const LANE_COLORS = ["var(--accent)", "var(--blue)", "var(--green)", "var(--violet)", "var(--yellow)", "#5fd4c8", "#f08a9b"];

function computeLanes(commits: Commit[]) {
  // Classic lane assignment: each lane holds the sha it is waiting for.
  const lanes: (string | null)[] = [];
  return commits.map((c) => {
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) { lane = lanes.indexOf(null); if (lane === -1) { lane = lanes.length; lanes.push(null); } }
    const before = [...lanes];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.sha && i !== lane) lanes[i] = null; // merges into this commit
    lanes[lane] = c.parents[0] ?? null;
    const extra: number[] = [];
    for (const p of c.parents.slice(1)) {
      let l = lanes.indexOf(p);
      if (l === -1) { l = lanes.indexOf(null); if (l === -1) { l = lanes.length; lanes.push(null); } lanes[l] = p; }
      extra.push(l);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    return { lane, before, after: [...lanes], extra };
  });
}

export function History({ version, target, go }: Nav) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [sel, setSel] = useState<string | null>(target?.sha ?? null);
  const [show, setShow] = useState("");
  const [filter, setFilter] = useState("");
  const toast = useToast();
  useEffect(() => { api.log(400).then((c) => { setCommits(c); if (c[0]) setSel((s) => s ?? c[0].sha); }); }, [version]);
  useEffect(() => { if (sel) api.show(sel).then((s) => setShow(s.show)).catch((e) => toast(e.message, "err")); }, [sel]);
  const lanes = useMemo(() => computeLanes(commits), [commits]);
  const width = Math.min(10, Math.max(1, ...lanes.map((l) => Math.max(l.before.length, l.after.length, l.lane + 1)))) * 12 + 8;
  const ROW = 48;
  const visible = commits.map((c, i) => ({ c, i })).filter(({ c }) => !filter || (c.subject + c.author + c.short).toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="split" style={{ gridTemplateColumns: "minmax(360px, 460px) 1fr" }}>
      <div className="list">
        <div className="list-head"><h2>History</h2><span className="muted">{commits.length}</span><span className="spacer" /><input className="input" style={{ width: 160, height: 26 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {commits.length === 0 && <Empty title="No commits yet" />}
        {visible.map(({ c, i }) => {
          const L = lanes[i];
          const x = (l: number) => 10 + l * 12;
          return (
            <div key={c.sha} className={`item ${sel === c.sha ? "on" : ""}`} style={{ padding: "0 14px 0 6px", height: ROW, alignItems: "center" }} onClick={() => setSel(c.sha)}>
              {!filter && (
                <svg className="lane-svg" width={width} height={ROW}>
                  {L.before.map((s, l) => s && <line key={"b" + l} x1={x(l)} y1={0} x2={x(l === L.lane || s === c.sha ? L.lane : l)} y2={ROW / 2} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                  {L.after.map((s, l) => s && <line key={"a" + l} x1={x(l === L.lane || (L.extra.includes(l) && L.before[l] !== s) ? L.lane : l)} y1={ROW / 2} x2={x(l)} y2={ROW} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                  <circle cx={x(L.lane)} cy={ROW / 2} r={c.parents.length > 1 ? 4.5 : 4} fill={c.parents.length > 1 ? "var(--bg-2)" : LANE_COLORS[L.lane % 7]} stroke={LANE_COLORS[L.lane % 7]} strokeWidth="2" />
                </svg>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="title">{c.subject}</div>
                <div className="sub row" style={{ gap: 6 }}>
                  <span className="mono">{c.short}</span>·<span>{c.author}</span>·<span>{relTime(c.time)}</span>
                  <span className="refs">{c.refs.slice(0, 3).map((r) => <span key={r} className={`tag ${r.startsWith("HEAD") ? "accent" : r.startsWith("tag:") ? "yellow" : ""}`} style={{ height: 17, fontSize: 10.5 }}>{r.replace("HEAD -> ", "● ")}</span>)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="detail">
        {sel ? (
          <div className="detail-pad">
            <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
              <span className="tag mono">{sel.slice(0, 10)}</span>
              <span className="spacer" />
              <button className="btn sm primary" title="Contrast this commit's knowledge graph with its parent's" onClick={() => go?.("graph", { contrast: { base: `${sel}^`, head: sel! } })}><Icon.compare /> Graph vs parent</button>
              <button className="btn sm" onClick={() => api.git("cherry_pick", { name: sel }).then(() => toast("Cherry-picked")).catch((e) => toast(e.message, "err"))}>Cherry-pick</button>
              <button className="btn sm" onClick={() => { if (confirm("Create a revert commit?")) api.git("revert", { name: sel }).then(() => toast("Reverted")).catch((e) => toast(e.message, "err")); }}>Revert</button>
              <button className="btn sm" onClick={() => { const n = prompt("Tag name"); if (n) api.git("tag", { name: n }).then(() => toast(`Tagged ${n}`)).catch((e) => toast(e.message, "err")); }}>Tag…</button>
              <button className="btn sm" onClick={() => { const n = prompt("New branch name"); if (n) api.git("branch", { name: n, from: sel }).then(() => toast(`Branch ${n} created`)).catch((e) => toast(e.message, "err")); }}>Branch here…</button>
            </div>
            <ShowOutput text={show} />
          </div>
        ) : <Empty title="Select a commit" />}
      </div>
    </div>
  );
}

// ============================================================ Branches + Compare
export function Branches({ onChanged, openSymbol, version, initialCompare, go }: Nav & { initialCompare?: { base: string; head: string } | null }) {
  const [data, setData] = useState<{ branches: Branch[]; tags: string[]; stashes: string[] } | null>(null);
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api.branches().then((d) => {
    setData(d);
    const cur = d.branches.find((b) => b.current)?.name ?? "";
    const main = d.branches.find((b) => !b.remote && ["main", "master", "trunk", "develop"].includes(b.name))?.name ?? cur;
    setBase((b) => b || main);
    // Default to the most recent other local branch so compare is meaningful.
    const other = d.branches.filter((b) => !b.remote && b.name !== main).sort((a, b) => b.time - a.time)[0]?.name;
    setHead((h) => h || (cur === main && other ? other : cur));
  });
  useEffect(() => { load(); }, [version]);
  useEffect(() => { if (initialCompare) { setBase(initialCompare.base); setHead(initialCompare.head); } }, [initialCompare]);
  useEffect(() => {
    if (!base || !head) return;
    setBusy(true);
    api.compare(base, head).then(setCmp).catch((e) => { setCmp(null); toast(e.message, "err"); }).finally(() => setBusy(false));
  }, [base, head]);

  const run = async (action: string, body: Record<string, unknown>, ok: string) => {
    try { await api.git(action, body); toast(ok); await load(); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  const local = data?.branches.filter((b) => !b.remote) ?? [];
  const remote = data?.branches.filter((b) => b.remote) ?? [];
  const names = data?.branches.map((b) => b.name) ?? [];

  const row = (b: Branch) => (
    <div key={b.name} className={`item ${head === b.name ? "on" : ""}`} onClick={() => setHead(b.name)}>
      <span className={`dot ${b.current ? "ok" : ""}`} style={{ marginTop: 7 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="title row" style={{ gap: 6 }}><span className="mono">{b.name}</span>{b.track && <span className="tag" style={{ height: 17 }}>{b.track.replace(/[[\]]/g, "")}</span>}</div>
        <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.subject} · {relTime(b.time)}</div>
      </div>
      {!b.remote && !b.current && (
        <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); run("checkout", { name: b.name }, `Switched to ${b.name}`); }}>Checkout</button>
      )}
    </div>
  );

  return (
    <div className="split">
      <div className="list">
        <div className="list-head">
          <h2>Branches</h2><span className="spacer" />
          <button className="btn sm" onClick={() => run("fetch", {}, "Fetched all remotes")}>Fetch</button>
          <button className="btn sm" onClick={() => run("pull", {}, "Pulled")}>Pull</button>
          <button className="btn sm" onClick={() => run("push", {}, "Pushed")}>Push</button>
          <button className="btn sm primary" onClick={() => { const n = prompt("New branch from HEAD"); if (n) run("branch", { name: n }, `Created ${n}`); }}><Icon.plus /></button>
        </div>
        <div className="section-title" style={{ padding: "0 14px" }}>Local <span className="count">{local.length}</span></div>
        {local.map(row)}
        {remote.length > 0 && <><div className="section-title" style={{ padding: "0 14px" }}>Remote <span className="count">{remote.length}</span></div>{remote.map(row)}</>}
        {!!data?.tags.length && <><div className="section-title" style={{ padding: "0 14px" }}>Tags <span className="count">{data.tags.length}</span></div><div style={{ padding: "0 14px 10px", display: "flex", gap: 4, flexWrap: "wrap" }}>{data.tags.slice(0, 30).map((t) => <span key={t} className="tag yellow">{t}</span>)}</div></>}
        <div className="section-title" style={{ padding: "0 14px" }}>Stash <span className="count">{data?.stashes.length ?? 0}</span><span className="spacer" />
          <button className="btn sm ghost" onClick={() => run("stash", {}, "Stashed changes")}>Stash</button>
          {!!data?.stashes.length && <button className="btn sm ghost" onClick={() => run("stash_pop", {}, "Popped stash")}>Pop</button>}
        </div>
        {data?.stashes.map((s) => <div key={s} className="item"><span className="sub mono">{s}</span></div>)}
      </div>
      <div className="detail">
        <div className="detail-pad">
          <div className="row" style={{ marginBottom: 6 }}><Icon.compare /><h1 style={{ fontSize: 17 }}>Compare</h1></div>
          <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
            <select className="input" style={{ width: 200 }} value={base} onChange={(e) => setBase(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select>
            <span className="muted">←</span>
            <select className="input" style={{ width: 200 }} value={head} onChange={(e) => setHead(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select>
            <span className="spacer" />
            {cmp && !data?.branches.find((b) => b.name === head)?.remote && head !== base && (
              <>
                <button className="btn" onClick={() => { const t = prompt("Proposal title", `Merge ${head} into ${base}`); if (t) api.metaAction("proposals", "new", { title: t, base, head }).then(() => { toast("Proposal opened"); onChanged(); }).catch((e) => toast(e.message, "err")); }}>Open proposal</button>
                <button className="btn primary" onClick={() => { if (confirm(`Merge ${head} into the current branch?`)) run("merge", { name: head }, `Merged ${head}`); }}>Merge</button>
              </>
            )}
          </div>
          {busy && <div className="muted">Comparing…</div>}
          {cmp && <><div className="row" style={{ marginBottom: 10 }}><button className="btn sm" onClick={() => go?.("graph", { contrast: { base, head } })}><Icon.graph /> See both graphs</button><span className="muted">overlay or side by side, one click back to this report</span></div><CompareReport c={cmp} openSymbol={openSymbol} /></>}
        </div>
      </div>
    </div>
  );
}

export function CompareReport({ c, openSymbol }: { c: Compare; openSymbol: (id: number) => void }) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="stat-row" style={{ gridTemplateColumns: "repeat(5, 1fr)", margin: 0 }}>
        <div className="stat"><b style={{ color: "var(--green)" }}>{c.ahead}</b><span>ahead</span></div>
        <div className="stat"><b style={{ color: "var(--red)" }}>{c.behind}</b><span>behind</span></div>
        <div className="stat"><b>{c.files.length}</b><span>files</span></div>
        <div className="stat"><b>{c.touched}</b><span>symbols changed</span></div>
        <div className="stat"><b className={`risk ${c.risk}`}>{c.risk}</b><span>{c.affected.length} dependents</span></div>
      </div>
      {c.communities.length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 4 }}><span className="muted">Clusters affected:</span>{c.communities.map((x) => <span key={x} className="tag">{x}</span>)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          <div className="section-title">Changed files</div>
          {c.files.map((f) => (
            <div key={f.path} style={{ marginBottom: 6 }}>
              <div className="sym" onClick={() => setFile(file === f.path ? null : f.path)}>
                <span className={`tag ${f.status === "A" ? "green" : f.status === "D" ? "red" : "yellow"}`} style={{ width: 20, justifyContent: "center", padding: 0 }}>{f.status}</span>
                <span className="nm">{f.path}</span>
              </div>
              <div style={{ paddingLeft: 26 }}>{f.symbols.slice(0, 12).map((s) => <Sym key={s.id} n={s} onClick={(n) => openSymbol(n.id)} right={`L${s.start_line}`} />)}</div>
            </div>
          ))}
          {!c.files.length && <div className="muted">Identical trees.</div>}
        </div>
        <div>
          <div className="section-title">Ripples into <span className="count">{c.affected.length}</span></div>
          {c.affected.slice(0, 60).map((h) => <Sym key={h.node.id} n={h.node} onClick={(n) => openSymbol(n.id)} right={`d${h.depth} · ${h.node.path}`} />)}
          {!c.affected.length && <div className="muted">No indexed dependents.</div>}
          <div className="section-title">Commits <span className="count">{c.commits.length}</span></div>
          {c.commits.slice(0, 30).map((x) => <div key={x.sha} className="row" style={{ padding: "3px 0" }}><span className="mono muted">{x.short}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.subject}</span></div>)}
        </div>
      </div>
    </div>
  );
}

// ============================================================ Console
export function Console({ onChanged }: Nav) {
  const [hist, setHist] = useState<{ cmd: string; out: string; err: string; code: number }[]>([]);
  const [line, setLine] = useState("");
  const [cursor, setCursor] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  useEffect(() => { api.graph("symbol").then(setGraph).catch(() => {}); api.repo().then(setRepo).catch(() => {}); }, []);
  useEffect(() => { if (hist.length) end.current?.scrollIntoView({ behavior: "smooth" }); }, [hist]);
  const run = (e: React.FormEvent) => { e.preventDefault(); exec(line); };
  const exec = async (input: string) => {
    const cmd = input.trim().replace(/^(git|kula)\s+/, "");
    if (!cmd) return;
    setLine(""); setCursor(-1);
    const args = cmd.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, "")) ?? [];
    try {
      const r = await api.exec(args);
      setHist((h) => [...h, { cmd, out: r.stdout, err: r.stderr, code: r.code }]);
    } catch (err: any) { setHist((h) => [...h, { cmd, out: "", err: err.message, code: 1 }]); }
    onChanged();
  };
  return (
    <div className="console">
      <div className="out">
        <section className="console-hero">
          <Dither data={graph} pixel={3} speed={0.6} className="ch-dither" />
          <div className="ch-text">
            <div className="ch-eyebrow">{repo ? `${repo.name} · ${repo.branch} @ ${repo.head?.slice(0, 7) ?? ""}` : "…"}</div>
            <h1 className="ch-title">Console</h1>
            <p>Every git command, in the browser. Whatever you type runs as <b>git &lt;args&gt;</b> in this repository; non-interactive commands only.</p>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {["status -sb", "log --oneline --graph -15", "branch -avv", "stash list", "remote -v", "shortlog -sn"].map((c) => (
                <button key={c} className="btn sm mono" onClick={() => exec(c)}>{c}</button>
              ))}
            </div>
          </div>
        </section>
        {hist.map((h, i) => (
          <div key={i} className="entry">
            <div className="cmd">git {h.cmd} {h.code !== 0 && <span style={{ color: "var(--red)" }}>· exit {h.code}</span>}</div>
            {h.out && <pre>{h.out}</pre>}
            {h.err && <pre className={h.code ? "err" : ""}>{h.err}</pre>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={run}>
        <span>❯ git</span>
        <input autoFocus value={line} onChange={(e) => setLine(e.target.value)} placeholder="status" aria-label="git command"
          onKeyDown={(e) => {
            const cmds = hist.map((h) => h.cmd);
            if (e.key === "ArrowUp" && cmds.length) { const c = cursor < 0 ? cmds.length - 1 : Math.max(0, cursor - 1); setCursor(c); setLine(cmds[c]); e.preventDefault(); }
            if (e.key === "ArrowDown" && cursor >= 0) { const c = cursor + 1; if (c >= cmds.length) { setCursor(-1); setLine(""); } else { setCursor(c); setLine(cmds[c]); } e.preventDefault(); }
          }} />
      </form>
    </div>
  );
}
