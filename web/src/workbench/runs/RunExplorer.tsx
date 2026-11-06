// W3 – runs explorer: the run list (deck p.4, "RUNS") and the agents in the
// selected run ("AGENTS · #42"). Selecting a run clears the ledger filters.
// Arrow-key walk + Enter to select (critic: keyboard access, do it right).
import { formatTokens, MOCK_AGENTS, MOCK_RUNS } from "@/workbench/mock/runs";
import { clearRunsFilters, setRunsUi, useRunsUi } from "@/workbench/runs/selection";
import { cn } from "cn";
import { Play } from "lucide-react";

export function RunExplorer() {
  const ui = useRunsUi();
  const runId = ui.runId ?? 42;
  const run = MOCK_RUNS.find((r) => r.id === runId) ?? MOCK_RUNS[0];
  const agents = MOCK_AGENTS[run.id] ?? [];

  const selectRun = (id: number) => {
    setRunsUi({ runId: id, agentId: null, laneKind: null, window: null, verdict: null });
  };

  return (
    <div data-testid="wb-runs-explorer" className="flex flex-col gap-4 p-3 text-[12px]">
      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Runs · {MOCK_RUNS.length} <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
          </h3>
          <span className="text-muted-foreground">1 live</span>
        </div>
        <ul className="flex flex-col">
          {MOCK_RUNS.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid={`wb-run-${r.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={r.id === run.id}
                onClick={() => selectRun(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectRun(r.id);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left outline-none hover:bg-secondary",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  r.id === run.id && "bg-secondary text-accent",
                )}
              >
                {r.state === "live" && <Play size={10} className="shrink-0 text-accent" aria-label="live" />}
                <span className="shrink-0 text-muted-foreground">#{r.id}</span>
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(r.tokens)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Agents · #{run.id} <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
          </h3>
          <span className="text-muted-foreground">{agents.length}</span>
        </div>
        <ul className="flex flex-col">
          {agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                data-testid={`wb-agent-${a.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={ui.agentId === a.id}
                onClick={() => setRunsUi({ agentId: ui.agentId === a.id ? null : a.id, laneKind: null, window: null, verdict: null })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRunsUi({ agentId: ui.agentId === a.id ? null : a.id, laneKind: null, window: null, verdict: null });
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left outline-none hover:bg-secondary",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  ui.agentId === a.id && "bg-secondary text-accent",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{a.id}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(a.tokensIn + a.tokensOut)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 px-2 text-muted-foreground">Click an agent to filter the ledger. ⌘J opens it.</p>
      </section>
    </div>
  );
}

export function clearFiltersNow() {
  clearRunsFilters();
}
