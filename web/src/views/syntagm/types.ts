// Syntagm types – the shared contract from BRIEF.md "the model".
// U1, B1 and E1 all code against these exact shapes; the fixture matches them
// so the live API can drop in without a UI change.

export type LeafKind = "fn" | "class" | "var" | "type";
export type BlockKind = "section" | "block" | "sub";
export type EmbedState = "off" | "on" | "stale";

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
}

/** A maximal call path from an entry point; a prefix of another chain is dropped. */
export interface Chain {
  id: string;
  entry: number;
  steps: number[];
  blocks: string[];
  len: number;
}

export interface Leaf {
  name: string;
  kind: LeafKind;
  path: string;
  line: number;
}

export interface SyntagmData {
  blocks: Record<string, Block>;
  chains: Chain[];
  leaves: Record<number, Leaf>;
  stats: { ms: number; batches: number; threads: number; embed: EmbedState };
}

/** Embed check output (E1 contract): a two-column table plus a verdict. */
export interface EmbedCheck {
  rows: [string, string][];
  verdict: "ok" | "warn" | "refuse";
  reasons: string[];
}
