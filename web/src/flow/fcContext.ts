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
  /** The "+" stub on a node with no outgoing edge. */
  onStub?: (id: string) => void;
  /** The node under the pointer – its wires light up, the rest fade. */
  hovered?: string | null;
  /** The edge under the pointer – its hover tools show. */
  hoverEdge?: string | null;
  setHoverEdge?: (id: string | null) => void;
  /** Corner resize of a resizable node: commit=false during the drag (live
      size only), commit=true on release (the kit persists + re-measures). */
  onResize?: (id: string, size: { w: number; h: number }, commit: boolean) => void;
  /** The canvas zoom – semantic zoom (far / mid / near) reads it. */
  zoom?: number;
  /** Semantic zoom level of the canvas: far (captions only), mid (facts),
      near (the function list) – resize forces a level up (docs §2). */
  zoomLevel?: "far" | "mid" | "near";
}>({});

export const useFc = () => useContext(FcCtx);
