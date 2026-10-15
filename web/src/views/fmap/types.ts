// Fmap types – the shared contract from BRIEF.md "the model", extended to
// the map: blocks with roles and themes, chain families, loops, and the
// /api/map* payloads. The fixture matches these exact shapes so the live API
// drops in without a UI change.

export type LeafKind = "fn" | "class" | "var" | "type";
export type BlockKind = "section" | "block" | "sub";
export type EmbedState = "off" | "on" | "stale";

/** One role per symbol, every block a dominant role (the classifier contract). */
export type Role = "entry" | "orchestrator" | "core" | "utility" | "adapter" | "model" | "config" | "test" | "glue";

/** Each role's one-line rule, shown in the UI as its explanation. */
export const ROLE_RULES: Record<Role, string> = {
  entry: "a source: nothing in the repo calls it, and it calls into the repo",
  orchestrator: "high fan-out into several blocks, low fan-in",
  core: "inside a block's chains, neither entry nor utility – the actual work",
  utility: "high fan-in from ≥ 3 distinct blocks, low fan-out, small; or under utils/ helpers/ common/ lib/ and called widely",
  adapter: "touches the outside world: file, network, process, DB, env",
  model: "classes, structs, types, enums, constants that are read more than called",
  config: "settings, constants and loaders under config paths or named so",
  test: "test code and fixtures",
  glue: "re-export barrels, __init__, mod.rs, index.ts",
};

export const ROLES = Object.keys(ROLE_RULES) as Role[];

/** The two lenses the owner asked for, plus test and glue apart (in All). */
export const LENS_ROLES: Record<"functions" | "utilities", Role[]> = {
  functions: ["entry", "orchestrator", "core", "adapter"],
  utilities: ["utility", "model", "config"],
};
export type Lens = "functions" | "utilities" | "all";

/** A block tree node: sections at depth 0, blocks, sub-blocks; leaves hang off the deepest block. */
export interface Block {
  id: string;
  parent: string | null;
  depth: number;
  name: string;
  summary: string;
  kind: BlockKind;
  symbols: number[];
  children: string[];
  files: number;
  cohesion: number;
  source: "graph" | "embed";
  role: Role;
  /** 2–4 word theme, present only when the block was formed with embeddings. */
  theme?: string;
}

/** A chain: a source→terminal path through the calls graph; a step is a symbol
 *  id, or a loop node id (string) where a cycle was condensed to one node. */
export interface Chain {
  id: string;
  source: number;
  terminal: number;
  steps: (number | string)[];
  blocks: string[];
  len: number;
}

/** Chain chains grouped by (source, terminal) pair – every family, nothing dropped. */
export interface Family {
  id: string;
  source: number;
  terminal: number;
  count: number;
  /** false when the count saturated past u128. */
  exact: boolean;
  min_len: number;
  max_len: number;
  blocks: string[];
}

/** A cycle, condensed to one node listing its members. */
export interface Loop {
  id: string;
  members: number[];
}

export interface Leaf {
  name: string;
  kind: LeafKind;
  path: string;
  line: number;
  role: Role;
}

/** GET /api/map – the whole map in one payload; the lens is client-side. */
export interface MapData {
  blocks: Record<string, Block>;
  families: Family[];
  loops: Loop[];
  leaves: Record<number, Leaf>;
  stats: { chains: number; exact: boolean; ms: number; threads: number; embed: EmbedState };
}

/** GET /api/map/chains – one page of a family's enumerated chains. */
export interface ChainPage {
  chains: Chain[];
  /** Cursor for the next page, null when done. */
  cursor: string | null;
  done: boolean;
}

/** GET /api/map/progress – the map run, reported while it works. */
export interface MapProgress {
  active: boolean;
  phase: "idle" | "scc" | "dp" | "blocks" | "families" | "done";
  done: number;
  total: number;
  elapsed_ms: number;
}

/** Embed check output (E1 contract): a two-column table plus a verdict. */
export interface EmbedCheck {
  rows: [string, string][];
  verdict: "ok" | "warn" | "refuse";
  reasons: string[];
}

/** @deprecated the pre-map payload shape – kept until /api/syntagm goes away. */
export interface SyntagmData {
  blocks: Record<string, Block>;
  chains: Chain[];
  leaves: Record<number, Leaf>;
  stats: { ms: number; batches: number; threads: number; embed: EmbedState };
}
