// Fixture MapData shaped exactly like GET /api/map (BRIEF.md "the model").
// Stands in until M1's /api/map lands; the shapes must not drift.
// Deterministic pseudo-random build so tests and probes always see the same
// data. Families are listed whole; their chains are generated on demand by
// `fixtureChains` (the paged enumeration the sidebar uses).

import type { Block, Chain, ChainPage, Family, Leaf, Loop, MapData, Role, LeafKind } from "./types";

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
const THEMES = ["graph building", "token streaming", "chain scoring", "route matching", "cache pooling", "panel layout", "field casting", "frame drawing", "sheet folding", "store wiring"];

const root: Block = { id: "b0", parent: null, depth: 0, name: "homonin-scripts", summary: "whole repo", kind: "section", symbols: [], children: [], files: 0, cohesion: 1, source: "graph", role: "orchestrator" };
let bid = 0; // block id counter – blocks is an object, so blocks.length is useless here
const blocks: Record<string, Block> = { b0: root };
const leaves: Record<number, Leaf> = {};
const sections: string[] = [];

// Role mix for leaves, deterministic: mostly core, sprinkled with the rest.
function leafRole(i: number, dir: string): Role {
  if (i % 23 === 0) return "adapter";
  if (i % 17 === 0) return "utility";
  if (i % 13 === 0) return "model";
  if (i % 31 === 0) return "config";
  if (i % 41 === 0) return "test";
  if (i % 53 === 0) return "glue";
  if (dir === "cli" || dir === "web") return i % 7 === 0 ? "entry" : "core";
  return "core";
}

// 12 sections × 4 blocks × 4 subs × ~24 leaves ≈ 4 600 leaves.
let leafId = 1;
const r = rng(20261013);
for (let s = 0; s < DIRS.length; s++) {
  const secId = `b${++bid}`;
  blocks[secId] = { id: secId, parent: "b0", depth: 0, name: DIRS[s], summary: `${DIRS[s]} · ${SYLL_A[s % SYLL_A.length]}`, kind: "section", symbols: [], children: [], files: 0, cohesion: 0.4 + r() * 0.5, source: s % 5 === 0 ? "embed" : "graph", role: "orchestrator", theme: s % 5 === 0 ? THEMES[s % THEMES.length] : undefined };
  root.children.push(secId);
  sections.push(secId);
  for (let b = 0; b < 4; b++) {
    const blkId = `b${++bid}`;
    const blkName = `${SYLL_A[(s * 4 + b) % SYLL_A.length]} · ${SYLL_B[(s + b) % SYLL_B.length]}`;
    blocks[blkId] = { id: blkId, parent: secId, depth: 1, name: blkName, summary: `${blkName} routines`, kind: "block", symbols: [], children: [], files: 0, cohesion: 0.3 + r() * 0.6, source: "graph", role: "core" };
    blocks[secId].children.push(blkId);
    for (let sb = 0; sb < 4; sb++) {
      const subId = `b${++bid}`;
      const subName = `${SYLL_B[(s * 4 + b + sb) % SYLL_B.length]} · ${SYLL_A[(s + sb * 3) % SYLL_A.length]}`;
      blocks[subId] = { id: subId, parent: blkId, depth: 2, name: subName, summary: `${subName} helpers`, kind: "sub", symbols: [], children: [], files: 0, cohesion: 0.2 + r() * 0.7, source: "graph", role: "core" };
      blocks[blkId].children.push(subId);
      const dir = DIRS[s];
      const n = 18 + Math.floor(r() * 10); // 18–27 leaves per sub-block
      blocks[subId].symbols = [];
      for (let i = 0; i < n; i++) {
        const id = leafId++;
        const kind = KINDS[Math.floor(r() * KINDS.length)];
        const name = `${SYLL_A[Math.floor(r() * SYLL_A.length)]}_${SYLL_B[Math.floor(r() * SYLL_B.length)]}${id}`;
        leaves[id] = { name, kind, path: `src/${dir}/${SYLL_B[(b * 4 + sb) % SYLL_B.length]}${Math.floor(id / 24) % 3 + 1}.rs`, line: 10 + (id % 400), role: leafRole(id, dir) };
        blocks[subId].symbols.push(id);
        blocks[subId].files++;
        blocks[blkId].files++;
        blocks[secId].files++;
      }
    }
  }
}
blocks.b0.files = Object.values(blocks).reduce((n, b) => (b.kind === "sub" ? n + b.files : n), 0);
// Every block's dominant role: the most common leaf role inside (one level
// down), falling back to the leaf role of its single symbols list.
for (const b of Object.values(blocks)) {
  if (b.kind === "section" && b.children.length) continue; // sections stay orchestrator
  if (b.children.length) continue; // blocks stay core
  const tally = new Map<Role, number>();
  for (const sid of b.symbols) {
    const role = leaves[sid]?.role ?? "core";
    tally.set(role, (tally.get(role) ?? 0) + 1);
  }
  let best: Role = "core", n = 0;
  for (const [role, count] of tally) if (count > n) { best = role; n = count; }
  b.role = best;
}

// Loops: a few cycles, condensed to one node listing their members.
const loops: Loop[] = [0, 1, 2].map((i) => {
  const sec = blocks[sections[i]].children[i % 4];
  const sub = blocks[sec]?.children[i % 4];
  const syms = sub ? blocks[sub].symbols.slice(0, 4 + i * 2) : [];
  return { id: `L${i + 1}`, members: syms };
});

// Chain families: every (source, terminal) pair, grouped. 12 section entries ×
// a spread of terminals ≈ 1 500+ families, several with saturated counts.
const entryLeaf = (sec: string): number => {
  const blk = blocks[sec].children[0];
  const sub = blocks[blk]?.children[0];
  const syms = sub ? blocks[sub].symbols : [];
  return syms[0] ?? 1;
};
const families: Family[] = [];
let fid = 0;
for (let s = 0; s < sections.length; s++) {
  const source = entryLeaf(sections[s]);
  for (let t = 0; t < 128; t++) {
    const terminal = ((source * 97 + t * 131) % (leafId - 1)) + 1;
    if (terminal === source) continue;
    const exact = (fid % 7 !== 0);
    const count = exact ? 3 + ((fid * 977) % 400_000) : Number("1e" + (18 + (fid % 3))); // some saturate past u128's exact range
    const minLen = 2 + (fid % 4);
    const maxLen = minLen + 3 + (fid % 6);
    const secBlocks = blocks[sections[s]].children;
    // families cross leafy sub-blocks – depth-1 blocks hold no leaves of their own
    const leafy = secBlocks.flatMap((b) => blocks[b].children).filter((b) => blocks[b].symbols.length > 0);
    const fblocks = [leafy[fid % leafy.length], leafy[(fid + 1) % leafy.length]].filter((x, i, a) => a.indexOf(x) === i);
    families.push({ id: `f${++fid}`, source, terminal, count, exact, min_len: minLen, max_len: maxLen, blocks: fblocks });
  }
}

/** Deterministic chains for one family, paged – the enumeration the sidebar
 *  expands. The cursor is the page offset (the real API's cursor is its own
 *  opaque string; the paged shape is the contract). */
export function fixtureChains(familyId: string, cursor: string | null, limit = 40): ChainPage {
  const fam = families.find((f) => f.id === familyId);
  if (!fam) return { chains: [], cursor: null, done: true };
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isFinite(start) || start >= 400) return { chains: [], cursor: null, done: true };
  const out: Chain[] = [];
  for (let i = start; i < Math.min(start + limit, 400); i++) {
    const len = fam.min_len + (i % (fam.max_len - fam.min_len + 1));
    const steps: number[] = [];
    const chBlocks: string[] = [];
    for (let j = 0; j < len; j++) {
      const blockId = fam.blocks[j % fam.blocks.length];
      const syms = blocks[blockId]?.symbols ?? [];
      if (syms.length) { chBlocks.push(blockId); steps.push(syms[(i * 31 + j * 17) % syms.length]); }
    }
    // steps as ids must make two equal paths one chain – dedupe by identity
    const id = `ch:${fam.id}:${steps.join(".")}`;
    if (!out.some((c) => c.id === id)) out.push({ id, source: fam.source, terminal: fam.terminal, steps, blocks: [...new Set(chBlocks)], len });
  }
  const next = start + limit;
  return { chains: out, cursor: next < 400 ? String(next) : null, done: next >= 400 };
}

export const fixture: MapData = {
  blocks,
  families,
  loops,
  leaves,
  stats: { chains: 8.4e17, exact: false, ms: 12_480, threads: 6, embed: "off" },
};
