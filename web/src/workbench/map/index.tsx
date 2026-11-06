// W2 – registration for the map + fences activities. Called from
// Workbench.tsx's ensurePlaceholders in rail order (map, runs, agents,
// fences, git) so ⌥1–5 keeps its meaning. Each registers only if the id is
// still free, replacing W1's placeholders. No module-load side effects.
import { Box, ShieldCheck } from "lucide-react";
import type { Activity } from "@/workbench/registry";
import { WorkbenchRegistry } from "@/workbench/registry";
import { BlockExplorer } from "@/workbench/map/BlockExplorer";
import { MapInspector } from "@/workbench/map/MapInspector";
import { MapTab } from "@/workbench/map/MapTab";
import { Subway } from "@/workbench/map/Subway";
import { FencesExplorer, FencesInspector, FencesWheel } from "@/workbench/map/FencesActivity";

export function registerMapActivity() {
  if (WorkbenchRegistry.get("map")) return;
  const activity: Activity = {
    id: "map",
    label: "Map",
    icon: Box,
    Explorer: BlockExplorer,
    Inspector: MapInspector,
    tabs: [
      { id: "map-graph", label: "Graph", component: MapTab },
      { id: "map-subway", label: "Subway", component: Subway },
    ],
  };
  WorkbenchRegistry.register(activity);
}

export function registerFencesActivity() {
  if (WorkbenchRegistry.get("fences")) return;
  WorkbenchRegistry.register({
    id: "fences",
    label: "Fences",
    icon: ShieldCheck,
    Explorer: FencesExplorer,
    Inspector: FencesInspector,
    tabs: [{ id: "fences-list", label: "Guards", component: FencesWheel }],
  });
}
