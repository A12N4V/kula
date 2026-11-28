// The view header slot. The shell owns one header row; a view puts its own
// controls into it with <HeadBar>, so no view draws a second toolbar.

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const Slot = createContext<HTMLElement | null>(null);
export const HeadSlotProvider = Slot.Provider;

/** Renders its children in the shell header; inline when there is no shell. */
export function HeadBar({ children }: { children: ReactNode }) {
  const el = useContext(Slot);
  return el ? createPortal(children, el) : <div className="k-headbar-inline">{children}</div>;
}
