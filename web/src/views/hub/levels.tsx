// Fence levels as words, shared by the hub, the graph and the checks panel.

import type { GuardLevel } from "../../api";

export const LEVEL_TEXT: Record<GuardLevel, string> = { open: "open", review: "review", scope: "out of scope", locked: "locked", hidden: "hidden" };
export const LEVEL_MEANS: Record<GuardLevel, string> = { open: "may change", review: "may change; a person reviews it", scope: "outside the task: read only", locked: "read only", hidden: "never shown" };
export function GuardTag({ level }: { level: GuardLevel }) { return <span className={`guard-tag ${level}`}>{LEVEL_TEXT[level]}</span>; }
