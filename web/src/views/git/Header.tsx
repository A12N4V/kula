// The strip over the Git view: which list is showing and how far from upstream.
import type { ComponentType } from "react";
import { Icon } from "../../ui";

export type Mode = "changes" | "history" | "branches" | "stashes" | "review";

export const MODES: { id: Mode; label: string; icon: ComponentType }[] = [
  { id: "changes", label: "Changes", icon: Icon.changes },
  { id: "history", label: "History", icon: Icon.history },
  { id: "branches", label: "Branches", icon: Icon.branches },
  { id: "stashes", label: "Stashes", icon: Icon.doc },
  { id: "review", label: "Review", icon: Icon.pr },
];

export function Header({ upstream, ahead, behind, mode, setMode, counts, busy }: {
  upstream?: string; ahead: number; behind: number;
  mode: Mode; setMode: (m: Mode) => void; counts: Partial<Record<Mode, number>>;
  busy: string;
}) {
  return (
    <header className="gv-head">
      <div className="seg gv-modes" role="radiogroup" aria-label="Git list">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} aria-label={m.label} data-tip={m.label} onClick={() => setMode(m.id)}>
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
    </header>
  );
}
