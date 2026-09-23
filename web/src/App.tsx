import { useCallback, useEffect, useRef, useState } from "react";
import { api, relTime, type Branch, type Meta, type Node, type RepoInfo } from "./api";
import { Icon, Kind, Logo, useToast } from "./ui";
import type { Go, Target, View } from "./nav";
import GraphView from "./views/GraphView";
import Overview from "./views/Overview";
import { Branches, Changes, Console, History } from "./views/GitViews";
import { Flows, Issues, Notes, Proposals } from "./views/MetaViews";
import SettingsPanel from "./SettingsPanel";
import { settings } from "./settings";

type Rail = { id: View; label: string; icon: () => React.ReactElement; key: string };
// Grouped by intent: understand · change · collaborate · escape hatch.
const GROUPS: Rail[][] = [
  [
    { id: "overview", label: "Overview", icon: Icon.home, key: "1" },
    { id: "graph", label: "Graph", icon: Icon.graph, key: "2" },
    { id: "flows", label: "Flows", icon: Icon.flows, key: "3" },
  ],
  [
    { id: "changes", label: "Changes", icon: Icon.changes, key: "4" },
    { id: "history", label: "History", icon: Icon.history, key: "5" },
    { id: "branches", label: "Branches & compare", icon: Icon.branches, key: "6" },
  ],
  [
    { id: "proposals", label: "Proposals", icon: Icon.pr, key: "7" },
    { id: "issues", label: "Issues", icon: Icon.issues, key: "8" },
    { id: "notes", label: "Notes", icon: Icon.notes, key: "9" },
  ],
  [{ id: "console", label: "Git console", icon: Icon.console, key: "0" }],
];
const VIEWS = GROUPS.flat();

type Contrast = { base: string; head: string } | null;

/** URL ⇄ state: #overview · #graph/<id>/<tab> · #graph/contrast/<base>/<head> · #issues/<id> … */
function parseHash() {
  const [v, a, b, c] = location.hash.slice(1).split("/").map(decodeURIComponent);
  const view = (VIEWS.some((x) => x.id === v) ? v : "overview") as View;
  const contrast: Contrast = view === "graph" && a === "contrast" && b && c ? { base: b, head: c } : null;
  const focus = view === "graph" && !contrast && Number(a) > 0 ? Number(a) : null;
  const target: Target = {};
  if (view === "issues" && Number(a)) target.issue = Number(a);
  if (view === "proposals" && Number(a)) target.proposal = Number(a);
  if (view === "history" && a) target.sha = a;
  return { view, contrast, focus, target };
}

export default function App() {
  const initial = useRef(parseHash()).current;
  const [view, setView] = useState<View>(initial.view);
  const [target, setTarget] = useState<Target>(initial.target);
  const [contrast, setContrast] = useState<Contrast>(initial.contrast);
  const [focus, setFocus] = useState<number | null>(initial.focus);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [changes, setChanges] = useState(0);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [version, setVersion] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const lastHead = useRef<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.repo().then((r) => {
      setRepo(r);
      // The server reindexes when HEAD moves; refresh views once it lands.
      if (lastHead.current && r.indexed_head && r.indexed_head !== lastHead.current) setVersion((v) => v + 1);
      lastHead.current = r.indexed_head;
    }).catch((e) => toast(e.message, "err"));
    api.meta().then(setMeta).catch(() => {});
    api.status().then((s) => setChanges(s.files.length)).catch(() => {});
  }, [toast]);
  const onChanged = useCallback(() => { refresh(); setVersion((v) => v + 1); }, [refresh]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  // Keep the URL shareable.
  useEffect(() => {
    const enc = encodeURIComponent;
    let h = view as string;
    if (view === "graph" && contrast) h += `/contrast/${enc(contrast.base)}/${enc(contrast.head)}`;
    else if (view === "graph" && focus != null) h += `/${focus}`;
    else if (view === "issues" && target.issue) h += `/${target.issue}`;
    else if (view === "proposals" && target.proposal) h += `/${target.proposal}`;
    history.replaceState(null, "", `#${h}`);
  }, [view, focus, contrast, target]);

  const go: Go = useCallback((v, t = {}) => {
    setView(v);
    setTarget(t);
    if (v === "graph") {
      setContrast(t.contrast ?? null);
      if (t.symbol) setFocus(t.symbol);
      if (t.search) api.search(t.search).then((h) => { const hit = h.find((n) => n.path === t.search) ?? h[0]; if (hit) setFocus(hit.id); });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) go(v.id);
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
      if (e.key === "?") setHelp((h) => !h);
      if (e.key === ",") setPrefs((p) => !p);
      if (e.key === "Escape") { setHelp(false); setFocus(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const reindex = async () => {
    setIndexing(true);
    try { const s: any = await api.reindex(); toast(`Indexed ${s.symbols} symbols in ${s.millis}ms`); onChanged(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setIndexing(false); }
  };

  const openIssues = meta?.issues.filter((i) => i.status === "open").length ?? 0;
  const openPrs = meta?.proposals.filter((p) => p.status === "open").length ?? 0;
  const badge: Partial<Record<View, number>> = { changes, issues: openIssues, proposals: openPrs };
  const nav = { onChanged, openSymbol: (id: number) => go("graph", { symbol: id }), version, go, target };
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => go("overview")} aria-label="Overview"><Logo /><span>kula</span></button>
        <span className="crumb">/</span>
        <span className="crumb-repo">{repo?.name ?? "…"}</span>
        <span className="crumb">/</span>
        <span className="crumb-view">{contrast && view === "graph" ? "Contrast" : current.label}</span>
        <button className="chip" onClick={() => go("branches")} title="Current branch"><Icon.branches /><b className="mono">{repo?.branch ?? "…"}</b></button>
        <span className="spacer" />
        <div className="search-trigger" onClick={() => setPalette(true)} role="button" aria-label="Search"><Icon.search /> <span className="st-label">Search symbols, issues, branches, commands…</span> <kbd>⌘K</kbd></div>
        <span className="spacer" />
        <span className="chip hide-sm" title={repo?.index === "current" ? "Graph matches HEAD" : "HEAD moved; the graph is being rebuilt"}>
          <span className={`dot ${repo?.index === "current" ? "ok" : repo?.index === "stale" ? "warn pulse" : "bad"}`} />
          {repo?.index === "current" ? "graph current" : repo?.index === "stale" ? "reindexing…" : "no graph"}
        </span>
        <button className="btn sm" onClick={reindex} disabled={indexing}><Icon.refresh /> {indexing ? "Indexing…" : "Reindex"}</button>
        <button className="btn sm ghost" aria-label="Keyboard shortcuts" title="Shortcuts  ?" onClick={() => setHelp(true)}>?</button>
        <button className="btn sm ghost" aria-label="Settings" title="Settings  ," onClick={() => setPrefs(true)}><Icon.sliders /></button>
      </header>

      <nav className="rail" aria-label="Views">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="rail-group">
            {g.map((v) => (
              <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => go(v.id)} data-tip={`${v.label}  ${v.key}`} aria-label={v.label} aria-current={view === v.id ? "page" : undefined}>
                <v.icon />
                {!!badge[v.id] && <span className="badge">{badge[v.id]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <main className="main">
        {/* Keyed so each view change plays a short enter transition. */}
        <div className="view-enter" key={view + (contrast ? ":c" : "")}>
          {view === "overview" && <Overview repo={repo} version={version} go={go} />}
          {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} openSettings={() => setPrefs(true)} contrast={contrast} setContrast={setContrast} go={go} />}
          {view === "changes" && <Changes {...nav} />}
          {view === "history" && <History {...nav} />}
          {view === "branches" && <Branches {...nav} />}
          {view === "proposals" && <Proposals {...nav} />}
          {view === "issues" && <Issues {...nav} />}
          {view === "notes" && <Notes {...nav} />}
          {view === "flows" && <Flows {...nav} />}
          {view === "console" && <Console {...nav} />}
        </div>
      </main>

      <footer className="statusbar">
        <span><Logo /> kula {repo?.version}</span>
        {repo?.stats && <span>{repo.stats.files} files · {repo.stats.symbols} symbols · {repo.stats.edges} edges · {repo.stats.communities} clusters</span>}
        <span className="spacer" />
        <span>{changes ? `${changes} changed` : "clean"}</span>
        <span className="mono">{repo?.head?.slice(0, 8)}</span>
        <span>{repo?.user}</span>
        <button className="sb-help" onClick={() => setHelp(true)}><kbd>?</kbd> shortcuts</button>
      </footer>

      {palette && <Palette meta={meta} onClose={() => setPalette(false)} go={(v, t) => { setPalette(false); go(v, t); }} onReindex={() => { setPalette(false); reindex(); }} onSettings={() => { setPalette(false); setPrefs(true); }} />}
      {help && <Help onClose={() => setHelp(false)} />}
      {prefs && <SettingsPanel onClose={() => setPrefs(false)} />}
    </div>
  );
}

type Item = { key: string; group: string; el: React.ReactNode; run: () => void };

/** One box for everything: symbols, issues, proposals, branches, views and actions. */
function Palette({ meta, onClose, go, onReindex, onSettings }: { meta: Meta | null; onClose: () => void; go: Go; onReindex: () => void; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Node[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => { api.branches().then((b) => setBranches(b.branches.filter((x) => !x.remote))).catch(() => {}); }, []);
  useEffect(() => {
    setI(0);
    const s = q.replace(/^[#@>]/, "").trim();
    if (!s || q.startsWith(">") || q.startsWith("#") || q.startsWith("@")) { setHits([]); return; }
    const t = setTimeout(() => api.search(s).then(setHits).catch(() => setHits([])), 80);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { list.current?.querySelector(".res.on")?.scrollIntoView({ block: "nearest" }); }, [i]);

  // Prefixes narrow the search: # issues/proposals, @ branches, > commands.
  const mode = q[0] === "#" ? "#" : q[0] === "@" ? "@" : q[0] === ">" ? ">" : "";
  const s = (mode ? q.slice(1) : q).trim().toLowerCase();
  const match = (t: string) => !s || t.toLowerCase().includes(s);

  const items: Item[] = [];
  if (!mode) hits.slice(0, 12).forEach((n) => items.push({ key: `n${n.id}`, group: "Symbols & files", run: () => go("graph", { symbol: n.id }), el: <><Kind kind={n.kind} community={n.community} size={18} /><span className="mono">{n.name}</span><span className="p">{n.path}:{n.start_line}</span></> }));
  if (!mode || mode === "#") {
    meta?.proposals.filter((p) => p.status === "open" && match(`${p.id} ${p.title} ${p.head}`)).slice(0, 6).forEach((p) =>
      items.push({ key: `p${p.id}`, group: "Proposals", run: () => go("proposals", { proposal: p.id }), el: <><span className="pal-ico" style={{ color: "var(--green)" }}><Icon.pr /></span><span>{p.title}</span><span className="p mono">#{p.id} · {p.head} → {p.base}</span></> }));
    meta?.issues.filter((x) => x.status === "open" && match(`${x.id} ${x.title} ${x.labels.join(" ")}`)).slice(0, 6).forEach((x) =>
      items.push({ key: `i${x.id}`, group: "Issues", run: () => go("issues", { issue: x.id }), el: <><span className="pal-ico" style={{ color: "var(--green)" }}><Icon.issues /></span><span>{x.title}</span><span className="p">#{x.id} · {relTime(x.created)}</span></> }));
  }
  if (!mode || mode === "@") branches.filter((b) => match(b.name)).slice(0, mode ? 20 : 4).forEach((b) =>
    items.push({ key: `b${b.name}`, group: "Branches", run: () => go("graph", { contrast: { base: "HEAD", head: b.name } }), el: <><span className="pal-ico"><Icon.branches /></span><span className="mono">{b.name}</span><span className="p">contrast graph with HEAD</span></> }));
  if (!mode || mode === ">") {
    [
      ...VIEWS.map((v) => ({ label: `Go to ${v.label}`, hint: v.key, run: () => go(v.id) })),
      { label: "Contrast graph: HEAD → working tree", hint: "", run: () => go("graph", { contrast: { base: "HEAD", head: "WORKTREE" } }) },
      { label: "Reindex knowledge graph", hint: "", run: onReindex },
      { label: "Open settings", hint: ",", run: onSettings },
      ...(["directory", "cluster", "kind", "churn"] as const).map((c) => ({ label: `Colour graph by ${c}`, hint: "", run: () => { settings.set({ colorBy: c }); go("graph"); } })),
      ...(["dark", "light", "system"] as const).map((t) => ({ label: `Theme: ${t}`, hint: "", run: () => { settings.set({ theme: t }); onClose(); } })),
    ].filter((c) => match(c.label)).forEach((c) => items.push({ key: c.label, group: "Commands", run: c.run, el: <><span className="pal-ico" style={{ color: "var(--accent)" }}>›</span><span>{c.label}</span><span className="p">{c.hint && <kbd>{c.hint}</kbd>}</span></> }));
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbols, #issues, @branches, >commands…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") items[i]?.run();
          }} />
        <div className="results" ref={list}>
          {items.map((it, k) => (
            <div key={it.key}>
              {(k === 0 || items[k - 1].group !== it.group) && <div className="grp">{it.group}</div>}
              <div className={`res ${k === i ? "on" : ""}`} onMouseEnter={() => setI(k)} onClick={it.run}>{it.el}</div>
            </div>
          ))}
          {!items.length && <div className="empty">No matches</div>}
        </div>
        <footer><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>#</kbd> issues</span><span><kbd>@</kbd> branches</span><span><kbd>&gt;</kbd> commands</span><span className="spacer" /><span><kbd>esc</kbd></span></footer>
      </div>
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K  /", "Search everything"],
    ["1 – 9, 0", "Switch view"],
    ["?", "This sheet"],
    [",", "Settings: theme, colours, graph encodings"],
    ["[  ]", "Back / forward through inspected symbols"],
    ["esc", "Close panel or dialog"],
    ["⌘↵", "Commit (Changes) · save (Notes)"],
    ["↑ ↓", "Command history (Console)"],
  ];
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette help" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="help-head"><Logo /><h2>Keyboard shortcuts</h2><span className="spacer" /><button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button></div>
        <div className="help-grid">
          {rows.map(([k, d]) => (<div key={k} className="help-row"><kbd>{k}</kbd><span>{d}</span></div>))}
          <div className="help-sep">Views</div>
          {VIEWS.map((v) => (<div key={v.id} className="help-row"><kbd>{v.key}</kbd><span>{v.label}</span></div>))}
        </div>
      </div>
    </div>
  );
}
