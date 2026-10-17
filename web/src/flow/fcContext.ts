// Tiny context so node renderers can reach the canvas callbacks (open, focus)
// without prop drilling through React Flow's NodeProps. Consume it in leaf
// components only (the toolbar slot) so a hover change does not re-render
// every node.
import { createContext, useContext } from "react";

export const FcCtx = createContext<{
  open?: (id: string) => void;
  /** Collapse/expand; without an id, the group of the current selection. */
  toggleGroup?: (id?: string) => void;
  /** The node whose hover toolbar is showing (hovered or selected). */
  activeId?: string | null;
}>({});

export const useFc = () => useContext(FcCtx);
