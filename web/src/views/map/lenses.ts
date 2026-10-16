// Map capabilities lens – the repo read as "what you can do with it": one
// swimlane per entry point / feature, each lane the chain family it starts.
// Pure data, no rendering, so the canvas and the sidebar share one source.

import type { Block, Family, Leaf, MapData, Role } from "./types";

export interface Lane {
  famId: string;
  label: string;
  count: number;
  len: number;
  /** The blocks the family's chains cross, source first, deduped in order. */
  stops: { id: string; name: string; role: Role }[];
  source: string;
  terminal: string;
  files: string[];
}

const name = (leaves: Record<number, Leaf>, id: number) => leaves[id]?.name ?? `#${id}`;

/** The top entry families – "capabilities" the repo offers – heaviest first. */
export function capabilities(data: MapData, limit = 24, roles?: Set<Role>): Lane[] {
  const blocks = data.blocks;
  const laneName = (b: Block) => b.theme || b.name;
  const fams = [...data.families].sort((a, b) => b.count - a.count);
  const out: Lane[] = [];
  for (const f of fams) {
    if (out.length >= limit) break;
    // A lane's blocks in chain order, sections folded to their top block.
    const stops: Lane["stops"] = [];
    const seen = new Set<string>();
    for (const id of f.blocks) {
      const b = blocks[id];
      if (!b) continue;
      const key = b.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (roles && !roles.has(b.role)) continue;
      stops.push({ id: b.id, name: laneName(b), role: b.role });
    }
    // A family filtered to nothing by the role filter is no lane at all.
    if (stops.length === 0) continue;
    const files = new Set<string>();
    for (const s of f.blocks)
      for (const sym of blocks[s]?.symbols ?? []) {
        const p = data.leaves[sym]?.path;
        if (p) files.add(p);
      }
    out.push({
      famId: f.id,
      label: `${name(data.leaves, f.source)} → ${name(data.leaves, f.terminal)}`,
      count: f.count,
      len: f.max_len,
      stops,
      source: name(data.leaves, f.source),
      terminal: name(data.leaves, f.terminal),
      files: [...files].slice(0, 4),
    });
  }
  return out;
}

/** Lane groups for the canvas: heavy lanes lead, each own row. */
export function laneRows(lanes: Lane[]) {
  return lanes;
}