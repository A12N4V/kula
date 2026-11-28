import { CodeProvider } from "./CodePanel";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

// Warm the lazy chunks once the shell is up, so the first click on a rail item
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
import Opening from "./Opening";
import ProjectTree from "./studio/ProjectTree";
import { DockProvider, useDockHost } from "./studio/Dock";
import FileEditor from "./studio/FileEditor";
import BranchMenu from "./studio/BranchMenu";
import { RibbonOptions, RibbonTabs, newTabId, tabKey, type Tab } from "./studio/Ribbon";
import { useSections, useSymbols, type RailItem } from "./studio/RailIndex";
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

type ViewDef = { id: View; label: string; short: string; icon: () => React.ReactElement; key: string };
/** Every view: each keeps its own hash, so old links still land. */
const VIEWS: ViewDef[] = [
  { id: "overview", label: "Overview", short: "Overview", icon: Icon.home, key: "1" },
  { id: "map", label: "Map", short: "Map", icon: Icon.map, key: "" },
  { id: "git", label: "Git", short: "Git", icon: Icon.branches, key: "2" },
  { id: "graph", label: "Graph", short: "Graph", icon: Icon.graph, key: "" },
  { id: "flows", label: "Flows", short: "Flows", icon: Icon.flows, key: "" },
  { id: "slice", label: "Slice", short: "Slice", icon: Icon.isolate, key: "" },
  { id: "query", label: "Ask", short: "Ask", icon: Icon.query, key: "" },
  { id: "proposals", label: "Proposals", short: "Proposals", icon: Icon.pr, key: "" },
  { id: "issues", label: "Issues", short: "Issues", icon: Icon.issues, key: "" },
  { id: "notes", label: "Notes", short: "Notes", icon: Icon.notes, key: "" },
  { id: "agents", label: "Agents", short: "Agents", icon: Icon.harmonograph, key: "5" },
  { id: "extensions", label: "Extensions", short: "Extensions", icon: Icon.plug, key: "6" },
  { id: "console", label: "Console", short: "Console", icon: Icon.console, key: "0" },
];
const vdef = (id: View) => VIEWS.find((x) => x.id === id)!;

/** The rail: one entry per view, in groups. No sub views, no toggles. */
type RailEntry = { id: string; label: string; icon: () => React.ReactElement; key: string; views: View[]; also?: View[]; inline?: boolean };
const one = (id: View, key: string): RailEntry => { const d = vdef(id); return { id, label: d.label, icon: d.icon, key, views: [id] }; };
const RAIL: RailEntry[][] = [
  [one("overview", "1"), one("map", ""), one("graph", "2"), one("flows", "3"), one("slice", "4"), one("query", "5")],
  [{ ...one("git", "6"), also: ["issues"] }, one("proposals", "7"), one("notes", "8")],
  [one("agents", "9"), one("extensions", "")],
  // Pinned to the foot of the stripe, the way an IDE keeps Terminal there.
  [one("console", "0")],
];
const RAIL_FLAT = RAIL.flat();
const railOf = (v: View, cur?: string) => RAIL_FLAT.find((r) => r.id === cur && r.views.includes(v)) ?? RAIL_FLAT.find((r) => r.views.includes(v) || r.also?.includes(v))!;

/** The toggle over a grouped view: Map, Flows and Slice, or Proposals, Issues and Notes. */
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
  if (view === "graph" && a === "fences") target.fences = b ?? "";
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
  return { view, contrast, focus, target, mapRoute };
}

export default function App() {
  const initial = useRef(parseHash()).current;
  const [view, setView] = useState<View>(initial.view);
  const [target, setTarget] = useState<Target>(initial.target);
  const [contrast, setContrast] = useState<Contrast>(initial.contrast);
  const [focus, setFocus] = useState<number | null>(initial.focus);
  const [mapRoute, setMapRoute] = useState<{ variant: VariantId; pick: string; test: boolean } | null>(initial.mapRoute);
  // what is focused becomes a place note and memory composers autofill from
  useEffect(() => {
    if (focus == null) return;
    api.symbol(focus).then(({ node: n }) => { if (n.kind !== "package") visit({ path: n.path, name: n.kind === "file" ? undefined : n.name, kind: n.kind, id: n.id }); }).catch(() => {});
  }, [focus]);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [changes, setChanges] = useState(0);
  const [palette, setPalette] = useState(false);
  const [version, setVersion] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [prefs, setPrefs] = useState<SettingsSection | null>(null);
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
    else if (view === "map" && mapRoute) h += mapRoute.test ? "/test" : `/${mapRoute.variant}${mapRoute.pick ? `/${mapRoute.pick}` : ""}`;
    if (`#${h}` === location.hash) return;
    if (popping.current || !location.hash) history.replaceState(null, "", `#${h}`);
    else history.pushState(null, "", `#${h}`);
    popping.current = false;
  }, [view, focus, contrast, target, mapRoute]);
  useEffect(() => {
    const onPop = () => {
      const p = parseHash();
      popping.current = true;
      setView(p.view); setTarget(p.target); setContrast(p.contrast); setFocus(p.focus); setMapRoute(p.mapRoute);
      setFile(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Phones: the sidebar is a drawer, summoned from the top bar.
  const [rail, setRail] = useState(false);

  // Editor tabs hold views and files side by side; view tabs are remembered, files stay out of the URL.
  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const vs = JSON.parse(localStorage.getItem("kula.tabs") ?? "[]") as string[];
      return vs.filter((v) => VIEWS.some((x) => x.id === v)).map((v) => ({ kind: "view", id: newTabId(), view: v }));
    } catch { return []; }
  });
  useEffect(() => { store.set("kula.tabs", JSON.stringify(tabs.flatMap((t) => (t.kind === "view" ? [t.view] : [])))); }, [tabs]);
  const [file, setFile] = useState<{ path: string; line?: number } | null>(null);
  const [curLine, setCurLine] = useState<number | undefined>();
  const [left, setLeft] = useState(() => store.flag("kula.studio.left", window.innerWidth >= 1440));
  // the sheet: a view's panel opened from the options row, over the centre pane
  const [right, setRight] = useState(false);
  const [lw, setLw] = useState(() => store.get("kula.studio.lw", 260));
  useEffect(() => { store.set("kula.studio.left", left ? "1" : "0"); }, [left]);
  const [pick, setPick] = useState<string | undefined>();
  const dock = useDockHost(pick, right, (id) => { if (id == null) setRight(false); else { setPick(id); setRight(true); } });
  const dockLabel = dock.panels.find((p) => p.id === dock.shown)?.label;
  const toggleRight = useRef(() => {});
  toggleRight.current = () => setRight((r) => !r);
  useEffect(() => { store.set("kula.studio.lw", String(lw)); }, [lw]);
  const viewRef = useRef(view);
  viewRef.current = view;
  // The option sheet belongs to its view, so it closes only when the view changes.
  const showView = useCallback((v: View) => { setFile(null); if (v !== viewRef.current) setRight(false); }, []);
  const openFile = useCallback((path: string, line?: number) => {
    setFile({ path, line }); setCurLine(line); setRight(false);
    setTabs((ts) => (ts.some((t) => t.kind === "file" && t.path === path)
      ? ts.map((t) => (t.kind === "file" && t.path === path ? { ...t, line } : t))
      : [...ts, { kind: "file", path, line }]));
    setRail(false);
  }, []);

  const [railId, setRailId] = useState("overview");
  const railRef = useRef(railId);
  const go: Go = useCallback((to, t = {}) => {
    const v = canonView(to);
    showView(v);
    setView(v);
    setTarget(t);
    const r = railOf(v, railRef.current);
    railRef.current = r.id; setRailId(r.id);
    if (v === "graph") {
      setContrast(t.contrast ?? null);
      if (t.symbol) setFocus(t.symbol);
      if (t.search) api.search(t.search).then((h) => { const hit = h.find((n) => n.path === t.search) ?? h[0]; if (hit) setFocus(hit.id); });
    }
  }, [showView]);

  // Tabs act like a browser: going somewhere changes the current tab, unless another tab already shows it.
  const [cur, setCur] = useState("");
  const curRef = useRef(cur); curRef.current = cur;
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const activeKey = file ? `f:${file.path}` : `v:${cur}`;
  useEffect(() => {
    const ts = tabsRef.current;
    const c = ts.find((t) => t.kind === "view" && t.id === curRef.current);
    if (c?.kind === "view" && c.view === view) return;
    const hit = ts.find((t) => t.kind === "view" && t.view === view);
    if (hit?.kind === "view") { setCur(hit.id); return; }
    if (c) { setTabs(ts.map((t) => (t === c ? { ...c, view } : t))); return; }
    const id = newTabId();
    setTabs([...ts, { kind: "view", id, view }]); setCur(id);
  }, [view]);
  const pickTab = (t: Tab) => {
    if (t.kind === "file") { setFile({ path: t.path, line: t.line }); setCurLine(t.line); setRight(false); }
    else { curRef.current = t.id; setCur(t.id); go(t.view as View); }
  };
  const newTab = () => {
    const id = newTabId();
    setTabs((ts) => [...ts, { kind: "view", id, view: "overview" }]);
    curRef.current = id; setCur(id); go("overview");
  };
  const closeTab = (t: Tab) => {
    const k = tabKey(t);
    const i = tabs.findIndex((x) => tabKey(x) === k);
    const rest = tabs.filter((x) => tabKey(x) !== k);
    setTabs(rest);
    if (k !== activeKey) return;
    const next = rest[Math.min(i, rest.length - 1)];
    if (!next) { setFile(null); return; }
    if (next.kind === "file") { setFile({ path: next.path, line: next.line }); setCurLine(next.line); }
    else { setFile(null); curRef.current = next.id; setCur(next.id); setView(next.view as View); setTarget({}); }
  };
  const tabLabel = (t: Tab) => {
    if (t.kind === "file") return { name: t.path.slice(t.path.lastIndexOf("/") + 1), icon: <Icon.file />, title: t.path };
    const v = VIEWS.find((x) => x.id === t.view)!;
    return { name: v.label, icon: <v.icon />, title: v.label };
  };

  const lastShift = useRef(-1e9);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift twice: Search Everywhere.
      if (e.key === "Shift" && !e.repeat) {
        const now = performance.now();
        if (now - lastShift.current < 350) { lastShift.current = -1e9; setPalette(true); } else lastShift.current = now;
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
        if (act === "palette") setPalette((p) => !p);
        else if (act === "palette.slash") setPalette(true);
        else if (act === "project") setLeft((l) => !l);
        else if (act === "right") toggleRight.current();
        else if (act === "back") history.back();
        else if (act === "forward") history.forward();
        else if (act === "console") go("console");
        else if (act === "agents") go("agents");
        else if (act === "query") go("query");
        else if (act === "extensions") go("extensions");
        else if (act === "map") go("map");
        else if (act === "settings") setPrefs((p) => (p ? null : "general"));
        else if (act === "keys") setPrefs((p) => (p === "keys" ? null : "keys"));
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Digits pick the options row; Shift with a digit picks the left rail group.
      const d = /^Digit([0-9])$/.exec(e.code)?.[1];
      if (d && e.shiftKey) {
        const r = RAIL_FLAT.find((x) => x.key === d);
        if (r) { e.preventDefault(); railRef.current = r.id; go(r.views[0]); }
        return;
      }
      if (d) { const it = d === "0" ? null : stripeRef.current[+d - 1]; if (it) { e.preventDefault(); it.run(); } return; }
      if (e.key === "Escape") { setFocus(null); setRail(false); setRight(false); }
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
  const sections = useSections(`${view}:${file ? "f" : "v"}`, !!file);
  const symbols = useSymbols(file?.path ?? null, curLine, (n) => file && openFile(file.path, n));
  // The options row lists the view's panels; a click opens one as a sheet, a second click closes it.
  const panels: RailItem[] = file ? [] : dock.panels.map((p) => {
    const I = p.icon ?? Icon.structure;
    const on = dock.shown === p.id;
    return { id: p.id, label: p.label, icon: <I />, badge: p.badge, info: p.info, on, run: () => { if (on) setRight(false); else { setPick(p.id); setRight(true); } } };
  });
  const track = file ? symbols.items : sections.items;
  const stripe = panels.length ? panels : track;
  const stripeRef = useRef(stripe); stripeRef.current = stripe;
  // The sheet hangs under its option, kept inside the centre pane.
  const editorRef = useRef<HTMLElement>(null);
  const [sheetX, setSheetX] = useState(8);
  useLayoutEffect(() => {
    const ed = editorRef.current, id = dock.shown;
    const b = id && document.querySelector<HTMLElement>(`.rb-opts [data-id="${CSS.escape(id)}"]`);
    if (!ed || !b) return;
    const e = ed.getBoundingClientRect(), r = b.getBoundingClientRect();
    setSheetX(Math.max(8, Math.min(r.left - e.left, e.width - Math.min(380, e.width - 16) - 8)));
  }, [dock.shown, left, lw]);
  const nav = { onChanged, openSymbol: (id: number) => go("graph", { symbol: id }), version, go, target };
  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <CodeProvider onLocate={(id) => go("graph", { symbol: id })} onEdit={(t) => openFile(t.path, t.line)}>
    <DockProvider api={dock.api}>
    <div className={`shell studio ${rail ? "rail-open" : ""} ${left ? "tw-l" : ""}`}>
      <header className="topbar ribbon">
        <button className="brand" onClick={() => go("overview")} aria-label="Overview" title="Overview"><Logo /></button>
        <button className="rail-toggle" onClick={() => setRail((r) => !r)} aria-label={rail ? "Hide sidebar" : "Show sidebar"} aria-expanded={rail} aria-controls="rail"><Icon.sidebar /></button>
        <RibbonTabs tabs={tabs} active={activeKey} label={tabLabel} onPick={pickTab} onClose={closeTab} onNew={newTab} />
        <div className="top-actions">
          <button className="crumb-repo tb-widget" onClick={() => go("overview")} title="Overview"><b>{repo?.name ?? "…"}</b></button>
          <BranchMenu branch={repo?.branch} onChanged={onChanged} openGit={() => go("git")} />
          <button className="btn sm ghost icon-only" aria-label="Back" title="Back  ⌥←" onClick={() => history.back()}><Icon.back /></button>
          <button className="btn sm ghost top-search" aria-label="Search" title="Search everywhere  ⇧⇧  ⌘K" onClick={() => setPalette(true)}><Icon.search /><kbd>⌘K</kbd></button>
          <button className="btn sm ghost icon-only" aria-label="Settings" title="Settings  ," onClick={() => setPrefs("general")}><Icon.gear /></button>
        </div>
      </header>
      <RibbonOptions items={stripe} name={panels.length ? "Options" : file ? "Symbols" : "Sections"} pressable={panels.length > 0} />

      <nav className="rail" id="rail" aria-label="Views">
        <div className="rail-group rail-tools">
          <button className={left ? "on tool" : "tool"} onClick={() => setLeft((l) => !l)} data-tip="Project  ⌥1" aria-label="Project" aria-pressed={left}>
            <Icon.project /><span className="rail-label">Project</span>
          </button>
        </div>
        {RAIL.map((g, gi) => (
          <div key={gi} className="rail-group">
            {g.map((r) => {
              const here = railOf(view, railId).id === r.id;
              const n = r.views.reduce((s, v) => s + (badge[v] ?? 0), 0);
              return (
                <button key={r.id} className={!file && here ? "on" : ""} onClick={() => { railRef.current = r.id; go(here ? view : r.views[0]); setRail(false); }} data-tip={r.key ? `${r.label}  ⇧${r.key}` : r.label} aria-label={r.label} aria-current={here ? "page" : undefined}>
                  <r.icon />
                  <span className="rail-label">{r.label}</span>
                  {!!n && <span className="badge">{n > 99 ? "99+" : n}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      {rail && <div className="rail-scrim" onClick={() => setRail(false)} aria-hidden="true" />}

      {left && (
        <aside className="tw tw-left" style={{ width: lw }} aria-label="Project">
          <div className="tw-head"><span>Project</span><span className="spacer" /><button className="tw-hide" aria-label="Hide Project" title="Hide  ⌥1" onClick={() => setLeft(false)}><Icon.close /></button></div>
          <ProjectTree repo={repo?.name ?? "…"} version={version} active={file?.path ?? dock.active} onOpen={(p) => { if (file || !dock.reveal(p)) openFile(p); }} onEdit={(p) => openFile(p)} />
          <Resizer side="left" width={lw} onWidth={setLw} />
        </aside>
      )}

      <section className="editor" ref={editorRef}>
        {dock.shown && <aside className="rb-sheet" style={{ left: sheetX }} aria-label={dockLabel}><div className="tw-dock" ref={dock.setSlot} /></aside>}
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
              <button className="btn sm" onClick={refresh}>Retry</button>
            </div>
          )}
          {file ? (
            <FileEditor path={file.path} line={file.line} onLine={setCurLine} />
          ) : (
          /* Keyed so each view change plays a short enter transition. */
          <div className="view-enter" key={view + (contrast ? ":c" : "")}>
            <div className="view-body">
            <Suspense fallback={<div className="view-loading" aria-live="polite">loading…</div>}>
              {view === "overview" && <Overview repo={repo} version={version} go={go} onChanged={onChanged} openSymbol={nav.openSymbol} />}
              {view === "map" && <MapView route={mapRoute ?? { variant: rememberedVariant(), pick: "", test: false }} setRoute={setMapRoute} />}
              {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} openSettings={() => setPrefs("graph")} contrast={contrast} setContrast={setContrast} go={go} fences={target.fences} />}
              {view === "git" && <GitView {...nav} />}
              {view === "issues" && <IssueDesk version={version} onChanged={onChanged} openSymbol={nav.openSymbol} target={target.issue ?? null} />}
              {view === "proposals" && <Proposals {...nav} />}
              {view === "notes" && <Notes {...nav} />}
              {view === "flows" && <Flows {...nav} />}
              {view === "agents" && <Agents {...nav} />}
              {view === "query" && <Query {...nav} />}
              {view === "slice" && <Slice {...nav} />}
              {view === "extensions" && <Extensions version={version} onChanged={onChanged} />}
              {view === "console" && <Console {...nav} />}
            </Suspense>
            </div>
          </div>
          )}
          </>
          )}
        </main>
      </section>

      <footer className="statusbar">
        <span>kula {repo?.version}</span>
        {(indexing || repo?.index !== "current") && <span className="sb-warn">{indexing || repo?.index === "stale" ? "reindexing…" : "No graph. ⌘K, Reindex"}</span>}
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
      </footer>

      {palette && <Palette meta={meta} onClose={() => setPalette(false)} go={(v, t) => { setPalette(false); go(v, t); }} onReindex={() => { setPalette(false); reindex(); }} onSettings={() => { setPalette(false); setPrefs("general"); }} onKeys={() => { setPalette(false); setPrefs("keys"); }} />}
      {prefs && <SettingsPanel section={prefs} setSection={setPrefs} onClose={() => setPrefs(null)} />}
      {opening && <Opening repo={repo} onDone={endOpening} />}
    </div>
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
function Palette({ meta, onClose, go, onReindex, onSettings, onKeys }: { meta: Meta | null; onClose: () => void; go: Go; onReindex: () => void; onSettings: () => void; onKeys: () => void }) {
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

