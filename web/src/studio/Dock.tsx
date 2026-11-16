// A view's own tool window. A view that needs a side panel docks it into the
// shell's right sidebar instead of building one inside itself; while docked the
// sidebar shows it in place of Structure. A view may also take Project tree
// clicks (reveal a file in place) and mark which file the tree should show as active.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Reveal = (path: string) => boolean;
type DockApi = {
  slot: HTMLElement | null;
  claim: (label: string) => () => void;
  /** a view's handler for Project tree clicks; true when it took the click */
  setReveal: (f: Reveal | null) => void;
  setActive: (path: string | null) => void;
};

const Ctx = createContext<DockApi | null>(null);

/** Shell side: what the sidebar should show and the hooks it calls. */
export function useDockHost() {
  const [label, setLabel] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const reveal = useRef<Reveal | null>(null);
  const api = useMemo<DockApi>(() => ({
    slot,
    claim: (l) => {
      setLabel(l);
      return () => { setLabel((x) => (x === l ? null : x)); setActive(null); };
    },
    setReveal: (f) => { reveal.current = f; },
    setActive,
  }), [slot]);
  return { api, label, active, setSlot, reveal: (p: string) => !!reveal.current?.(p) };
}

export const DockProvider = ({ api, children }: { api: DockApi; children: ReactNode }) => <Ctx.Provider value={api}>{children}</Ctx.Provider>;

/** View side: render children in the shell's right sidebar while mounted. */
export function Docked({ label, children }: { label: string; children: ReactNode }) {
  const d = useContext(Ctx);
  const claim = d?.claim;
  useEffect(() => claim?.(label), [label, !!claim]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d?.slot) return null;
  return createPortal(children, d.slot);
}

/** View side: take Project tree clicks and mark the active file while mounted. */
export function useDockTree(reveal: Reveal, active: string | null) {
  const d = useContext(Ctx);
  const f = useRef(reveal);
  f.current = reveal;
  const setReveal = d?.setReveal, setActive = d?.setActive;
  useEffect(() => {
    if (!setReveal) return;
    setReveal((p) => f.current(p));
    return () => setReveal(null);
  }, [!!setReveal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive?.(active); }, [active, !!setActive]); // eslint-disable-line react-hooks/exhaustive-deps
}
