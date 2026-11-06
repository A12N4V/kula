// W2 – typed mocks for what the API does not expose yet: fences on blocks,
// owners and token spend. Every mocked slot carries a MOCK tag in the UI.
// Fences / owners / spend have no /api endpoint in canvas-flows today.
import type { Stage } from "@/workbench/map/stage";

export type FenceLevel = "locked" | "review" | "hidden";
export interface MockFence {
  id: string;
  path: string;
  level: FenceLevel;
  followsRenames: boolean;
  blockedAttempts7d: number;
  attemptsBy: string[];
}

export const mockFences: MockFence[] = [
  { id: "f1", path: "src/guard.rs", level: "locked", followsRenames: true, blockedAttempts7d: 5, attemptsBy: ["coder-1", "codex"] },
  { id: "f2", path: "src/isolate.rs", level: "locked", followsRenames: true, blockedAttempts7d: 2, attemptsBy: ["codex"] },
  { id: "f3", path: "src/agent_config.rs", level: "locked", followsRenames: false, blockedAttempts7d: 0, attemptsBy: [] },
  { id: "f4", path: "src/index/", level: "review", followsRenames: true, blockedAttempts7d: 3, attemptsBy: ["coder-1"] },
  { id: "f5", path: "web/src/workbench/", level: "review", followsRenames: true, blockedAttempts7d: 1, attemptsBy: ["w2"] },
  { id: "f6", path: "src/lang_cmd.rs", level: "review", followsRenames: false, blockedAttempts7d: 0, attemptsBy: [] },
  { id: "f7", path: "film/", level: "hidden", followsRenames: false, blockedAttempts7d: 0, attemptsBy: [] },
];

export const fenceLevelOf = (dir: string): FenceLevel | null => {
  const hit = mockFences.find((f) => dir.startsWith(f.path) || f.path.startsWith(dir));
  return hit?.level ?? null;
};

export const mockOwners: Record<string, string> = {
  src: "coder-1",
  "src/map": "codex",
  web: "w2",
  film: "design",
};

export const ownerOf = (dir: string): string => {
  const keys = Object.keys(mockOwners).sort((a, b) => b.length - a.length);
  return keys.find((k) => dir.startsWith(k)) ? mockOwners[keys.find((k) => dir.startsWith(k))!] : "unassigned";
};

// spend per block over 7D, tokens only (no dollars) – from the ledger shape
export const mockSpend: Record<string, number> = {
  src: 412_000,
  "src/index": 301_000,
  "src/map": 212_000,
  "web/src/views": 96_000,
  "web/src/workbench": 88_000,
};

export const spendOf = (dir: string): number => mockSpend[dir] ?? 0;

export const STAGE_COLORS: Record<Stage, string> = {
  entry: "#8a8a8a",
  ingest: "#6e6e6e",
  transform: "#565656",
  decide: "#3f3f3f",
  effect: "#2a2a2a",
};

export const ACCENT = "#ff5a1f";
