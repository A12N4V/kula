// Flow canvas kit – shared types. One canvas for the map, the agents and the
// dev lab. Sizes live on the 16 px grid (docs/design/flow-canvas.md §1).
import type { ReactNode } from "react";

export type FlowNodeKind = "tile" | "wide" | "circle" | "group" | "loop" | "sticky" | "block";
export type FlowStatus = "running" | "success" | "error" | "pinned" | "disabled";

/** A node for the canvas. Sizes come from the kind unless the caller overrides. */
export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  title: string;
  subtitle?: string;
  /** Glyph name from web/src/ui.tsx Icon, or any small node. */
  icon?: string | ReactNode;
  /** Role/accent colour as a CSS colour or token reference. */
  color?: string;
  status?: FlowStatus;
  /** Entry nodes get the D shape facing the flow. */
  entry?: boolean;
  /** Attached config sub-node – hangs below its parent in a TB sub-layout. */
  sub?: boolean;
  /** Parent node id for sub-nodes, or parent group id for members. */
  parent?: string;
  /** Node reports no outgoing main edge – the "+" stub renders. */
  noOut?: boolean;
  /** Node has sub-nodes hanging below – the bottom diamond renders. */
  hasSub?: boolean;
  /** Extra hover toolbar content (the slot). */
  toolbar?: ReactNode;
  /** Explicit size override (16 px grid), else per kind. */
  size?: { w: number; h: number };
  /** Caller-provided position; layout fills the rest. */
  pos?: { x: number; y: number };
  /** Dimmed while another selection is focused. */
  dim?: boolean;
  /** Overlay ring: an agent's fence, changed files, or a live drop target. */
  ring?: "fence" | "hot" | "drop";
  /** Small corner badge (an agent widget, a change count). */
  badge?: ReactNode;
  /** The output handle can be dragged to make a connection (n8n). */
  connectable?: boolean;
  /** The input handle accepts a dragged connection. */
  accepts?: boolean;
  /** The block card's payload (R0). */
  card?: BlockCardData;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  /** 1–4 stroke weight (chain/flow weight, quantised by the caller). */
  weight?: number;
  /** Label riding the edge midpoint (rare, on purpose). */
  label?: string;
  /** Main flow edge (default). Non-main edges are dashed and 1 px. */
  main?: boolean;
  /** Explicit backward routing hint; the renderer also detects it from x. */
  backward?: boolean;
  /** Run state of the wire: data moving (animated), passed, failed. */
  flow?: "run" | "ok" | "err";
  /** Hover tools at the midpoint (n8n's "+" / delete on an edge). */
  tools?: ReactNode;
};

/** A titled frame behind its members; collapsible to a chip. */
export type FlowGroup = {
  id: string;
  label: string;
  members: string[];
};

/** What the kit hands back on selection. */
export type FlowSelection = { id: string; kind: FlowNodeKind } | null;

/* The block node's payload (R0): the old Blocks-lens card, as the node itself.
   Kept here so the kit stays the single type surface for every canvas. */
export type BlockCardData = {
  role?: string;
  roleColor?: string;
  logo?: string;
  files?: number;
  symbols?: number;
  inDeg?: number;
  outDeg?: number;
  flows?: string[];
  chains?: string[];
  summary?: string;
  /** Blocks with room show their function names (content reflows). */
  functions?: { name: string; kind: string }[];
  /** Sections are frames: their blocks render inside the card. */
  members?: { id: string; title: string; color?: string }[];
};

/* Sizes (docs/design/flow-canvas.md §1–2). */
export const GRID = 16;
export const TILE = { w: 96, h: 128 }; // 96×96 tile + 32 of title/subtitle under it
export const WIDE = { w: 256, h: 96 };
export const CIRCLE = { w: 80, h: 80 };
export const CHIP = { w: 256, h: 48 };
/** Block card nodes (R0): the default stage and the expanded stage. */
export const BLOCK_SIZES: { w: number; h: number; label: string }[] = [
  { w: 224, h: 128, label: "compact" },
  { w: 320, h: 208, label: "detail" },
  { w: 432, h: 304, label: "full" },
];
export const BLOCK_DEFAULT = BLOCK_SIZES[1];
/** Resizable kinds grow/shrink between their bounds (the corner handle). */
export const RESIZE_MIN = { w: 192, h: 112 };
export const RESIZE_MAX = { w: 560, h: 400 };
/** Frame padding around members – room for the 33 px group head row. */
export const GROUP_PAD = 48;
export const RANK_STEP = 128;

export function nodeSize(n: Pick<FlowNode, "kind" | "size">): { w: number; h: number } {
  if (n.size) return n.size;
  if (n.kind === "block") return BLOCK_DEFAULT;
  if (n.kind === "wide") return WIDE;
  if (n.kind === "circle") return CIRCLE;
  if (n.kind === "group") return { w: 256, h: 128 };
  return TILE;
}

/** Cheap deterministic string hash – layout cache keys. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function dataHash(nodes: FlowNode[], edges: FlowEdge[]): string {
  return hashString(nodes.map((n) => n.id + n.kind + (n.parent ?? "")).join("|") + "#" + edges.map((e) => e.id + e.source + e.target).join("|"));
}

export const snap = (v: number): number => Math.round(v / GRID) * GRID;
