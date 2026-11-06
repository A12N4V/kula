import { cn } from "@/workbench/kit/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/workbench/kit/tooltip";
import { Separator } from "@/workbench/kit/separator";
import { Settings } from "lucide-react";
import { useState } from "react";
import type { Activity } from "@/workbench/registry";

// Activity rail: one 32px button per registered activity, settings pinned at
// the bottom. ⌥1–N activates, ⌥I collapses the inspector, ⌘J the panel.
export function ActivityBar({
  activities,
  active,
  onSelect,
}: {
  activities: Activity[];
  active: string;
  onSelect: (id: string) => void;
}) {
  // C1 round 2 – the rail Settings button now opens a small settings panel
  // (deck p.7 IA: ⚙ Settings at the bottom) instead of doing nothing.
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <nav
      data-testid="wb-activity-bar"
      data-figure="wb-activity-bar"
      className="relative flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2"
      aria-label="Activity bar"
    >
      <TooltipProvider delayDuration={150}>
        <div className="flex flex-col items-center gap-1">
          {activities.map((a, i) => (
            <Tooltip key={a.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid={`wb-activity-${a.id}`}
                  aria-pressed={active === a.id}
                  aria-label={a.label}
                  onClick={() => onSelect(a.id)}
                  className={cn(
                    "flex h-8 w-8 cursor-pointer items-center justify-center bg-transparent text-muted-foreground hover:text-foreground",
                    active === a.id && "border-l-2 border-accent bg-secondary text-accent",
                  )}
                >
                  <a.icon size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="rounded-none text-xs">
                {a.label} <span className="ml-2 opacity-60">⌥{i + 1}</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Separator className="w-6 bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="wb-activity-settings"
                aria-label="Settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((o) => !o)}
                className={cn(
                  "flex h-8 w-8 cursor-pointer items-center justify-center bg-transparent text-muted-foreground hover:text-foreground",
                  settingsOpen && "text-accent",
                )}
              >
                <Settings size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="rounded-none text-xs">Settings</TooltipContent>
          </Tooltip>
          {settingsOpen && (
            <div
              data-testid="wb-settings"
              className="absolute bottom-10 left-12 z-50 w-64 border border-border bg-card p-3 text-[11px] text-muted-foreground"
            >
              <p className="mb-2 text-[11px] uppercase tracking-wider text-foreground">Settings · keys</p>
              <ul className="space-y-1">
                <li>⌘K – command line · ⌘P – go to block</li>
                <li>⌥1–5 – activity · ⌘J – panel · ⌥I – inspector</li>
                <li>Esc – up one level (symbol → block → wheel)</li>
              </ul>
              <p className="mt-2 border-t border-border pt-2">theme: kula · mono · radius 0</p>
            </div>
          )}
        </div>
      </TooltipProvider>
    </nav>
  );
}
