// Cross-view navigation: any view can send the user somewhere specific.

export type View = "overview" | "map" | "graph" | "git" | "changes" | "history" | "branches" | "proposals" | "issues" | "notes" | "flows" | "agents" | "query" | "impact" | "slice" | "console" | "extensions";

export interface Target {
  issue?: number;
  proposal?: number;
  sha?: string;
  symbol?: number;
  /** Selectors to cut out on the Slice mode of Graph. */
  slice?: string;
  /** Search the map and focus the best hit (e.g. a file path from Hotspots). */
  search?: string;
  /** Open the graph in contrast mode between two revisions. */
  contrast?: { base: string; head: string; mode?: ContrastMode };
  /** Open the graph with the fences overlay: "" for what is in force now, or a workflow to preview. */
  fences?: string;
  /** A tab inside a view (Agents: workflows, fences, memory, docs, connect). */
}
/** Contrast shows two revisions overlaid, side by side, or as a textual report. */
export type ContrastMode = "overlay" | "split" | "report";

/** Changes, History and Branches merged into the Git board; the old ids still route there. */
export const canonView = (v: View): View => (v === "changes" || v === "history" || v === "branches" ? "git" : v === "impact" ? "graph" : v);

export type Go = (view: View, target?: Target) => void;

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
