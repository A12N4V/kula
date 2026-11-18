// Shared pieces of the Git view: the one selection every pane writes to, and
// the pane frame from views/widget.
import type { GitOp } from "../../api";

export type Sel =
  | { kind: "file"; path: string; staged: boolean }
  | { kind: "commit"; sha: string }
  | { kind: "compare"; base: string; head: string; proposal?: number }
  | { kind: "stash"; n: number }
  | null;

export type Run = (action: string, body?: Record<string, unknown>, ok?: string) => Promise<string | null>;
export type SetSel = (s: Sel) => void;

export const OP_LABEL: Record<GitOp, string> = { merge: "Merge", rebase: "Rebase", cherry_pick: "Cherry pick", revert: "Revert" };

export { IB, Widget, WEmpty } from "../widget";

/** Ahead and behind counts out of a branch's track string. */
export const track = (t?: string) => ({
  ahead: Number(/ahead (\d+)/.exec(t ?? "")?.[1] ?? 0),
  behind: Number(/behind (\d+)/.exec(t ?? "")?.[1] ?? 0),
});
