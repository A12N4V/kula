// Starting points for research loops and teams. A loop template knows the
// command for each stack it supports (the server says which this repository
// is built with); a team template names seats, and the agents connected here
// fill them in order.

import { namesFor } from "../../roster";
import type { Team } from "../../api";

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

/** A team from a template: one named generic agent per seat, run by whichever
 * agent is connected (`connected` is kept for callers; seats are not pinned). */
export function teamFrom(t: TeamTemplate, name: string, _connected: string[], loop: string): Team {
  const names = namesFor(name, t.seats.length);
  const agent = (i: number) => names[i]; // seats point at each other by name
  return {
    name, about: t.about, prompt: t.prompt,
    members: t.seats.map((s, i) => ({
      name: names[i], agent: "", role: s.role, workflow: s.workflow === "@loop" ? loop : s.workflow,
      reports_to: s.reports_to !== undefined ? agent(s.reports_to) : "", hands_off: (s.hands_off ?? []).map(agent), prompt: s.prompt ?? "",
    })),
  };
}
