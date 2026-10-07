// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Shared data plumbing for the agents tabs (module S1): the Nav type, shared
// constants, the one api.agents read and the action callback every tab uses.

import { useCallback, useEffect, useState } from "react";
import { api, type AgentsInfo, type Workflow } from "../../api";
import type { Go, Target } from "../../nav";

export type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };
export const AGENT_IDS = ["claude", "cursor", "codex", "gemini"];
export const AGENT_NAME: Record<string, string> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex", gemini: "Gemini CLI" };
export const GLYPHS: Record<string, string> = { claude: "\u273b", cursor: "\u25c6", codex: ">", gemini: "\u2726" };
export const blank = (): Workflow => ({ name: "", about: "", scope: [], lock: [], hide: [], review: [], memory: "write", steps: [], docs: [] });

/** One `api.agents` read for the whole tab strip, re-read whenever `version` moves. */
export function useAgentsInfo(version: number) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [version]);
  return { info, err, load };
}
export type Act = (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => Promise<unknown>;
export type Tab = "overview" | "workflows" | "research" | "teams" | "skills" | "fences" | "memory" | "docs" | "connect";
