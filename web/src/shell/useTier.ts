import { useSyncExternalStore } from "react";
import { TIER_LARGE, TIER_MID, tierOf, type Tier } from "./tiers";

const QUERIES = [`(min-width: ${TIER_MID}px)`, `(min-width: ${TIER_LARGE}px)`];

function subscribe(cb: () => void) {
  const lists = QUERIES.map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", cb));
  return () => lists.forEach((l) => l.removeEventListener("change", cb));
}

/** The current layout tier. Re-renders only when a breakpoint is crossed, never on every resize. */
export function useTier(): Tier {
  return useSyncExternalStore(
    subscribe,
    () => tierOf(window.innerWidth),
    () => "large",
  );
}
