// W3 – lanes for the selected run (deck p.4): one row per agent, bars for
// working (black) / waiting (grey) / blocked (orange), on a shared time axis.
// Click a bar → ledger filtered to that agent, kind and time window.
// Time axis in minutes from the run start, labelled every 5 min.
import { useMemo } from "react";
import { LaneChart, type LaneChartTask } from "@/workbench/kit/lane-chart/lane-chart";
import { MOCK_AGENTS, MOCK_LANES, MOCK_RUNS, formatTokens, runStartMinutes } from "@/workbench/mock/runs";
import { setRunsUi, useRunsUi } from "@/workbench/runs/selection";

export function Lanes({ className }: { className?: string }) {
  const ui = useRunsUi();
  const runId = ui.runId ?? 42;
  const run = MOCK_RUNS.find((r) => r.id === runId) ?? MOCK_RUNS[0];
  const agents = MOCK_AGENTS[run.id] ?? [];

  const lanes = useMemo(
    () => agents.map((a) => ({ id: a.id, label: `${a.id} · ${formatTokens(a.tokensIn + a.tokensOut)}` })),
    [agents],
  );
  const tasks: LaneChartTask[] = useMemo(
    () =>
      (MOCK_LANES[run.id] ?? [])
        .filter((l) => agents.some((a) => a.id === l.agentId))
        .map((l) => ({
          id: l.id,
          laneId: l.agentId,
          label: l.kind,
          start: l.start,
          end: l.end,
          kind: l.kind,
        })),
    [agents, run.id],
  );

  const onSelect = (task: LaneChartTask | undefined) => {
    if (!task) {
      setRunsUi({ agentId: null, laneKind: null, window: null });
      return;
    }
    setRunsUi({ agentId: task.laneId, laneKind: task.kind ?? null, window: { start: task.start, end: task.end + 1 } });
  };

  // the axis spans exactly the run's minutes (mock coherence: no slot drift)
  const slots = Math.max(run.minutes + 1, 12);

  return (
    <section data-testid="wb-lanes" className={className}>
      <div className="mb-1 flex items-baseline justify-between px-3 pt-2">
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Lanes · {agents.length} agents <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
        </h3>
        <p className="text-muted-foreground">Black = working, grey = waiting, orange = blocked · click a bar to filter the ledger</p>
      </div>
      {agents.length === 0 ? (
        <p className="px-3 pb-2 text-muted-foreground">No agents recorded in this run.</p>
      ) : (
        <>
          <LaneChart lanes={lanes} tasks={tasks} slots={slots} onSelectItem={onSelect} />
          {/* axis labels: flex row with a hidden mirror of the lane labels so
              the spacer width matches LaneChart's content-sized gutter exactly,
              then the same grid template as the chart's slot grid (critic fix:
              display:grid, previously a flex row that ignored the template). */}
          <div className="mt-px flex" aria-hidden>
            <div className="shrink-0 pr-2">
              {lanes.map((lane) => (
                <div key={lane.id} className="h-8 whitespace-nowrap px-2 opacity-0">
                  {lane.label}
                </div>
              ))}
            </div>
            <div
              className="grid flex-1 text-[10px] tabular-nums text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${slots}, minmax(48px, 1fr))` }}
            >
              {Array.from({ length: slots }, (_, m) => (
                <span key={m} className="min-w-0 overflow-visible whitespace-nowrap pl-1">
                  {m % 5 === 0 ? label(m, run.start) : ""}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function label(minute: number, start: string): string {
  // wall-clock axis labels, derived from the run's own start (never hardcoded)
  const total = runStartMinutes(start) + minute;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
