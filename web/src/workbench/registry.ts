// W1 – the workbench activity registry.
//
// Later modules (W2 map, W3 ledger, W4 git) add an activity by calling
// `WorkbenchRegistry.register({...})` in their own module file – the shell
// never needs to be touched. Registered entries are rendered by
// `Workbench.tsx` in the activity bar, explorer column, inspector column and
// the center tab strip.
//
// The contract is frozen for W2–W4. Shape changes go through the manager.

import type { ComponentType } from "react";

/** A bottom-panel slot contribution. W3 registers the Ledger this way. */
export interface BottomPanelTab {
  /** Stable id, e.g. "ledger". Also the DOM test id suffix. */
  id: string;
  label: string;
  component: ComponentType;
  /** Render order hint; tabs sort by (order, id). Default 100. */
  order?: number;
}

/** One tab in the center column owned by an activity. */
export interface ActivityTab {
  /** Stable id, e.g. "map-graph". */
  id: string;
  label: string;
  component: ComponentType;
}

export interface Activity {
  /** Stable id: "map" | "runs" | "agents" | "fences" | "git". Also test id prefix. */
  id: string;
  /** Short label used in tooltips and the ⌘K palette. */
  label: string;
  /** lucide-react icon component. */
  icon: ComponentType<{ size?: number | string; className?: string }>;
  /** Left column content for this activity. Shown only when active. */
  Explorer: ComponentType;
  /** Right column content for this activity. Shown only when active. */
  Inspector: ComponentType;
  /** Center-column tabs owned by this activity. */
  tabs: ActivityTab[];
  /** Optional bottom-panel tabs contributed by this activity. */
  panelTabs?: BottomPanelTab[];
}

class Registry {
  private entries = new Map<string, Activity>();

  register(activity: Activity): () => void {
    if (this.entries.has(activity.id)) {
      throw new Error(`WorkbenchRegistry: duplicate activity id "${activity.id}"`);
    }
    this.entries.set(activity.id, activity);
    return () => this.entries.delete(activity.id);
  }

  get(id: string): Activity | undefined {
    return this.entries.get(id);
  }

  list(): Activity[] {
    return [...this.entries.values()];
  }
}

export const WorkbenchRegistry = new Registry();
