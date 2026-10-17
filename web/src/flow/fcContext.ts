// Tiny context so node renderers can reach the canvas callbacks (open, focus)
// without prop drilling through React Flow's NodeProps.
import { createContext, useContext } from "react";

export const FcCtx = createContext<{
  open?: (id: string) => void;
  collapsedGroups?: Set<string>;
  toggleGroup?: (id: string) => void;
}>({});

export const useFc = () => useContext(FcCtx);
