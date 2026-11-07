// The layout root: places the rail, the centre slot and the reserved right
// and bottom slots, sized to the current tier. It knows slots and panes,
// nothing about which views exist – the rail reads those from the registry.

import type { ReactNode } from "react";
import { Icon } from "../ui";
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

/** One toggle per pane the tier actually draws. Wave 1: the list pane only.
 *  Class `rail-toggle`, not `rail-btn` – that name means one thing only: a
 *  36px dock icon for a registry group. The glyph is the shared Icon so the
 *  stroke grammar (round cap, 1.5 width) is inherited, never hand-rolled. */
export function PaneToggles({ open, onToggle, testId = "pane-list" }: { open: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button type="button" className="rail-toggle" data-testid={testId} aria-pressed={open}
      aria-label={`${open ? "Hide" : "Show"} view list`} data-tip="Views  ⌘B" onClick={onToggle}>
      <Icon.sidebar />
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
