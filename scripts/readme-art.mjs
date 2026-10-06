// The README's animated art, rendered from the same seven rows as the mark.
// Every animation is 1-bit ordered dither: cells are grouped by their Bayer
// threshold into one <path> per level, and a level's opacity is animated, so a
// gradient sweeping through time reads as a dithered gradient on screen – in a
// few kilobytes, with no raster and no script (GitHub renders SVG animations in
// <img>, never scripts).
//   usage: node scripts/readme-art.mjs   → docs/assets/{hero,divider,agent-loop}.svg
import { writeFileSync } from "node:fs";

const BASE = ["..###..", ".#...#.", "#.....#", "#..#..#", "#.....#", ".#...#.", "..###.."];
const N = BASE.length;
const lit = (x, y) => BASE[y]?.[x] === "#";
const ACCENT = "#F05201", UI = "#f97f3a", CREAM = "#e8e2d9", LINE = "#24201d", BG = "#000";

// 4×4 Bayer matrix, thresholds 0..15.
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const bayer = (x, y) => BAYER[y & 3][x & 3];
const sq = (x, y, s = 1) => `M${+x.toFixed(2)} ${+y.toFixed(2)}h${s}v${s}h-${s}z`;

/** Cells of the mark two levels deep (49×49). */
function markCells() {
  const S = N * N, out = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
    if (lit(x % N, y % N) && lit(Math.floor(x / N), Math.floor(y / N))) out.push([x, y]);
  return out;
}

// A 5×7 pixel face for the wordmark, so it never depends on a font being present.
const GLYPH = {
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};
function word(text, x0, y0, s, gap = 1) {
  let d = "", x = x0;
  for (const ch of text) {
    const g = GLYPH[ch];
    g.forEach((row, y) => [...row].forEach((c, i) => { if (c === "#") d += sq(x + i * s, y0 + y * s, s - 0.6); }));
    x += (5 + gap) * s;
  }
  return d;
}

// ------------------------------------------------------------------ hero
function hero() {
  const W = 1280, H = 440;
  const T = 9; // seconds per loop
  // Ground: an ordered-dither radial glow behind the mark, one path per Bayer level.
  const P = 8, cols = W / P, rows = H / P, cx = 270 / P, cy = H / 2 / P;
  const ground = Array.from({ length: 16 }, () => "");
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const r = Math.hypot((x - cx) / 1.25, y - cy) / (rows * 0.95);
    const v = Math.max(0, 1 - r) ** 1.6 * 16; // brightness 0..16
    const t = bayer(x, y);
    if (t < v) ground[t] += sq(x * P + 3, y * P + 3, 1.6);
  }
  // The mark: cells dissolve in by threshold and distance from the centre, then shimmer.
  const S = N * N, size = 300, k = size / S, ox = 120, oy = (H - size) / 2;
  const levels = Array.from({ length: 16 }, () => "");
  for (const [x, y] of markCells()) {
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const lvl = Math.min(15, Math.floor((d * 0.55 + bayer(x, y) / 16 * 0.45) * 16));
    levels[lvl] += sq(ox + x * k, oy + y * k, k * 0.86);
  }
  const fx = 520;
  const css = `
    .g path { fill: ${CREAM}; }
    ${ground.map((_, i) => `.g${i} { opacity: 0; animation: breathe ${T}s ${(-(15 - i) / 15 * T * 0.5).toFixed(2)}s ease-in-out infinite; }`).join("\n    ")}
    @keyframes breathe { 0%, 100% { opacity: .05 } 50% { opacity: .22 } }
    .m path { fill: ${ACCENT}; }
    ${levels.map((_, i) => `.m${i} { opacity: 0; animation: in .5s ${(0.15 + i * 0.07).toFixed(2)}s steps(1, end) forwards, shimmer ${T}s ${(2 + i / 15 * T).toFixed(2)}s steps(1, end) infinite; }`).join("\n    ")}
    @keyframes in { from { opacity: 0 } to { opacity: 1 } }
    @keyframes shimmer { 0%, 6%, 100% { opacity: 1 } 3% { opacity: .35 } }
    .w { fill: ${CREAM}; opacity: 0; animation: in .4s 1.2s steps(1, end) forwards; }
    .w2 { fill: ${UI}; opacity: 0; animation: in .4s 1.5s steps(1, end) forwards; }
    .t { font: 500 19px 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; fill: ${CREAM}; opacity: 0; animation: in .3s 1.8s steps(1, end) forwards; }
    .s { font: 600 12px 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: .14em; fill: #867d73; opacity: 0; animation: in .6s 2.1s ease-out forwards; }
    .s b, .o { fill: ${UI}; }
    .rule { stroke: ${LINE}; stroke-width: 1; }
    .cur { fill: ${UI}; animation: blink 1.1s 2.2s steps(1, end) infinite; opacity: 0; }
    @keyframes blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; opacity: 1 !important; } .g path { opacity: .14 !important; } }`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="kula 1.0 – git, with a map. A knowledge graph of your code for you and your agents.">
<style>${css}
</style>
<rect width="${W}" height="${H}" fill="${BG}"/>
<g class="g">${ground.map((d, i) => `<path class="g${i}" d="${d}"/>`).join("")}</g>
<g class="m" shape-rendering="crispEdges">${levels.map((d, i) => `<path class="m${i}" d="${d}"/>`).join("")}</g>
<path class="rule" d="M${fx} 112H${W - 60}M${fx} 328H${W - 60}"/>
<g shape-rendering="crispEdges"><path class="w" d="${word("KULA", fx, 140, 12)}"/><path class="w2" d="${sq(fx + 4 * 6 * 12 + 4, 140 + 6 * 12, 11.4)}"/></g>
<text class="t" x="${fx}" y="268">git, with a map – for you and your agents<tspan class="cur">_</tspan></text>
<text class="s" x="${fx}" y="300">KNOWLEDGE GRAPH · WORKFLOWS · FENCES · MEMORY · MCP</text>
<text class="s" x="${fx}" y="100"><tspan class="o">●</tspan> V1.0.1 · GPL-3.0 · ONE BINARY · LOCAL-FIRST</text>
</svg>
`;
}

// ------------------------------------------------------------------ divider
function divider() {
  const W = 1280, H = 18, P = 3, T = 6;
  const levels = Array.from({ length: 16 }, () => "");
  for (let y = 0; y < H / P; y++) for (let x = 0; x < W / P; x++) {
    const v = (Math.sin((x / (W / P)) * Math.PI) ** 2) * 16;
    const t = bayer(x, y);
    if (t < v) levels[t] += sq(x * P, y * P, P - 1);
  }
  const css = levels.map((_, i) => `.d${i} { animation: sweep ${T}s ${(-i / 16 * T).toFixed(2)}s linear infinite; }`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation">
<style>path { fill: ${UI}; opacity: .08; }
${css}
@keyframes sweep { 0%, 100% { opacity: .06 } 50% { opacity: .55 } }
@media (prefers-reduced-motion: reduce) { path { animation: none !important; opacity: .2; } }</style>
<rect width="${W}" height="${H}" fill="${BG}"/>
<g shape-rendering="crispEdges">${levels.map((d, i) => `<path class="d${i}" d="${d}"/>`).join("")}</g>
</svg>
`;
}

// ------------------------------------------------------------------ agent loop
function agentLoop() {
  const W = 1280, H = 300, T = 8;
  const stages = [
    ["workflows", "learn how"], ["context_pack", "read the graph"], ["pre_edit", "callers · tests · risk"],
    ["edit", "the hook checks fences"], ["verify_edit", "what moved"], ["remember", "anchored to code"],
  ];
  const bw = 176, gap = 26, x0 = (W - (stages.length * bw + (stages.length - 1) * gap)) / 2, y0 = 92, bh = 96;
  const boxes = stages.map(([t, s], i) => {
    const x = x0 + i * (bw + gap);
    const gate = t === "edit";
    const hatch = gate ? Array.from({ length: 14 }, (_, j) => `M${x + j * 14} ${y0 + bh}l${Math.min(bh, bw - j * 14)} -${Math.min(bh, bw - j * 14)}`).join("") : "";
    return `<g>
  <rect x="${x}" y="${y0}" width="${bw}" height="${bh}" class="box${gate ? " gate" : ""}"/>
  ${gate ? `<path d="${hatch}" class="hatch" clip-path="url(#c${i})"/><clipPath id="c${i}"><rect x="${x}" y="${y0}" width="${bw}" height="${bh}"/></clipPath>` : ""}
  <text x="${x + 14}" y="${y0 + 26}" class="n">${String(i + 1).padStart(2, "0")}</text>
  <text x="${x + 14}" y="${y0 + 54}" class="h${gate ? " r" : ""}">${t}</text>
  <text x="${x + 14}" y="${y0 + 76}" class="d">${s}</text>
  ${i > 0 ? `<path d="M${x - gap + 4} ${y0 + bh / 2}h${gap - 10}" class="arrow"/><path d="M${x - 8} ${y0 + bh / 2 - 4}l5 4-5 4" class="arrow"/>` : ""}
</g>`;
  }).join("\n");
  // A packet runs the loop; at the gate it splits: a fenced edit is turned back.
  const yL = y0 + bh / 2, xs = stages.map((_, i) => x0 + i * (bw + gap) + bw / 2);
  const run = `M${xs[0]} ${yL}H${xs[5]}`;
  const back = `M${xs[3]} ${y0 + bh}v34H${xs[2]}v-34`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The agent loop: workflows, context_pack, pre_edit, edit through the fence hook, verify_edit, remember">
<style>
  .box { fill: #0c0b0a; stroke: ${LINE}; }
  .gate { stroke: #f0827a; }
  .hatch { stroke: #f0827a; stroke-opacity: .16; }
  text { font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace; }
  .n { font-size: 11px; font-weight: 600; letter-spacing: .1em; fill: ${UI}; }
  .h { font-size: 16px; font-weight: 600; fill: ${CREAM}; }
  .h.r { fill: #f0827a; }
  .d { font-size: 12px; fill: #867d73; }
  .arrow { fill: none; stroke: #332d28; stroke-width: 1.5; }
  .cap { font-size: 12px; letter-spacing: .14em; fill: #867d73; }
  .cap b { fill: ${UI}; }
  .pk { fill: ${UI}; }
  .no { fill: #f0827a; }
  .ret { fill: none; stroke: #f0827a; stroke-dasharray: 3 5; stroke-opacity: .5; }
  @media (prefers-reduced-motion: reduce) { .pk, .no { display: none; } }
</style>
<rect width="${W}" height="${H}" fill="${BG}"/>
<text x="${x0}" y="52" class="cap">THE AGENT LOOP · EVERY STEP IS AN MCP TOOL, A CLI COMMAND, AND A UI VIEW</text>
${boxes}
<path d="${back}" class="ret"/>
<text x="${xs[2] + 30}" y="${y0 + bh + 58}" class="d">a locked or out-of-scope edit is turned back, with the reason</text>
<rect class="pk" x="-5" y="-5" width="10" height="10"><animateMotion dur="${T}s" repeatCount="indefinite" path="${run}" keyPoints="0;0.6;0.6;1" keyTimes="0;0.45;0.55;1" calcMode="linear"/></rect>
<rect class="no" x="-4" y="-4" width="8" height="8" opacity="0"><animateMotion dur="${T}s" begin="${T * 0.45}s" repeatCount="indefinite" path="${back}"/><animate attributeName="opacity" dur="${T}s" begin="${T * 0.45}s" values="1;1;0;0" keyTimes="0;0.25;0.26;1" repeatCount="indefinite"/></rect>
</svg>
`;
}

writeFileSync("docs/assets/hero.svg", hero());
writeFileSync("docs/assets/divider.svg", divider());
writeFileSync("docs/assets/agent-loop.svg", agentLoop());
console.log("hero.svg, divider.svg, agent-loop.svg");
