// W2 – the map activity's center tab: the wheel with overlay chips
// (stages / owners / fences / spend / churn) and the subway as an inner tab.
// Chord and thread clicks set subwayOpen in the shared selection store, which
// switches the inner tab (CenterTabs is uncontrolled, so the subway lives
// inside the map tab as a controlled kit-Tabs switch – see handoff).
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/workbench/kit/tabs";
import { WheelMap, useMap, type MapOverlay } from "@/workbench/map/WheelMap";
import { Subway } from "@/workbench/map/Subway";
import { useMapUi, setMapUi } from "@/workbench/map/selection";

const OVERLAYS: MapOverlay[] = ["stages", "owners", "fences", "spend", "churn"];

export function MapTab() {
  const { map, error } = useMap();
  const ui = useMapUi();
  return (
    <Tabs
      value={ui.subwayOpen ? "subway" : "wheel"}
      onValueChange={(v) => setMapUi({ subwayOpen: v === "subway" })}
      className="flex h-full min-h-0 flex-col"
      data-testid="wb-map-tab"
    >
      <TabsList data-testid="wb-map-inner-tabs">
        <TabsTrigger value="wheel" data-testid="wb-inner-wheel">
          wheel
        </TabsTrigger>
        <TabsTrigger value="subway" data-testid="wb-inner-subway">
          subway
        </TabsTrigger>
      </TabsList>
      <TabsContent value="wheel" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5" data-testid="wb-map-overlays">
          <span className="mr-1 text-[10px] text-muted-foreground">map ◎ wheel</span>
          {OVERLAYS.map((o) => (
            <button
              key={o}
              data-testid={`wb-overlay-${o}`}
              className={`h-10 border px-2 text-[11px] md:h-7 ${
                ui.overlay === o ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMapUi({ overlay: o })}
            >
              {o}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {map ? `${map.blocks.length} blocks · ${map.threads.length} threads` : ""}
            {error ? ` · map error: ${error}` : ""}
            <span className="ml-2 opacity-40">MOCK fences · owners · spend</span>
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <WheelMap
            map={map}
            overlay={ui.overlay}
            selection={ui.block}
            onSelectBlock={(id) => setMapUi({ block: id })}
            onOpenThread={(tid) => setMapUi({ thread: tid, subwayOpen: true })}
          />
        </div>
      </TabsContent>
      <TabsContent value="subway" className="flex min-h-0 flex-1 flex-col">
        <Subway />
      </TabsContent>
    </Tabs>
  );
}
