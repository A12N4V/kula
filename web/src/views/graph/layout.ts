// Where things sit on the code canvas: each folder is a hollow box with its name
// above it, packing subfolders and files into rows. A file is a bar as tall as its
// code is long and a little wider when it is big, its name in a column to its left.
// Pure: the same tree, hidden set and collapsed set always give the same boxes.

import type { DirN, FileN } from "./model";

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = {
  dirs: Map<DirN, Box & { shut: boolean }>;
  files: Map<FileN, Box>;
  /** the outermost box, for fitting */
  bounds: Box;
};

/** DIR_LABEL: room above a folder for its name. FLABEL: the name column left of a file bar. */
export const DIR_LABEL = 20, FLABEL = 70, GAP = 18, PAD = 18;
const SHUT_W = 120, SHUT_H = 34;

/** A bar widens with the root of its length too, so big files read as big at a glance. */
export const fileW = (loc: number) => Math.round(Math.min(44, Math.max(16, 12 + Math.sqrt(loc) * 0.65)));
/** Roughly how wide a folder's name is drawn, in world units (mono at 11px). */
export const dirLabelW = (name: string) => (name.length + 1) * 6.6;

/** A block's height grows with the root of its length, so a 3k line file is tall without being a tower. */
export const fileH = (loc: number) => Math.round(Math.min(280, Math.max(22, 6 + Math.sqrt(loc) * 3.4)));

type Sized = { w: number; h: number; place: (x: number, y: number) => void };

export function place(root: DirN, show: (f: FileN) => boolean, shut: Set<string>): Placed {
  const out: Placed = { dirs: new Map(), files: new Map(), bounds: { x: 0, y: 0, w: 0, h: 0 } };

  const size = (d: DirN, top: boolean): Sized | null => {
    if (!top && shut.has(d.path)) {
      if (!d.files.some(show) && !d.dirs.some((c) => anyShown(c, show))) return null;
      return { w: SHUT_W, h: DIR_LABEL + SHUT_H, place: (x, y) => out.dirs.set(d, { x, y: y + DIR_LABEL, w: SHUT_W, h: SHUT_H, shut: true }) };
    }
    const items: Sized[] = [];
    for (const c of d.dirs) { const s = size(c, false); if (s) items.push(s); }
    for (const f of d.files) {
      if (!show(f)) continue;
      const h = fileH(f.loc), w = fileW(f.loc);
      items.push({ w: FLABEL + w, h, place: (x, y) => out.files.set(f, { x: x + FLABEL, y, w, h }) });
    }
    if (!items.length) return null;
    // tallest first, then try a range of row widths and keep the one closest to the wanted shape
    items.sort((a, b) => b.h - a.h);
    const best = pack(items, top ? 1.35 : 1.05);
    const { at, wide } = best;
    const y = best.y, row = best.row;
    const w = Math.max(wide + PAD * 2, Math.min(240, dirLabelW(d.name) + 24));
    const h = PAD + y + row + PAD;
    return {
      w, h: DIR_LABEL + h,
      place: (bx, by) => {
        out.dirs.set(d, { x: bx, y: by + DIR_LABEL, w, h, shut: false });
        items.forEach((it, i) => it.place(bx + PAD + at[i][0], by + DIR_LABEL + PAD + at[i][1]));
      },
    };
  };

  const s = size(root, true);
  if (s) { s.place(0, 0); out.bounds = { x: 0, y: 0, w: s.w, h: s.h }; }
  return out;
}

function shelf(items: Sized[], target: number) {
  let x = 0, y = 0, row = 0, wide = 0;
  const at = items.map((it) => {
    if (x > 0 && x + it.w > target) { x = 0; y += row + GAP; row = 0; }
    const p = [x, y] as const;
    x += it.w + GAP; row = Math.max(row, it.h); wide = Math.max(wide, x - GAP);
    return p;
  });
  return { at, wide, y, row };
}

function pack(items: Sized[], aspect: number) {
  const maxW = Math.max(...items.map((it) => it.w));
  const sumW = items.reduce((t, it) => t + it.w + GAP, 0);
  const area = items.reduce((t, it) => t + it.w * it.h, 0);
  let best = shelf(items, maxW), score = Infinity;
  for (let t = maxW; t <= sumW + 1; t = Math.max(t * 1.12, t + 60)) {
    const r = shelf(items, t), h = r.y + r.row;
    const sc = Math.abs(Math.log(r.wide / h / aspect)) + 0.6 * Math.log((r.wide * h) / area);
    if (sc < score) { score = sc; best = r; }
  }
  return best;
}

function anyShown(d: DirN, show: (f: FileN) => boolean): boolean {
  return d.files.some(show) || d.dirs.some((c) => anyShown(c, show));
}

/** Where a line of a file sits on its block. */
export const lineY = (b: Box, line: number, loc: number) => (line <= 0 ? b.y + b.h / 2 : b.y + 3 + ((line - 1) / Math.max(1, loc)) * (b.h - 6));

/** The box a file is drawn as: its own block, or the closed folder it is hidden in. */
export function holder(p: Placed, f: FileN): { box: Box; open: boolean } | null {
  let shutBox: Box | null = null;
  for (let d: DirN | null = f.dir; d; d = d.parent) {
    const b = p.dirs.get(d);
    if (b?.shut) shutBox = b;
  }
  if (shutBox) return { box: shutBox, open: false };
  const b = p.files.get(f);
  return b ? { box: b, open: true } : null;
}
