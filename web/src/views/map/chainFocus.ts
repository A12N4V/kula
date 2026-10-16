// Chain focus – dim everything the focused chain does not cross and, unless
// the person prefers reduced motion, animate the walk along the path.
// Pure logic; the canvas reads `focused` and adds its classes from it.

import type { Chain, MapData } from "./types";

export interface Focus {
  chain: Chain | null;
  /** Block ids the chain crosses – nodes inside stay bright. */
  on: Set<string>;
  /** Section ids touched, for the frame marks. */
  sections: Set<string>;
  /** true when the OS asks for reduced motion – the animation is then off. */
  still: boolean;
}

export function prefersStill(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The focus state for a chain on the map. Sections come from the block tree. */
export function focusOf(data: MapData, chain: Chain | null): Focus {
  const on = new Set<string>(chain?.blocks ?? []);
  const sections = new Set<string>();
  const up = (id: string) => {
    let cur = data.blocks[id];
    while (cur?.parent) {
      const p = data.blocks[cur.parent];
      if (!p || p.parent === null) break;
      if (p.kind !== "section") sections.add(p.id);
      cur = data.blocks[cur.parent];
    }
  };
  for (const id of on) up(id);
  return { chain, on, sections, still: prefersStill() };
}
