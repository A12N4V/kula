// W4 – shared selection for the agents activity: connectors, tree rows, graph
// badges and the inspector all read and write the same state (deck p.9 note 3:
// badge and tree row open the same file and select the same agent).
// Plain pub/sub + useSyncExternalStore, same pattern as map/selection.ts.
import { useSyncExternalStore } from "react";

export interface AgentsUiState {
  /** Selected agent id, or null. */
  agentId: string | null;
  /** Open file path (kula://), or null – drives the split tab beside the graph. */
  openFile: string | null;
  /** Open memory editor for this path instead of a plain file view. */
  memoryOpen: string | null;
  /** Saved-but-not-applied diff shown first (deck p.10 ledger strip). */
  pendingDiff: { path: string; hunks: { line: number; before: string; after: string }[] } | null;
}

let state: AgentsUiState = {
  agentId: "coder-1",
  openFile: null,
  memoryOpen: null,
  pendingDiff: null,
};
const subs = new Set<() => void>();

export function setAgentsUi(patch: Partial<AgentsUiState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getAgentsUi(): AgentsUiState {
  return state;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useAgentsUi(): AgentsUiState {
  return useSyncExternalStore(subscribe, getAgentsUi);
}
