// Module registry – the single list of everything the shell can host.
// Views register here, never in App.tsx; the rail, the keyboard handler and
// the prefetcher all read this list so they cannot drift from what exists.
// Later waves add right/bottom/widget slots without touching this shape.

import type { ComponentType, ReactElement } from "react";
import type { View } from "../nav";
import { Icon } from "../ui";

/** Where a module renders. Wave 1 uses centre only; the others are reserved. */
export type Slot = "centre" | "right" | "bottom" | "widget";

/** Rail section a module is listed under – one icon in the rail per group. */
export type Group = "overview" | "map" | "code" | "connectors" | "agents";

export interface GroupDef {
  id: Group;
  label: string;
  icon: () => ReactElement;
  /** ⌘-key that lands on the group's home view; absent if the group has none. */
  key?: string;
}

/** Rail groups – one rail icon each, in rail order. */
export const GROUPS: GroupDef[] = [
  { id: "overview", label: "Overview", icon: Icon.home, key: "1" },
  { id: "map", label: "Map", icon: Icon.map, key: "3" },
  { id: "code", label: "Code", icon: Icon.code, key: "2" },
  { id: "connectors", label: "Connectors", icon: Icon.plug, key: "c" },
  { id: "agents", label: "Agents", icon: Icon.agents, key: "a" },
];

export interface Module {
  /** Stable id, equal to the nav View – also the hash root (#<id>/…). */
  id: View;
  label: string;
  icon: () => ReactElement;
  slot: Slot;
  group: Group;
  /** ⌘-number view key (1–9, 0, a, q, c); absent for views without one. */
  key?: string;
  /** Component bundle shared by several modules (e.g. "code" for the Code
   *  workbench tabs). App maps family → element; defaults to the module id. */
  family?: string;
  /** Lazy component importer – the shell renders it under Suspense. */
  lazy: () => Promise<{ default: ComponentType<any> }>;
}

// – Lazy view chunks, exactly the importers App.tsx used –
const graphView = () => import("../views/GraphView");
const agentsCanvas = () => import("../views/AgentsCanvas");
const code = () => import("../views/Code");
const connectors = () => import("../views/Connectors");
const mapView = () => import("../views/MapView");
const syntagm = () => import("../views/Syntagm");
const overview = () => import("../views/Overview");
const query = () => import("../views/Query");

/** Every view in the product, grouped the way the rail shows it. */
export const MODULES: Module[] = [
  { id: "overview", label: "Overview", icon: Icon.home, slot: "centre", group: "overview", key: "1", lazy: overview },
  { id: "graph", label: "Graph", icon: Icon.graph, slot: "centre", group: "code", key: "2", family: "code", lazy: graphView },
  { id: "flows", label: "Map", icon: Icon.map, slot: "centre", group: "map", key: "3", lazy: mapView },
  { id: "syntagm", label: "Syntagm", icon: Icon.map, slot: "centre", group: "map", lazy: syntagm },
  { id: "changes", label: "Changes", icon: Icon.changes, slot: "centre", group: "code", key: "4", family: "code", lazy: code },
  { id: "history", label: "History", icon: Icon.history, slot: "centre", group: "code", key: "5", family: "code", lazy: code },
  { id: "branches", label: "Branches & compare", icon: Icon.branches, slot: "centre", group: "code", key: "6", family: "code", lazy: code },
  { id: "proposals", label: "Proposals", icon: Icon.pr, slot: "centre", group: "agents", key: "7", family: "agents", lazy: agentsCanvas },
  { id: "issues", label: "Issues", icon: Icon.issues, slot: "centre", group: "agents", key: "8", family: "agents", lazy: agentsCanvas },
  { id: "notes", label: "Notes", icon: Icon.notes, slot: "centre", group: "agents", key: "9", family: "agents", lazy: agentsCanvas },
  { id: "agents", label: "Agents", icon: Icon.agents, slot: "centre", group: "agents", key: "a", family: "agents", lazy: agentsCanvas },
  { id: "connectors", label: "Connectors", icon: Icon.plug, slot: "centre", group: "connectors", key: "c", lazy: connectors },
  { id: "query", label: "Query (SPARQL)", icon: Icon.query, slot: "centre", group: "code", key: "q", family: "code", lazy: query },
  { id: "console", label: "Console", icon: Icon.console, slot: "centre", group: "code", key: "0", family: "code", lazy: code },
];

/** All module ids, in rail order. */
export const VIEWS = MODULES.map((m) => m.id);

/** Look up by view id. */
export const moduleOf = (v: View): Module => MODULES.find((m) => m.id === v) ?? MODULES[0];

/** The ⌘-key → view map, from the registry. */
export const keyOf = (v: View): string | undefined => moduleOf(v).key;

/** The view a rail icon opens: the module in the group carrying the group's key. */
export const groupHome = (g: Group): View =>
  MODULES.find((m) => m.group === g && m.key === GROUPS.find((x) => x.id === g)?.key)?.id ?? "overview";

// Warm every lazy chunk once the shell is up, so the first rail click does
// not wait on a chunk load (local disk, but still a visible flash).
let prefetched = false;
export function prefetchModules() {
  if (prefetched) return;
  prefetched = true;
  const run = () => MODULES.forEach((m) => void m.lazy().catch(() => {}));
  const idle = (window as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (idle) idle(run);
  else setTimeout(run, 1500);
}
