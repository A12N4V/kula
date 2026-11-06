// W3 – lanes for the selected run (deck p.4): one row per agent, bars for
// working (black) / waiting (grey) / blocked (orange), on a shared time axis.
// Click a bar → ledger filtered to that agent, kind and time window.
// Time axis in minutes from the run start, labelled every 5 min.
import { useMemo } from "react";
import { LaneChart, type LaneChartTask } from "@/workbench/kit/lane-chart/lane-chart";
import { MOCK_AGENTS, MOCK_LANES, formatTokens } from "@/workbench/mock/runs";
import { setRunsUi, useRunsUi } from "@/workbench/runs/selection";

export function Lanes({ className }: { className?: string }) {
  const ui = useRunsUi();
  const runId = ui.runId ?? 42;
  const agents = MOCK_AGENTS[runId] ?? [];

  const lanes = useMemo(
    () => agents.map((a) => ({ id: a.id, label: `${a.id} · ${formatTokens(a.tokensIn + a.tokensOut)}` })),
    [agents],
  );
  const tasks: LaneChartTask[] = useMemo(
    () =>
      MOCK_LANES.filter((l) => agents.some((a) => a.id === l.agentId)).map((l) => ({
        id: l.id,
        laneId: l.agentId,
        label: l.kind,
        start: l.start,
        end: l.end,
        kind: l.kind,
      })),
    [agents],
  );

  const onSelect = (task: LaneChartTask | undefined) => {
    if (!task) {
      setRunsUi({ agentId: null, laneKind: null, window: null });
      return;
    }
    setRunsUi({ agentId: task.laneId, laneKind: task.kind ?? null, window: { start: task.start, end: task.end + 1 } });
  };

  const slots = agents.length ? 32 : 1;

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
          <div
            aria-hidden
            className="mt-px flex pl-0 text-[10px] tabular-nums text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${slots}, minmax(48px, 1fr))` }}
          >
            {Array.from({ length: slots }, (_, m) => (
              <span key={m} className="min-w-0 overflow-visible whitespace-nowrap pl-1">
                {m % 5 === 0 ? label(m) : ""}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function label(minute: number): string {
  // run #42 starts 14:18 – axis labels are wall-clock, from the mock run.
  const h = 14 + Math.floor((18 + minute) / 60);
  const m = (18 + minute) % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
