// The layout root: places the rail, the centre slot and the reserved right
// and bottom slots, sized to the current tier. It knows slots and panes,
// nothing about which views exist – the rail reads those from the registry.

import type { ReactNode } from "react";
import { Grip } from "../resize";
import { useTier } from "./useTier";

/** Which panes the shell can open and hide. Wave 1 draws the list pane; the others are reserved. */
export type PaneId = "list" | "right" | "bottom";

const LIST = { min: 180, max: 480, fallback: 240 };

export default function Shell({
  rail,
  centre,
  right,
  bottom,
  status,
  open,
  children,
}: {
  rail?: ReactNode;
  centre: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
  status?: ReactNode;
  /** Open panes by id – the tier decides which of these are actually drawn. */
  open?: Partial<Record<PaneId, boolean>>;
  /** Overlays (palette, help, settings) ride outside the frame but inside the app. */
  children?: ReactNode;
}) {
  const tier = useTier();
  const showList = open?.list && tier === "large";
  const showRight = open?.right && right && tier !== "mobile";
  const showBottom = open?.bottom && bottom && tier !== "mobile";
  return (
    <>
      <div className="shell-root" data-tier={tier}>
        <div className="shell-main">
          {rail}
          <div className="shell-mid">
            <div className="shell-centre" data-testid="centre">
              {centre}
            </div>
            {showBottom && <div className="shell-slot shell-slot-bottom">{bottom}</div>}
          </div>
          {showRight && <div className="shell-slot shell-slot-right">{right}</div>}
        </div>
        {status}
      </div>
      {children}
    </>
  );
}

/** One toggle per pane the tier actually draws. Wave 1: the list pane only. */
export function PaneToggles({ open, onToggle, testId = "pane-list" }: { open: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button type="button" className="rail-btn" data-testid={testId} aria-pressed={open}
      aria-label={`${open ? "Hide" : "Show"} view list`} data-tip="Views  ⌘B" onClick={onToggle}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
        <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" stroke="currentColor" />
      </svg>
    </button>
  );
}

/** The collapsible list pane sits left of the centre slot, with a grip on its right edge. */
export function ListPane({ children }: { children: ReactNode }) {
  return (
    <aside className="shell-listpane" data-testid="list-pane" style={{ width: `var(--size-raillist, ${LIST.fallback}px)` }}>
      {children}
      <Grip id="raillist" edge="right" min={LIST.min} max={LIST.max} label="Resize list pane" />
    </aside>
  );
}
