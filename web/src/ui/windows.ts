// The desktop window store – one place that knows every open window, its
// geometry and its z order. State persists per stable window id in
// localStorage ("kula.windows.v1"), so a window reopens where the user left
// it; geometry is clamped back on screen whenever the viewport shrinks.
// Window ids are stable kebab strings (code-panel, settings,
// agent-sidebar-<name> …) – see the fuse5 plan.

export type WinState = {
  x: number; y: number; w: number; h: number;
  z: number;
  min?: boolean; max?: boolean;
  open?: boolean;
};

const KEY = "kula.windows.v2"; // v2: windows open docked right, not centred
const MIN_W = 280, MIN_H = 160, EDGE = 24; // snap distance, in px

let wins: Record<string, WinState> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; }
})();
let topZ = 1;
for (const w of Object.values(wins)) if (w.open && w.z > topZ) topZ = w.z;

const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(wins)); } catch { /* private window */ }
}

const clampX = (w: WinState) => Math.max(0, Math.min(window.innerWidth - w.w, w.x));
const clampY = (w: WinState) => Math.max(0, Math.min(window.innerHeight - w.h, w.y));

/** Bring every saved window back inside the viewport (resize, rotation). */
export function clampAll() {
  let moved = false;
  for (const w of Object.values(wins)) {
    if (!w.open || w.max) continue;
    const x = clampX(w), y = clampY(w);
    if (x !== w.x || y !== w.y) { w.x = x; w.y = y; moved = true; }
    if (w.w > window.innerWidth - 16) { w.w = window.innerWidth - 16; moved = true; }
    if (w.h > window.innerHeight - 16) { w.h = window.innerHeight - 16; moved = true; }
  }
  if (moved) { save(); emit(); }
}

// The shell's top bar and status bar heights, and the gap kept to the edge.
const TOP = 52, BOTTOM = 36;

function defaults(id: string): WinState {
  // First open: a tall panel against the right edge, below the top bar and
  // above the status bar, so the canvas in the middle stays in play. Stacked
  // opens step left and down a little so they read as separate windows.
  const n = Object.values(wins).filter((w) => w.open).length;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(520, Math.max(340, Math.round(vw * 0.32)));
  const h = Math.max(320, vh - TOP - BOTTOM);
  return { x: Math.max(0, vw - w - 8 - n * 28), y: TOP + n * 24, w, h: h - n * 24, z: 0 };
}

export function get(id: string): WinState | undefined {
  return wins[id];
}

// Which window components are currently mounted. A window the user closed
// unmounts its view; the dock must never list – or try to restore – a window
// whose component is gone, so the dock reads this set, not the store.
const mounted = new Set<string>();

/** A Window component mounted – the dock may now list it. */
export function mount(id: string) { mounted.add(id); emit(); }

/** A Window component unmounted – drop it from the dock's view. */
export function unmount(id: string) {
  mounted.delete(id);
  // A real close unmounts the view without the store knowing; reconcile so
  // no ghost open state (and no reopen on the next visit) is left behind.
  const w = wins[id];
  if (w?.open) close(id);
  emit();
}

export function isMounted(id: string): boolean {
  return mounted.has(id);
}

// How a dock button reopens a window whose component is not mounted (after a
// reload, say): the view registers a restore callback and the dock calls it
// after clearing the minimised flag. Windows with no handler and no mounted
// component are never listed – a dock button must always do something.
const restore = new Map<string, () => void>();

/** Register how the dock reopens this window when its component is away. */
export function onRestore(id: string, fn: () => void) {
  restore.set(id, fn);
  emit();
  return () => { restore.delete(id); emit(); };
}

export function restoreFn(id: string): (() => void) | undefined {
  return restore.get(id);
}

/** Open (or focus) a window by stable id. Returns its state. */
export function open(id: string, size?: { w: number; h: number }): WinState {
  let w = wins[id];
  const n = Object.values(wins).filter((x) => x.open).length;
  if (!w) {
    w = wins[id] = { ...defaults(id), ...(size ? { w: Math.min(size.w, window.innerWidth - 16), h: size.h } : {}) };
    if (size) {
      // the requested size can differ from the default one the cascade was
      // computed for – re-centre so a wide window never opens off-screen
      const vw = window.innerWidth, vh = window.innerHeight;
      w.x = Math.max(0, vw - w.w - 8 - n * 28);
      w.y = Math.max(0, Math.min(vh - w.h, TOP + n * 24));
    }
  }
  w.open = true;
  if (w.min) w.min = false;
  topZ += 1; w.z = topZ;
  save(); emit();
  return w;
}

export function close(id: string) {
  const w = wins[id];
  if (!w) return;
  w.open = false;
  if (w.max) w.max = false;
  save(); emit();
}

export function focus(id: string) {
  const w = wins[id];
  if (!w || !w.open) return;
  if (w.min) w.min = false;
  if (w.z !== topZ) { topZ += 1; w.z = topZ; save(); emit(); }
}

export function minimize(id: string) {
  const w = wins[id];
  if (!w) return;
  w.min = true; w.max = false;
  save(); emit();
}

export function toggleMax(id: string) {
  const w = wins[id];
  if (!w) return;
  w.max = !w.max;
  if (w.max) w.min = false;
  save(); emit();
}

/** A move or resize landed – snap to viewport edges and halves, keep on screen. */
export function settle(id: string, s: { x: number; y: number; w: number; h: number }) {
  const w = wins[id]; if (!w) return;
  let { x, y, w: ww, h: hh } = s;
  const vw = window.innerWidth, vh = window.innerHeight;
  ww = Math.max(MIN_W, Math.min(ww, vw - 16)); hh = Math.max(MIN_H, Math.min(hh, vh - 16));
  // Fully on screen: the flush edges are the snap positions.
  x = Math.max(0, Math.min(vw - ww, x));
  y = Math.max(0, Math.min(vh - hh, y));
  if (x < EDGE && x > -EDGE * 0.5) x = 0;
  if (x + ww > vw - EDGE && x + ww < vw + EDGE * 0.5) x = vw - ww;
  if (y < EDGE) y = 0;
  if (y + hh > vh - EDGE && y + hh < vh + EDGE * 0.5) y = vh - hh;
  w.x = Math.round(x); w.y = Math.round(y); w.w = Math.round(ww); w.h = Math.round(hh);
  save(); emit();
}

export function state() {
  return wins;
}

/** Subscribe to the store. Pass a selector-free listener – windows are few. */
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Ids of open windows, front last. */
export function openIds(): string[] {
  return Object.entries(wins).filter(([, w]) => w.open)
    .sort((a, b) => a[1].z - b[1].z).map(([id]) => id);
}

export const mins = { MIN_W, MIN_H, EDGE };

if (typeof window !== "undefined") {
  window.addEventListener("resize", clampAll);
}
