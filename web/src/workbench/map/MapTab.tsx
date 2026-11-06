// W2 – the map activity's center tab: the wheel with overlay chips
// (stages / owners / fences / spend / churn), sharing selection with the
// explorer and inspector. The subway is its own tab, opened from a chord or
// a thread row.
import { WheelMap, useMap, type MapOverlay } from "@/workbench/map/WheelMap";
import { useMapUi, setMapUi } from "@/workbench/map/selection";

const OVERLAYS: MapOverlay[] = ["stages", "owners", "fences", "spend", "churn"];

export function MapTab() {
  const { map, error } = useMap();
  const ui = useMapUi();
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="wb-map-tab">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5" data-testid="wb-map-overlays">
        <span className="mr-1 text-[10px] text-muted-foreground">map ◎ wheel</span>
        {OVERLAYS.map((o) => (
          <button
            key={o}
            data-testid={`wb-overlay-${o}`}
            className={`h-6 border px-2 text-[11px] ${
              ui.overlay === o ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setMapUi({ overlay: o })}
          >
            {o}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {map ? `${map.blocks.length} blocks · ${map.threads.length} threads` : ""}
          {error ? " · map failed to load" : ""}
          <span className="ml-2 opacity-40">MOCK fences · owners · spend</span>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <WheelMap
          map={map}
          overlay={ui.overlay}
          selection={ui.block}
          onSelectBlock={(id) => setMapUi({ block: id })}
          onOpenThread={(tid) => {
            setMapUi({ thread: tid, subwayOpen: true });
            document
              .querySelector('[data-testid="wb-tab-map-subway"]')
              ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }}
        />
      </div>
    </div>
  );
}
