// Map capabilities lens – the repo read as "what you can do with it":
// one swimlane per entry point / feature, each lane the chain family it
// starts. Lanes are the heaviest capabilities first; every stop in a lane
// selects its block; a lane's files list goes to the code panel.

import type { Lane } from "./lenses";
import { capabilities } from "./lenses";
import { RoleMark } from "./icons";
import type { Chain, ChainPage, MapData, Role } from "./types";

type Props = {
  data: MapData;
  roles: Set<Role>;
  onSelect: (id: string | null) => void;
  selection: string | null;
  onFile: (path: string) => void;
};

export function CapsView({ data, roles, onSelect, selection, onFile }: Props) {
  const lanes = capabilities(data, 24, roles);
  if (!lanes.length)
    return <div className="sy-canvas fm-caps" data-testid="map-caps"><div className="view-loading">no capability families under this filter</div></div>;
  return (
    <div className="sy-canvas fm-caps" data-testid="map-caps">
      <div className="fm-headline" data-testid="map-caps-headline">
        <span className="fm-headline-k">capabilities</span>
        <span className="fm-headline-v">{lanes.length} lanes – one per entry family, heaviest first</span>
      </div>
      <div className="fm-caps-scroll sy-canvas-scroll">
        <ol className="fm-lanes" data-testid="map-lanes">
          {lanes.map((l, i) => (
            <li key={l.famId} className="fm-lane" data-testid={`map-lane-${i}`}>
              <button className="fm-lane-head" title={`${l.label} · ${l.count} chains`}>
                <span className="fm-lane-n mono">{i + 1}</span>
                <span className="mono fm-lane-label">{l.label}</span>
                <span className="sy-row-meta">{l.count}</span>
              </button>
              <div className="fm-lane-track">
                {l.stops.map((s, j) => (
                  <button key={`${s.id}-${j}`} className={`fm-lane-stop fm-role-${s.role}${selection === s.id ? " sel" : ""}`}
                    data-testid={`map-lane-stop-${s.id}`} data-flow-box={s.id}
                    onClick={() => onSelect(s.id)} title={s.name}>
                    <RoleMark role={s.role} />
                    <span className="mono fm-lane-stop-name">{s.name}</span>
                  </button>
                ))}
              </div>
              {l.files.length > 0 && (
                <div className="fm-lane-files">
                  {l.files.map((p) => (
                    <button key={p} className="fm-fn" onClick={() => onFile(p)} title={p}>
                      <span className="mono fm-fn-name">{p.split("/").pop()}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
// Chains lens – the top chain families as subway strips: one stop per block
// the family's chains cross, the family heaviest first. Selecting a strip
// loads its first chain; steps open in the code panel from the sidebar.
import { useEffect, useState } from "react";

type ChainsProps = {
  data: MapData;
  roles: Set<Role>;
  onChain: (c: Chain) => void;
  selChain: string | null;
  loadChains: (family: string, cursor?: string) => Promise<ChainPage>;
  onLeaf: (id: number) => void;
};

export function ChainsStrips({ data, roles, onChain, selChain, loadChains, onLeaf }: ChainsProps) {
  const lanes = capabilities(data, 12, roles);
  const [loaded, setLoaded] = useState<Record<string, Chain | null>>({});
  useEffect(() => { setLoaded({}); }, [data]);
  const open = async (famId: string) => {
    if (loaded[famId]) { onChain(loaded[famId]!); return; }
    const page = await loadChains(famId);
    const c = page.chains[0];
    if (c) { setLoaded((m) => ({ ...m, [famId]: c })); onChain(c); }
  };
  if (!lanes.length)
    return <div className="sy-canvas fm-caps" data-testid="map-chains-view"><div className="view-loading">no chains under this filter</div></div>;
  return (
    <div className="sy-canvas fm-caps" data-testid="map-chains-view">
      <div className="fm-headline" data-testid="map-chains-headline">
        <span className="fm-headline-k">chains</span>
        <span className="fm-headline-v">the busiest execution paths – select one to walk it</span>
      </div>
      <div className="fm-caps-scroll sy-canvas-scroll">
        <ol className="fm-lanes" data-testid="map-chain-strips">
          {lanes.map((l, i) => (
            <li key={l.famId} className="fm-lane fm-lane-strip" data-testid={`map-strip-${i}`}>
              <button className="fm-lane-head" title={`${l.label} · ${l.count} chains`} data-testid={`map-strip-open-${i}`}
                onClick={() => open(l.famId)}>
                <span className="fm-lane-n mono">{i + 1}</span>
                <span className="mono fm-lane-label">{l.label}</span>
                <span className="sy-row-meta">{l.count}</span>
              </button>
              <div className="fm-lane-track">
                {l.stops.map((s, j) => (
                  <span key={`${s.id}-${j}`} className={`fm-lane-stop fm-role-${s.role}${selChain && loaded[l.famId] ? " picked" : ""}`} title={s.name}>
                    <span className="mono fm-lane-stop-name">{s.name}</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
