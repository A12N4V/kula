// W2 – Fences activity: the same wheel with the fences overlay (locked solid,
// review hatched, hidden cut out) plus the fence list in the explorer
// (deck p.6). Reuses WheelMap; fence data is mocked (no endpoint yet).
import { WheelMap, useMap } from "@/workbench/map/WheelMap";
import { mockFences } from "@/workbench/mock/map";
import { useMapUi, setMapUi } from "@/workbench/map/selection";

function fencesBlockFor(dir: string): string | null {
  const hit = mockFences.find((f) => dir.startsWith(f.path) || f.path.startsWith(dir));
  return hit ? hit.path : null;
}

export function FencesExplorer() {
  const { map } = useMap();
  const ui = useMapUi();
  const counts = {
    locked: mockFences.filter((f) => f.level === "locked").length,
    review: mockFences.filter((f) => f.level === "review").length,
    hidden: mockFences.filter((f) => f.level === "hidden").length,
  };
  const block = map?.blocks.find((b) => b.id === ui.block) ?? null;
  const crossing = map?.threads.filter((t) => block && t.blocks.includes(block.id)) ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col text-xs" data-testid="wb-fences-explorer">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-muted-foreground">FENCES {mockFences.length}</span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="px-3 py-1 text-muted-foreground">
        locked {counts.locked} · review {counts.review} · hidden {counts.hidden}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mockFences.map((f) => (
          <button
            key={f.id}
            data-testid={`wb-fence-${f.id}`}
            className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-accent/10 ${
              block && fencesBlockFor(block.dir) === f.path ? "text-accent" : "text-foreground/80"
            }`}
            onClick={() => {
              const b = map?.blocks.find((x) => x.dir.startsWith(f.path) || f.path.startsWith(x.dir));
              if (b) setMapUi({ block: b.id, overlay: "fences" });
            }}
          >
            <span className="truncate">
              {f.level === "locked" ? "■" : f.level === "review" ? "▩" : "□"} {f.path}
            </span>
            <span className="shrink-0 pl-2 text-muted-foreground">{f.blockedAttempts7d}</span>
          </button>
        ))}
      </div>
      {block && (
        <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted-foreground" data-testid="wb-fences-crossing">
          threads crossing: {crossing.length || "0"}
        </div>
      )}
    </div>
  );
}

export function FencesInspector() {
  const ui = useMapUi();
  return (
    <div className="p-3 text-xs text-muted-foreground" data-testid="wb-fences-inspector">
      {ui.block ? `fence overlay · ${ui.block}` : "select a sector to read its fence."}
    </div>
  );
}

export function FencesWheel() {
  const { map } = useMap();
  const ui = useMapUi();
  return (
    <div className="relative h-full w-full p-2" data-testid="wb-fences-wheel">
      <WheelMap
        map={map}
        overlay="fences"
        selection={ui.block}
        onSelectBlock={(id) => setMapUi({ block: id })}
      />
      <div className="absolute right-3 top-3 border border-border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
        ■ locked · ▩ review · □ hidden · recolours the same wheel <span className="opacity-40">MOCK</span>
      </div>
    </div>
  );
}
