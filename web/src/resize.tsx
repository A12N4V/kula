// Hand-sized panels – one mechanism for every panel that pops open. Each
// carries a Grip on its free edge and PaneControls (full screen · close) in
// its top-right corner. Hand-sized panels. Every pane edge carries a grip; the size it sets is a CSS
// variable on <html> (`--size-<id>`), so rules that depend on a panel – the
// canvas inset beside the contrast panel, the zoom stack beside the inspector –
// follow it without any wiring. Sizes persist per browser; double-click resets.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

const KEY = "kula.sizes.v1";
let sizes: Record<string, number> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; }
})();

function apply(id: string, v: number | null) {
  const st = document.documentElement.style;
  if (v == null) st.removeProperty(`--size-${id}`); else st.setProperty(`--size-${id}`, `${Math.round(v)}px`);
}
for (const [k, v] of Object.entries(sizes)) apply(k, v);

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* private window */ }
}

/** Forget every hand-set panel size. */
export function resetSizes() {
  for (const k of Object.keys(sizes)) apply(k, null);
  sizes = {};
  save();
}

export const hasCustomSizes = () => Object.keys(sizes).length > 0;

type Edge = "left" | "right" | "top" | "bottom";

/**
 * A drag handle on one edge of a panel. `target` is the element being sized:
 * the grip's parent (default) or its previous sibling (for grid splits, where
 * the grip sits between the two tracks).
 */
export function Grip({ id, edge, min, max, target = "parent", label }: {
  id: string; edge: Edge; min: number; max: number; target?: "parent" | "prev"; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = edge === "left" || edge === "right";
  // Which pointer direction grows the panel: a grip on the right edge grows rightwards.
  const sign = edge === "right" || edge === "bottom" ? 1 : -1;
  const el = () => (target === "prev" ? ref.current!.previousElementSibling : ref.current!.parentElement) as HTMLElement;
  const measure = () => { const r = el().getBoundingClientRect(); return x ? r.width : r.height; };
  const set = (v: number) => {
    // Never let a panel eat the window: leave at least 160px of everything else.
    const room = (x ? window.innerWidth : window.innerHeight) - 160;
    sizes[id] = Math.max(min, Math.min(max, room, v));
    apply(id, sizes[id]);
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const g = ref.current!;
    const start = measure(), p0 = x ? e.clientX : e.clientY;
    g.setPointerCapture(e.pointerId);
    document.documentElement.dataset.resizing = x ? "x" : "y";
    const move = (ev: globalThis.PointerEvent) => set(start + sign * ((x ? ev.clientX : ev.clientY) - p0));
    const up = () => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
      g.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.resizing;
      save();
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
    g.addEventListener("pointercancel", up);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = x ? { ArrowRight: 1, ArrowLeft: -1 }[e.key] : { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!grow) return;
    e.preventDefault();
    set(measure() + grow * sign * (e.shiftKey ? 64 : 16));
    save();
  };

  const reset = () => { delete sizes[id]; apply(id, null); save(); };

  return (
    <div ref={ref} className={`grip grip-${edge}`} role="separator" tabIndex={0}
      aria-orientation={x ? "vertical" : "horizontal"} aria-label={label ?? "Resize"}
      title="Drag to resize · double-click to reset"
      onPointerDown={down} onDoubleClick={reset} onKeyDown={key} />
  );
}

/** Style for a `.split` whose list column is hand-sized under `id`. */
export const listWidth = (id: string, def: number) => ({ ["--list-w" as string]: `var(--size-${id}, ${def}px)` }) as CSSProperties;

/**
 * The two buttons every popped panel carries in its top-right corner: full
 * screen (the panel takes the window over everything, Esc or the button
 * restores it) and close. The panel is the nearest `[data-pane]` ancestor;
 * the state is an attribute on it, so the CSS does the rest
 * (`[data-pane][data-max]` in base.css) and no panel needs extra wiring.
 */
export function PaneControls({ onClose, closeLabel = "Close", closeTitle = "Close  esc", testId }: {
  onClose?: () => void; closeLabel?: string; closeTitle?: string; testId?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [max, setMax] = useState(false);
  const pane = () => ref.current?.closest("[data-pane]") as HTMLElement | null;
  useEffect(() => {
    const el = pane();
    if (!el) return;
    if (max) el.dataset.max = ""; else delete el.dataset.max;
    if (!max) return;
    // Esc restores first; a second Esc reaches the panel's own close.
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); setMax(false); } };
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("keydown", esc, true); delete el.dataset.max; };
  }, [max]);
  // Every pane also takes a height: a grip along its bottom edge sets it,
  // kept per pane like the widths (double-click returns to the content height).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(pane()); }, []);
  return (
    <span className="pane-ctl" ref={ref} data-testid={testId ? `${testId}-ctl` : "pane-ctl"}>
      <button type="button" className="pane-btn" data-testid={testId ? `${testId}-max` : "pane-max"} aria-pressed={max}
        aria-label={max ? "Exit full screen" : "Full screen"} title={max ? "Exit full screen  esc" : "Full screen"}
        onClick={(e) => { e.stopPropagation(); setMax((m) => !m); }}>
        {max ? <Icon.shrink /> : <Icon.expand />}
      </button>
      {onClose && (
        <button type="button" className="pane-btn" data-testid={testId ? `${testId}-close` : "pane-close"} aria-label={closeLabel} title={closeTitle}
          onClick={(e) => { e.stopPropagation(); setMax(false); onClose(); }}>
          <Icon.close />
        </button>
      )}
      {host && testId && createPortal(<HeightGrip pane={host} id={`h-${testId}`} />, host)}
    </span>
  );
}

/** The bottom-edge grip a pane carries for its height. The height lands as
 *  an inline style on the pane (heights depend on where a panel sits, so no
 *  shared CSS variable fits); it persists with the other sizes. */
function HeightGrip({ pane, id }: { pane: HTMLElement; id: string }) {
  useEffect(() => {
    const h = sizes[id];
    if (h) { pane.style.height = `${h}px`; pane.style.maxHeight = "none"; }
  }, [pane, id]);
  const set = (v: number) => {
    const top = pane.getBoundingClientRect().top;
    sizes[id] = Math.max(120, Math.min(window.innerHeight - top - 8, v));
    pane.style.height = `${Math.round(sizes[id])}px`;
    pane.style.maxHeight = "none";
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const g = e.currentTarget, start = pane.getBoundingClientRect().height, y0 = e.clientY;
    g.setPointerCapture(e.pointerId);
    document.documentElement.dataset.resizing = "y";
    const move = (ev: globalThis.PointerEvent) => set(start + ev.clientY - y0);
    const up = () => {
      g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
      delete document.documentElement.dataset.resizing;
      save();
    };
    g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = ({ ArrowDown: 1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!grow) return;
    e.preventDefault();
    set(pane.getBoundingClientRect().height + grow * (e.shiftKey ? 64 : 16));
    save();
  };
  const reset = () => { delete sizes[id]; pane.style.height = ""; pane.style.maxHeight = ""; save(); };
  return (
    <div className="grip grip-bottom pane-hgrip" role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Resize height"
      title="Drag to resize height · double-click to reset" data-testid={`${id}-grip`}
      onPointerDown={down} onDoubleClick={reset} onKeyDown={key} />
  );
}
