// The run log: one stream every view can write to and the bottom dock reads.
// Plain module state with subscribers – no provider, so the map's runner and
// the dock never need a shared parent.

export type LogLine = { t: number; src: string; text: string; level?: "info" | "ok" | "err" | "warn" };

const lines: LogLine[] = [];
const subs = new Set<() => void>();
let wantOpen: ((tab: DockTab) => void) | null = null;

export type DockTab = "terminal" | "run";

export function log(src: string, text: string, level: LogLine["level"] = "info") {
  for (const part of text.split("\n")) if (part.trim()) lines.push({ t: Date.now(), src, text: part, level });
  if (lines.length > 2000) lines.splice(0, lines.length - 2000);
  subs.forEach((f) => f());
}
export function logLines(): readonly LogLine[] { return lines; }
export function clearLog() { lines.length = 0; subs.forEach((f) => f()); }
export function onLog(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

/** Ask the dock to open on a tab (the runner does this when a run starts). */
export function openDock(tab: DockTab) { wantOpen?.(tab); }
export function registerDock(f: (tab: DockTab) => void) { wantOpen = f; return () => { if (wantOpen === f) wantOpen = null; }; }
