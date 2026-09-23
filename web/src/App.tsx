import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Meta, type Node, type RepoInfo } from "./api";
import { Icon, Kind, Logo, useToast } from "./ui";
import GraphView from "./views/GraphView";
import { Branches, Changes, Console, History } from "./views/GitViews";
import { Flows, Issues, Notes, Proposals } from "./views/MetaViews";

type View = "graph" | "changes" | "history" | "branches" | "proposals" | "issues" | "notes" | "flows" | "console";
const VIEWS: { id: View; label: string; icon: () => React.ReactElement; key: string }[] = [
  { id: "graph", label: "Graph", icon: Icon.graph, key: "1" },
  { id: "changes", label: "Changes", icon: Icon.changes, key: "2" },
  { id: "history", label: "History", icon: Icon.history, key: "3" },
  { id: "branches", label: "Branches & compare", icon: Icon.branches, key: "4" },
  { id: "proposals", label: "Proposals", icon: Icon.pr, key: "5" },
  { id: "issues", label: "Issues", icon: Icon.issues, key: "6" },
  { id: "notes", label: "Notes", icon: Icon.notes, key: "7" },
  { id: "flows", label: "Flows", icon: Icon.flows, key: "8" },
  { id: "console", label: "Git console", icon: Icon.console, key: "9" },
];

export default function App() {
  const [view, setView] = useState<View>(() => (location.hash.slice(1).split("/")[0] as View) || "graph");
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [changes, setChanges] = useState(0);
  const [focus, setFocus] = useState<number | null>(() => {
    const id = Number(location.hash.split("/")[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  });
  const [palette, setPalette] = useState(false);
  const [version, setVersion] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [theme, setTheme] = useState<string | null>(() => { try { return localStorage.getItem("kula-theme"); } catch { return null; } });
  const toast = useToast();

  const refresh = useCallback(() => {
    api.repo().then(setRepo).catch((e) => toast(e.message, "err"));
    api.meta().then(setMeta).catch(() => {});
    api.status().then((s) => setChanges(s.files.length)).catch(() => {});
  }, [toast]);
  const onChanged = useCallback(() => { refresh(); setVersion((v) => v + 1); }, [refresh]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  // Deep links: #graph/<symbol id> is shareable.
  useEffect(() => { history.replaceState(null, "", `#${view}${view === "graph" && focus != null ? `/${focus}` : ""}`); }, [view, focus]);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    try { theme ? localStorage.setItem("kula-theme", theme) : localStorage.removeItem("kula-theme"); } catch {}
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = VIEWS.find((x) => x.key === e.key);
      if (v) setView(v.id);
      if (e.key === "/") { e.preventDefault(); setPalette(true); }
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSymbol = useCallback((id: number) => { setView("graph"); setFocus(id); }, []);
  const reindex = async () => {
    setIndexing(true);
    try { const s: any = await api.reindex(); toast(`Indexed ${s.symbols} symbols in ${s.millis}ms`); onChanged(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setIndexing(false); }
  };

  const openIssues = meta?.issues.filter((i) => i.status === "open").length ?? 0;
  const openPrs = meta?.proposals.filter((p) => p.status === "open").length ?? 0;
  const badge: Partial<Record<View, number>> = { changes, issues: openIssues, proposals: openPrs };
  const nav = { onChanged, openSymbol, version };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><Logo /><span>kula</span><span className="crumb">/</span><span style={{ fontWeight: 500 }}>{repo?.name ?? "…"}</span></div>
        <button className="chip" onClick={() => setView("branches")} title="Current branch"><Icon.branches /><b className="mono">{repo?.branch ?? "…"}</b></button>
        <span className="spacer" />
        <div className="search-trigger" onClick={() => setPalette(true)} role="button" aria-label="Search"><Icon.search /> <span className="st-label">Search symbols, files, commands…</span> <kbd>⌘K</kbd></div>
        <span className="spacer" />
        <span className="chip hide-sm" title={repo?.index === "current" ? "Graph matches HEAD" : "Graph is behind HEAD"}>
          <span className={`dot ${repo?.index === "current" ? "ok" : repo?.index === "stale" ? "warn" : "bad"}`} />
          {repo?.index === "current" ? "graph current" : repo?.index === "stale" ? "graph behind" : "no graph"}
        </span>
        <button className="btn sm" onClick={reindex} disabled={indexing}><Icon.refresh /> {indexing ? "Indexing…" : "Reindex"}</button>
        <button className="btn sm ghost" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === "light" ? "dark" : t === "dark" ? null : "light"))} title={`Theme: ${theme ?? "system"}`}><Icon.sun /></button>
      </header>

      <nav className="rail" aria-label="Views">
        {VIEWS.map((v, i) => (
          <div key={v.id} style={{ display: "contents" }}>
            {(i === 1 || i === 4 || i === 7) && <div className="sep" />}
            <button className={view === v.id ? "on" : ""} onClick={() => setView(v.id)} data-tip={`${v.label}  ${v.key}`} aria-label={v.label}>
              <v.icon />
              {!!badge[v.id] && <span className="badge">{badge[v.id]}</span>}
            </button>
          </div>
        ))}
      </nav>

      <main className="main">
        {view === "graph" && <GraphView focus={focus} setFocus={setFocus} onChanged={onChanged} version={version} theme={theme} />}
        {view === "changes" && <Changes {...nav} />}
        {view === "history" && <History {...nav} />}
        {view === "branches" && <Branches {...nav} />}
        {view === "proposals" && <Proposals {...nav} />}
        {view === "issues" && <Issues {...nav} />}
        {view === "notes" && <Notes {...nav} />}
        {view === "flows" && <Flows {...nav} />}
        {view === "console" && <Console {...nav} />}
      </main>

      <footer className="statusbar">
        <span><Logo /> kula {repo?.version}</span>
        {repo?.stats && <span>{repo.stats.files} files · {repo.stats.symbols} symbols · {repo.stats.edges} edges · {repo.stats.communities} clusters</span>}
        <span className="spacer" />
        <span>{changes ? `${changes} changed` : "clean"}</span>
        <span className="mono">{repo?.head?.slice(0, 8)}</span>
        <span>{repo?.user}</span>
      </footer>

      {palette && <Palette onClose={() => setPalette(false)} onPick={(n) => { setPalette(false); openSymbol(n.id); }}
        onView={(v) => { setPalette(false); setView(v); }} onReindex={() => { setPalette(false); reindex(); }} />}
    </div>
  );
}

function Palette({ onClose, onPick, onView, onReindex }: { onClose: () => void; onPick: (n: Node) => void; onView: (v: View) => void; onReindex: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Node[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => api.search(q).then((h) => { setHits(h); setI(0); }).catch(() => setHits([])), 90);
    return () => clearTimeout(t);
  }, [q]);
  const commands = [
    ...VIEWS.map((v) => ({ label: `Go to ${v.label}`, hint: v.key, run: () => onView(v.id) })),
    { label: "Reindex knowledge graph", hint: "", run: onReindex },
  ].filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const items: { key: string; el: React.ReactNode; run: () => void }[] = [
    ...hits.map((n) => ({ key: `n${n.id}`, run: () => onPick(n), el: <><Kind kind={n.kind} community={n.community} size={18} /><span className="mono">{n.name}</span><span className="p">{n.path}:{n.start_line}</span></> })),
    ...commands.map((c) => ({ key: c.label, run: c.run, el: <><span style={{ width: 16, textAlign: "center", color: "var(--accent)" }}>›</span><span>{c.label}</span><span className="p">{c.hint && <kbd>{c.hint}</kbd>}</span></> })),
  ];
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a symbol or file, or run a command…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter") items[i]?.run();
          }} />
        <div className="results">
          {hits.length > 0 && <div className="grp">Symbols & files</div>}
          {items.map((it, k) => (
            <div key={it.key} className={`res ${k === i ? "on" : ""}`} onMouseEnter={() => setI(k)} onClick={it.run}>
              {k === hits.length && <></>}{it.el}
            </div>
          ))}
          {!items.length && <div className="empty">No matches</div>}
        </div>
        <footer><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></footer>
      </div>
    </div>
  );
}
