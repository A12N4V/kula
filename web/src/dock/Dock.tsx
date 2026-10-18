// The bottom dock: the console and the run log in one resizable pane under
// every view (VS Code's panel, n8n's logs). ctrl+` toggles it, the status bar
// has a button, and a run opens it on the log.

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearLog, logLines, onLog, registerDock, type DockTab } from "./bus";
import { Icon } from "../ui";
import type { Go, Target } from "../nav";
type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

const Console = lazy(() => import("../views/GitViews").then((m) => ({ default: m.Console })));

const H_KEY = "kula.dock.h";
const readH = () => { try { return Number(localStorage.getItem(H_KEY)) || 280; } catch { return 280; } };

export function Dock({ open, setOpen, tab, setTab, nav }: { open: boolean; setOpen: (o: boolean) => void; tab: DockTab; setTab: (t: DockTab) => void; nav: Nav }) {
  const [h, setH] = useState(readH);
  const drag = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => registerDock((t) => { setTab(t); setOpen(true); }), [setOpen, setTab]);
  useEffect(() => { try { localStorage.setItem(H_KEY, String(h)); } catch { /* private */ } }, [h]);
  // Views are absolutely positioned in .main; they end where the dock starts.
  useEffect(() => { document.documentElement.style.setProperty("--dock-h", `${open ? h : 30}px`); }, [open, h]);
  const n = useSyncExternalStore(onLog, () => logLines().length);

  return (
    <section className={`dock${open ? " open" : ""}`} style={{ height: open ? h : 30 }} data-testid="dock" aria-label="Bottom panel">
      {open && <div className="dock-grip" role="separator" aria-orientation="horizontal" aria-label="Resize panel"
        onPointerDown={(e) => { drag.current = { y: e.clientY, h }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setH(Math.max(120, Math.min(window.innerHeight * 0.8, drag.current.h + drag.current.y - e.clientY))); }}
        onPointerUp={() => { drag.current = null; }} />}
      <div className="dock-bar" role="tablist" aria-label="Panel">
        {(["terminal", "run"] as DockTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={open && tab === t} data-testid={`dock-tab-${t}`} className={`dock-tab${open && tab === t ? " on" : ""}`}
            onClick={() => { if (open && tab === t) setOpen(false); else { setTab(t); setOpen(true); } }}>
            {t === "terminal" ? <><Icon.console />Terminal</> : <><Icon.flows />Run log{n > 0 && <span className="dock-n">{n}</span>}</>}
          </button>
        ))}
        <span className="spacer" />
        {open && tab === "run" && <button className="dock-btn" onClick={clearLog}>clear</button>}
        <button className="dock-btn" data-testid="dock-toggle" aria-expanded={open} title="Toggle panel  ctrl+`" onClick={() => setOpen(!open)}>
          <span className={`ws-chev${open ? "" : " up"}`}><Icon.chevron /></span>
        </button>
      </div>
      {open && <div className="dock-body">
        {tab === "terminal" ? <Suspense fallback={<div className="view-loading">loading…</div>}><Console {...nav} compact /></Suspense> : <RunLog />}
      </div>}
    </section>
  );
}

function RunLog() {
  const lines = useSyncExternalStore(onLog, () => logLines().length) && logLines();
  const end = useRef<HTMLDivElement>(null);
  const all = lines || logLines();
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [all.length]);
  if (!all.length) return <div className="dock-empty" data-testid="dock-run-empty">No run yet. Add blocks to the map and press <b>Run</b> – every step, gate output and fence edit streams here.</div>;
  return (
    <div className="dock-log" data-testid="dock-log">
      {all.map((l, i) => (
        <div key={i} className={`dl dl-${l.level ?? "info"}`}>
          <span className="dl-t">{new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>
          <span className="dl-src">{l.src}</span>
          <span className="dl-x">{l.text}</span>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
