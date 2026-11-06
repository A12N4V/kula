import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/workbench/kit/tabs";
import { Button } from "@/workbench/kit/button";
import { Columns2, X } from "lucide-react";
import type { Activity } from "@/workbench/registry";
import { cn } from "@/workbench/kit/lib/utils";

// Center column: the active activity's tabs. W4 needs split view later – the
// "split" button demonstrates the slot and CenterTabs keeps per-tab ids so
// W4 can either drive this or use kit/resizable inside its own tab.
export function CenterTabs({ activities, active }: { activities: Activity[]; active: string }) {
  const a = activities.find((x) => x.id === active);
  if (!a) return null;
  return (
    <div data-testid="wb-center" data-figure="wb-center" className="flex h-full min-h-0 flex-col bg-background">
      <Tabs defaultValue={a.tabs[0]?.id} className="flex min-h-0 flex-1 flex-col gap-0" data-wb-activity={a.id}>
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-1">
          <TabsList className="h-8 gap-0 rounded-none bg-transparent p-0">
            {a.tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`wb-tab-${t.id}`}
                className="h-8 rounded-none border-0 border-r border-transparent bg-transparent px-3 text-xs data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-accent"
              >
                {t.label}
                <X size={10} className="ml-2 opacity-40 hover:opacity-100" />
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            data-testid="wb-split-tab"
            aria-label="Split editor (W4)"
            className="ml-auto h-8 w-10 rounded-none bg-transparent p-0 text-muted-foreground"
          >
            <Columns2 size={14} />
          </Button>
        </div>
        {a.tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="mt-0 min-h-0 flex-1 overflow-auto p-0" forceMount={undefined}>
            {active === a.id && <t.component />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
