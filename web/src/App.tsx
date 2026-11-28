import { CodeProvider } from "./CodePanel";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, relTime, type Branch, type Meta, type Node, type RepoInfo } from "./api";
import { Icon, Kind, Logo, useToast } from "./ui";
import type { ContrastMode, Go, Target, View } from "./nav";
import { canonView, fuzzyScore } from "./nav";
// Heavy views load on demand: the first paint ships the shell + Overview only,
// the rest arrive as their own chunks (prefetched on idle, see PREFETCH below).
const GraphView = lazy(() => import("./views/GraphView"));
const Agents = lazy(() => import("./views/Agents"));
const Query = lazy(() => import("./views/query/Ask"));
const GitView = lazy(() => import("./views/git"));
import IssueDesk from "./views/IssueDesk";
const Console = lazy(() => import("./views/GitViews").then((m) => ({ default: m.Console })));
const Flows = lazy(() => import("./views/query/Flows"));
const MapView = lazy(() => import("./views/map/Map"));
import { canonVariant, rememberedVariant, type VariantId } from "./views/map/ab";
const Slice = lazy(() => import("./views/query/Slice"));
const Extensions = lazy(() => import("./views/Extensions"));
const Notes = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Notes })));
const Proposals = lazy(() => import("./views/MetaViews").then((m) => ({ default: m.Proposals })));
import Overview from "./views/Overview";
import SettingsPanel, { type SettingsSection } from "./SettingsPanel";
import { actionFor, chordOf, strong } from "./keys";

// Warm the lazy chunks once the shell is up, so the first click on a destination
// does not wait on the network (local disk, but still a visible flash).
const PREFETCH: Array<() => Promise<unknown>> = [
  () => import("./views/GraphView"),
  () => import("./views/Agents"),
  () => import("./views/query/Ask"),
  () => import("./views/query/Flows"),
  () => import("./views/map/Map"),
  () => import("./views/GitViews"),
  () => import("./views/git"),
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
import ProjectTree from "./studio/ProjectTree";
import { DockProvider, useDockHost } from "./studio/Dock";
import FileEditor from "./studio/FileEditor";
import BranchMenu from "./studio/BranchMenu";
import { HeadSlotProvider } from "./studio/Head";
import type { Mode as HubMode } from "./views/hub/Hub";
import { visit } from "./near";

// Tool window widths survive a reload; storage may be blocked, so every touch is guarded.
const store = {
  get: (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } },
  flag: (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } },
  str: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
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

type ViewDef = { id: View; label: string; icon: () => React.ReactElement };
/** Every view keeps its own hash, so old links still land. */
const VIEWS: ViewDef[] = [
  { id: "overview", label: "Overview", icon: Icon.home },
  { id: "map", label: "Map", icon: Icon.map },
  { id: "graph", label: "Graph", icon: Icon.graph },
  { id: "flows", label: "Flows", icon: Icon.flows },
  { id: "slice", label: "Slice", icon: Icon.isolate },
  { id: "query", label: "Query", icon: Icon.query },
  { id: "git", label: "Changes", icon: Icon.changes },
  { id: "proposals", label: "Proposals", icon: Icon.pr },
  { id: "issues", label: "Issues", icon: Icon.issues },
  { id: "notes", label: "Notes", icon: Icon.notes },
  { id: "agents", label: "Agents", icon: Icon.agents },
  { id: "extensions", label: "Extensions", icon: Icon.plug },
  { id: "console", label: "Console", icon: Icon.console },
];
const vdef = (id: View) => VIEWS.find((x) => x.id === id)!;

/** Five destinations on keys 1 to 5. A destination's modes are one toggle in the header;
 *  views without a toggle (Slice, Query) are reached from ⌘K and live under Code. */
type ModeDef = { id: string; label: string; view: View; hub?: HubMode };
type Dest = { id: string; label: string; icon: () => React.ReactElement; modes: ModeDef[]; also?: View[] };
const DESTS: Dest[] = [
  { id: "home", label: "Home", icon: Icon.home, modes: [{ id: "overview", label: "Overview", view: "overview" }] },
  { id: "agents", label: "Agents", icon: Icon.agents, modes: [
    { id: "build", label: "Build", view: "agents", hub: "build" },
    { id: "live", label: "Live", view: "agents", hub: "live" },
    { id: "runs", label: "Runs", view: "agents", hub: "runs" },
    { id: "extensions", label: "Extensions", view: "extensions" },
  ] },
  { id: "code", label: "Code", icon: Icon.map, modes: [
    { id: "map", label: "Map", view: "map" },
    { id: "graph", label: "Graph", view: "graph" },
    { id: "flows", label: "Flows", view: "flows" },
  ], also: ["slice", "query"] },
  { id: "changes", label: "Changes", icon: Icon.changes, modes: [{ id: "git", label: "Changes", view: "git" }] },
  { id: "review", label: "Review", icon: Icon.pr, modes: [
    { id: "proposals", label: "Proposals", view: "proposals" },
    { id: "issues", label: "Issues", view: "issues" },
    { id: "notes", label: "Notes", view: "notes" },
  ] },
];
const destOf = (v: View) => DESTS.find((d) => d.modes.some((m) => m.view === v) || d.also?.includes(v)) ?? DESTS[0];
const HUB_MODES: HubMode[] = ["build", "live", "runs"];

type Contrast = { base: string; head: string; mode?: ContrastMode } | null;

/** URL ⇄ state: #overview · #agents/<mode> · #graph/<id> · #graph/contrast/<base>/<head> · #issues/<id> …
 *  #console still works: it opens the console drawer over Home. */
function parseHash() {
  const [v, a, b, c, d] = location.hash.slice(1).split("/").map(decodeURIComponent);
  const drawer = v === "console";
  const known = VIEWS.some((x) => x.id === v) && v !== "console";
  const view = (known ? v : canonView(v as View) === "git" ? "git" : canonView(v as View) === "graph" ? "graph" : "overview") as View;
  const contrast: Contrast = view === "graph" && a === "contrast" && b && c ? { base: b, head: c, mode: (["overlay", "split", "report"].includes(d) ? d : undefined) as ContrastMode | undefined } : null;
  const focus = view === "graph" && !contrast && Number(a) > 0 ? Number(a) : null;
  const target: Target = {};
  if (view === "issues" && Number(a)) target.issue = Number(a);
  if (view === "proposals" && Number(a)) target.proposal = Number(a);
  if (view === "git" && a) target.sha = a;
  if (view === "graph" && a === "fences") target.fences = b ?? "";
  const hub: HubMode = view === "agents" && HUB_MODES.includes(a as HubMode) ? (a as HubMode) : "build";
  // Map sub-route: #map/<variant>/<pick> with pick s/<id> · f/<id> · d/<id>, or #map/test.
  const mapRoute = view === "map"
    ? {
        variant: (["atlas", "metro", "a", "b", "c"].includes(a ?? "")
          ? canonVariant(a)
          : rememberedVariant()) as VariantId,
        pick: a && a !== "test" && b ? `${b}${c ? `/${c}` : ""}` : "",
        test: a === "test",
      }
    : null;
  return { view, contrast, focus, target, mapRoute, hub, drawer };
}

const DRAWER_KEY = "kula.drawer.h";

export default function App() {
  const initial = useRef(parseHash()).current;
  const [view, setView] = useState<View>(initial.view);
  const [target, setTarget] = useState<Target>(initial.target);
  const [contrast, setContrast] = useState<Contrast>(initial.contrast);
  const [focus, setFocus] = useState<number | null>(initial.focus);
  const [hub, setHub] = useState<HubMode>(initial.hub);
  const [mapRoute, setMapRoute] = useState<{ variant: VariantId; pick: string; test: boolean } | null>(initial.mapRoute);
  const [drawer, setDrawer] = useState(initial.drawer);
  const [drawerH, setDrawerH] = useState(() => store.get(DRAWER_KEY, 280));
  useEffect(() => { store.set(DRAWER_KEY, String(drawerH)); }, [drawerH]);
  // what is focused becomes a place note and memory composers autofill from
  useEffect(() => {
    if (focus == null) return;
    api.symbol(focus).then(({ node: n }) => { if (n.kind !== "package") visit({ path: n.path, name: n.kind === "file" ? undefined : n.name, kind: n.kind, id: n.id }); }).catch(() => {});
  }, [focus]);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [changes, setChanges] = useState(0);
  const [palette, setPalette] = useState<string | false>(false);
  const [version, setVersion] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [prefs, setPrefs] = useState<SettingsSection | null>(null);
  // The server's last error: when set, the shell shows it with a retry instead of a blank page.
  const [serverError, setServerError] = useState<string | null>(null);
  const lastHead = useRef<string | null>(null);
  const toast = useToast();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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

  // Keep the URL shareable, and make back/forward walk through where you have been.
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
    else if (view === "agents" && hub !== "build") h += `/${hub}`;
    else if (view === "map" && mapRoute) h += mapRoute.test ? "/test" : `/${mapRoute.variant}${mapRoute.pick ? `/${mapRoute.pick}` : ""}`;
    if (`#${h}` === location.hash) return;
    if (popping.current || !location.hash || location.hash === "#console") history.replaceState(null, "", `#${h}`);
    else history.pushState(null, "", `#${h}`);
    popping.current = false;
  }, [view, focus, contrast, target, mapRoute, hub]);
  useEffect(() => {
    const onPop = () => {
      const p = parseHash();
      popping.current = true;
      setView(p.view); setTarget(p.target); setContrast(p.contrast); setFocus(p.focus); setMapRoute(p.mapRoute); setHub(p.hub);
      if (p.drawer) setDrawer(true);
      setFile(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [file, setFile] = useState<{ path: string; line?: number } | null>(null);
  const [curLine, setCurLine] = useState<number | undefined>();
  const [left, setLeft] = useState(() => store.flag("kula.studio.left", false));
  const [lw, setLw] = useState(() => store.get("kula.studio.lw", 260));
  useEffect(() => { store.set("kula.studio.left", left ? "1" : "0"); }, [left]);
  useEffect(() => { store.set("kula.studio.lw", String(lw)); }, [lw]);
  // A view's side panels dock top right of the view; the header toggles them.
  const [right, setRight] = useState(false);
  const [pick, setPick] = useState<string | undefined>();
  const dock = useDockHost(pick, right, (id) => { if (id == null) setRight(false); else { setPick(id); setRight(true); } });
  const dockLabel = dock.panels.find((p) => p.id === dock.shown)?.label;
  const toggleRight = useRef(() => {});
  toggleRight.current = () => setRight((r) => !r);
  const viewRef = useRef(view);
  viewRef.current = view;
  const showView = useCallback((v: View) => { setFile(null); if (v !== viewRef.current) setRight(false); }, []);
  const openFile = useCallback((path: string, line?: number) => { setFile({ path, line }); setCurLine(line); setRight(false); }, []);

  // Each destination remembers its last mode, so Code returns to Graph if you left it there.
  const lastIn = useRef<Record<string, View>>({});
  const go: Go = useCallback((to, t = {}) => {
    if (to === "console") { setDrawer(true); return; }
    const v = canonView(to);
    showView(v);
    setView(v);
    setTarget(t);
    lastIn.current[destOf(v).id] = v;
    if (v === "graph") {
      setContrast(t.contrast ?? null);
      if (t.symbol) setFocus(t.symbol);
      if (t.search) api.search(t.search).then((h) => { const hit = h.find((n) => n.path === t.search) ?? h[0]; if (hit) setFocus(hit.id); });
    }
  }, [showView]);
  const goDest = useCallback((d: Dest) => {
    const here = destOf(viewRef.current).id === d.id;
    if (here) { setFile(null); return; }
    go(lastIn.current[d.id] ?? d.modes[0].view);
  }, [go]);
  const goMode = (m: ModeDef) => { if (m.hub) setHub(m.hub); go(m.view); };

  const lastShift = useRef(-1e9);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift twice: Search Everywhere.
      if (e.key === "Shift" && !e.repeat) {
        const now = performance.now();
        if (now - lastShift.current < 350) { lastShift.current = -1e9; setPalette(""); } else lastShift.current = now;
        return;
      }
      lastShift.current = -1e9;
      const el = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable || !!el.closest?.(".cm-editor, .monaco-editor");
      if (el.closest?.("[data-capture-keys]")) return;
      const chord = chordOf(e);
      const act = chord ? actionFor(chord) : null;
      if (act && (!typing || (strong(chord) && !(typing && /[←→]/.test(chord))))) {
        e.preventDefault();
        if (act === "palette") setPalette((p) => (p === false ? "" : false));
        else if (act === "palette.slash") setPalette("");
        else if (act === "project") setLeft((l) => !l);
        else if (act === "right") toggleRight.current();
        else if (act === "back") history.back();
        else if (act === "forward") history.forward();
        else if (act === "console") setDrawer((o) => !o);
        else if (act === "agents") go("agents");
        else if (act === "query") go("query");
        else if (act === "extensions") go("extensions");
        else if (act === "map") go("map");
        else if (act === "settings") setPrefs((p) => (p ? null : "general"));
        else if (act === "keys") setPrefs((p) => (p === "keys" ? null : "keys"));
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const dg = /^Digit([1-5])$/.exec(e.code)?.[1];
      if (dg) { e.preventDefault(); goDest(DESTS[+dg - 1]); return; }
      if (e.key === "Escape") { setFocus(null); setRight(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goDest]);

  const reindex = async () => {
    setIndexing(true);
    try { const s: any = await api.reindex(); toast(`Indexed ${s.symbols} symbols in ${s.millis}ms`); onChanged(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setIndexing(false); }
  };

  const openIssues = meta?.issues.filter((i) => i.status === "open").length ?? 0;
  const openPrs = meta?.proposals.filter((p) => p.status === "open").length ?? 0;
  const badge: Record<string, number> = { changes, review: openIssues + openPrs };
  const nav = { onChanged, openSymbol: (id: number) => go("graph", { symbol: id }), version, go, target };
  const dest = destOf(view);
  const modeOn = (m: ModeDef) => m.view === view && (!m.hub || m.hub === hub);
  const fileName = file ? file.path.slice(file.path.lastIndexOf("/") + 1) : "";
  const subtitle = file ? file.path : view === "graph" && contrast ? `${contrast.base} vs ${contrast.head}` : dest.also?.includes(view) ? vdef(view).label : "";

  // The drawer resizes from its top edge.
  const dragDrawer = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = drawerH;
    const move = (m: PointerEvent) => setDrawerH(Math.max(140, Math.min(window.innerHeight - 200, h0 + y0 - m.clientY)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("resizing"); };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <CodeProvider onLocate={(id) => go("graph", { symbol: id })} onEdit={(t) => openFile(t.path, t.line)}>
    <DockProvider api={dock.api}>
    <HeadSlotProvider value={file ? null : slot}>
    <div className={`k-shell ${left ? "tw-l" : ""}`} style={{ ["--drawer-h" as string]: `${drawerH}px` }}>
      <nav className="k-nav" aria-label="Destinations">
        <button className="k-logo" onClick={() => go("overview")} aria-label="Home" data-tip="Home" data-tip-side="right"><Logo /></button>
        {DESTS.map((d, i) => {
          const on = !file && dest.id === d.id;
          const n = badge[d.id] ?? 0;
          return (
            <button key={d.id} className={`k-dest${on ? " on" : ""}`} onClick={() => goDest(d)} aria-current={on ? "page" : undefined} aria-label={d.label}
              data-tip={`${d.label}  ${i + 1}`} data-tip-side="right" data-dest={d.id}>
              <d.icon /><span>{d.label}</span>
              {n > 0 && <i className="k-badge">{n > 99 ? "99+" : n}</i>}
            </button>
          );
        })}
        <div className="k-nav-foot">
          <button className={`btn quiet icon${drawer ? " on" : ""}`} aria-label="Console" aria-pressed={drawer} data-tip="Console  ⌃`" data-tip-side="right" onClick={() => setDrawer((o) => !o)}><Icon.console /></button>
          <button className="btn quiet icon" aria-label="Settings" data-tip="Settings  ," data-tip-side="right" onClick={() => setPrefs("general")}><Icon.gear /></button>
        </div>
      </nav>

      <header className="k-head">
        {file && <button className="btn quiet icon" aria-label="Back" data-tip="Back to the view" onClick={() => setFile(null)}><Icon.back /></button>}
        <div className="k-title">
          <h1>{file ? fileName : dest.label}</h1>
          {subtitle && <span className="k-sub">{subtitle}</span>}
        </div>
        {!file && dest.modes.length > 1 && (
          <div className="seg" role="radiogroup" aria-label={`${dest.label} mode`}>
            {dest.modes.map((m) => <button key={m.id} role="radio" aria-checked={modeOn(m)} className={modeOn(m) ? "on" : ""} onClick={() => goMode(m)}>{m.label}</button>)}
          </div>
        )}
        <div className="k-slot" ref={setSlot} />
        <div className="k-tools">
          {!file && dock.panels.length > 0 && <div className="k-panels" role="toolbar" aria-label="Panels">{dock.panels.map((p) => {
            const I = p.icon ?? Icon.structure;
            const on = dock.shown === p.id;
            return (
              <button key={p.id} className={`btn quiet icon${on ? " on" : ""}`} style={{ position: "relative" }} aria-pressed={on} aria-label={p.label} data-tip={p.info ? `${p.label}  ${p.info}` : p.label} data-id={p.id}
                onClick={() => { if (on) setRight(false); else { setPick(p.id); setRight(true); } }}>
                <I />{!!p.badge && <i className="k-badge-dot">{p.badge}</i>}
              </button>
            );
          })}</div>}
          {!file && dock.panels.length > 0 && <span className="k-sep" />}
          <button className={`btn quiet icon${left ? " on" : ""}`} aria-pressed={left} aria-label="Project" data-tip="Project  ⌥1" onClick={() => setLeft((l) => !l)}><Icon.project /></button>
          <BranchMenu branch={repo?.branch} onChanged={onChanged} openGit={() => go("git")} />
          <button className="btn k-search" aria-label="Search" data-tip="Search everywhere  ⇧⇧" onClick={() => setPalette("")}><Icon.search /><span>Search</span><kbd>⌘K</kbd></button>
        </div>
      </header>

      <div className="k-body">
        {left && (
          <aside className="tw tw-left" style={{ width: lw }} aria-label="Project">
            <div className="tw-head"><span className="label">Project</span><span className="spacer" /><button className="btn quiet icon" aria-label="Hide Project" data-tip="Hide  ⌥1" onClick={() => setLeft(false)}><Icon.close /></button></div>
            <ProjectTree repo={repo?.name ?? "…"} version={version} active={file?.path ?? dock.active} onOpen={(p) => { if (file || !dock.reveal(p)) openFile(p); }} onEdit={(p) => openFile(p)} />
            <Resizer side="left" width={lw} onWidth={setLw} />
          </aside>
        )}
        <section className={`k-view${file ? " k-file" : ""}`}>
          {dock.shown && !file && <aside className="rb-sheet" aria-label={dockLabel}><div className="tw-dock" ref={dock.setSlot} /></aside>}
          <main className="main">
            {/* Full panel only when nothing has loaded; once data is in, a failed poll
                is a slim banner so the view (and its state) survives the blip. */}
            {serverError && !repo ? (
              <div className="shell-error" data-testid="server-error" role="alert">
                <h2>Server unreachable</h2>
                <p className="mono">{serverError}</p>
                <p className="hint">Waiting for the kula server.</p>
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
                <button className="btn" onClick={refresh}>Retry</button>
              </div>
            )}
            {file ? (
              <FileEditor path={file.path} line={file.line} onLine={setCurLine} />
            ) : (
            <div className="view-enter" key={view + (contrast ? ":c" : "")}>
              <div className="view-body">
              <Suspense fallback={<div className="view-loading" aria-live="polite">loading</div>}>
                {view === "overview" && <Overview repo={repo} version={version} go={go} onChanged={onChanged} openSymbol={nav.openSymbol} />}
                {view === "map" && <MapView route={mapRoute ?? { variant: rememberedVariant(), pick: "", test: false }} setRoute={setMapRoute} />}
                {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} openSettings={() => setPrefs("graph")} contrast={contrast} setContrast={setContrast} go={go} fences={target.fences} />}
                {view === "git" && <GitView {...nav} />}
                {view === "issues" && <IssueDesk version={version} onChanged={onChanged} openSymbol={nav.openSymbol} target={target.issue ?? null} />}
                {view === "proposals" && <Proposals {...nav} />}
                {view === "notes" && <Notes {...nav} />}
                {view === "flows" && <Flows {...nav} />}
                {view === "agents" && <Agents {...nav} mode={hub} setMode={(m) => setHub(m)} />}
                {view === "query" && <Query {...nav} />}
                {view === "slice" && <Slice {...nav} />}
                {view === "extensions" && <Extensions version={version} onChanged={onChanged} />}
              </Suspense>
              </div>
            </div>
            )}
            </>
            )}
          </main>
        </section>
      </div>

      <section className={`k-drawer${drawer ? " open" : ""}`} aria-label="Console" aria-hidden={!drawer}>
        {drawer && <>
          <div className="tw-resize top" onPointerDown={dragDrawer} onDoubleClick={() => setDrawerH(280)} role="separator" aria-orientation="horizontal" aria-label="Resize console" />
          <div className="k-drawer-head">
            <span className="label">Console</span>
            <button className="btn quiet icon" aria-label="Close console" data-tip="Close  ⌃`" onClick={() => setDrawer(false)}><Icon.close /></button>
          </div>
          <div className="k-drawer-body">
            <Suspense fallback={null}><Console {...nav} /></Suspense>
          </div>
        </>}
      </section>

      <footer className="statusbar">
        <span>kula {repo?.version}</span>
        {(indexing || repo?.index !== "current") && <span className="sb-warn">{indexing || repo?.index === "stale" ? "reindexing" : "No graph yet, reindex from ⌘K"}</span>}
        <span className="sb-crumbs">
          <span>{repo?.name ?? "…"}</span>
          {(file ? file.path.split("/") : [dest.label, ...(dest.modes.length > 1 || dest.also?.includes(view) ? [vdef(view).label] : [])]).map((p, i) => <span key={i}><i><Icon.chevron /></i>{p}</span>)}
        </span>
        <span className="spacer" />
        {repo?.stats && <span className="sb-stats">{repo.stats.files} files · {repo.stats.symbols} symbols · {repo.stats.edges} edges</span>}
        {file && curLine && <span className="mono">Ln {curLine}</span>}
        <span>{changes ? `${changes} changed` : "clean"}</span>
        <span className="mono">{repo?.head?.slice(0, 8)}</span>
        <span>{repo?.user}</span>
      </footer>

      {palette !== false && <Palette initial={palette} meta={meta} onClose={() => setPalette(false)} go={(v, t) => { setPalette(false); go(v, t); }} onReindex={() => { setPalette(false); reindex(); }} onSettings={() => { setPalette(false); setPrefs("general"); }} onKeys={() => { setPalette(false); setPrefs("keys"); }} />}
      {prefs && <SettingsPanel section={prefs} setSection={setPrefs} onClose={() => setPrefs(null)} />}
    </div>
    </HeadSlotProvider>
    </DockProvider>
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
function Palette({ initial = "", meta, onClose, go, onReindex, onSettings, onKeys }: { initial?: string; meta: Meta | null; onClose: () => void; go: Go; onReindex: () => void; onSettings: () => void; onKeys: () => void }) {
  const [q, setQ] = useState(initial);
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
    const s = q.replace(/^[#@>?]/, "").trim();
    if (!s || /^[>#@?]/.test(q)) { setHits([]); return; }
    const t = setTimeout(() => api.search(s).then(setHits).catch(() => setHits([])), 80);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { list.current?.querySelector(".res.on")?.scrollIntoView({ block: "nearest" }); }, [i]);

  // Prefixes narrow the search: # issues and proposals, @ branches, > commands, ? query the graph.
  const mode = q[0] === "#" ? "#" : q[0] === "@" ? "@" : q[0] === ">" ? ">" : q[0] === "?" ? "?" : "";
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
  if (mode === "?") {
    items.push({ key: "ask", text: s || "query", group: "Query", run: () => { if (s) { try { localStorage.setItem("kula.query.v1", q.slice(1).trim()); } catch { /* blocked */ } } go("query"); },
      el: <><span className="pal-ico" style={{ color: "var(--accent)" }}><Icon.query /></span><span>{s ? "Run in Query" : "Open Query"}</span><span className="p mono">{q.slice(1).trim().slice(0, 60)}</span></> });
  }
  if (!mode || mode === ">") {
    [
      ...DESTS.map((d, n) => ({ key: `dest:${d.id}`, label: `Go to ${d.label}`, hint: String(n + 1), run: () => go(d.modes[0].view) })),
      ...VIEWS.filter((v) => !DESTS.some((d) => d.modes[0].view === v.id && d.label === v.label)).map((v) => ({ key: `go:${v.id}`, label: v.id === "console" ? "Open Console" : `Open ${v.label}`, hint: v.id === "console" ? "⌃`" : "", run: () => go(v.id) })),
      { key: "contrast:worktree", label: "Contrast graph: HEAD → working tree", hint: "", run: () => go("graph", { contrast: { base: "HEAD", head: "WORKTREE" } }) },
      { key: "reindex", label: "Reindex knowledge graph", hint: "", run: onReindex },
      { key: "fences", label: "Graph: show fences", hint: "f", run: () => go("graph", { fences: "" }) },
      ...(["explore", "fix", "refactor", "tests", "docs", "autoresearch"]).map((w) => ({ key: `fences:${w}`, label: `Graph: preview the ${w} workflow's fences`, hint: "", run: () => go("graph", { fences: w }) })),
      { key: "settings", label: "Open settings", hint: ",", run: onSettings },
      { key: "help", label: "Keybindings", hint: "?", run: onKeys },
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
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbols, #issues, @branches, >commands, ?query"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(scored.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") (mode === "?" ? items[0] : scored[k])?.run();
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
        <footer><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>#</kbd> issues</span><span><kbd>@</kbd> branches</span><span><kbd>&gt;</kbd> commands</span><span><kbd>?</kbd> query</span><span className="spacer" /><span><kbd>esc</kbd></span></footer>
      </div>
    </div>
  );
}

