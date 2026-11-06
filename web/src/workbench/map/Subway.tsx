// W2 – the subway: one thread. Columns = the five stages, stops = blocks on
// the thread, a stop expands to its function chain inline (deck p.3). Opened
// from a chord click or a thread row.
import { useState } from "react";
import { STAGES, type MapShape, type Stage } from "@/workbench/map/stage";
import { useMap } from "@/workbench/map/WheelMap";
import { useMapUi } from "@/workbench/map/selection";

export function Subway() {
  const ui = useMapUi();
  const { map } = useMap() as { map: MapShape | null };
  const [open, setOpen] = useState<string | null>(null);
  if (!map) return <div className="p-3 text-xs text-muted-foreground">loading…</div>;
  const thread = map.threads.find((t) => t.id === ui.thread) ?? map.threads[0];
  if (!thread) {
    return (
      <div className="p-3 text-xs text-muted-foreground" data-testid="wb-subway-empty">
        no threads yet – click a chord on the wheel.
      </div>
    );
  }
  const fnsByBlock = new Map<string, { name: string; path: string }[]>();
  for (const f of thread.fns) (fnsByBlock.get(f.block) ?? fnsByBlock.set(f.block, []).get(f.block)!).push(f);
  const byId = new Map(map.blocks.map((b) => [b.id, b]));
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="wb-subway">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span>
          THREAD · <span className="text-accent">{thread.label}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          {thread.blocks.length} blocks · {thread.weight} fn paths
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3" data-testid="wb-subway-columns">
        {STAGES.map((stage: Stage) => {
          const stops = thread.blocks.map((id) => byId.get(id)).filter((b) => b && b.stage === stage);
          return (
            <div key={stage} className="flex min-w-32 flex-1 flex-col" data-testid={`wb-subway-col-${stage}`}>
              <div className="mb-2 border-b border-border pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {stage}
              </div>
              {stops.map((b) => (
                <div key={b!.id} className="mb-2" data-testid={`wb-subway-stop-${b!.id}`}>
                  <button
                    className={`w-full border px-2 py-1 text-left text-xs ${
                      open === b!.id ? "border-accent text-accent" : "border-border hover:border-muted-foreground"
                    }`}
                    onClick={() => setOpen(open === b!.id ? null : b!.id)}
                  >
                    {b!.label}
                    <span className="float-right text-muted-foreground">{b!.symbols}</span>
                  </button>
                  {open === b!.id && (
                    <div className="border border-t-0 border-border px-2 py-1 text-[10px]" data-testid={`wb-subway-fns-${b!.id}`}>
                      {(fnsByBlock.get(b!.id) ?? []).slice(0, 12).map((f, i) => (
                        <div key={i} className="truncate text-muted-foreground">
                          {f.name} <span className="opacity-50">{f.path}</span>
                        </div>
                      ))}
                      {(fnsByBlock.get(b!.id) ?? []).length === 0 && <div className="text-muted-foreground">no function chain recorded</div>}
                    </div>
                  )}
                </div>
              ))}
              {!stops.length && <div className="text-[10px] text-muted-foreground">–</div>}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
        stops expand to their function chain · weight from /api/flows <span className="opacity-40">MOCK</span>
      </div>
    </div>
  );
}
