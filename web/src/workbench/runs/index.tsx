// W3 – registration for the runs activity + the Ledger panel tab. Called
// from Workbench.tsx's ensurePlaceholders in rail order, replacing W1's
// runs placeholder. No module-load side effects (renderer-crash trap).
//
// Panel tab id note: the shell's BottomPanel has a built-in placeholder tab
// with id "ledger" (order 10) and merges extraTabs without de-duping ids, so
// registering id "ledger" would render two Radix tabs with the same value.
// We therefore register "run-ledger" (order 9) – it sorts before the built-in
// placeholder. Noted as a shell gap in handoff-w3, never edited in the shell.
import { Play } from "lucide-react";
import type { Activity } from "@/workbench/registry";
import { WorkbenchRegistry } from "@/workbench/registry";
import { RunExplorer } from "@/workbench/runs/RunExplorer";
import { RunsInspector } from "@/workbench/runs/RunsInspector";
import { RunsTab } from "@/workbench/runs/RunsActivity";
import { LedgerPanel } from "@/workbench/runs/LedgerPanel";

export function registerRunsActivity() {
  if (WorkbenchRegistry.get("runs")) return;
  const activity: Activity = {
    id: "runs",
    label: "Runs",
    icon: Play,
    Explorer: RunExplorer,
    Inspector: RunsInspector,
    tabs: [{ id: "runs-lanes", label: "run #42", component: RunsTab }],
    panelTabs: [{ id: "run-ledger", label: "Ledger", component: LedgerPanel, order: 9 }],
  };
  WorkbenchRegistry.register(activity);
}
