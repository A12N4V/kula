import { useEffect, useMemo, useRef, useState } from "react";
import { api, relTime, type Branch, type Commit, type Compare, type FileStatus, type GraphData, type RepoInfo } from "../api";
import Dither from "../Dither";
import Life from "../Life";
import type { Go, Target } from "../nav";
import { Diff, Empty, Icon, ShowOutput, Sym, useToast } from "../ui";
import { Grip, listWidth } from "../resize";
import { VerifyPanel } from "../AgentChecks";

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

  // Keyboard: j/k walks the files, s stages, u unstages, ⌘/ctrl+↵ commits.
  // One flat walk order: staged files first, then the rest – the same order as the list.
  const ordered = useMemo(() => [...staged.map((f) => ({ f, s: true })), ...unstaged.map((f) => ({ f, s: false }))], [files]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const editable = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { if (msg.trim() && (staged.length || amend)) { e.preventDefault(); commit(); } return; }
      if (editable || e.metaKey || e.ctrlKey || e.altKey) return;
      const at = ordered.findIndex((x) => x.f.path === sel?.path && x.s === sel?.staged);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const d = e.key === "j" ? 1 : -1;
        const n = ordered[at === -1 ? 0 : (at + d + ordered.length) % ordered.length];
        if (n) setSel({ path: n.f.path, staged: n.s });
        return;
      }
      if (e.key === "s" && sel) { e.preventDefault(); act("stage", [sel.path]); return; }
      if (e.key === "u" && sel) { e.preventDefault(); act("unstage", [sel.path]); return; }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [ordered, sel, msg, amend, staged.length, files]);

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
    <div className="split" style={listWidth("changes", 340)}>
      <div className="list" style={{ display: "flex", flexDirection: "column" }}>
        <div className="list-head"><h2>Changes</h2><span className="muted">{files.length}</span><span className="spacer" /><button className="btn sm ghost" aria-label="Refresh changes" title="Refresh" onClick={refresh}><Icon.refresh /></button></div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {files.length === 0 ? <Empty title="Working tree clean">Nothing to commit.</Empty> : (<>{group("Staged", staged, true)}{group("Changes", unstaged, false)}</>)}
        </div>
        {files.length > 0 && <VerifyPanel version={files.map((f) => f.path + f.index + f.worktree).join("|") + version} />}
        <div style={{ padding: 12, borderTop: "1px solid var(--line)" }} className="stack">
          <textarea className="textarea" placeholder="Commit message  (⌘↵ to commit)" value={msg} onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg.trim()) commit(); }} style={{ minHeight: 70 }} />
          <div className="row">
            <label className="row muted" style={{ gap: 6, cursor: "pointer" }}><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /> Amend</label>
            <span className="muted hide-sm row" style={{ gap: 4 }}>j/k walk · s stage · u unstage</span>
            <span className="spacer" />
            <button className="btn primary" disabled={!msg.trim() || (!staged.length && !amend)} onClick={commit}>Commit {staged.length ? `${staged.length} file${staged.length > 1 ? "s" : ""}` : ""}</button>
          </div>
        </div>
      </div>
      <Grip id="changes" edge="right" target="prev" min={220} max={900} label="Resize list" />
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
  // j/k walks the visible list; Enter is already selection by itself, so no extra binding.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const at = visible.findIndex(({ c }) => c.sha === sel);
      const d = e.key === "j" ? 1 : -1;
      const n = visible[at === -1 ? 0 : (at + d + visible.length) % visible.length];
      if (n) setSel(n.c.sha);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [visible, sel]);

  return (
    <div className="split" style={listWidth("history", 420)}>
      <div className="list">
        <div className="list-head"><h2>History</h2><span className="muted">{commits.length}</span><span className="spacer" /><input className="input" style={{ width: 160 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {commits.length === 0 && <Empty title="No commits yet" />}
        {visible.map(({ c, i }) => {
          const L = lanes[i];
          const x = (l: number) => 10 + l * 12;
          return (
            <div key={c.sha} className={`item ${sel === c.sha ? "on" : ""}`} style={{ padding: "0 14px 0 6px", height: ROW, alignItems: "center" }} onClick={() => setSel(c.sha)}>
              {!filter && (
                <svg className="lane-svg" data-figure width={width} height={ROW}>
                  {L.before.map((s, l) => s && <line key={"b" + l} x1={x(l)} y1={0} x2={x(l === L.lane || s === c.sha ? L.lane : l)} y2={ROW / 2} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                  {L.after.map((s, l) => s && <line key={"a" + l} x1={x(l === L.lane || (L.extra.includes(l) && L.before[l] !== s) ? L.lane : l)} y1={ROW / 2} x2={x(l)} y2={ROW} stroke={LANE_COLORS[l % 7]} strokeWidth="1.6" />)}
                  <circle cx={x(L.lane)} cy={ROW / 2} r={c.parents.length > 1 ? 4.5 : 4} fill={c.parents.length > 1 ? "var(--bg-2)" : LANE_COLORS[L.lane % 7]} stroke={LANE_COLORS[L.lane % 7]} strokeWidth="2" />
                </svg>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="title">{c.subject}</div>
                <div className="sub row" style={{ gap: 6, flexWrap: "nowrap", whiteSpace: "nowrap", overflow: "hidden", minWidth: 0 }}>
                  <span className="mono">{c.short}</span>·<span>{c.author}</span>·<span>{relTime(c.time)}</span>
                  <span className="refs" style={{ display: "flex", flexWrap: "nowrap", gap: 4, minWidth: 0, overflow: "hidden" }}>{c.refs.slice(0, 3).map((r) => <span key={r} className={`tag ${r.startsWith("HEAD") ? "accent" : r.startsWith("tag:") ? "yellow" : ""}`} style={{ height: 17, fontSize: 10.5, flexShrink: 0, whiteSpace: "nowrap" }}>{r.replace("HEAD -> ", "")}</span>)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Grip id="history" edge="right" target="prev" min={220} max={900} label="Resize list" />
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
  // j/k walks local branches, then remote ones. Enter is left to the focused
  // element – a key that reaches a focused button must not be swallowed here.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const rows = [...local, ...remote];
      const at = rows.findIndex((b) => b.name === head);
      const n = rows[at === -1 ? 0 : (at + (e.key === "k" ? -1 : 1) + rows.length) % rows.length];
      if (n) setHead(n.name);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [data, head]);

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
    <div className="split" style={listWidth("branches", 360)}>
      <div className="list">
        <div className="list-head">
          <h2>Branches</h2><span className="spacer" />
          <button className="btn sm" onClick={() => run("fetch", {}, "Fetched all remotes")}>Fetch</button>
          <button className="btn sm" onClick={() => run("pull", {}, "Pulled")}>Pull</button>
          <button className="btn sm" onClick={() => run("push", {}, "Pushed")}>Push</button>
          <button className="btn sm primary" aria-label="New branch from HEAD" title="New branch from HEAD" onClick={() => { const n = prompt("New branch from HEAD"); if (n) run("branch", { name: n }, `Created ${n}`); }}><Icon.plus /></button>
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
      <Grip id="branches" edge="right" target="prev" min={220} max={900} label="Resize list" />
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
      <div className="cmp-grid">
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
// A terminal, as in an IDE: tabs you can add and close, a prompt that reads
// `kula`, and everything run by the kula binary itself – its own commands, and
// any git command passed straight through.
type Entry = { cmd: string; out: string; err: string; code: number };
type Term = { id: number; hist: Entry[]; busy?: boolean };
const COMMANDS = ["init", "index", "deps", "pack", "before", "verify", "check", "hooks", "status", "lg", "query", "context", "impact", "trace", "flows",
  "clusters", "compare", "graph-diff", "issue", "pr", "note", "sync", "doctor", "git", "help",
  "add", "commit", "log", "diff", "show", "branch", "switch", "checkout", "merge", "rebase", "stash", "tag", "fetch", "pull", "push", "remote", "reset", "restore", "blame", "shortlog"];
// Terminals outlive a visit to another view.
let saved: { terms: Term[]; on: number; seq: number } = { terms: [{ id: 1, hist: [] }], on: 1, seq: 1 };

export function Console({ onChanged }: Nav) {
  const [terms, setTerms] = useState<Term[]>(saved.terms);
  const [on, setOn] = useState(saved.on);
  const [line, setLine] = useState("");
  const [cursor, setCursor] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  useEffect(() => { api.graph("symbol").then(setGraph).catch(() => {}); api.repo().then(setRepo).catch(() => {}); }, []);
  useEffect(() => { saved = { ...saved, terms, on }; }, [terms, on]);
  const term = terms.find((t) => t.id === on) ?? terms[0];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [term?.hist.length, on]);

  const patch = (id: number, f: (t: Term) => Term) => setTerms((ts) => ts.map((t) => (t.id === id ? f(t) : t)));
  const add = () => { const id = ++saved.seq; setTerms((ts) => [...ts, { id, hist: [] }]); setOn(id); setLine(""); input.current?.focus(); };
  const close = (id: number) => {
    const rest = terms.filter((t) => t.id !== id);
    if (!rest.length) { const nid = ++saved.seq; setTerms([{ id: nid, hist: [] }]); setOn(nid); return; }
    setTerms(rest);
    if (id === on) setOn(rest[Math.max(0, terms.findIndex((t) => t.id === id) - 1)].id);
  };
  const exec = async (typed: string) => {
    const cmd = typed.trim().replace(/^kula(\s+|$)/, "");
    setLine(""); setCursor(-1);
    const id = term.id;
    if (!cmd) { patch(id, (t) => ({ ...t, hist: [...t.hist, { cmd: "", out: "", err: "", code: 0 }] })); return; }
    if (cmd === "clear" || cmd === "cls") { patch(id, (t) => ({ ...t, hist: [] })); return; }
    const args = cmd === "help" ? ["--help"] : cmd.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, "")) ?? [];
    patch(id, (t) => ({ ...t, busy: true }));
    let e: Entry;
    try { const r = await api.kula(args); e = { cmd, out: r.stdout, err: r.stderr, code: r.code }; }
    catch (err: any) { e = { cmd, out: "", err: err.message, code: 1 }; }
    patch(id, (t) => ({ ...t, busy: false, hist: [...t.hist, e] }));
    onChanged();
  };
  const complete = () => {
    const m = line.match(/^(\s*(?:kula\s+)?)(\S*)$/);
    if (!m) return;
    const hits = COMMANDS.filter((c) => c.startsWith(m[2]));
    if (hits.length === 1) setLine(`${m[1]}${hits[0]} `);
    else if (hits.length > 1) {
      let p = m[2];
      while (hits.every((h) => h.startsWith(hits[0].slice(0, p.length + 1))) && p.length < hits[0].length) p = hits[0].slice(0, p.length + 1);
      if (p !== m[2]) setLine(m[1] + p);
      else patch(term.id, (t) => ({ ...t, hist: [...t.hist, { cmd: line.trim().replace(/^kula\s*/, ""), out: hits.join("  "), err: "", code: 0 }] }));
    }
  };
  const ps = <span className="ps">{repo?.name ?? "repo"} <span className="ps-br">{repo?.branch ?? ""}</span></span>;

  return (
    <div className="console">
      <div className="term-bar" role="tablist" aria-label="Terminals">
        {terms.map((t, i) => (
          <div key={t.id} className={`term-tab ${t.id === on ? "on" : ""}`} role="tab" aria-selected={t.id === on} onClick={() => { setOn(t.id); input.current?.focus(); }}>
            <Icon.console /><span>kula {i + 1}</span>{t.busy && <span className="dot warn" />}
            <button className="term-x" aria-label={`Close terminal ${i + 1}`} title="Kill terminal" onClick={(e) => { e.stopPropagation(); close(t.id); }}><Icon.close /></button>
          </div>
        ))}
        <button className="term-btn" onClick={add} aria-label="New terminal" title="New terminal"><Icon.plus /></button>
        <span className="spacer" />
        <button className="term-btn" onClick={() => patch(term.id, (t) => ({ ...t, hist: [] }))} title="Clear (ctrl+L)">clear</button>
      </div>
      <div className="out" onClick={() => { if (!window.getSelection()?.toString()) input.current?.focus(); }}>
        <section className="console-hero">
          <Dither data={graph} pixel={3} speed={0.6} className="ch-dither" />
          <div className="ch-text">
            <div className="ch-eyebrow">{repo ? `${repo.name} · ${repo.branch} @ ${repo.head?.slice(0, 7) ?? ""}` : "…"}</div>
            <h1 className="ch-title">Console</h1>
            <button className="btn sm mono" onClick={() => exec("help")}>kula help</button>
          </div>
          <Life className="ch-life" />
        </section>
        {term.hist.map((h, i) => (
          <div key={i} className="entry">
            <div className="cmd">{ps} <span className="ps-sym">$</span> {h.cmd && <>kula {h.cmd}</>} {h.code !== 0 && <span className="exit">exit {h.code}</span>}</div>
            {h.out && <pre>{h.out}</pre>}
            {h.err && <pre className={h.code ? "err" : ""}>{h.err}</pre>}
          </div>
        ))}
        <form className="prompt" onSubmit={(e) => { e.preventDefault(); if (!term.busy) exec(line); }}>
          {ps} <span className="ps-sym">$</span> <span className="ps-kula">kula</span>
          <input ref={input} autoFocus value={line} onChange={(e) => setLine(e.target.value)} aria-label="kula command" spellCheck={false} autoCapitalize="off" autoComplete="off"
            placeholder={term.hist.length ? "" : "help"} readOnly={term.busy}
            onKeyDown={(e) => {
              const cmds = term.hist.map((h) => h.cmd).filter(Boolean);
              if (e.key === "Enter") { e.preventDefault(); if (!term.busy) exec(line); }
              if (e.key === "Tab") { e.preventDefault(); complete(); }
              if (e.ctrlKey && e.key === "l") { e.preventDefault(); patch(term.id, (t) => ({ ...t, hist: [] })); }
              if (e.ctrlKey && e.key === "c" && !window.getSelection()?.toString()) { e.preventDefault(); patch(term.id, (t) => ({ ...t, hist: [...t.hist, { cmd: `${line}^C`, out: "", err: "", code: 0 }] })); setLine(""); }
              if (e.key === "ArrowUp" && cmds.length) { const c = cursor < 0 ? cmds.length - 1 : Math.max(0, cursor - 1); setCursor(c); setLine(cmds[c]); e.preventDefault(); }
              if (e.key === "ArrowDown" && cursor >= 0) { const c = cursor + 1; if (c >= cmds.length) { setCursor(-1); setLine(""); } else { setCursor(c); setLine(cmds[c]); } e.preventDefault(); }
            }} />
        </form>
        <div ref={end} />
      </div>
    </div>
  );
}
