import { CodeProvider } from "./CodePanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, relTime, type Branch, type Meta, type Node, type RepoInfo } from "./api";
import { Icon, Kind, Logo, useToast } from "./ui";
import type { ContrastMode, Go, Target, View } from "./nav";
import { CONTEXT_SHORTCUTS, GLOBAL_SHORTCUTS, fuzzyScore } from "./nav";
import GraphView from "./views/GraphView";
import Overview from "./views/Overview";
import { Branches, Changes, Console, History } from "./views/GitViews";
import { Flows, Issues, Notes, Proposals } from "./views/MetaViews";
import Agents from "./views/Agents";
import Query from "./views/Query";
import SettingsPanel from "./SettingsPanel";
import { settings } from "./settings";
import Opening from "./Opening";

type Rail = { id: View; label: string; icon: () => React.ReactElement; key: string };
// Grouped by intent: understand · change · collaborate · agents and the graph as data · escape hatch.
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
  [
    { id: "agents", label: "Agents", icon: Icon.agents, key: "a" },
    { id: "query", label: "Query (SPARQL)", icon: Icon.query, key: "q" },
  ],
  [{ id: "console", label: "Console", icon: Icon.console, key: "0" }],
];
const VIEWS = GROUPS.flat();

type Contrast = { base: string; head: string; mode?: ContrastMode } | null;

/** URL ⇄ state: #overview · #graph/<id>/<tab> · #graph/contrast/<base>/<head> · #issues/<id> … */
function parseHash() {
  const [v, a, b, c, d] = location.hash.slice(1).split("/").map(decodeURIComponent);
  const view = (VIEWS.some((x) => x.id === v) ? v : "overview") as View;
  const contrast: Contrast = view === "graph" && a === "contrast" && b && c ? { base: b, head: c, mode: (["overlay", "split", "report"].includes(d) ? d : undefined) as ContrastMode | undefined } : null;
  const focus = view === "graph" && !contrast && Number(a) > 0 ? Number(a) : null;
  const target: Target = {};
  if (view === "issues" && Number(a)) target.issue = Number(a);
  if (view === "proposals" && Number(a)) target.proposal = Number(a);
  if (view === "history" && a) target.sha = a;
  if (view === "agents" && a) target.tab = a;
  if (view === "graph" && a === "fences") target.fences = b ?? "";
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
  // The server's last error: when set, the shell shows it with a retry instead of a blank page.
  const [serverError, setServerError] = useState<string | null>(null);
  // The opening plays once per session (or on demand with ?opening), never under reduced motion.
  const [opening, setOpening] = useState(() => {
    const forced = new URLSearchParams(location.search).has("opening");
    let seen = false;
    try { seen = sessionStorage.getItem("kula.opened") === "1"; sessionStorage.setItem("kula.opened", "1"); } catch { /* ignore */ }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    return forced || (settings.get().opening && !seen && !reduced);
  });
  const endOpening = useCallback(() => setOpening(false), []);
  const lastHead = useRef<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.repo().then((r) => {
      setServerError(null);
      setRepo(r);
      // The server reindexes when HEAD moves; refresh views once it lands.
      if (lastHead.current && r.indexed_head && r.indexed_head !== lastHead.current) setVersion((v) => v + 1);
      lastHead.current = r.indexed_head;
    }).catch((e) => setServerError(e.message || "Server unreachable"));
    api.meta().then(setMeta).catch(() => {});
    api.status().then((s) => setChanges(s.files.length)).catch(() => {});
  }, []);
  const onChanged = useCallback(() => { refresh(); setVersion((v) => v + 1); }, [refresh]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  // Keep the URL shareable, and make back/forward walk through where you have been:
  // each new place is a history entry; popping one restores it.
  const popping = useRef(false);
  useEffect(() => {
    const enc = encodeURIComponent;
    let h = view as string;
    if (view === "graph" && contrast) h += `/contrast/${enc(contrast.base)}/${enc(contrast.head)}${contrast.mode ? `/${contrast.mode}` : ""}`;
    else if (view === "graph" && focus != null) h += `/${focus}`;
    else if (view === "graph" && target.fences !== undefined) h += `/fences${target.fences ? `/${enc(target.fences)}` : ""}`;
    else if (view === "issues" && target.issue) h += `/${target.issue}`;
    else if (view === "proposals" && target.proposal) h += `/${target.proposal}`;
    else if (view === "agents" && target.tab && target.tab !== "overview") h += `/${target.tab}`;
    if (`#${h}` === location.hash) return;
    if (popping.current || !location.hash) history.replaceState(null, "", `#${h}`);
    else history.pushState(null, "", `#${h}`);
    popping.current = false;
  }, [view, focus, contrast, target]);
  useEffect(() => {
    const onPop = () => {
      const p = parseHash();
      popping.current = true;
      setView(p.view); setTarget(p.target); setContrast(p.contrast); setFocus(p.focus);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Phones: the sidebar is a drawer, summoned from the top bar.
  const [rail, setRail] = useState(false);
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
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) { e.preventDefault(); if (e.key === "ArrowLeft") history.back(); else history.forward(); return; }
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) go(v.id);
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
      if (e.key === "?") setHelp((h) => !h);
      if (e.key === ",") setPrefs((p) => !p);
      if (e.key === "Escape") { setHelp(false); setFocus(null); setRail(false); }
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
    <CodeProvider onLocate={(id) => go("graph", { symbol: id })}>
    <div className={`shell ${rail ? "rail-open" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go("overview")} aria-label="Overview"><Logo /><span>kula</span></button>
        <button className="rail-toggle" onClick={() => setRail((r) => !r)} aria-label={rail ? "Hide sidebar" : "Show sidebar"} aria-expanded={rail} aria-controls="rail"><Icon.sidebar /></button>
        <span className="crumb">/</span>
        <span className="crumb-repo">{repo?.name ?? "…"}</span>
        <span className="crumb">/</span>
        <span className="crumb-view">{contrast && view === "graph" ? "Contrast" : current.label}</span>
        <button className="chip" onClick={() => go("branches")} title="Current branch"><Icon.branches /><b className="mono">{repo?.branch ?? "…"}</b></button>
        <span className="spacer" />
        <div className="top-actions">
          <button className="btn sm ghost icon-only" aria-label="Back" title="Back  ⌥←" onClick={() => history.back()}><Icon.back /></button>
          <button className="btn sm ghost top-search" aria-label="Search" title="Search symbols, issues, branches, commands  ⌘K" onClick={() => setPalette(true)}><Icon.search /><kbd>⌘K</kbd></button>
          <button className="btn sm ghost icon-only" aria-label="Settings" title="Settings  ," onClick={() => setPrefs(true)}><Icon.gear /></button>
        </div>
      </header>

      <nav className="rail" id="rail" aria-label="Views">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="rail-group">
            {g.map((v) => (
              <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => { go(v.id); setRail(false); }} data-tip={`${v.label}  ${v.key}`} aria-label={v.label} aria-current={view === v.id ? "page" : undefined}>
                <v.icon />
                <span className="rail-label">{v.label}</span>
                {!!badge[v.id] && <span className="badge">{badge[v.id]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      {rail && <div className="rail-scrim" onClick={() => setRail(false)} aria-hidden="true" />}

      <main className="main">
        {/* Full panel only when nothing has loaded; once data is in, a failed poll
            is a slim banner so the view (and its state) survives the blip. */}
        {serverError && !repo ? (
          <div className="shell-error" data-testid="server-error" role="alert">
            <h2>Server unreachable</h2>
            <p className="mono">{serverError}</p>
            <p className="hint">kula's server answers every view – nothing can load until it is back.</p>
            <div className="shell-error-actions">
              <button className="btn primary" onClick={refresh}>Retry now</button>
              <span className="muted">or restart with <code>kula serve</code></span>
            </div>
          </div>
        ) : (
        <>
        {serverError && repo && (
          <div className="server-note" data-testid="server-note" role="alert">
            <span className="mono">{serverError}</span>
            <button className="btn sm" onClick={refresh}>Retry</button>
          </div>
        )}
        {/* Keyed so each view change plays a short enter transition. */}
        <div className="view-enter" key={view + (contrast ? ":c" : "")}>
          {view === "overview" && <Overview repo={repo} version={version} go={go} />}
          {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} openSettings={() => setPrefs(true)} contrast={contrast} setContrast={setContrast} go={go} fences={target.fences} />}
          {view === "changes" && <Changes {...nav} />}
          {view === "history" && <History {...nav} />}
          {view === "branches" && <Branches {...nav} />}
          {view === "proposals" && <Proposals {...nav} />}
          {view === "issues" && <Issues {...nav} />}
          {view === "notes" && <Notes {...nav} />}
          {view === "flows" && <Flows {...nav} />}
          {view === "agents" && <Agents {...nav} />}
          {view === "query" && <Query {...nav} />}
          {view === "console" && <Console {...nav} />}
        </div>
        </>
        )}
      </main>

      <footer className="statusbar">
        <span>kula {repo?.version}</span>
        {(indexing || repo?.index !== "current") && <span className="sb-warn">{indexing || repo?.index === "stale" ? "reindexing…" : "no graph – ⌘K, then Reindex"}</span>}
        {repo?.stats && <span className="sb-stats">{repo.stats.files} files · {repo.stats.symbols} symbols · {repo.stats.edges} edges · {repo.stats.communities} clusters</span>}
        <span className="spacer" />
        <span>{changes ? `${changes} changed` : "clean"}</span>
        <span className="mono">{repo?.head?.slice(0, 8)}</span>
        <span>{repo?.user}</span>
        <button className="sb-help" onClick={() => setHelp(true)}><kbd>?</kbd> shortcuts</button>
      </footer>

      {palette && <Palette meta={meta} onClose={() => setPalette(false)} go={(v, t) => { setPalette(false); go(v, t); }} onReindex={() => { setPalette(false); reindex(); }} onSettings={() => { setPalette(false); setPrefs(true); }} />}
      {help && <Help onClose={() => setHelp(false)} />}
      {prefs && <SettingsPanel onClose={() => setPrefs(false)} />}
      {opening && <Opening repo={repo} onDone={endOpening} />}
    </div>
    </CodeProvider>
  );
}

type Item = { key: string; text: string; group: string; el: React.ReactNode; run: () => void };

const RECENT_KEY = "kula.palette.recent";
function readRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
function pushRecent(key: string) {
  const next = [key, ...readRecents().filter((k) => k !== key)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window */ }
}

/** One box for everything: symbols, issues, proposals, branches, views and actions.
 *  Fuzzy matching, recently used commands first, every result shows its shortcut. */
function Palette({ meta, onClose, go, onReindex, onSettings }: { meta: Meta | null; onClose: () => void; go: Go; onReindex: () => void; onSettings: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Node[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [recents, setRecents] = useState<string[]>(readRecents);
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
  const score = (t: string) => fuzzyScore(s, t);
  const run = (it: Item) => { pushRecent(it.key); setRecents(readRecents()); it.run(); };
  const fresh = (it: Item): Item => ({ ...it, run: () => run(it) });

  const items: Item[] = [];
  if (!mode) hits.slice(0, 12).forEach((n) => items.push({ key: `n${n.id}`, text: `${n.name} ${n.path}`, group: "Symbols & files", run: () => go("graph", { symbol: n.id }), el: <><Kind kind={n.kind} community={n.community} size={18} /><span className="mono">{n.name}</span><span className="p">{n.path}:{n.start_line}</span></> }));
  if (!mode || mode === "#") {
    meta?.proposals.filter((p) => p.status === "open" && score(`${p.id} ${p.title} ${p.head}`) >= 0).slice(0, 6).forEach((p) =>
      items.push({ key: `p${p.id}`, text: `${p.id} ${p.title}`, group: "Proposals", run: () => go("proposals", { proposal: p.id }), el: <><span className="pal-ico" style={{ color: "var(--green)" }}><Icon.pr /></span><span>{p.title}</span><span className="p mono">#{p.id} · {p.head} → {p.base}</span></> }));
    meta?.issues.filter((x) => x.status === "open" && score(`${x.id} ${x.title} ${x.labels.join(" ")}`) >= 0).slice(0, 6).forEach((x) =>
      items.push({ key: `i${x.id}`, text: `${x.id} ${x.title}`, group: "Issues", run: () => go("issues", { issue: x.id }), el: <><span className="pal-ico" style={{ color: "var(--green)" }}><Icon.issues /></span><span>{x.title}</span><span className="p">#{x.id} · {relTime(x.created)}</span></> }));
  }
  if (!mode || mode === "@") branches.filter((b) => score(b.name) >= 0).slice(0, mode ? 20 : 4).forEach((b) =>
    items.push({ key: `b${b.name}`, text: b.name, group: "Branches", run: () => go("graph", { contrast: { base: "HEAD", head: b.name } }), el: <><span className="pal-ico"><Icon.branches /></span><span className="mono">{b.name}</span><span className="p">contrast graph with HEAD</span></> }));
  if (!mode || mode === ">") {
    [
      ...VIEWS.map((v) => ({ key: `go:${v.id}`, label: `Go to ${v.label}`, hint: v.key, run: () => go(v.id) })),
      { key: "contrast:worktree", label: "Contrast graph: HEAD → working tree", hint: "", run: () => go("graph", { contrast: { base: "HEAD", head: "WORKTREE" } }) },
      { key: "reindex", label: "Reindex knowledge graph", hint: "", run: onReindex },
      { key: "fences", label: "Graph: show fences", hint: "f", run: () => go("graph", { fences: "" }) },
      ...(["explore", "fix", "refactor", "tests", "docs", "autoresearch"]).map((w) => ({ key: `fences:${w}`, label: `Graph: preview the ${w} workflow's fences`, hint: "", run: () => go("graph", { fences: w }) })),
      ...(["workflows", "fences", "memory", "docs", "connect"]).map((t) => ({ key: `agents:${t}`, label: `Agents: ${t}`, hint: "", run: () => go("agents", { tab: t }) })),
      { key: "settings", label: "Open settings", hint: ",", run: onSettings },
      { key: "help", label: "Keyboard shortcuts", hint: "?", run: () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" })); } },
      ...(["directory", "cluster", "kind", "churn"] as const).map((c) => ({ key: `color:${c}`, label: `Colour graph by ${c}`, hint: "", run: () => { settings.set({ colorBy: c }); go("graph"); } })),
      ...(["dark", "light", "system"] as const).map((t) => ({ key: `theme:${t}`, label: `Theme: ${t}`, hint: "", run: () => { settings.set({ theme: t }); onClose(); } })),
    ].filter((c) => score(c.label) >= 0).forEach((c) => items.push({ key: c.key, text: c.label, group: "Commands", run: c.run, el: <><span className="pal-ico" style={{ color: "var(--accent)" }}><Icon.arrow /></span><span>{c.label}</span><span className="p">{c.hint && <kbd>{c.hint}</kbd>}</span></> }));
  }

  // Filter by fuzz, then order: recently used first, then best fuzzy match.
  const scored = items.map((it) => ({ it, sc: s ? score(it.text) : 0 })).filter((x) => x.sc >= 0)
    .sort((a, b) => {
      const ra = recents.indexOf(a.it.key), rb = recents.indexOf(b.it.key);
      if (ra >= 0 || rb >= 0) return (ra < 0 ? Infinity : ra) - (rb < 0 ? Infinity : rb);
      return b.sc - a.sc;
    }).map((x) => fresh(x.it));
  const seenGroups = new Set<string>();
  // The highlight clamps to the list on every render, so Enter always has a
  // target even after typing has narrowed the results.
  const k = Math.min(i, scored.length - 1);

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbols, #issues, @branches, >commands…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(scored.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") scored[k]?.run();
          }} />
        <div className="results" ref={list}>
          {scored.map((it, j) => (
            <div key={it.key}>
              {!seenGroups.has(it.group) && <div className="grp">{it.group}</div>}
              {seenGroups.add(it.group)}
              <div className={`res ${k === j ? "on" : ""}`} onMouseEnter={() => setI(j)} onClick={it.run}>{it.el}</div>
            </div>
          ))}
          {!scored.length && <div className="empty">No matches</div>}
        </div>
        <footer><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>#</kbd> issues</span><span><kbd>@</kbd> branches</span><span><kbd>&gt;</kbd> commands</span><span className="spacer" /><span><kbd>esc</kbd></span></footer>
      </div>
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  // One registry, one sheet: the list cannot drift from what the shell does.
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette help" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="help-head"><Logo /><h2>Keyboard shortcuts</h2><span className="spacer" /><button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button></div>
        <div className="help-grid" data-testid="help-grid">
          {GLOBAL_SHORTCUTS.map((k) => (<div key={k.keys} className="help-row" data-keys={k.keys}><kbd>{k.keys}</kbd><span>{k.label}</span></div>))}
          <div className="help-sep">Views</div>
          {VIEWS.map((v) => (<div key={v.id} className="help-row" data-keys={v.key}><kbd>{v.key}</kbd><span>{v.label}</span></div>))}
          <div className="help-sep">In context</div>
          {CONTEXT_SHORTCUTS.map((k) => (<div key={k.keys} className="help-row" data-keys={k.keys}><kbd>{k.keys}</kbd><span>{k.label}</span></div>))}
        </div>
      </div>
    </div>
  );
}
