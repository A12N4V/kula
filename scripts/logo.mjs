// kula's mark: the kula ring drawn with kula rings.
// A 7×7 ring with a node at its centre; every lit cell of it is the whole mark
// again, two levels deep (49×49). The centre node is a fixed point: it holds a
// complete copy of the mark, which is where the app's loader zooms forever
// (web/src/AsciiMark.tsx reads the same BASE from web/src/mark.ts).
// usage: node scripts/logo.mjs   → rewrites favicon, logo.svg and the hero's mark
import { readFileSync, writeFileSync } from "node:fs";

const BASE = [
  "..###..",
  ".#...#.",
  "#.....#",
  "#..#..#",
  "#.....#",
  ".#...#.",
  "..###..",
];
const N = BASE.length;
const lit = (x, y) => BASE[y]?.[x] === "#";

/** Lit pixels of the mark recursed `depth` levels, as one SVG path on an N^depth grid. */
function path(depth) {
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

const ACCENT = "#F05201";
const two = path(2);
const S = N * N;

// Tab icon: level two on black with a one-cell margin, so it reads in light and dark tab bars.
writeFileSync("web/public/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${S + 8} ${S + 8}" shape-rendering="crispEdges" role="img" aria-label="kula"><rect x="-4" y="-4" width="${S + 8}" height="${S + 8}" fill="#000"/><path fill="${ACCENT}" d="${two}"/></svg>\n`);
writeFileSync("docs/assets/logo.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" shape-rendering="crispEdges" role="img" aria-label="kula"><path fill="${ACCENT}" d="${two}"/></svg>\n`);

// The README hero carries the mark inline between its marker comment and </g>.
const heroPath = "docs/assets/hero.svg";
const hero = readFileSync(heroPath, "utf8").replace(
  /(<!-- the mark:[^>]*-->\s*<g transform=")[^"]*("[^>]*>\s*<path fill="[^"]*" d=")[^"]*(")/,
  `$1translate(60 60) scale(${(240 / S).toFixed(4)})$2${two}$3`,
).replace(/<!-- the mark:[^>]*-->/, "<!-- the mark: the kula ring drawn with kula rings (scripts/logo.mjs) -->");
writeFileSync(heroPath, hero);

console.log(`wrote favicon.svg, logo.svg, hero.svg · ${S}×${S} · ${(two.match(/M/g) ?? []).length} cells`);
