// Desktop windows – every sidebar, editor popup and dialog as a movable,
// resizable, remembered window. Drag by its header, resize from every edge
// and corner, snap to edges, maximise (double-click the header), minimise to
// the small dock, close. Click brings to front. Position, size and state
// persist per stable window id in localStorage (ui/windows.ts) and reopen
// where the user left them, clamped back on screen when the viewport shrinks.
// At ≤ 600px a window is a full-width sheet.
//
// The window keeps `data-pane` (so PaneControls keeps working inside it), so
// existing specs, Esc handling and the full-screen pane styles hold.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";
import * as wins from "./windows";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** The fixed layer every window portals into; created on first use so views
 *  need no wiring – just render <Window …>. */
function layer(): HTMLElement {
  let el = document.getElementById("kula-desktop") as HTMLElement | null;
  if (!el) { el = document.createElement("div"); el.id = "kula-desktop"; document.body.appendChild(el); }
  return el;
}

// small force-update hook over the window store; returns a tick that bumps
// on every store change
function useWins(): number {
  const [n, setN] = useState(0);
  const force = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => { const off = wins.subscribe(force); return () => { off(); }; }, [force]);
  return n;
}

/** One desktop window. `id` is the stable kebab id the store remembers. */
export function Window({ id, title, icon, width, height, onClose, children, testId, footer, className }: {
  id: string; title: string; icon?: ReactNode; width?: number; height?: number;
  onClose: () => void; children: ReactNode; testId?: string; footer?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const forceVersion = useWins();
  const tid = testId ?? id;

  // Esc restores a maximised window first (same contract as the panes); a
  // second Esc reaches the window's own close or the view's handlers.
  useEffect(() => {
    if (!wins.get(id)?.max) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); wins.toggleMax(id); }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [id, forceVersion]);

  // First mount opens the window (with the requested size if the store has
  // none); later mounts reopen it where the user left it.
  useEffect(() => {
    wins.open(id, width != null || height != null ? { w: width ?? 0, h: height ?? 0 } : undefined);
    return () => {}; // state stays; the window reopens on the next visit
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = wins.get(id);
  if (!w || !w.open || w.min) return null; // minimised windows live in the dock
  const style: CSSProperties = w.max
    ? { zIndex: 300 + w.z }
    : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: 300 + w.z };

  const drag = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".pane-ctl, button")) return;
    // no preventDefault and no pointer capture here: cancelling pointerdown
    // suppresses the compatibility mouse events, and capture retargets them
    // to the section – either would kill the header's dblclick. Window
    // listeners move the window instead.
    const s = { x: w.x, y: w.y, w: w.w, h: w.h };
    if (w.max) wins.toggleMax(id);
    const px = e.clientX, py = e.clientY;
    const el = ref.current!;
    document.documentElement.dataset.draggingWin = "";
    const move = (ev: globalThis.PointerEvent) => {
      el.style.left = `${s.x + ev.clientX - px}px`;
      el.style.top = `${s.y + ev.clientY - py}px`;
      const snap = edgeSnap(s.x + ev.clientX - px, s.y + ev.clientY - py, s.w, s.h);
      el.dataset.snap = snap ?? "";
    };
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.draggingWin;
      delete el.dataset.snap;
      wins.settle(id, { x: s.x + ev.clientX - px, y: s.y + ev.clientY - py, w: s.w, h: s.h });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const resize = (dir: Dir) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const s = { x: w.x, y: w.y, w: w.w, h: w.h };
    const px = e.clientX, py = e.clientY;
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    document.documentElement.dataset.resizing = dir.includes("e") || dir.includes("w") ? "x" : "y";
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - px, dy = ev.clientY - py;
      const n = { x: s.x, y: s.y, w: s.w, h: s.h };
      if (dir.includes("e")) n.w = s.w + dx;
      if (dir.includes("s")) n.h = s.h + dy;
      if (dir.includes("w")) { n.w = s.w - dx; n.x = s.x + dx; }
      if (dir.includes("n")) { n.h = s.h - dy; n.y = s.y + dy; }
      wins.settle(id, n);
    };
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.resizing;
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  // Keyboard from the header: arrow keys move, alt+arrows resize the east and
  // south edges (alt+left/up shrink), 16px a step, 64px with shift.
  const key = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const [dx, dy] = d;
    if (e.altKey) {
      const x = dx < 0 ? w.x - step : w.x;
      const y = dy < 0 ? w.y - step : w.y;
      const ww = Math.max(wins.mins.MIN_W, w.w + dx * step);
      const hh = Math.max(wins.mins.MIN_H, w.h + dy * step);
      wins.settle(id, { x: dx < 0 ? w.x - (ww - w.w) : w.x, y: dy < 0 ? w.y - (hh - w.h) : w.y, w: ww, h: hh });
    } else {
      wins.settle(id, { x: w.x + dx * step, y: w.y + dy * step, w: w.w, h: w.h });
    }
  };

  return createPortal(
    <section ref={ref} className={`win${className ? ` ${className}` : ""}`} data-testid={tid} data-pane="true" data-max={w.max ? "" : undefined}
      role="dialog" aria-label={title} style={style} onPointerDown={() => wins.focus(id)}
      onMouseDown={(e) => e.stopPropagation()}>
      <header className="win-head" data-testid={`${tid}-head`} tabIndex={0}
        onPointerDown={drag} onDoubleClick={() => wins.toggleMax(id)} onKeyDown={key}
        title="Drag to move · double-click to maximise · arrow keys move, alt+arrows resize">
        {icon}
        <span className="win-title">{title}</span>
        <span className="spacer" />
        <span className="pane-ctl" data-testid={testId ? `${tid}-ctl` : undefined}>
          <button type="button" className="pane-btn" data-testid={`${tid}-min`} aria-label={`Minimise ${title}`} title="Minimise"
            onClick={(e) => { e.stopPropagation(); wins.minimize(id); }}><Icon.minus /></button>
          <button type="button" className="pane-btn" data-testid={`${tid}-max`} aria-pressed={!!w.max} aria-label={w.max ? "Exit full screen" : "Full screen"} title={w.max ? "Exit full screen  esc" : "Full screen"}
            onClick={(e) => { e.stopPropagation(); wins.toggleMax(id); }}>{w.max ? <Icon.shrink /> : <Icon.expand />}</button>
          <button type="button" className="pane-btn" data-testid={`${tid}-close`} aria-label="Close" title="Close  esc"
            onClick={(e) => { e.stopPropagation(); onClose(); }}><Icon.close /></button>
        </span>
      </header>
      <div className="win-body" data-testid={`${tid}-body`}>{children}</div>
      {footer && <div className="win-foot">{footer}</div>}
      {!w.max && DIRS.map((d) => (
        <div key={d} className={`win-rz win-rz-${d}`} data-testid={`${tid}-rz-${d}`} onPointerDown={resize(d)} />
      ))}
    </section>,
    layer(),
  );
}

/** Which edge a dragged window is over, for the snap preview. */
function edgeSnap(x: number, y: number, w: number, h: number): string | null {
  const E = wins.mins.EDGE, vw = window.innerWidth, vh = window.innerHeight;
  if (y <= E * 0.4) return "top";
  if (x <= E * 0.4) return "left";
  if (x + w >= vw - E * 0.4) return "right";
  if (y + h >= vh - E * 0.4) return "bottom";
  return null;
}

/** The dock of minimised windows – mount once, near the app shell. */
export function WindowDock() {
  useWins();
  const ids = Object.entries(wins.state()).filter(([, w]) => w.open && w.min).map(([id]) => id);
  if (!ids.length) return null;
  return createPortal(
    <div className="win-dock" data-testid="win-dock" role="toolbar" aria-label="Minimised windows">
      {ids.map((id) => (
        <button key={id} type="button" data-testid={`dock-${id}`} title={id} aria-label={`Restore ${id}`}
          onClick={() => wins.focus(id)}><Icon.expand /></button>
      ))}
    </div>,
    layer(),
  );
}
