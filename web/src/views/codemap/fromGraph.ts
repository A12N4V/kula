// Blocks from the plain symbol graph, for a server without /api/syntagm:
// directories are blocks, files are sub-blocks, their symbols are the leaves,
// and every call is a two-step chain. Directories with one child fold into it.
import type { GraphData } from "../../api";
import type { Block, Chain, Leaf, LeafKind, SyntagmData } from "../syntagm/types";

const KIND: Record<string, LeafKind> = { function: "fn", method: "fn", class: "class", interface: "type" };

export function fromGraph(g: GraphData): SyntagmData {
  const t0 = performance.now();
  const blocks: Record<string, Block> = {};
  const mk = (id: string, parent: string | null, name: string, kind: Block["kind"]): Block =>
    (blocks[id] ??= { id, parent, depth: 0, name, summary: "", kind, symbols: [], children: [], files: 0, cohesion: 0, source: "graph" });
  const root = mk("~", null, "repo", "section");

  const leaves: Record<number, Leaf> = {};
  const fileOf = new Map<number, string>();
  for (const n of g.nodes) {
    const k = KIND[n.kind]; if (!k || !n.path) continue;
    leaves[n.id] = { name: n.name, kind: k, path: n.path, line: n.start_line };
    const parts = n.path.split("/");
    let parent = root.id;
    for (let i = 0; i < parts.length; i++) {
      const id = parts.slice(0, i + 1).join("/"), file = i === parts.length - 1;
      if (!blocks[id]) { mk(id, parent, parts[i], file ? "sub" : "block"); blocks[parent].children.push(id); }
      parent = id;
    }
    blocks[parent].symbols.push(n.id);
    fileOf.set(n.id, parent);
  }

  // fold single-child directories ("src" → "src/index" becomes "src/index")
  const fold = (id: string) => {
    let b = blocks[id];
    while (b.kind !== "sub" && b.children.length === 1 && blocks[b.children[0]].kind !== "sub" && b.id !== root.id) {
      const c = blocks[b.children[0]];
      b.name = `${b.name}/${c.name}`; b.children = c.children;
      for (const k of c.children) blocks[k].parent = b.id;
      delete blocks[c.id];
    }
    b.children.forEach(fold);
  };
  fold(root.id);

  // depth, file counts; sections are the root's children
  const walk = (id: string, d: number): number => {
    const b = blocks[id]; b.depth = d;
    b.files = b.kind === "sub" ? 1 : b.children.reduce((s, c) => s + walk(c, d + 1), 0);
    b.kind = b.kind === "sub" ? "sub" : d === 1 ? "section" : "block";
    b.children.sort((x, y) => blocks[y].files - blocks[x].files || blocks[y].symbols.length - blocks[x].symbols.length);
    return b.files;
  };
  walk(root.id, 0);
  for (const c of root.children) blocks[c].depth = 0;
  root.depth = -1;

  const chains: Chain[] = [];
  const inner = new Map<string, number>(), all = new Map<string, number>();
  for (const e of g.edges) {
    if (e.kind !== "CALLS") continue;
    const a = fileOf.get(e.src), b = fileOf.get(e.dst); if (!a || !b) continue;
    chains.push({ id: `c${e.src}-${e.dst}`, entry: e.src, steps: [e.src, e.dst], blocks: a === b ? [a] : [a, b], len: 2 });
    all.set(a, (all.get(a) ?? 0) + 1); if (a === b) inner.set(a, (inner.get(a) ?? 0) + 1);
  }
  for (const b of Object.values(blocks)) {
    if (b.kind === "sub") { b.cohesion = all.get(b.id) ? (inner.get(b.id) ?? 0) / all.get(b.id)! : 1; b.summary = `${b.symbols.length} symbols`; }
    else b.summary = `${b.files} files`;
  }
  return { blocks, chains, leaves, stats: { ms: Math.round(performance.now() - t0), batches: 0, threads: 1, embed: "off" } };
}
