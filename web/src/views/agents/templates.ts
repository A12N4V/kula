// Starting points for research loops and teams. A loop template knows the
// command for each stack it supports (the server says which this repository
// is built with); a team template names seats, and the agents connected here
// fill them in order.

import type { Team } from "../../api";
import { AGENT_IDS } from "./data";

export type Stack = "rust" | "node" | "python" | "go" | "make";

export interface LoopTemplate {
  id: string; title: string; about: string; goal: "min" | "max"; budget: number; scope: string[]; prompt: string;
  /** The metric per stack; `any` when it does not depend on one. */
  metric: Partial<Record<Stack | "any", string>>;
}

const count = (cmd: string, pat: string) => `${cmd} 2>&1 | grep -c '${pat}'`;
const failed = (cmd: string) => `${cmd} 2>&1 | grep -Eo '[0-9]+ failed' | awk '{s+=$1} END {print s+0}'`;
const seconds = (cmd: string) => `/usr/bin/time -p ${cmd} 2>&1 >/dev/null | awk '/^real/ {print $2}'`;

export const LOOP_TEMPLATES: LoopTemplate[] = [
  {
    id: "faster-tests", title: "Faster tests", about: "Seconds the test suite takes; agents may not touch the tests themselves.", goal: "min", budget: 20, scope: ["src/**"],
    prompt: "Make the test suite faster without changing what it checks. Profile first; one change per experiment.",
    metric: { rust: seconds("cargo test --quiet"), node: seconds("npm test --silent"), python: seconds("python -m pytest -q"), go: seconds("go test ./..."), make: seconds("make test") },
  },
  {
    id: "fix-failures", title: "Fewer failing tests", about: "Failing tests, down to zero. Each kept step is a commit that fixed something.", goal: "min", budget: 30, scope: ["src/**"],
    prompt: "Read the failures, fix the code (never the test), one failure per experiment.",
    metric: { rust: failed("cargo test"), node: failed("npm test --silent"), python: failed("python -m pytest -q"), go: `go test ./... 2>&1 | grep -c '^--- FAIL'` },
  },
  {
    id: "lint", title: "Fewer lint warnings", about: "Warnings from the linter; a safe first loop for a new team.", goal: "min", budget: 40, scope: ["src/**"],
    prompt: "Fix lint warnings without changing behaviour. Group warnings of one kind into one experiment.",
    metric: { rust: count("cargo clippy --quiet", "^warning"), node: `npx eslint . -f unix 2>/dev/null | grep -c ':'`, python: `ruff check . -q 2>/dev/null | grep -c ':'`, go: `go vet ./... 2>&1 | grep -c ':'` },
  },
  {
    id: "type-errors", title: "Fewer type errors", about: "Errors from the type checker while tightening types.", goal: "min", budget: 30, scope: ["src/**"],
    prompt: "Fix type errors at their source; never silence them with casts or ignores.",
    metric: { node: count("npx tsc --noEmit", "error TS"), python: count("mypy .", "error:") },
  },
  {
    id: "coverage", title: "More coverage", about: "Line coverage in percent – agents write tests, the code under test stays put.", goal: "max", budget: 25, scope: ["tests/**", "**/*test*"],
    prompt: "Add tests for the least covered code that matters. Tests must assert behaviour, not just run lines.",
    metric: {
      rust: `cargo llvm-cov --summary-only 2>/dev/null | awk '/^TOTAL/ {print $(NF-3)}' | tr -d %`,
      python: `python -m pytest -q --cov 2>/dev/null | awk '/^TOTAL/ {print $NF}' | tr -d %`,
      node: `npx vitest run --coverage 2>/dev/null | awk -F'|' '/All files/ {print $2}'`,
      go: `go test -cover ./... 2>/dev/null | grep -Eo '[0-9.]+%' | tr -d % | awk '{s+=$1;n++} END {print n ? s/n : 0}'`,
    },
  },
  {
    id: "bundle", title: "Smaller bundle", about: "Kilobytes of the production build.", goal: "min", budget: 20, scope: ["src/**"],
    prompt: "Shrink the build: dead code, heavy imports, duplicate dependencies. Behaviour stays the same.",
    metric: { node: "npm run build --silent >/dev/null 2>&1 && du -sk dist | cut -f1", rust: "cargo build --release --quiet && du -sk target/release | cut -f1" },
  },
  {
    id: "benchmark", title: "A benchmark of yours", about: "Any command whose last printed number is the score.", goal: "min", budget: 20, scope: ["src/**"],
    prompt: "Improve the benchmark. Explain the hypothesis before each experiment.",
    metric: { any: "" },
  },
];

/** The template's command for this repository, and whether it is a real fit. */
export function metricFor(t: LoopTemplate, stack: string[]): { cmd: string; fits: boolean } {
  const s = stack.find((x) => (t.metric as Record<string, string>)[x] !== undefined);
  if (s) return { cmd: (t.metric as Record<string, string>)[s], fits: true };
  if (t.metric.any !== undefined) return { cmd: t.metric.any, fits: true };
  return { cmd: Object.values(t.metric)[0] ?? "", fits: false };
}

export interface TeamTemplate {
  id: string; title: string; about: string; prompt: string;
  /** Seats in order; `lead` answers to nobody, the rest answer to the seat named. */
  seats: { role: string; workflow: string; reports_to?: number; hands_off?: number[]; prompt?: string }[];
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "ship", title: "Ship a feature", about: "A lead builds, a second agent writes the tests, a third reviews before anything merges.",
    prompt: "Ship the feature in the task. Keep changes small and reviewable.",
    seats: [
      { role: "lead", workflow: "fix", hands_off: [1] },
      { role: "tests", workflow: "tests", reports_to: 0, hands_off: [2] },
      { role: "review", workflow: "explore", reports_to: 0, prompt: "Review only: report problems to the lead, change nothing." },
    ],
  },
  {
    id: "bug-hunt", title: "Bug hunt", about: "One agent reproduces and narrows the bug, one fixes it, one pins it with a regression test.",
    prompt: "Find the cause before changing code. A fix without a failing test first is not done.",
    seats: [
      { role: "triage", workflow: "explore", hands_off: [1] },
      { role: "fix", workflow: "fix", reports_to: 0, hands_off: [2] },
      { role: "regression test", workflow: "tests", reports_to: 0 },
    ],
  },
  {
    id: "swarm", title: "Research swarm", about: "Every agent attacks the same loop. Each builds on the current best; kula keeps only what beats it.",
    prompt: "Work the research loop. Read the frontier and what failed before proposing; one hypothesis per experiment.",
    seats: [
      { role: "lead", workflow: "@loop" },
      { role: "solver", workflow: "@loop", reports_to: 0 },
      { role: "solver", workflow: "@loop", reports_to: 0 },
      { role: "solver", workflow: "@loop", reports_to: 0 },
    ],
  },
  {
    id: "refactor", title: "Safe refactor", about: "A lead restructures inside its scope while tests guard behaviour and docs follow.",
    prompt: "Restructure without changing behaviour. Tests pass before and after every step.",
    seats: [
      { role: "lead", workflow: "refactor", hands_off: [1, 2] },
      { role: "tests", workflow: "tests", reports_to: 0 },
      { role: "docs", workflow: "docs", reports_to: 0 },
    ],
  },
  {
    id: "docs", title: "Docs pass", about: "One agent reads the code and writes the docs; another checks them against the code.",
    prompt: "Docs describe what the code does today. Link symbols, not line numbers.",
    seats: [
      { role: "writer", workflow: "docs", hands_off: [1] },
      { role: "fact check", workflow: "explore", reports_to: 0 },
    ],
  },
  {
    id: "solo", title: "Just a lead", about: "One agent, one workflow. Add seats as the work grows.",
    prompt: "",
    seats: [{ role: "lead", workflow: "explore" }],
  },
];

/** A team from a template: connected agents first, then the rest, one per seat. */
export function teamFrom(t: TeamTemplate, name: string, connected: string[], loop: string): Team {
  const pool = [...connected.filter((a) => AGENT_IDS.includes(a)), ...AGENT_IDS.filter((a) => !connected.includes(a))];
  const agent = (i: number) => pool[i] ?? `agent-${i + 1}`;
  return {
    name, about: t.about, prompt: t.prompt,
    members: t.seats.map((s, i) => ({
      agent: agent(i), role: s.role, workflow: s.workflow === "@loop" ? loop : s.workflow,
      reports_to: s.reports_to !== undefined ? agent(s.reports_to) : "", hands_off: (s.hands_off ?? []).map(agent), prompt: s.prompt ?? "",
    })),
  };
}
