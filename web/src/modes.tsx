import { createContext, useContext, type ReactElement } from "react";
import type { View } from "./nav";

/** The sibling views of the current rail entry, so a view can put the toggle first in its own header. */
export type ModeItem = { id: View; label: string; short: string; icon: () => ReactElement; badge?: number };
export type Modes = { label: string; view: View; items: ModeItem[]; go: (v: View) => void };
export const ModeCtx = createContext<Modes | null>(null);

export function ModeToggle() {
  const m = useContext(ModeCtx);
  if (!m || m.items.length < 2) return null;
  return (
    <div className="seg gv-modes mode-toggle" role="radiogroup" aria-label={m.label}>
      {m.items.map((d) => (
        <button key={d.id} role="radio" aria-checked={d.id === m.view} aria-label={d.label} className={d.id === m.view ? "on" : ""} onClick={() => m.go(d.id)} title={d.label}>
          <d.icon /><span>{d.short}</span>{!!d.badge && <em>{d.badge}</em>}
        </button>
      ))}
    </div>
  );
}
