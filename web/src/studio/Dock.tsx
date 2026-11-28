// A view's tool windows. A view that needs side panels docks them into the
// shell's option panel instead of building them inside itself. Each panel gets
// a button in the top ribbon, which toggles the panel the way Project toggles
// the file tree. A view may also take Project tree clicks (reveal a file in
// place) and mark which file the tree should show as active.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Reveal = (path: string) => boolean;
export type Panel = { id: string; label: string; icon?: () => ReactElement; badge?: number; info?: string; seq: number };
type DockApi = {
  slot: HTMLElement | null;
  shown: string | null;
  put: (p: Panel) => void;
  drop: (id: string) => void;
  /** show a panel; null hides the option panel */
  open: (id: string | null) => void;
  /** a view's handler for Project tree clicks; true when it took the click */
  setReveal: (f: Reveal | null) => void;
  setActive: (path: string | null) => void;
};

const Ctx = createContext<DockApi | null>(null);
let seq = 0;

/** Shell side: the panels on offer, which one shows, and the hooks it calls. */
export function useDockHost(pick: string | undefined, on: boolean, open: (id: string | null) => void) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const shown = on && panels.length ? (panels.find((p) => p.id === pick) ?? panels[0]).id : null;
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const reveal = useRef<Reveal | null>(null);
  const openRef = useRef(open); openRef.current = open;
  const api = useMemo<DockApi>(() => ({
    slot,
    shown,
    put: (p) => setPanels((ps) => {
      const i = ps.findIndex((x) => x.id === p.id);
      if (i < 0) return [...ps, p].sort((a, b) => a.seq - b.seq);
      const o = ps[i];
      if (o.label === p.label && o.badge === p.badge && o.info === p.info && o.icon === p.icon) return ps;
      const next = ps.slice(); next[i] = { ...p, seq: o.seq }; return next;
    }),
    drop: (id) => { setPanels((ps) => ps.filter((x) => x.id !== id)); },
    open: (id) => openRef.current(id),
    setReveal: (f) => { reveal.current = f; },
    setActive,
  }), [slot, shown]);
  return { api, panels, shown, active, setSlot, reveal: (p: string) => !!reveal.current?.(p) };
}

export const DockProvider = ({ api, children }: { api: DockApi; children: ReactNode }) => <Ctx.Provider value={api}>{children}</Ctx.Provider>;

/** View side: offer a panel in the ribbon; its children render in the option panel while it shows. */
export function Docked({ id, label, icon, badge, info, children }: { id?: string; label: string; icon?: () => ReactElement; badge?: number; info?: string; children: ReactNode }) {
  const d = useContext(Ctx);
  const key = id ?? label;
  const mine = useRef(++seq).current;
  const put = d?.put, drop = d?.drop;
  useEffect(() => { put?.({ id: key, label, icon, badge, info, seq: mine }); }, [key, label, icon, badge, info, !!put]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => drop?.(key), [key, !!drop]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d?.slot || d.shown !== key) return null;
  return createPortal(children, d.slot);
}

/** View side: show one of its panels (or hide the option panel with null). */
export function useDockOpen() {
  const d = useContext(Ctx);
  return d?.open ?? (() => {});
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
