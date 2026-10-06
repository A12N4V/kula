// Cross-view navigation: any view can send the user somewhere specific.

export type View = "overview" | "graph" | "changes" | "history" | "branches" | "proposals" | "issues" | "notes" | "flows" | "agents" | "query" | "console";

export interface Target {
  issue?: number;
  proposal?: number;
  sha?: string;
  symbol?: number;
  /** Search the map and focus the best hit (e.g. a file path from Hotspots). */
  search?: string;
  /** Open the graph in contrast mode between two revisions. */
  contrast?: { base: string; head: string; mode?: ContrastMode };
  /** Open the graph with the fences overlay: "" for what is in force now, or a workflow to preview. */
  fences?: string;
  /** A tab inside a view (Agents: workflows, fences, memory, docs, connect). */
  tab?: string;
}
/** Contrast shows two revisions overlaid, side by side, or as a textual report. */
export type ContrastMode = "overlay" | "split" | "report";

export type Go = (view: View, target?: Target) => void;

// – Shortcut registry –
// The one place shortcuts are named, so the ? sheet, the palette footer and the
// e2e suite all read the same list and cannot drift from what the shell does.

export interface Shortcut { keys: string; label: string }

/** Active in every view; each one is proven working by an e2e test (N1.2). */
export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: "⌘K /", label: "Command palette – symbols, #issues, @branches, >commands" },
  { keys: "1 – 9 0 a q", label: "Go to a view (the rail shows which key)" },
  { keys: "?", label: "This sheet" },
  { keys: ",", label: "Settings" },
  { keys: "⌥← ⌥→", label: "Back / forward through views" },
  { keys: "esc", label: "Close palette, sheet, settings or selection" },
];

/** Shortcuts that belong to a view or an in-place editor. */
export const CONTEXT_SHORTCUTS: Shortcut[] = [
  { keys: "f", label: "Graph: show the fences in force" },
  { keys: "[  ]", label: "Inspector: back / forward through inspected symbols" },
  { keys: "⇧ click", label: "Graph: trace the path from the selected symbol" },
  { keys: "right-click", label: "Graph: actions for a symbol" },
  { keys: "[[", label: "Notes and memories: link a symbol (autofill)" },
  { keys: "tab", label: "Accept the autofill" },
  { keys: "⌘↵", label: "Commit (Changes) · save (Notes) · run (Query)" },
  { keys: "↑ ↓", label: "Command history (Console)" },
];

/** Subsequence match with a bonus for runs and for hits after a word break. −1 means no match. */
export function fuzzyScore(q: string, t: string): number {
  if (!q) return 0;
  const lt = t.toLowerCase();
  let ti = 0, score = 0, streak = 0;
  for (const ch of q.toLowerCase()) {
    const idx = lt.indexOf(ch, ti);
    if (idx < 0) return -1;
    streak = idx === ti ? streak + 1 : 0;
    score += 10 + streak * 6 + (idx === 0 || /[^a-z0-9]/.test(lt[idx - 1] ?? " ") ? 8 : 0);
    ti = idx + 1;
  }
  return score;
}
