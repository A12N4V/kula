// W2 – map inspector: identity + metrics for the selected block, or the
// selected thread. Fixed sections, counts before lists (deck p.2 note 4).
import { type MapShape } from "@/workbench/map/stage";
import { useMap } from "@/workbench/map/WheelMap";
import { fenceLevelOf, ownerOf, spendOf, mockFences } from "@/workbench/mock/map";
import { useMapUi } from "@/workbench/map/selection";

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

export function MapInspector() {
  const ui = useMapUi();
  const { map } = useMap() as { map: MapShape | null };
  if (!map) return null;
  const block = map.blocks.find((b) => b.id === ui.block) ?? null;
  const thread = map.threads.find((t) => t.id === ui.thread) ?? null;
  if (!block && !thread) {
    return (
      <div className="p-3 text-xs text-muted-foreground" data-testid="wb-map-inspector">
        select a sector, a chord or an explorer row.
      </div>
    );
  }
  if (block) {
    const level = fenceLevelOf(block.dir);
    const fence = mockFences.find((f) => block.dir.startsWith(f.path) || f.path.startsWith(block.dir));
    return (
      <div className="p-3 text-xs" data-testid="wb-map-inspector">
        <div className="mb-1 font-medium" data-testid="wb-inspector-block-name">
          {block.label}
        </div>
        <div className="mb-2 text-[10px] text-muted-foreground">{block.dir}</div>
        <Row k="stage" v={block.stage} />
        <Row k="symbols" v={block.symbols} />
        <Row k="threads through" v={map.threads.filter((t) => t.blocks.includes(block.id)).length} />
        <Row k="churn" v={block.churn} />
        <Row k="owner" v={`${ownerOf(block.dir)} · MOCK`} />
        <Row k="spend 7d" v={`${spendOf(block.dir).toLocaleString()} tok · MOCK`} />
        <Row k="fence" v={level ? `${level} · MOCK` : "none"} />
        {fence && (
          <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            blocked attempts 7d: {fence.blockedAttempts7d}
            {fence.attemptsBy.length > 0 && ` by ${fence.attemptsBy.join(", ")}`}
          </div>
        )}
      </div>
    );
  }
  const stops = thread!.blocks.length;
  return (
    <div className="p-3 text-xs" data-testid="wb-map-inspector">
      <div className="mb-1 font-medium">{thread!.label}</div>
      <div className="mb-2 text-[10px] text-muted-foreground">thread · MOCK</div>
      <Row k="stops" v={stops} />
      <Row k="function paths" v={thread!.weight} />
      <Row k="longest chain" v={Math.max(...thread!.fns.reduce((m, f) => { const c = m.get(f.block) ?? 0; return m.set(f.block, c + 1); }, new Map<string, number>()).values(), 0)} />
    </div>
  );
}
