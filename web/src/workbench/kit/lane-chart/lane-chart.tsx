import * as React from "react";
import { cn } from "cn";

export type LaneChartTask = {
  id: string;
  laneId: string;
  label: string;
  /** Inclusive slot indexes on the shared time axis (0-based). */
  start: number;
  end: number;
};

export type LaneChartLane = {
  id: string;
  label: string;
};

export type LaneChartProps = {
  lanes: LaneChartLane[];
  tasks: LaneChartTask[];
  /** Number of slots on the time axis. Defaults to the max task end + 1. */
  slots?: number;
  className?: string;
};

/* kula variant of the bigbullui gantt-lite (21st.dev, MIT): a CSS-grid
   lane chart with radius 0 bars, hairline slot grid, accent for the
   in-progress bar, mono labels. No shadows, no glow. */
export function LaneChart({ lanes, tasks, slots, className }: LaneChartProps) {
  const slotCount = React.useMemo(() => {
    const maxEnd = tasks.reduce((m, t) => Math.max(m, t.end), 0);
    return Math.max(slots ?? 0, maxEnd + 1, 1);
  }, [tasks, slots]);

  const byLane = React.useMemo(() => {
    const map = new Map<string, LaneChartTask[]>();
    for (const t of tasks) {
      const list = map.get(t.laneId) ?? [];
      list.push(t);
      map.set(t.laneId, list);
    }
    return map;
  }, [tasks]);

  return (
    <div
      data-testid="kwb-lane-chart"
      className={cn("kwb-lane-chart overflow-auto text-[12px]", className)}
    >
      <div className="flex">
        <div className="shrink-0 border-b border-r border-border pr-2">
          {lanes.map((lane) => (
            <div
              key={lane.id}
              data-testid={`lane-label-${lane.id}`}
              className="flex h-8 items-center whitespace-nowrap px-2 text-muted-foreground"
            >
              {lane.label}
            </div>
          ))}
        </div>
        <div
          className="grid flex-1 border-b border-border"
          style={{
            gridTemplateColumns: `repeat(${slotCount}, minmax(48px, 1fr))`,
            gridTemplateRows: `repeat(${lanes.length}, 2rem)`,
          }}
        >
          {Array.from({ length: slotCount * lanes.length }, (_, i) => {
            const lane = Math.floor(i / slotCount);
            const slot = i % slotCount;
            const laneId = lanes[lane]?.id;
            const task = byLane.get(laneId)?.find(
              (t) => t.start <= slot && slot <= t.end,
            );
            const isBarStart = task?.start === slot;
            return (
              <div
                key={i}
                data-testid={task && isBarStart ? `lane-bar-${task.id}` : undefined}
                className={cn(
                  "relative flex items-center overflow-hidden border-r border-b border-border/60",
                  task && "bg-secondary px-2",
                  task && isBarStart && "bg-primary text-primary-foreground",
                  task && !isBarStart && "bg-primary/60 text-primary-foreground",
                )}
              >
                {task && isBarStart && (
                  <span className="truncate">{task.label}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
