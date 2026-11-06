// W2 – shared selection store for the map: explorer, wheel, subway and
// inspector all read and write the same selection (brief: shared selection
// between explorer, wheel and inspector). Plain pub/sub + useSyncExternalStore.
import { useSyncExternalStore } from "react";

export interface MapUiState {
  block: string | null;
  thread: string | null;
  overlay: "stages" | "owners" | "fences" | "spend" | "churn";
  subwayOpen: boolean;
}

let state: MapUiState = { block: null, thread: null, overlay: "stages", subwayOpen: false };
const subs = new Set<() => void>();

export function setMapUi(patch: Partial<MapUiState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getMapUi(): MapUiState {
  return state;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useMapUi(): MapUiState {
  return useSyncExternalStore(subscribe, getMapUi);
}
