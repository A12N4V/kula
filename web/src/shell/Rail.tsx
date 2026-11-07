// The rail: one icon per group on the left edge, plus a collapsible pane that
// lists every module under its group heading. It reads the registry, so a
// module registered there appears here with no rail code touched.

import type { ReactNode } from "react";
import { GROUPS, MODULES, groupHome, moduleOf, type Group } from "./registry";
import type { View } from "../nav";
import { ListPane } from "./Shell";

export default function Rail({
  view,
  onGo,
  open,
  toggles,
}: {
  view: View;
  onGo: (v: View) => void;
  open: boolean;
  /** Rendered above the group icons – Shell's pane toggles live here. */
  toggles?: ReactNode;
}) {
  const current = moduleOf(view).group;
  return (
    <>
      <nav className="rail" aria-label="Sections">
        <div className="rail-top">{toggles}</div>
        <div className="rail-groups" role="group" aria-label="View groups">
          {GROUPS.map((g) => (
            <button key={g.id} className="rail-btn" data-testid={`rail-group-${g.id}`} data-tip={g.label}
              aria-label={g.label} aria-current={current === g.id ? "true" : undefined}
              onClick={() => onGo(groupHome(g.id as Group))}>
              <g.icon />
            </button>
          ))}
        </div>
      </nav>
      {open && (
        <ListPane>
          {GROUPS.map((g) => (
            <div key={g.id} className="rail-list-group">
              <div className="rail-list-head">{g.label}</div>
              {MODULES.filter((m) => m.group === g.id).map((m) => (
                <button key={m.id} className="rail-item" data-testid={`rail-item-${m.id}`}
                  aria-current={view === m.id ? "true" : undefined} onClick={() => onGo(m.id)}>
                  <span className="rail-item-ico"><m.icon /></span>
                  <span className="rail-item-label">{m.label}</span>
                  {m.key && <kbd className="rail-item-key">{m.key}</kbd>}
                </button>
              ))}
            </div>
          ))}
        </ListPane>
      )}
    </>
  );
}
