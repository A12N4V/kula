// W4 – agents explorer: connectors summary on top, the kula:// tree below
// (deck p.9 left column). Both feed the shared selection store.
import { ConnectorsSummary } from "@/workbench/agents/ConnectorsSummary";
import { KulaTree } from "@/workbench/agents/KulaTree";

export function AgentsExplorer() {
  return (
    <div data-testid="wb-agents-explorer" className="flex h-full min-h-0 flex-col">
      <ConnectorsSummary />
      <KulaTree />
    </div>
  );
}
