// Fixture SyntagmData shaped exactly like GET /api/syntagm (BRIEF.md "the model").
// Wave 2 swaps this for the live API; the shapes must not drift.
// Deterministic pseudo-random build so tests and probes always see the same data.

import type { Block, Chain, Leaf, SyntagmData } from "./types";

// Tiny deterministic PRNG (mulberry32) – same fixture on every load.
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = ["core", "server", "web", "cli", "store", "graph", "agents", "index", "meta", "kg", "git", "flows"];
const SYLL_A = ["parse", "build", "load", "draw", "walk", "fetch", "push", "sync", "diff", "merge", "bind", "cast", "hash", "span", "trace", "match", "fold", "scan", "clip", "wire"];
const SYLL_B = ["node", "tree", "list", "map", "block", "edge", "chunk", "layer", "cache", "pool", "frame", "sheet", "graph", "store", "stream", "token", "panel", "route", "field", "cell"];
const KINDS = ["fn", "fn", "fn", "fn", "class", "var", "type"] as const;

const root: Block = { id: "b0", parent: null, depth: 0, name: "homonin-scripts", summary: "whole repo", kind: "section", symbols: [], children: [], files: 0, cohesion: 1, source: "graph" };
let bid = 0; // block id counter – blocks is an object, so blocks.length is useless here
const blocks: Record<string, Block> = { b0: root };
const leaves: Record<number, Leaf> = {};
const sections: string[] = [];

// 12 sections × 4 blocks × 4 subs × ~24 leaves ≈ 4 600 leaves.
let leafId = 1;
const r = rng(20261013);
for (let s = 0; s < DIRS.length; s++) {
  const secId = `b${++bid}`;
  blocks[secId] = { id: secId, parent: "b0", depth: 0, name: DIRS[s], summary: `${DIRS[s]} · ${SYLL_A[s % SYLL_A.length]}`, kind: "section", symbols: [], children: [], files: 0, cohesion: 0.4 + r() * 0.5, source: s % 5 === 0 ? "embed" : "graph" };
  root.children.push(secId);
  sections.push(secId);
  for (let b = 0; b < 4; b++) {
    const blkId = `b${++bid}`;
    const blkName = `${SYLL_A[(s * 4 + b) % SYLL_A.length]} · ${SYLL_B[(s + b) % SYLL_B.length]}`;
    blocks[blkId] = { id: blkId, parent: secId, depth: 1, name: blkName, summary: `${blkName} routines`, kind: "block", symbols: [], children: [], files: 0, cohesion: 0.3 + r() * 0.6, source: "graph" };
    blocks[secId].children.push(blkId);
    blocks[secId].symbols.push(0);
    for (let sb = 0; sb < 4; sb++) {
      const subId = `b${++bid}`;
      const subName = `${SYLL_B[(s * 4 + b + sb) % SYLL_B.length]} · ${SYLL_A[(s + sb * 3) % SYLL_A.length]}`;
      blocks[subId] = { id: subId, parent: blkId, depth: 2, name: subName, summary: `${subName} helpers`, kind: "sub", symbols: [], children: [], files: 0, cohesion: 0.2 + r() * 0.7, source: "graph" };
      blocks[blkId].children.push(subId);
      blocks[blkId].symbols.push(0);
      const dir = DIRS[s];
      const n = 18 + Math.floor(r() * 10); // 18–27 leaves per sub-block
      blocks[subId].symbols = [];
      for (let i = 0; i < n; i++) {
        const id = leafId++;
        const kind = KINDS[Math.floor(r() * KINDS.length)];
        const name = `${SYLL_A[Math.floor(r() * SYLL_A.length)]}_${SYLL_B[Math.floor(r() * SYLL_B.length)]}${id}`;
        leaves[id] = { name, kind, path: `src/${dir}/${SYLL_B[(b * 4 + sb) % SYLL_B.length]}${Math.floor(id / 24) % 3 + 1}.rs`, line: 10 + (id % 400) };
        blocks[subId].symbols.push(id);
        blocks[subId].files++;
        blocks[blkId].files++;
        blocks[secId].files++;
      }
      blocks[blkId].files = blocks[blkId].files; // files already counted per leaf
    }
  }
}
// Strip the placeholder 0s pushed before counting leaves.
for (const b of Object.values(blocks)) b.symbols = b.symbols.filter((x) => x !== 0);
blocks.b0.files = Object.values(blocks).reduce((n, b) => (b.kind === "sub" ? n + b.files : n), 0);

// Chains: one per section entry, walking that section's sub-blocks plus a
// couple of neighbours, so paths visibly cross box boundaries.
const chains: Chain[] = sections.map((sec, i) => {
  const steps: number[] = [];
  const blocks_: string[] = [];
  const secBlocks = blocks[sec].children;
  for (let j = 0; j < secBlocks.length; j++) {
    const subs = blocks[secBlocks[j]].children;
    const sub = subs[j % subs.length];
    if (!sub) continue;
    const syms = blocks[sub].symbols;
    if (!syms.length) continue;
    blocks_.push(sub);
    steps.push(syms[Math.floor(r() * syms.length)]);
  }
  if (i > 0) {
    const prev = blocks[sections[i - 1]].children[0];
    const sub = blocks[prev]?.children[0];
    const syms = sub ? blocks[sub].symbols : [];
    if (syms.length) { steps.push(syms[0]); blocks_.push(sub!); }
  }
  return { id: `c${i}`, entry: steps[0], steps, blocks: blocks_, len: steps.length };
});

export const fixture: SyntagmData = {
  blocks,
  chains,
  leaves,
  stats: { ms: 12_480, batches: 34, threads: 6, embed: "off" },
};
