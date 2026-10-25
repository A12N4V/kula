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

const KEY = "kula.windows.v1";
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
  }
  if (moved) { save(); emit(); }
}

function defaults(id: string): WinState {
  // First open: a modest window, cascaded a little so stacked opens read as
  // separate windows rather than a stack of identical cards.
  const n = Object.values(wins).filter((w) => w.open).length;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(560, Math.max(360, vw * 0.34));
  const h = Math.min(Math.round(vh * 0.7), 640);
  return { x: Math.round(vw * 0.5 - w * 0.5 + n * 28), y: Math.round(vh * 0.5 - h * 0.4 + n * 24), w, h, z: 0 };
}

export function get(id: string): WinState | undefined {
  return wins[id];
}

/** Open (or focus) a window by stable id. Returns its state. */
export function open(id: string, size?: { w: number; h: number }): WinState {
  let w = wins[id];
  if (!w) {
    w = wins[id] = { ...defaults(id), ...(size ? { w: Math.min(size.w, window.innerWidth - 16), h: size.h } : {}) };
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
