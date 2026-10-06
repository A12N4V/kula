// Hand-sized panels. Every pane edge carries a grip; the size it sets is a CSS
// variable on <html> (`--size-<id>`), so rules that depend on a panel – the
// canvas inset beside the contrast panel, the zoom stack beside the inspector –
// follow it without any wiring. Sizes persist per browser; double-click resets.

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

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
