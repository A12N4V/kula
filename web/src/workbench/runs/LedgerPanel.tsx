// W3 – Ledger tab (deck p.4 bottom panel): every row is one ledger event in
// .kula/runs/42.jsonl. Filters come from the explorer (agent), a lane bar
// (agent + kind + time window) or a wheel sector (touched block) – plus the
// map store's blockId, read one-way from map/selection.ts. Tokens and credits
// only, never dollars.
import { useMemo } from "react";
import { formatTokens, MOCK_LEDGER, type Verdict } from "@/workbench/mock/runs";
import { useMapUi } from "@/workbench/map/selection";
import { clearRunsFilters, setRunsUi, useRunsUi } from "@/workbench/runs/selection";
import { cn } from "cn";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/workbench/kit/table";

const VERDICT_CLASS: Record<Verdict, string> = {
  ok: "text-muted-foreground",
  review: "text-accent",
  blocked: "text-accent",
  error: "text-destructive",
};

export function LedgerPanel() {
  const ui = useRunsUi();
  const mapUi = useMapUi();
  const runId = ui.runId ?? 42;
  const events = MOCK_LEDGER[runId] ?? [];

  const filtered = useMemo(() => {
    return events
      .filter((e) => (ui.agentId ? e.agentId === ui.agentId : true))
      .filter((e) => (ui.laneKind ? matchKind(e, ui.laneKind) : true))
      .filter((e) => {
        if (!ui.window) return true;
        const m = minuteOf(e.time);
        return m >= ui.window.start && m < ui.window.end;
      })
      .filter((e) => (ui.verdict ? e.verdict === ui.verdict : true))
      .filter((e) => {
        const blockId = ui.blockId ?? mapUi.block; // wheel sector filter (runs store) or the map store, one-way
        if (blockId && e.blockId !== blockId) return false;
        return true;
      })
      .slice()
      .reverse(); // newest first, like the deck
  }, [events, ui, mapUi.block, runId]);

  const filters = [
    ui.agentId ? { key: "agent", text: `agent: ${ui.agentId}` } : null,
    ui.laneKind ? { key: "kind", text: ui.laneKind } : null,
    ui.window ? { key: "window", text: `${fmt(ui.window.start)}–${fmt(ui.window.end)} min` } : null,
    ui.verdict ? { key: "verdict", text: `verdict: ${ui.verdict}` } : null,
    (ui.blockId ?? mapUi.block) ? { key: "block", text: `block: ${ui.blockId ?? mapUi.block}` } : null,
  ].filter(Boolean) as { key: string; text: string }[];

  const anyFilter = filters.length > 0;

  return (
    <div data-testid="wb-ledger" className="flex min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] text-muted-foreground">
        <span>
          {filtered.length} of {events.length} events · run #{runId} · every row = one ledger event in .kula/runs/{runId}.jsonl
          <span className="ml-1 lowercase normal-case tracking-normal">MOCK</span>
        </span>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            data-testid={`wb-ledger-filter-${f.key}`}
            onClick={() =>
              setRunsUi(
                f.key === "agent"
                  ? { agentId: null }
                  : f.key === "kind"
                    ? { laneKind: null }
                    : f.key === "window"
                      ? { window: null }
                      : f.key === "verdict"
                        ? { verdict: null }
                        : { blockId: null },
              )
            }
            className="flex cursor-pointer items-center gap-1 border border-border px-1.5 py-0.5 hover:text-foreground"
          >
            {f.text} <X size={8} />
          </button>
        ))}
        {anyFilter && (
          <button
            type="button"
            data-testid="wb-ledger-clear"
            onClick={() => clearRunsFilters()}
            className="cursor-pointer text-accent hover:underline"
          >
            clear
          </button>
        )}
      </div>
      <Table data-testid="wb-ledger-table">
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">t</TableHead>
            <TableHead className="w-24">agent</TableHead>
            <TableHead className="w-20">event</TableHead>
            <TableHead>target</TableHead>
            <TableHead className="w-20 text-right">tok in</TableHead>
            <TableHead className="w-20 text-right">tok out</TableHead>
            <TableHead className="w-20">verdict</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((e) => (
            <TableRow
              key={`${e.time}-${e.agentId}-${e.target}`}
              data-testid={`wb-ledger-row-${e.agentId}-${e.event}`}
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  if (e.blockId) setRunsUi({ agentId: e.agentId });
                }
              }}
              className={cn("cursor-pointer", ui.agentId === e.agentId && "bg-secondary/60")}
            >
              <TableCell className="tabular-nums">{e.time}</TableCell>
              <TableCell>{e.agentId}</TableCell>
              <TableCell>{e.event}</TableCell>
              <TableCell className="max-w-80 truncate font-mono">{e.target}</TableCell>
              <TableCell className="text-right tabular-nums">{formatTokens(e.tokensIn)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatTokens(e.tokensOut)}</TableCell>
              <TableCell className={VERDICT_CLASS[e.verdict]}>{e.verdict}</TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                No events match the current filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// matchKind – an event matches a lane kind when its verdict agrees with the
// bar colour: blocked bars hold verdicts blocked/error, working ones ok/review.
function matchKind(e: { verdict: Verdict }, kind: string): boolean {
  if (kind === "blocked") return e.verdict === "blocked" || e.verdict === "error";
  if (kind === "waiting") return e.verdict === "review";
  return e.verdict === "ok";
}

// minuteOf – minutes from the mock run start (14:18).
function minuteOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m - (14 * 60 + 18);
}

function fmt(minute: number): string {
  const total = 14 * 60 + 18 + minute;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
