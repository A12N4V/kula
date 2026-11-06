// W2 – explorer for the map activity: the wheel as a tree, blocks grouped by
// the five stages, plus the thread list (deck p.2/p.3). Selection is shared
// with the wheel and inspector through map/selection.
import { STAGES, type MapShape, type Stage } from "@/workbench/map/stage";
import { useMap } from "@/workbench/map/WheelMap";
import { spendOf, mockFences } from "@/workbench/mock/map";
import { useMapUi, setMapUi } from "@/workbench/map/selection";

export function BlockExplorer() {
  const ui = useMapUi();
  const { map } = useMap() as { map: MapShape | null };
  if (!map) return <div className="p-3 text-xs text-muted-foreground">loading blocks…</div>;
  const byStage = new Map<Stage, typeof map.blocks>(STAGES.map((s) => [s, []]));
  for (const b of map.blocks) byStage.get(b.stage)!.push(b);
  return (
    <div className="flex h-full min-h-0 flex-col text-xs" data-testid="wb-map-explorer">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-muted-foreground">BLOCKS {map.blocks.length}</span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {STAGES.map((stage) => {
          const blocks = byStage.get(stage)!;
          if (!blocks.length) return null;
          return (
            <div key={stage}>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                · {stage}
              </div>
              {blocks.map((b) => (
                <button
                  key={b.id}
                  data-testid={`wb-explorer-block-${b.id}`}
                  className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-accent/10 ${
                    ui.block === b.id ? "bg-accent/15 text-accent" : "text-foreground/80"
                  }`}
                  onClick={() => setMapUi({ block: ui.block === b.id ? null : b.id })}
                >
                  <span className="truncate">{b.label}</span>
                  <span className="shrink-0 pl-2 tabular-nums text-muted-foreground">{b.symbols}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border px-2 py-1.5 text-muted-foreground">
        THREADS {map.threads.length}
      </div>
      <div className="max-h-48 shrink-0 overflow-y-auto border-t border-border">
        {map.threads.map((t) => (
          <button
            key={t.id}
            data-testid={`wb-thread-${t.id}`}
            className={`flex w-full items-center justify-between px-3 py-1 text-left hover:bg-accent/10 ${
              ui.thread === t.id ? "text-accent" : "text-foreground/80"
            }`}
            onClick={() => {
              setMapUi({ thread: t.id, subwayOpen: true });
              document.querySelector('[data-testid="wb-tab-map-subway"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }}
          >
            <span className="truncate">{t.label}</span>
            <span className="shrink-0 pl-2 tabular-nums text-muted-foreground">{t.weight}</span>
          </button>
        ))}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        fences 7 · spend 7d · churn live <span className="opacity-40">MOCK</span>
      </div>
      <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-muted-foreground" data-testid="wb-explorer-fences">
        {mockFences.map((f) => `${f.level} ${f.path}`).slice(0, 3).join(" · ")}
      </div>
      <div className="shrink-0 px-3 py-1 text-[10px] text-muted-foreground">
        top block spend {Math.max(...map.blocks.map((b) => spendOf(b.dir)), 0).toLocaleString()} tok
      </div>
    </div>
  );
}
