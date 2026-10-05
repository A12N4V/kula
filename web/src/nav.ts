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
