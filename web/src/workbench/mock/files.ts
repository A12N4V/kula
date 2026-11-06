// W4 – the one auditable kula:// tree → file content map (guidance-w4 risk 3):
// every tree row and file badge resolves its content here and nowhere else.
// Writes are mocks: saveFile returns a diff object and never touches disk.

import { MOCK_AGENTS } from "@/workbench/mock/agents";

export interface VFile {
  /** Real source the virtual file maps to, shown in the file header (PLAN §4). */
  source: string;
  /** Read-only for agents (fences.toml, runs); editable otherwise. */
  readOnly: boolean;
  lines: string[];
}

export interface FileDiff {
  path: string;
  /** Changed line numbers (1-based, into the pre-edit content). */
  hunks: { line: number; before: string; after: string }[];
}

export function isEditable(path: string): boolean {
  const f = MOCK_FILES[path];
  return !!f && !f.readOnly;
}

export function getFile(path: string): VFile | undefined {
  return MOCK_FILES[path];
}

// saveFile – the mock write: returns the diff the panel shows first
// (deck p.11 level 3: saves show a diff before they land). Pure, no fs.
export function saveFile(path: string, edited: string[]): FileDiff | null {
  const f = MOCK_FILES[path];
  if (!f || f.readOnly) return null;
  const before = f.lines;
  const hunks: FileDiff["hunks"] = [];
  const n = Math.max(before.length, edited.length);
  for (let i = 0; i < n; i++) {
    if ((before[i] ?? "") !== (edited[i] ?? "")) {
      hunks.push({ line: i + 1, before: before[i] ?? "", after: edited[i] ?? "" });
    }
  }
  return hunks.length ? { path, hunks } : null;
}

const agentToml = (id: string) => {
  const a = MOCK_AGENTS.find((ag) => ag.id === id)!;
  return [
    `# source: kula.toml [agents.${id}]`,
    `harness = "${a.harness}"`,
    `model = "${a.model}"`,
    `workflow = "${a.workflow}"`,
    `scope = [${a.scope.map((s) => `"${s}"`).join(", ")}]`,
    `budget = ${a.budget.toLocaleString("en-US").replace(/,/g, "_")}`,
    `skills = [${a.skills.map((s) => `"${s}"`).join(", ")}]`,
    `mcp = [${a.mcp.map((s) => `"${s}"`).join(", ")}]`,
    "",
    `[agents.${id}.memory]`,
    `read = [${a.access.filter((r) => r.read).map((r) => `"${r.folder}"`).join(", ")}]`,
    `write = [${a.access.filter((r) => r.write).map((r) => `"${r.folder}"`).join(", ")}]`,
  ];
};

export const MOCK_FILES: Record<string, VFile> = {
  "kula://connectors/harnesses.toml": {
    source: "kula.toml [agents.*] + hook wiring",
    readOnly: false,
    lines: [
      "# source: kula.toml [agents.*] + hook wiring",
      "[harnesses]",
      'claude-code = { bin = "claude", version = "2.1" }',
      'codex = { bin = "codex", version = "0.4" }',
      'gemini = { bin = "gemini", version = "1.9" }   # down – bin not found',
      "",
      "[hooks]",
      'pre-edit = "kula guard check --stdin"',
      'post-edit = "kula index touch --stdin"',
    ],
  },
  "kula://connectors/mcp.json": {
    source: ".mcp.json",
    readOnly: false,
    lines: [
      "// source: .mcp.json",
      "{",
      '  "kula":   { "command": "kula", "args": ["mcp"] },',
      '  "github": { "command": "github-mcp", "args": ["--read"] },',
      '  "lark":   { "command": "lark-mcp", "args": ["--read"] }',
      "}",
    ],
  },
  "kula://connectors/skills": {
    source: ".agents/skills/*/SKILL.md",
    readOnly: false,
    lines: [
      "# source: .agents/skills/*/SKILL.md – 9 skills, 1 drift",
      "kula         ok",
      "rust-test    drift – harness copy differs from .agents/skills",
      "wireframe    ok",
      "…(6 more, counts in the connectors line)",
    ],
  },
  "kula://teams/map-rework/team.toml": {
    source: "kula.toml [[team]]",
    readOnly: false,
    lines: [
      "# source: kula.toml [[team]]",
      'name = "map-rework"',
      'workflow = "fix"',
      'agents = ["planner", "coder-1", "coder-2", "critic"]',
      'wave_order = [1, 2, 3]',
    ],
  },
  "kula://teams/map-rework/planner.toml": { source: "kula.toml [agents.planner]", readOnly: false, lines: agentToml("planner") },
  "kula://teams/map-rework/coder-1.toml": { source: "kula.toml [agents.coder-1]", readOnly: false, lines: agentToml("coder-1") },
  "kula://teams/map-rework/coder-2.toml": { source: "kula.toml [agents.coder-2]", readOnly: false, lines: agentToml("coder-2") },
  "kula://teams/map-rework/critic.toml": { source: "kula.toml [agents.critic]", readOnly: false, lines: agentToml("critic") },
  "kula://teams/map-rework/prompts/coder-1.md": {
    source: "workflow prompt",
    readOnly: false,
    lines: [
      "# coder-1 · fix",
      "Fix the failing test with the smallest change that holds.",
      "Write or update an e2e test for the behaviour you fixed.",
      "Commit with a clear message; do not push.",
    ],
  },
  "kula://workflows/fix.toml": {
    source: "workflows/fix.toml",
    readOnly: false,
    lines: ["# source: workflows/fix.toml", 'name = "fix"', 'steps = ["reproduce", "fix", "test", "commit"]', 'memory = "write"'],
  },
  "kula://workflows/review.toml": {
    source: "workflows/review.toml",
    readOnly: false,
    lines: ["# source: workflows/review.toml", 'name = "review"', 'steps = ["diff", "audit", "report"]', 'memory = "read"'],
  },
  "kula://workflows/research.toml": {
    source: "workflows/research.toml",
    readOnly: false,
    lines: ["# source: workflows/research.toml", 'name = "research"', 'steps = ["question", "search", "verify", "report"]', 'memory = "read"'],
  },
  "kula://fences.toml": {
    source: "kula.toml [[guard]]",
    readOnly: true,
    lines: [
      "# source: kula.toml [[guard]] – locked config: read-only for agents",
      "[[guard]]",
      'path = "kula.toml"',
      'level = "locked"',
    ],
  },
  "kula://memory/by-block/indexer/0007-walk-tree-order.md": { source: "refs/kula/meta note 7", readOnly: false, lines: [] },
  "kula://memory/by-block/indexer/0003-cache-key.md": { source: "refs/kula/meta note 3", readOnly: false, lines: [] },
  "kula://memory/by-block/map-engine/0002-wheel-layout.md": { source: "refs/kula/meta note 2", readOnly: false, lines: [] },
  "kula://runs/42.jsonl": {
    source: ".kula/runs/42.jsonl",
    readOnly: true,
    lines: [
      '{"t":"14:02","agent":"planner","event":"plan.ready","target":"fix #41"}',
      '{"t":"14:03","agent":"coder-1","event":"edit.apply","target":"src/map/wheel.rs"}',
      '{"t":"14:09","agent":"critic","event":"verdict","target":"pass"}',
    ],
  },
  "kula://runs/41.jsonl": { source: ".kula/runs/41.jsonl", readOnly: true, lines: ['{"t":"09:12","agent":"planner","event":"plan.ready","target":"research"}'] },
};
