// Overlays: per-station numbers every variant reads. Four overlays, all
// optional at draw time: fences (lock or review on a station), live (heat
// where agents are working now), churn (recent commits per file), owners
// (the seat whose scope covers a file). Nothing here draws; the variants do.

import type { AgentsInfo, Commit, GraphData, GuardRule, KulaEvent, Member } from "../../api";
import type { MapModel } from "./model";

export interface OverlayState {
  /** station id → the fence level that falls on it. */
  fences: Record<string, "locked" | "review">;
  /** station id → live heat, Σ e^(−Δt / 60 s) over recent events. */
  live: Record<string, number>;
  /** station id → churn count of its hottest file. */
  churn: Record<string, number>;
  /** station id → seat name whose scope covers its file. */
  owners: Record<string, string>;
}

/** Events older than this cannot contribute heat. */
const HEAT_WINDOW_MS = 10 * 60_000;

const fenceFor = (rules: GuardRule[], path: string, name: string): "locked" | "review" | undefined => {
  let hit: "locked" | "review" | undefined;
  for (const r of rules) {
    if (r.level !== "locked" && r.level !== "review") continue;
    const sym = r.symbols.includes(name) || r.symbols.some((s) => s.endsWith(`:${name}`));
    const p = r.paths.some((pp) => path === pp || path.startsWith(pp.endsWith("/") ? pp : `${pp}/`));
    if (sym || p) {
      // locked beats review when both fall on a station.
      if (r.level === "locked") return "locked";
      hit = "review";
    }
  }
  return hit;
};

const ownerFor = (info: AgentsInfo | null, path: string): string | undefined => {
  if (!info) return undefined;
  for (const t of info.teams) {
    for (const m of t.members) {
      if (!(m as Member & { scope?: string[] }).scope?.length) continue;
      const scope = (m as Member & { scope?: string[] }).scope ?? [];
      if (scope.some((sp: string) => path === sp || path.startsWith(sp.endsWith("/") ? sp : `${sp}/`))) {
        return m.name ? `${t.name}/${m.name}` : t.name;
      }
    }
  }
  return undefined;
};

/**
 * Build the overlay state. `now` anchors live heat (pass Date.now()); churn
 * comes from the graph's own per-path churn counts; `events` may be empty.
 */
export function buildOverlays(
  model: MapModel,
  opts: { events?: KulaEvent[]; now?: number; graph?: GraphData | null; info?: AgentsInfo | null } = {},
): OverlayState {
  const { events = [], now = 0, graph, info } = opts;
  const rules = info?.rules ?? [];
  const fences: Record<string, "locked" | "review"> = {};
  const live: Record<string, number> = {};
  const churn: Record<string, number> = {};
  const owners: Record<string, string> = {};

  // Path → heat, from the freshest events only (the window is capped, the
  // event list itself is already capped upstream at 500).
  const heat = new Map<string, number>();
  for (const e of events) {
    if (!e.path) continue;
    const age = now - e.ts;
    if (age < 0 || age > HEAT_WINDOW_MS) continue;
    heat.set(e.path, (heat.get(e.path) ?? 0) + Math.exp(-age / 60_000));
  }

  const churnByPath = graph?.churn ?? {};
  for (const st of model.stations) {
    const f = fenceFor(rules, st.path, st.name);
    if (f) fences[st.id] = f;
    const h = Math.max(0, ...st.files.map((p) => heat.get(p) ?? 0));
    if (h > 0) live[st.id] = h;
    const c = Math.max(0, ...st.files.map((p) => churnByPath[p] ?? 0));
    if (c > 0) churn[st.id] = c;
    const o = ownerFor(info ?? null, st.path);
    if (o) owners[st.id] = o;
  }
  return { fences, live, churn, owners };
}

/** The six task drawer needs at least one event to seed "where is an agent working". */
export const FIXTURE_EVENTS: KulaEvent[] = [
  { seq: 1, ts: 0, kind: "verdict", agent: "agent:claude", path: "web/src/views/map/model.ts", verdict: "passed" },
  { seq: 2, ts: 0, kind: "handoff", agent: "agent:claude", from: "m0", path: "web/src/views/map/Map.tsx" },
];

/** Heat at a moment against a fresh event list – used by the test drawer seed too. */
export function seedLive(model: MapModel, events: KulaEvent[], now: number): Record<string, number> {
  return buildOverlays(model, { events: events.map((e) => ({ ...e, ts: now - 30_000 })), now }).live;
}

export type { Commit };
