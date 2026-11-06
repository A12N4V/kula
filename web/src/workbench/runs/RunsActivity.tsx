// W3 – runs activity center tab (deck p.4): lanes for the selected run above
// the mini wheel reusing W2's WheelMap with the run's touched blocks lit.
// Click a wheel sector → ledger filtered to that block's events (one-way read
// of the map store, per guidance-w3: never write to map/selection.ts).
import { useEffect, useState } from "react";
import { WheelMap, useMap, type MapOverlay } from "@/workbench/map/WheelMap";
import { setMapUi } from "@/workbench/map/selection";
import { MOCK_TOUCHED_BLOCKS } from "@/workbench/mock/runs";
import { Lanes } from "@/workbench/runs/Lanes";
import { setRunsUi, useRunsUi } from "@/workbench/runs/selection";
import { ScrollArea } from "@/workbench/kit/scroll-area";

export function RunsTab() {
  const ui = useRunsUi();
  const runId = ui.runId ?? 42;
  const { map, error } = useMap();
  // One-way read is not enough here: the wheel → ledger filter needs the
  // clicked block. We mirror it into our own store (wb-ledger-filter-block)
  // instead of deriving from mapUi, so the ledger filter is explicit and
  // clearable without touching map/selection.ts.
  const [blockFilter, setBlockFilter] = useState<string | null>(null);
  useEffect(() => {
    setRunsUi({ blockId: blockFilter });
  }, [blockFilter]);

  if (error) {
    return <p className="p-3 text-[12px] text-destructive">map failed to load: {error}</p>;
  }
  if (!map) {
    return <p className="p-3 text-[12px] text-muted-foreground">loading map…</p>;
  }
  // only light sectors that exist on the real staged wheel (map is non-null here)
  const touched = (MOCK_TOUCHED_BLOCKS[runId] ?? []).filter((id) => map.blocks.some((b) => b.id === id));

  return (
    <div data-testid="wb-runs-tab" className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 pt-2">
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Run #{runId} · lanes and where it spent <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
        </h3>
        <p className="pb-2 text-muted-foreground">
          Click a lane bar or a wheel sector to filter the ledger below (⌘J).
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          <Lanes />
          <section>
            <h3 className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Mini wheel · {touched.length} blocks touched <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
            </h3>
            <div data-testid="wb-runs-wheel" className="mx-auto max-w-md">
              <WheelMap
                map={map}
                overlay={overlayFor(runId)}
                selection={blockFilter}
                litBlocks={blockFilter ? [blockFilter] : touched}
                onSelectBlock={(id) => setBlockFilter((b) => (id ? (b === id ? null : id) : null))}
                onOpenThread={(t) => setMapUi({ thread: t })}
              />
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

// overlayFor – the wheel recolours in place; runs default to the spend view
// so tokens (never dollars) are the visual story, per the deck note.
function overlayFor(runId: number): MapOverlay {
  return runId === 42 ? "spend" : "stages";
}
