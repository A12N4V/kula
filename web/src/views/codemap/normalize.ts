// The live /api/syntagm sends blocks as a flat array with raw symbol kinds;
// the map wants them keyed by id under one root ("~") and kinds folded to
// fn/class/type/var. Data already in that shape passes through.
import type { Block, Leaf, LeafKind, SyntagmData } from "../syntagm/types";

const KIND: Record<string, LeafKind> = { function: "fn", method: "fn", fn: "fn", class: "class", struct: "class", enum: "type", interface: "type", trait: "type", type: "type" };

export function normalize(raw: unknown): SyntagmData {
  const d = raw as SyntagmData & { blocks: Block[] | Record<string, Block>; error?: string };
  if (d.error) throw new Error(d.error);
  if (!Array.isArray(d.blocks)) return d;
  const blocks: Record<string, Block> = {};
  for (const b of d.blocks) blocks[b.id] = { ...b, children: [...b.children] };
  const tops = d.blocks.filter((b) => !b.parent || !blocks[b.parent]).map((b) => b.id);
  if (!tops.length) throw new Error("no blocks");
  blocks["~"] = { id: "~", parent: null, depth: -1, name: "repo", summary: "", kind: "section", symbols: [], children: tops, files: tops.reduce((s, id) => s + blocks[id].files, 0), cohesion: 0, source: "graph" };
  for (const id of tops) blocks[id].parent = "~";
  const leaves: Record<number, Leaf> = {};
  for (const [k, l] of Object.entries(d.leaves ?? {})) leaves[Number(k)] = { ...l, kind: KIND[l.kind as string] ?? "var" };
  return { ...d, blocks, leaves };
}
