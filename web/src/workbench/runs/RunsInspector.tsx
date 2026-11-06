// W3 – runs inspector (deck p.4 right column): the selected run and agent –
// tokens in/out, cache read, credits (never dollars), tool calls, files ·
// edits, verdict counts, hand-offs. Numbers are clickable and filter the
// ledger (plan §6: every number filters the ledger).
import { formatTokens, MOCK_AGENTS, MOCK_LEDGER, MOCK_RUNS } from "@/workbench/mock/runs";
import { clearRunsFilters, setRunsUi, useRunsUi } from "@/workbench/runs/selection";
import type { Verdict } from "@/workbench/mock/runs";
import { cn } from "cn";

export function RunsInspector() {
  const ui = useRunsUi();
  const runId = ui.runId ?? 42;
  const run = MOCK_RUNS.find((r) => r.id === runId) ?? MOCK_RUNS[0];
  const agents = MOCK_AGENTS[run.id] ?? [];
  const agent = agents.find((a) => a.id === ui.agentId) ?? agents[0];
  const events = MOCK_LEDGER[run.id] ?? [];

  const agentEvents = agent ? events.filter((e) => e.agentId === agent.id) : events;
  const verdicts = (["ok", "review", "blocked", "error"] as Verdict[]).map((v) => ({
    v,
    n: agentEvents.filter((e) => e.verdict === v).length,
  }));
  const handoffs = agentEvents.filter((e) => e.event === "handoff").length;
  const cacheRead = agentEvents.reduce((s, e) => s + Math.round(e.tokensIn * 0.64), 0);

  return (
    <div data-testid="wb-runs-inspector" className="flex flex-col gap-4 p-3 text-[12px]">
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Agent {agent ? `· ${agent.id}` : ""} <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
        </h3>
        {agent ? (
          <>
            <p className="text-muted-foreground">{agent.kind} · {agent.task}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <Row label="tokens in / out" value={`${formatTokens(agent.tokensIn)} / ${formatTokens(agent.tokensOut)}`} />
              <Row label="cache read" value={formatTokens(cacheRead)} />
              <Row label="credits" value={agent.credits === null ? "–" : String(agent.credits)} />
              <Row label="tool calls" value={String(agent.toolCalls)} filter={() => setRunsUi({ agentId: agent.id })} />
              <Row label="files · edits" value={`${agent.filesEdited} · ${agentEvents.filter((e) => e.event === "edit").length}`} />
              <Row label="hand-offs" value={handoffs ? `→ ${handoffs}` : "–"} />
            </dl>
          </>
        ) : (
          <p className="text-muted-foreground">No agents recorded in this run.</p>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Verdicts</h3>
        <ul className="flex flex-col">
          {verdicts.map(({ v, n }) => (
            <li key={v}>
              <button
                type="button"
                data-testid={`wb-verdict-${v}`}
                onClick={() => setRunsUi({ verdict: ui.verdict === v ? null : v })}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between px-2 py-1 text-left outline-none hover:bg-secondary",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  ui.verdict === v && "bg-secondary text-accent",
                )}
              >
                <span>{v}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">Ledger filters</h3>
          <button
            type="button"
            data-testid="wb-runs-inspector-clear"
            onClick={() => clearRunsFilters()}
            className="cursor-pointer text-accent hover:underline"
          >
            clear
          </button>
        </div>
        <p className="text-muted-foreground">
          {ui.agentId ? `agent ${ui.agentId} · ` : ""}
          {ui.laneKind ? `${ui.laneKind} · ` : ""}
          {ui.blockId ? `block ${ui.blockId} · ` : ""}
          {!ui.agentId && !ui.laneKind && !ui.blockId ? "none" : ""}
        </p>
      </section>
    </div>
  );
}

function Row({ label, value, filter }: { label: string; value: string; filter?: () => void }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">
        {filter ? (
          <button
            type="button"
            onClick={filter}
            className="cursor-pointer outline-none hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {value}
          </button>
        ) : (
          value
        )}
      </dd>
    </>
  );
}
