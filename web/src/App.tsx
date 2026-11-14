import { CodeProvider } from "./CodePanel";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, relTime, type Branch, type Meta, type Node, type RepoInfo } from "./api";
import { Icon, Kind, Logo, useToast } from "./ui";
import type { ContrastMode, Go, Target, View } from "./nav";
import { CONTEXT_SHORTCUTS, GLOBAL_SHORTCUTS, canonView, fuzzyScore } from "./nav";
// Heavy views load on demand: the first paint ships the shell + Overview only,
// the rest arrive as their own chunks (prefetched on idle – see PREFETCH below).
const GraphView = lazy(() => import("./views/GraphView"));
const Agents = lazy(() => import("./views/Agents"));
const Query = lazy(() => import("./views/Query"));
const GitBoard = lazy(() => import("./views/GitBoard"));
const Console = lazy(() => import("./views/GitViews").then((m) => ({ default: m.Console })));
const Flows = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Flows })));
const Issues = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Issues })));
const Notes = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Notes })));
const Proposals = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Proposals })));
import Overview from "./views/Overview";
import SettingsPanel from "./SettingsPanel";

// Warm the lazy chunks once the shell is up, so the first click on a rail item
// does not wait on the network (local disk, but still a visible flash).
const PREFETCH: Array<() => Promise<unknown>> = [
  () => import("./views/GraphView"),
  () => import("./views/Agents"),
  () => import("./views/Query"),
  () => import("./views/GitViews"),
  () => import("./views/GitBoard"),
  () => import("./views/MetaViews"),
];
let prefetched = false;
function prefetchViews() {
  if (prefetched) return;
  prefetched = true;
  const idle = (window as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => PREFETCH.forEach((f) => void f().catch(() => {})));
  else setTimeout(() => PREFETCH.forEach((f) => void f().catch(() => {})), 1500);
}
import { settings } from "./settings";
import Opening from "./Opening";
import ProjectTree from "./studio/ProjectTree";
import Structure from "./studio/Structure";
import FileEditor from "./studio/FileEditor";
import EditorTabs, { tabKey, type Tab } from "./studio/EditorTabs";

// Tool window widths survive a reload; storage may be blocked, so every touch is guarded.
const store = {
  get: (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } },
  flag: (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};

function Resizer({ side, width, onWidth }: { side: "left" | "right"; width: number; onWidth: (w: number) => void }) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (m: PointerEvent) => onWidth(Math.max(180, Math.min(560, w0 + (side === "left" ? m.clientX - x0 : x0 - m.clientX))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className={`tw-resize ${side}`} onPointerDown={down} role="separator" aria-orientation="vertical" aria-label="Resize" />;
}

type Rail = { id: View; label: string; icon: () => React.ReactElement; key: string };
// Grouped by intent: understand · change · collaborate · agents and the graph as data · escape hatch.
const GROUPS: Rail[][] = [
  [
    { id: "overview", label: "Overview", icon: Icon.home, key: "1" },
    { id: "graph", label: "Graph", icon: Icon.graph, key: "2" },
    { id: "flows", label: "Flows", icon: Icon.flows, key: "3" },
  ],
  [
    { id: "git", label: "Git", icon: Icon.branches, key: "4" },
  ],
  [
    { id: "proposals", label: "Proposals", icon: Icon.pr, key: "7" },
    { id: "issues", label: "Issues", icon: Icon.issues, key: "8" },
    { id: "notes", label: "Notes", icon: Icon.notes, key: "9" },
  ],
  [{ id: "agents", label: "Agents", icon: Icon.agents, key: "a" }],
  // Pinned to the foot of the stripe, the way an IDE keeps Terminal there.
  [
    { id: "query", label: "Query (SPARQL)", icon: Icon.query, key: "q" },
    { id: "console", label: "Console", icon: Icon.console, key: "0" },
  ],
];
const VIEWS = GROUPS.flat();

type Contrast = { base: string; head: string; mode?: ContrastMode } | null;

/** URL ⇄ state: #overview · #graph/<id>/<tab> · #graph/contrast/<base>/<head> · #issues/<id> … */
function parseHash() {
  const [v, a, b, c, d] = location.hash.slice(1).split("/").map(decodeURIComponent);
  const view = (VIEWS.some((x) => x.id === v) ? v : canonView(v as View) === "git" ? "git" : "overview") as View;
  const contrast: Contrast = view === "graph" && a === "contrast" && b && c ? { base: b, head: c, mode: (["overlay", "split", "report"].includes(d) ? d : undefined) as ContrastMode | undefined } : null;
  const focus = view === "graph" && !contrast && Number(a) > 0 ? Number(a) : null;
  const target: Target = {};
  if (view === "issues" && Number(a)) target.issue = Number(a);
  if (view === "proposals" && Number(a)) target.proposal = Number(a);
  if (view === "git" && a) target.sha = a;
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
  useEffect(() => { prefetchViews(); }, []);

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
    else if (view === "git" && target.sha) h += `/${target.sha}`;
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
      setNoTabs(false); setFile(null);
      setTabs((ts) => (ts.some((t) => t.kind === "view" && t.view === p.view) ? ts : [...ts, { kind: "view", view: p.view }]));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Phones: the sidebar is a drawer, summoned from the top bar.
  const [rail, setRail] = useState(false);

  // Editor tabs: every view you visit and every file you open; files live here only, not in the URL.
  const [tabs, setTabs] = useState<Tab[]>([{ kind: "view", view: initial.view }]);
  const [file, setFile] = useState<{ path: string; line?: number } | null>(null);
  const [curLine, setCurLine] = useState<number | undefined>();
  const [left, setLeft] = useState(() => store.flag("kula.studio.left", window.innerWidth >= 1440));
  const [right, setRight] = useState(() => store.flag("kula.studio.right", false));
  const [lw, setLw] = useState(() => store.get("kula.studio.lw", 260));
  const [rw, setRw] = useState(() => store.get("kula.studio.rw", 260));
  useEffect(() => { store.set("kula.studio.left", left ? "1" : "0"); store.set("kula.studio.right", right ? "1" : "0"); }, [left, right]);
  useEffect(() => { store.set("kula.studio.lw", String(lw)); store.set("kula.studio.rw", String(rw)); }, [lw, rw]);
  const showView = useCallback((v: View) => {
    setFile(null);
    setTabs((ts) => (ts.some((t) => t.kind === "view" && t.view === v) ? ts : [...ts, { kind: "view", view: v }]));
  }, []);
  const openFile = useCallback((path: string, line?: number) => {
    setFile({ path, line }); setCurLine(line);
    setTabs((ts) => (ts.some((t) => t.kind === "file" && t.path === path)
      ? ts.map((t) => (t.kind === "file" && t.path === path ? { ...t, line } : t))
      : [...ts, { kind: "file", path, line }]));
    setRail(false);
  }, []);
  const [noTabs, setNoTabs] = useState(false);

  const go: Go = useCallback((to, t = {}) => {
    const v = canonView(to);
    showView(v); setNoTabs(false);
    setView(v);
    setTarget(t);
    if (v === "graph") {
      setContrast(t.contrast ?? null);
      if (t.symbol) setFocus(t.symbol);
      if (t.search) api.search(t.search).then((h) => { const hit = h.find((n) => n.path === t.search) ?? h[0]; if (hit) setFocus(hit.id); });
    }
  }, [showView]);

  const activeKey = noTabs ? null : file ? `f:${file.path}` : `v:${view}`;
  const pickTab = (t: Tab) => {
    setNoTabs(false);
    if (t.kind === "file") { setFile({ path: t.path, line: t.line }); setCurLine(t.line); }
    else go(t.view as View);
  };
  const closeTab = (t: Tab) => {
    const k = tabKey(t);
    const i = tabs.findIndex((x) => tabKey(x) === k);
    const rest = tabs.filter((x) => tabKey(x) !== k);
    setTabs(rest);
    if (k !== activeKey) return;
    const next = rest[Math.min(i, rest.length - 1)];
    if (!next) { setFile(null); setNoTabs(true); return; }
    if (next.kind === "file") { setFile({ path: next.path, line: next.line }); setCurLine(next.line); }
    else { setFile(null); setView(next.view as View); setTarget({}); }
  };
  const tabLabel = (t: Tab) => {
    if (t.kind === "file") return { name: t.path.slice(t.path.lastIndexOf("/") + 1), icon: <Icon.file />, title: t.path };
    const v = VIEWS.find((x) => x.id === t.view)!;
    return { name: v.label, icon: <v.icon />, title: `${v.label}  ${v.key}` };
  };

  const lastShift = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift twice: Search Everywhere.
      if (e.key === "Shift" && !e.repeat) {
        const now = performance.now();
        if (now - lastShift.current < 350) { lastShift.current = 0; setPalette(true); } else lastShift.current = now;
        return;
      }
      lastShift.current = 0;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      // Tool windows by number, as in the IDE: ⌥1 Project, ⌥7 Structure.
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "Digit1" || e.code === "Digit7")) {
        e.preventDefault();
        if (e.code === "Digit1") setLeft((l) => !l); else setRight((r) => !r);
        return;
      }
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
  const badge: Partial<Record<View, number>> = { git: changes, issues: openIssues, proposals: openPrs };
  const nav = { onChanged, openSymbol: (id: number) => go("graph", { symbol: id }), version, go, target };
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <CodeProvider onLocate={(id) => go("graph", { symbol: id })} onEdit={(t) => openFile(t.path, t.line)}>
    <div className={`shell studio ${rail ? "rail-open" : ""} ${left ? "tw-l" : ""} ${right ? "tw-r" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go("overview")} aria-label="Overview"><Logo /><span>kula</span></button>
        <button className="rail-toggle" onClick={() => setRail((r) => !r)} aria-label={rail ? "Hide sidebar" : "Show sidebar"} aria-expanded={rail} aria-controls="rail"><Icon.sidebar /></button>
        <button className="crumb-repo tb-widget" onClick={() => go("overview")} title="Project"><b>{repo?.name ?? "…"}</b><span className="tb-caret"><Icon.chevron /></span></button>
        <button className="chip tb-widget" onClick={() => go("git")} title="Current branch"><Icon.branches /><b className="mono">{repo?.branch ?? "…"}</b><span className="tb-caret"><Icon.chevron /></span></button>
        <span className="spacer" />
        <div className="top-actions">
          <button className="btn sm ghost icon-only" aria-label="Back" title="Back  ⌥←" onClick={() => history.back()}><Icon.back /></button>
          <button className="btn sm ghost top-search" aria-label="Search" title="Search everywhere  ⇧⇧  ⌘K" onClick={() => setPalette(true)}><Icon.search /><kbd>⌘K</kbd></button>
          <button className="btn sm ghost icon-only" aria-label="Settings" title="Settings  ," onClick={() => setPrefs(true)}><Icon.gear /></button>
        </div>
      </header>

      <nav className="rail" id="rail" aria-label="Views">
        <div className="rail-group rail-tools">
          <button className={left ? "on tool" : "tool"} onClick={() => setLeft((l) => !l)} data-tip="Project  ⌥1" aria-label="Project" aria-pressed={left}>
            <Icon.project /><span className="rail-label">Project</span>
          </button>
        </div>
        {GROUPS.map((g, gi) => (
          <div key={gi} className="rail-group">
            {g.map((v) => (
              <button key={v.id} className={!file && !noTabs && view === v.id ? "on" : ""} onClick={() => { go(v.id); setRail(false); }} data-tip={`${v.label}  ${v.key}`} aria-label={v.label} aria-current={view === v.id ? "page" : undefined}>
                <v.icon />
                <span className="rail-label">{v.label}</span>
                {!!badge[v.id] && <span className="badge">{badge[v.id]}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      {rail && <div className="rail-scrim" onClick={() => setRail(false)} aria-hidden="true" />}

      {left && (
        <aside className="tw tw-left" style={{ width: lw }} aria-label="Project">
          <div className="tw-head"><span>Project</span><span className="spacer" /><button className="tw-hide" aria-label="Hide Project" title="Hide  ⌥1" onClick={() => setLeft(false)}><Icon.close /></button></div>
          <ProjectTree repo={repo?.name ?? "…"} version={version} active={file?.path ?? null} onOpen={(p) => openFile(p)} />
          <Resizer side="left" width={lw} onWidth={setLw} />
        </aside>
      )}

      <section className="editor">
        {tabs.length > 0 && <EditorTabs tabs={tabs} active={activeKey} label={tabLabel} onPick={pickTab} onClose={closeTab} />}
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
          {noTabs ? (
            <div className="editor-empty" data-testid="editor-empty">
              <dl>
                <dt>Search everywhere</dt><dd><kbd>⇧⇧</kbd></dd>
                <dt>Project</dt><dd><kbd>⌥1</kbd></dd>
                <dt>Structure</dt><dd><kbd>⌥7</kbd></dd>
                <dt>Graph</dt><dd><kbd>2</kbd></dd>
                <dt>Shortcuts</dt><dd><kbd>?</kbd></dd>
              </dl>
            </div>
          ) : file ? (
            <FileEditor path={file.path} line={file.line} onLine={setCurLine} />
          ) : (
          /* Keyed so each view change plays a short enter transition. */
          <div className="view-enter" key={view + (contrast ? ":c" : "")}>
            <Suspense fallback={<div className="view-loading" aria-live="polite">loading…</div>}>
              {view === "overview" && <Overview repo={repo} version={version} go={go} />}
              {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} openSettings={() => setPrefs(true)} contrast={contrast} setContrast={setContrast} go={go} fences={target.fences} />}
              {view === "git" && <GitBoard {...nav} />}
              {view === "proposals" && <Proposals {...nav} />}
              {view === "issues" && <Issues {...nav} />}
              {view === "notes" && <Notes {...nav} />}
              {view === "flows" && <Flows {...nav} />}
              {view === "agents" && <Agents {...nav} />}
              {view === "query" && <Query {...nav} />}
              {view === "console" && <Console {...nav} />}
            </Suspense>
          </div>
          )}
          </>
          )}
        </main>
      </section>

      {right && (
        <aside className="tw tw-right" style={{ width: rw }} aria-label="Structure">
          <Resizer side="right" width={rw} onWidth={setRw} />
          <div className="tw-head"><span>Structure</span><span className="spacer" /><button className="tw-hide" aria-label="Hide Structure" title="Hide  ⌥7" onClick={() => setRight(false)}><Icon.close /></button></div>
          <Structure path={file?.path ?? null} line={curLine} onJump={(n) => file && openFile(file.path, n)} />
        </aside>
      )}
      <aside className="stripe-right" aria-label="Tool windows">
        <button className={right ? "on" : ""} onClick={() => setRight((r) => !r)} data-tip="Structure  ⌥7" aria-label="Structure" aria-pressed={right}><Icon.structure /></button>
      </aside>

      <footer className="statusbar">
        <span>kula {repo?.version}</span>
        {(indexing || repo?.index !== "current") && <span className="sb-warn">{indexing || repo?.index === "stale" ? "reindexing…" : "no graph – ⌘K, then Reindex"}</span>}
        <span className="sb-crumbs">
          <span>{repo?.name ?? "…"}</span>
          {(file ? file.path.split("/") : [contrast && view === "graph" ? "Contrast" : current.label]).map((p, i) => <span key={i}><i><Icon.chevron /></i>{p}</span>)}
        </span>
        <span className="spacer" />
        {repo?.stats && <span className="sb-stats">{repo.stats.files} files · {repo.stats.symbols} symbols · {repo.stats.edges} edges</span>}
        {file && curLine && <span className="mono">Ln {curLine}</span>}
        {file && <span className="sb-enc">UTF-8</span>}
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
              {(j === 0 || scored[j - 1].group !== it.group) && <div className="grp">{it.group}</div>}
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
