// The strip over the Git view: where you are, which list is showing, and sync.
import type { ComponentType } from "react";
import { Icon } from "../../ui";
import { IB } from "./parts";

export type Mode = "changes" | "history" | "branches" | "stashes" | "review";

export const MODES: { id: Mode; label: string; icon: ComponentType }[] = [
  { id: "changes", label: "Changes", icon: Icon.changes },
  { id: "history", label: "History", icon: Icon.history },
  { id: "branches", label: "Branches", icon: Icon.branches },
  { id: "stashes", label: "Stashes", icon: Icon.doc },
  { id: "review", label: "Review", icon: Icon.pr },
];

export function Header({ branch, upstream, ahead, behind, mode, setMode, counts, busy, sync }: {
  branch: string; upstream?: string; ahead: number; behind: number;
  mode: Mode; setMode: (m: Mode) => void; counts: Partial<Record<Mode, number>>;
  busy: string; sync: (label: "Fetch" | "Pull" | "Push") => void;
}) {
  return (
    <header className="gv-head">
      <span className="gv-branch-chip mono" title={upstream ? `Tracks ${upstream}` : "No upstream"}>
        <Icon.branches /><b>{branch || "detached"}</b>
      </span>
      <div className="seg gv-modes" role="radiogroup" aria-label="Git list">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
            <m.icon /><span>{m.label}</span>{!!counts[m.id] && <em>{counts[m.id]}</em>}
          </button>
        ))}
      </div>
      <span className="spacer" />
      {upstream && (
        <span className="gv-track-pair mono" aria-label={`${ahead} ahead, ${behind} behind`}>
          <span className={ahead ? "up on" : "up"}><Icon.up />{ahead}</span>
          <span className={behind ? "down on" : "down"}><Icon.down />{behind}</span>
        </span>
      )}
      {busy && <span className="gv-busy mono">{busy}</span>}
      <IB tip="Fetch" disabled={!!busy} onClick={() => sync("Fetch")}><Icon.refresh /></IB>
      <IB tip="Pull" disabled={!!busy || !upstream} onClick={() => sync("Pull")}><Icon.down /></IB>
      <IB tip="Push" disabled={!!busy} primary={ahead > 0} onClick={() => sync("Push")}><Icon.up /></IB>
    </header>
  );
}
