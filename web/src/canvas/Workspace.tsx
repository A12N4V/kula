// One layout for every destination: the canvas fills the top, a bottom pane
// (resizable, collapsible) holds the information for what is selected or on
// the canvas, and selecting a node pops a sidebar in from the right with that
// node's details and actions. On phones the pane is always on (canvas top
// half, information bottom half) and the sidebar slides over as a sheet.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "../ui";

export type PaneTab = { id: string; label: string; icon: () => ReactElement; count?: number; render: () => ReactNode };
export type Side = { title: ReactNode; sub?: ReactNode; icon?: ReactNode; body: ReactNode; actions?: ReactNode; onClose: () => void } | null;

const phone = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
const read = (k: string, d: number) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

export default function Workspace({ id, canvas, tabs, tab, onTab, side, paneTall, testid }: {
  id: string; canvas: ReactNode; tabs: PaneTab[]; tab: string; onTab: (t: string) => void; side: Side;
  /** Open the pane taller (a list or table view was asked for directly). */
  paneTall?: boolean; testid?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [frac, setFrac] = useState(() => (paneTall ? 0.62 : read(`kula.pane.${id}`, 0.42)));
  // Phones keep the pane on by default; desktop remembers whether you closed it.
  const [open, setOpen] = useState(() => { try { return phone() || localStorage.getItem(`kula.pane.${id}.open`) !== "0"; } catch { return true; } });
  useEffect(() => { if (paneTall) { setFrac((f) => Math.max(f, 0.62)); setOpen(true); } }, [paneTall, tab]);
  const toggle = () => setOpen((o) => { write(`kula.pane.${id}.open`, o ? "0" : "1"); return !o; });
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];

  const grip = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = host.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const mv = (ev: PointerEvent) => setFrac(Math.max(0.16, Math.min(0.84, (r.bottom - ev.clientY) / r.height)));
    const done = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", done); setFrac((f) => { write(`kula.pane.${id}`, String(f)); return f; }); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", done);
  };

  return (
    <div className={`ws ${open ? "pane-open" : "pane-closed"} ${side ? "side-open" : ""}`} ref={host} data-testid={testid ?? `ws-${id}`}
      style={{ ["--pane" as string]: `${Math.round(frac * 1000) / 10}%` }}>
      <div className="ws-canvas">
        {canvas}
        <aside className={`ws-side ${side ? "in" : ""}`} aria-label="Selection" aria-hidden={!side} data-testid="ws-side">
          {side && <>
            <header className="ws-side-head">
              {side.icon && <span className="ws-side-ico">{side.icon}</span>}
              <div className="grow"><h2>{side.title}</h2>{side.sub && <div className="sub">{side.sub}</div>}</div>
              <button className="btn sm ghost icon-only" aria-label="Close details" data-tip="Close  esc" data-tip-place="left" onClick={side.onClose}><Icon.close /></button>
            </header>
            <div className="ws-side-body">{side.body}</div>
            {side.actions && <footer className="ws-side-foot">{side.actions}</footer>}
          </>}
        </aside>
      </div>
      <section className="ws-pane" aria-label={`${cur?.label ?? ""} pane`} data-testid="ws-pane">
        <div className="ws-grip" onPointerDown={grip} onDoubleClick={() => { setFrac(0.42); write(`kula.pane.${id}`, "0.42"); }} role="separator" aria-orientation="horizontal" aria-label="Resize pane" />
        <header className="ws-pane-head">
          <div className="ws-tabs" role="group" aria-label="Pane views">
            {tabs.map((t) => (
              <button key={t.id} className={`ws-tab ${cur?.id === t.id ? "on" : ""}`} aria-pressed={cur?.id === t.id} data-pane={t.id} data-tip={t.label}
                onClick={() => { onTab(t.id); if (!open) toggle(); }}>
                <t.icon /><span className="ws-tab-l">{t.label}</span>{!!t.count && <span className="ws-count tnum">{t.count}</span>}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button className="btn sm ghost icon-only ws-collapse" aria-label={open ? "Collapse pane" : "Expand pane"} aria-expanded={open} data-tip={open ? "Collapse" : "Expand"} data-tip-place="left" onClick={toggle}>
            {open ? <Icon.down /> : <Icon.up />}
          </button>
        </header>
        {open && <div className="ws-pane-body" key={cur?.id}>{cur?.render()}</div>}
      </section>
    </div>
  );
}
