// W3 – typed mocks for runs and the ledger. There is no /api/runs or ledger
// endpoint in web/src/api.ts (verified in guidance-w3), so this is a mock in
// the JSONL shape from PLAN build item 1 (.kula/runs, kula runs, kula
// ledger): time, agent, event, target, tokens in, tokens out, verdict.
// Tokens and credits only – never dollars.

export type Verdict = "ok" | "review" | "blocked" | "error";

export interface Run {
  id: number;
  title: string;
  state: "live" | "done";
  tokens: number;
  credits: number | null;
  agents: string[];
  /** Wall-clock start as HH:MM, drives the lane time axis label. */
  start: string;
  /** Minutes covered by the run (lane axis span). */
  minutes: number;
}

export interface RunAgent {
  id: string;
  kind: string;
  task: string;
  tokensIn: number;
  tokensOut: number;
  credits: number | null;
  toolCalls: number;
  filesEdited: number;
}

/** One lane segment: kind maps 1:1 to the deck's black / grey / orange bars. */
export type LaneKind = "working" | "waiting" | "blocked";

export interface LaneSegment {
  id: string;
  agentId: string;
  kind: LaneKind;
  /** Minutes from run start (0-based), inclusive. */
  start: number;
  end: number;
}

export interface LedgerEvent {
  /** HH:MM wall-clock time, newest last in the file, newest first in the UI. */
  time: string;
  agentId: string;
  event: "edit" | "read" | "bash" | "handoff" | "spawn" | "memory" | "fence";
  /** Target symbol, file, or hand-off text – free-form JSONL field. */
  target: string;
  /** Touched block id on the map (for the wheel → ledger filter). */
  blockId?: string;
  tokensIn: number;
  tokensOut: number;
  verdict: Verdict;
}

export const MOCK_RUNS: Run[] = [
  { id: 42, title: "swarm wave 2", state: "live", tokens: 1_274_000, credits: null, agents: ["planner", "coder-1", "coder-2", "critic"], start: "14:18", minutes: 32 },
  { id: 41, title: "research: bench", state: "done", tokens: 1_902_000, credits: 640, agents: ["planner", "researcher"], start: "09:02", minutes: 46 },
  { id: 40, title: "fix guard glob", state: "done", tokens: 310_000, credits: 210, agents: ["coder-1"], start: "08:40", minutes: 12 },
  { id: 39, title: "manual · claude", state: "done", tokens: 88_000, credits: 0, agents: ["claude-code"], start: "08:15", minutes: 9 },
];

export const MOCK_AGENTS: Record<number, RunAgent[]> = {
  42: [
    { id: "planner", kind: "kula · planner", task: "plan build order", tokensIn: 180_000, tokensOut: 50_000, credits: null, toolCalls: 12, filesEdited: 0 },
    { id: "coder-1", kind: "claude-code", task: "scope · workbench lanes", tokensIn: 640_000, tokensOut: 92_000, credits: null, toolCalls: 188, filesEdited: 27 },
    { id: "coder-2", kind: "claude-code", task: "exit · ledger table", tokensIn: 120_000, tokensOut: 18_000, credits: null, toolCalls: 54, filesEdited: 8 },
    { id: "critic", kind: "kula · critic", task: "review parse", tokensIn: 312_000, tokensOut: 0, credits: null, toolCalls: 31, filesEdited: 0 },
  ],
  41: [
    { id: "planner", kind: "kula · planner", task: "bench plan", tokensIn: 400_000, tokensOut: 60_000, credits: null, toolCalls: 20, filesEdited: 0 },
    { id: "researcher", kind: "kula · researcher", task: "codemap pass 3", tokensIn: 1_300_000, tokensOut: 142_000, credits: 640, toolCalls: 61, filesEdited: 3 },
  ],
  40: [{ id: "coder-1", kind: "claude-code", task: "fix guard glob", tokensIn: 240_000, tokensOut: 70_000, credits: 210, toolCalls: 44, filesEdited: 6 }],
  39: [{ id: "claude-code", kind: "claude-code", task: "interactive session", tokensIn: 70_000, tokensOut: 18_000, credits: 0, toolCalls: 9, filesEdited: 2 }],
};

/** Lane segments per run – every segment fits inside its run's minutes. */
export const MOCK_LANES: Record<number, LaneSegment[]> = {
  42: [
    { id: "l-1", agentId: "planner", kind: "working", start: 0, end: 3 },
    { id: "l-2", agentId: "planner", kind: "waiting", start: 4, end: 9 },
    { id: "l-3", agentId: "planner", kind: "working", start: 10, end: 14 },
    { id: "l-4", agentId: "coder-1", kind: "waiting", start: 0, end: 4 },
    { id: "l-5", agentId: "coder-1", kind: "working", start: 5, end: 10 },
    { id: "l-6", agentId: "coder-1", kind: "blocked", start: 11, end: 11 },
    { id: "l-7", agentId: "coder-1", kind: "working", start: 12, end: 14 },
    { id: "l-8", agentId: "coder-2", kind: "waiting", start: 0, end: 9 },
    { id: "l-9", agentId: "coder-2", kind: "working", start: 10, end: 10 },
    { id: "l-10", agentId: "coder-2", kind: "waiting", start: 11, end: 14 },
    { id: "l-11", agentId: "critic", kind: "waiting", start: 0, end: 11 },
    { id: "l-12", agentId: "critic", kind: "working", start: 12, end: 13 },
    { id: "l-13", agentId: "critic", kind: "blocked", start: 14, end: 14 },
  ],
  41: [
    { id: "l-1", agentId: "planner", kind: "working", start: 0, end: 8 },
    { id: "l-2", agentId: "planner", kind: "waiting", start: 9, end: 14 },
    { id: "l-3", agentId: "researcher", kind: "waiting", start: 0, end: 12 },
    { id: "l-4", agentId: "researcher", kind: "working", start: 13, end: 38 },
    { id: "l-5", agentId: "researcher", kind: "blocked", start: 39, end: 41 },
    { id: "l-6", agentId: "researcher", kind: "working", start: 42, end: 45 },
  ],
  40: [
    { id: "l-1", agentId: "coder-1", kind: "working", start: 0, end: 6 },
    { id: "l-2", agentId: "coder-1", kind: "blocked", start: 7, end: 8 },
    { id: "l-3", agentId: "coder-1", kind: "working", start: 9, end: 11 },
  ],
  39: [{ id: "l-1", agentId: "claude-code", kind: "working", start: 0, end: 8 }],
};

/** Minutes-since-midnight for a run's HH:MM start – one source for the axis. */
export function runStartMinutes(start: string): number {
  const [h, m] = start.split(":").map(Number);
  return h * 60 + m;
}

/** Touched block ids per run – wheel sectors light up for these. */
export const MOCK_TOUCHED_BLOCKS: Record<number, string[]> = {
  42: ["1", "4", "6", "8"], // real staged block ids (src · mcp, web/src · api, src/index · packs, src · config)
  41: ["2"],
  40: ["8"],
  39: [],
};

export const MOCK_LEDGER: Record<number, LedgerEvent[]> = {
  42: [
    { time: "14:18", agentId: "planner", event: "spawn", target: "run #42 · build order item 1", blockId: "6", tokensIn: 4_200, tokensOut: 610, verdict: "ok" },
    { time: "14:19", agentId: "planner", event: "read", target: "src/index/mod.rs", blockId: "6", tokensIn: 9_800, tokensOut: 40, verdict: "ok" },
    { time: "14:21", agentId: "planner", event: "handoff", target: "→ coder-1 \"lanes\"", blockId: "4", tokensIn: 600, tokensOut: 210, verdict: "ok" },
    { time: "14:23", agentId: "coder-1", event: "read", target: "web/src/workbench/kit/lane-chart", blockId: "4", tokensIn: 12_400, tokensOut: 88, verdict: "ok" },
    { time: "14:25", agentId: "coder-1", event: "edit", target: "src/hash.rs::parse_hash", blockId: "6", tokensIn: 4_100, tokensOut: 612, verdict: "review" },
    { time: "14:27", agentId: "coder-1", event: "bash", target: "cargo test -j 4 index::", blockId: "6", tokensIn: 2_200, tokensOut: 90, verdict: "ok" },
    { time: "14:28", agentId: "coder-2", event: "edit", target: "web/src/api.ts", blockId: "4", tokensIn: 1_000, tokensOut: 0, verdict: "blocked" },
    { time: "14:28", agentId: "coder-2", event: "memory", target: "remember lane-axis-slot-width", blockId: "4", tokensIn: 900, tokensOut: 44, verdict: "ok" },
    { time: "14:29", agentId: "coder-1", event: "edit", target: "src/guard.rs::fence_glob", blockId: "8", tokensIn: 1_000, tokensOut: 0, verdict: "blocked" },
    { time: "14:30", agentId: "critic", event: "read", target: "src/guard.rs", blockId: "8", tokensIn: 9_800, tokensOut: 40, verdict: "ok" },
    { time: "14:30", agentId: "coder-1", event: "bash", target: "cargo test -j 4 index::", blockId: "6", tokensIn: 2_200, tokensOut: 90, verdict: "ok" },
    { time: "14:31", agentId: "coder-1", event: "edit", target: "src/index/parse.rs::walk_tree", blockId: "6", tokensIn: 4_100, tokensOut: 612, verdict: "review" },
    { time: "14:32", agentId: "critic", event: "handoff", target: "→ coder-1 \"narrow lane labels\"", blockId: "4", tokensIn: 700, tokensOut: 180, verdict: "error" },
    { time: "14:32", agentId: "coder-1", event: "fence", target: "review src/index/**", blockId: "6", tokensIn: 300, tokensOut: 0, verdict: "review" },
  ],
  41: [
    { time: "09:02", agentId: "planner", event: "spawn", target: "run #41 · bench", blockId: "2", tokensIn: 3_000, tokensOut: 500, verdict: "ok" },
    { time: "09:10", agentId: "researcher", event: "read", target: "src/codemap/passes.rs", blockId: "2", tokensIn: 40_000, tokensOut: 120, verdict: "ok" },
    { time: "09:30", agentId: "researcher", event: "bash", target: "cargo bench codemap", blockId: "2", tokensIn: 8_000, tokensOut: 300, verdict: "ok" },
    { time: "09:33", agentId: "researcher", event: "edit", target: "src/codemap/passes.rs::rank", blockId: "2", tokensIn: 5_000, tokensOut: 640, verdict: "review" },
  ],
  40: [
    { time: "08:41", agentId: "coder-1", event: "edit", target: "src/guard.rs::fence_glob", blockId: "8", tokensIn: 5_000, tokensOut: 700, verdict: "ok" },
  ],
  39: [
    { time: "08:16", agentId: "claude-code", event: "read", target: "kula.toml", blockId: undefined, tokensIn: 1_500, tokensOut: 20, verdict: "ok" },
  ],
};

// formatTokens – 1.27M / 4.1k, tokens and credits only, no dollars.
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
