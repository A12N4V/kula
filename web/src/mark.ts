// kula's mark: the kula ring drawn with kula rings. Keep BASE in step with
// scripts/logo.mjs, which renders the favicon and the README assets from it.

export const BASE = [
  "..###..",
  ".#...#.",
  "#.....#",
  "#..#..#",
  "#.....#",
  ".#...#.",
  "..###..",
];
export const N = BASE.length;
export const lit = (x: number, y: number) => BASE[y]?.[x] === "#";

/** Lit pixels of the mark recursed `depth` levels deep, as one SVG path on an N^depth grid. */
export function markPath(depth: number) {
  const S = N ** depth;
  let d = "";
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let on = true;
      for (let k = 0, X = x, Y = y; k < depth; k++, X = Math.floor(X / N), Y = Math.floor(Y / N))
        if (!lit(X % N, Y % N)) { on = false; break; }
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  return d;
}
