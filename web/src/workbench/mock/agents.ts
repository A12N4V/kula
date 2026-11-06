// W4 – typed mocks for the agents activity (deck p.9/p.10, PLAN §3–5):
// connectors summary, team + agents, memory access matrix, memory files with
// revisions. Everything mocked here is marked MOCK in the UI by the components
// that read it. No module-load side effects, no real file writes – saving a
// memory or config produces a diff object (see saveMemoryDraft in files.ts).

export type ConnectorKind = "harnesses" | "mcp" | "skills" | "hooks" | "services";

export interface Connector {
  id: string;
  kind: ConnectorKind;
  name: string;
  /** Glance level: one number per line (deck p.9 note 1). */
  count: number;
  /** ok | drift | down – status dot; drift/down render in the accent. */
  status: "ok" | "drift" | "down";
  /** kula:// path of its config file, opened on click. */
  config: string;
}

export const MOCK_CONNECTORS: Connector[] = [
  { id: "harness-claude-code", kind: "harnesses", name: "claude-code", count: 2, status: "ok", config: "kula://connectors/harnesses.toml" },
  { id: "harness-codex", kind: "harnesses", name: "codex", count: 1, status: "ok", config: "kula://connectors/harnesses.toml" },
  { id: "harness-gemini", kind: "harnesses", name: "gemini", count: 1, status: "down", config: "kula://connectors/harnesses.toml" },
  { id: "mcp-kula", kind: "mcp", name: "kula", count: 14, status: "ok", config: "kula://connectors/mcp.json" },
  { id: "mcp-github", kind: "mcp", name: "github", count: 8, status: "ok", config: "kula://connectors/mcp.json" },
  { id: "mcp-lark", kind: "mcp", name: "lark", count: 6, status: "ok", config: "kula://connectors/mcp.json" },
  { id: "skills", kind: "skills", name: "skills", count: 9, status: "drift", config: "kula://connectors/skills" },
  { id: "hook-pre-edit", kind: "hooks", name: "pre-edit", count: 1, status: "ok", config: "kula://connectors/harnesses.toml" },
  { id: "hook-post-edit", kind: "hooks", name: "post-edit", count: 1, status: "ok", config: "kula://connectors/harnesses.toml" },
  { id: "service-git", kind: "services", name: "git", count: 1, status: "ok", config: "kula://connectors/harnesses.toml" },
  { id: "service-ci", kind: "services", name: "ci", count: 1, status: "ok", config: "kula://connectors/harnesses.toml" },
];

export interface MemoryAccessRow {
  folder: string;
  read: boolean;
  write: boolean;
  authored: number;
  last: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  harness: string;
  model: string;
  workflow: string;
  scope: string[];
  budget: number;
  mcp: string[];
  skills: string[];
  /** kula:// config file path for this agent. */
  file: string;
  wave: number;
  handoffsTo: string[];
  reportsTo: string | null;
  access: MemoryAccessRow[];
}

export const TEAM_ID = "map-rework";

export const MOCK_AGENTS: AgentConfig[] = [
  {
    id: "planner",
    name: "planner",
    harness: "claude-code",
    model: "opus",
    workflow: "research",
    scope: ["src/**"],
    budget: 800_000,
    mcp: ["kula"],
    skills: ["kula"],
    file: "kula://teams/map-rework/planner.toml",
    wave: 1,
    handoffsTo: ["coder-1", "coder-2"],
    reportsTo: null,
    access: [
      { folder: "map engine", read: true, write: false, authored: 4, last: "11-04" },
      { folder: "indexer", read: true, write: true, authored: 0, last: "11-02" },
      { folder: "guard", read: true, write: false, authored: 0, last: "10-29" },
      { folder: "arch (tag)", read: true, write: false, authored: 0, last: "–" },
    ],
  },
  {
    id: "coder-1",
    name: "coder-1",
    harness: "claude-code",
    model: "opus",
    workflow: "fix",
    scope: ["src/map/**"],
    budget: 1_000_000,
    mcp: ["kula"],
    skills: ["kula", "rust-test"],
    file: "kula://teams/map-rework/coder-1.toml",
    wave: 2,
    handoffsTo: ["critic"],
    reportsTo: "planner",
    access: [
      { folder: "map engine", read: true, write: true, authored: 5, last: "11-04" },
      { folder: "indexer", read: true, write: false, authored: 0, last: "11-02" },
      { folder: "guard", read: true, write: false, authored: 0, last: "10-29" },
      { folder: "arch (tag)", read: true, write: false, authored: 0, last: "–" },
    ],
  },
  {
    id: "coder-2",
    name: "coder-2",
    harness: "codex",
    model: "gpt-5",
    workflow: "fix",
    scope: ["src/knowledge/**"],
    budget: 900_000,
    mcp: ["kula", "github"],
    skills: ["kula"],
    file: "kula://teams/map-rework/coder-2.toml",
    wave: 2,
    handoffsTo: ["critic"],
    reportsTo: "planner",
    access: [
      { folder: "map engine", read: true, write: false, authored: 2, last: "11-03" },
      { folder: "indexer", read: true, write: true, authored: 1, last: "11-01" },
      { folder: "guard", read: true, write: false, authored: 0, last: "10-29" },
      { folder: "arch (tag)", read: false, write: false, authored: 0, last: "–" },
    ],
  },
  {
    id: "critic",
    name: "critic",
    harness: "gemini",
    model: "pro",
    workflow: "review",
    scope: ["src/**"],
    budget: 400_000,
    mcp: ["kula"],
    skills: ["kula"],
    file: "kula://teams/map-rework/critic.toml",
    wave: 3,
    handoffsTo: [],
    reportsTo: "planner",
    access: [
      { folder: "map engine", read: true, write: false, authored: 1, last: "11-04" },
      { folder: "indexer", read: true, write: false, authored: 2, last: "11-04" },
      { folder: "guard", read: true, write: false, authored: 0, last: "10-30" },
      { folder: "arch (tag)", read: true, write: false, authored: 0, last: "–" },
    ],
  },
];

// MOCK memory files. Lines carry their own revision author + date, so the
// blame gutter is derived from the record (no hardcoded clock, per critic-w3).
export interface MemoryLine {
  text: string;
  by: string; // "AS" (you) | agent id
  at: string;
  rev: number;
}

export interface MemoryFile {
  /** kula:// path. */
  id: string;
  /** Anchor: content hash + freshness, from the meta ref (PLAN §5). */
  anchor: string;
  fresh: boolean;
  block: string;
  /** Human title, e.g. "0007 walk-tree order". */
  title: string;
  lines: MemoryLine[];
  /** Revisions, newest first (r3, r2, r1). */
  history: { rev: number; date: string; by: string; run: number | null; lines: number }[];
}

export const MOCK_MEMORIES: MemoryFile[] = [
  {
    id: "kula://memory/by-block/indexer/0007-walk-tree-order.md",
    anchor: "indexer::parse::walk_tree @ 9f3a…",
    fresh: true,
    block: "indexer",
    title: "0007 walk-tree order",
    lines: [
      { text: "# walk_tree visits children in source order", by: "AS", at: "10-28", rev: 1 },
      { text: "", by: "AS", at: "10-28", rev: 1 },
      { text: "Order matters: the resolver walks defs in tree order,", by: "coder-1", at: "11-04", rev: 2 },
      { text: "so a def listed later shadows an earlier one with the", by: "coder-1", at: "11-04", rev: 2 },
      { text: "same name. Do not parallelise per-child.", by: "coder-1", at: "11-04", rev: 2 },
      { text: "", by: "coder-1", at: "11-04", rev: 2 },
      { text: "Confirmed by critic after re-run in #40: 3 tests green.", by: "critic", at: "11-04", rev: 3 },
    ],
    history: [
      { rev: 3, date: "11-04", by: "critic", run: 40, lines: 1 },
      { rev: 2, date: "11-04", by: "coder-1", run: 40, lines: 4 },
      { rev: 1, date: "10-28", by: "AS", run: null, lines: 2 },
    ],
  },
  {
    id: "kula://memory/by-block/indexer/0003-cache-key.md",
    anchor: "indexer::cache::key @ b1c2…",
    fresh: false,
    block: "indexer",
    title: "0003 cache key",
    lines: [
      { text: "Resolution depends on it: later defs shadow earlier.", by: "AS", at: "10-28", rev: 1 },
      { text: "Stale since the cache split in 0009 – confirm or edit.", by: "AS", at: "10-28", rev: 1 },
    ],
    history: [{ rev: 1, date: "10-28", by: "AS", run: null, lines: 2 }],
  },
  {
    id: "kula://memory/by-block/map-engine/0002-wheel-layout.md",
    anchor: "map::wheel::layout @ 4d11…",
    fresh: true,
    block: "map engine",
    title: "0002 wheel layout",
    lines: [
      { text: "Sector order is slot-persisted, never reshuffled.", by: "coder-1", at: "11-03", rev: 1 },
      { text: "Chords sort by barycentre, two sweeps, per PLAN §2.", by: "coder-1", at: "11-03", rev: 1 },
    ],
    history: [{ rev: 1, date: "11-03", by: "coder-1", run: 41, lines: 2 }],
  },
];

// Reads · 7d per agent from ledger memory.read events (deck p.10 note 4).
export const MOCK_READS: Record<string, number> = { planner: 3, "coder-1": 2, "coder-2": 1, critic: 1 };
