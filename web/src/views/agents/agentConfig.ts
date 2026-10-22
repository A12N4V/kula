// U3 · per-agent operating config: autonomy, cost/time/files caps. The
// backend has no field for these on a workflow yet (Workflow carries name,
// about, scope, fences, memory) – the ask-backend request for
// POST /api/agents/agent_config is filed; until it lands this module keeps
// the same shape behind localStorage so the swap is one function each.
import type { Workflow } from "../../api";

export type Autonomy = "ask" | "ask-risky" | "auto";

export type Caps = { cost?: number; time?: number; files?: number };

export type AgentCfg = { autonomy: Autonomy; caps: Caps };

const KEY = "kula.agents.cfg";

/** Read every agent's stored config (one JSON document, cheap and atomic). */
export function readCfgs(): Record<string, AgentCfg> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, AgentCfg>; }
  catch { return {}; }
}

export function readCfg(name: string): AgentCfg {
  const all = readCfgs();
  return all[name] ?? { autonomy: "ask-risky", caps: {} };
}

export function writeCfg(name: string, cfg: AgentCfg): void {
  try {
    const all = readCfgs();
    all[name] = cfg;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode – the config stays for the session */ }
}

/** The gate words that make an agent "ask first": it can stop a run. */
const GATE_WORDS = /\bgate|approve|review|confirm|sign[- ]?off\b/i;
/** Words that mark an agent as writing code – the default for most agents. */
const WRITE_WORDS = /\bwrite|build|implement|fix|refactor|refine|fuse|migrate|test|polish|hard|verify\b/i;
/** Read-only roles default to Auto – they cannot damage the tree. */
const READ_ONLY = /\bexplor|research|docs?|read[- ]?only|review(?!er)|analys|summar|audit\b/i;

/** Autonomy default by role (contract §5): read-only roles Auto, agents that
    write code Ask on risky, anything that gates a run Ask. "Risky" = writes
    outside the fence, deletes, network access, dependency changes. */
export function defaultAutonomy(wf: Workflow): Autonomy {
  const text = `${wf.name} ${wf.about ?? ""} ${wf.prompt ?? ""}`;
  if (GATE_WORDS.test(text)) return "ask";
  if (READ_ONLY.test(text)) return "auto";
  if (WRITE_WORDS.test(text) || wf.scope?.length || wf.lock?.length) return "ask-risky";
  return "ask-risky";
}

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  ask: "Ask", "ask-risky": "Ask on risky", auto: "Auto",
};