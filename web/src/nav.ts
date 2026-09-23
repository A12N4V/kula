// Cross-view navigation: any view can send the user somewhere specific.

export type View = "overview" | "graph" | "changes" | "history" | "branches" | "proposals" | "issues" | "notes" | "flows" | "console";

export interface Target {
  issue?: number;
  proposal?: number;
  sha?: string;
  symbol?: number;
  /** Search the map and focus the best hit (e.g. a file path from Hotspots). */
  search?: string;
  /** Open the graph in contrast mode between two revisions. */
  contrast?: { base: string; head: string };
}

export type Go = (view: View, target?: Target) => void;
