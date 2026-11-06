import { ScrollArea } from "@/workbench/kit/scroll-area";
import { Separator } from "@/workbench/kit/separator";
import { mockInspector } from "@/workbench/mock/state";
import type { Activity } from "@/workbench/registry";

// Right column: the active activity's Inspector, then the fixed plan §6
// sections (identity · metrics · fences · spend · memory · access), counts
// before lists. ⌥I collapses this column.
export function InspectorColumn({ activities, active }: { activities: Activity[]; active: string }) {
  const a = activities.find((x) => x.id === active);
  const I = a?.Inspector;
  return (
    <div data-testid="wb-inspector" data-figure="wb-inspector" className="flex h-full flex-col bg-card">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        inspector
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col px-3 py-2">
          {I && (
            <div className="mb-2 border-b border-border pb-2">
              <I />
            </div>
          )}
          {mockInspector.map((s) => (
            <section key={s.title} data-testid={`wb-inspector-${s.title.toLowerCase()}`} className="py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.title}</div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {s.rows.map(([k, v]) => (
                  <div key={k} className="col-span-2 grid grid-cols-[auto_1fr] gap-x-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <Separator className="mt-2 bg-border/60" />
            </section>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
