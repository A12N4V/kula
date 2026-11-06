// W4 – registration for the agents activity, replacing W1's "agents"
// placeholder. Called from Workbench.tsx's ensurePlaceholders in rail order
// (map, runs, agents, fences, git). No module-load side effects
// (renderer-crash trap): registration happens inside the component render.
// Panel tab: the memory diff strip lives in the center split, not the bottom
// panel – no panelTabs contribution, so no id collisions with shell built-ins.
import { Users } from "lucide-react";
import type { Activity } from "@/workbench/registry";
import { WorkbenchRegistry } from "@/workbench/registry";
import { AgentsExplorer } from "@/workbench/agents/AgentsExplorer";
import { AgentInspector } from "@/workbench/agents/AgentInspector";
import { AgentsTab } from "@/workbench/agents/AgentsTab";

export function registerAgentsActivity() {
  if (WorkbenchRegistry.get("agents")) return;
  const activity: Activity = {
    id: "agents",
    label: "Agents",
    icon: Users,
    Explorer: AgentsExplorer,
    Inspector: AgentInspector,
    tabs: [{ id: "agents-team", label: "team", component: AgentsTab }],
  };
  WorkbenchRegistry.register(activity);
}
