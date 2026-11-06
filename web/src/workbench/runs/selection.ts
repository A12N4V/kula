// W3 – shared selection store for runs: explorer, lanes and ledger all read
// and write the same selection. Plain pub/sub + useSyncExternalStore, same
// pattern as map/selection.ts (one store concept per guidance-w3). One-way
// reads of the map store for the wheel → ledger filter happen in the views,
// never by writing to map/selection.ts.
import { useSyncExternalStore } from "react";
import type { LaneKind, Verdict } from "@/workbench/mock/runs";

export interface RunsUiState {
  /** Selected run (mock run id). */
  runId: number | null;
  /** Ledger filter: agent from the lane bar or the explorer agent list. */
  agentId: string | null;
  /** Ledger filter: lane bar kind (working / waiting / blocked). */
  laneKind: LaneKind | null;
  /** Ledger filter: time window start/end in minutes from run start. */
  window: { start: number; end: number } | null;
  /** Ledger filter: verdict from the inspector counts. */
  verdict: Verdict | null;
  /** Ledger filter: wheel sector (touched block), mirrored one-way from the map store. */
  blockId: string | null;
}

let state: RunsUiState = {
  runId: 42,
  agentId: null,
  laneKind: null,
  window: null,
  verdict: null,
  blockId: null,
};
const subs = new Set<() => void>();

export function setRunsUi(patch: Partial<RunsUiState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getRunsUi(): RunsUiState {
  return state;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useRunsUi(): RunsUiState {
  return useSyncExternalStore(subscribe, getRunsUi);
}

/** Clear all ledger filters, keep the selected run. */
export function clearRunsFilters() {
  setRunsUi({ agentId: null, laneKind: null, window: null, verdict: null, blockId: null });
}
