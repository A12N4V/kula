// #flow-lab – dev-only route (not in the nav). The kit against the synthetic
// 2 600-node fixture, with a readout and the perf hooks the benchmark uses.
import { useMemo, useState } from "react";
import { FlowCanvas } from "./FlowCanvas";
import { FlowSidebar } from "./FlowSidebar";
import { useFc } from "./fcContext";
import { flowLabFixture } from "./fixture";

/** The collapse/expand tinker – the fixed-UI path for phones and keyboards. */
function TinkerCollapse() {
  const { toggleGroup } = useFc();
  if (!toggleGroup) return null;
  return <button className="btn sm" data-testid="fc-tinker-collapse" onClick={() => toggleGroup("*")}>Collapse / expand selection</button>;
}

export default function FlowLab() {
  const fixture = useMemo(() => flowLabFixture(), []);
  performance.mark("fc:lab-mount");
  const [sel, setSel] = useState<string | null>(null);
  const selNode = useMemo(() => fixture.nodes.find((n) => n.id === sel) ?? null, [fixture.nodes, sel]);

  return (
    <div className="view-flow-lab">
      <FlowCanvas
        nodes={fixture.nodes}
        edges={fixture.edges}
        groups={fixture.groups}
        layoutKey="flow-lab"
        ns="flow-lab"
        selection={sel}
        onSelect={setSel}
        onOpen={() => { /* the lab opens nothing – open-path is exercised by the views */ }}
        sidebar={
          <FlowSidebar
            title={selNode ? selNode.title : "Flow lab"}
            desc={selNode ? (selNode.subtitle ?? "synthetic node") : "The canvas kit against 2 600 synthetic nodes – drag, tidy, fit, traverse."}
            kv={selNode ? ([["kind", selNode.kind], ["id", selNode.id], ["nodes", String(fixture.counts.nodes)], ["edges", String(fixture.counts.edges)]] as [string, string][]) : ([["nodes", String(fixture.counts.nodes)], ["edges", String(fixture.counts.edges)], ["groups", String(fixture.counts.groups)]] as [string, string][])}
            tinker={<div className="fsb-tinker"><TinkerCollapse /><p className="fsb-desc">Tidy (T) re-runs dagre. Reset layout clears persisted drags.</p></div>}
          />
        }
      />
    </div>
  );
}
