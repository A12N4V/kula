// Shared by the typographic scenes. Every scene draws a frame for a time t (in
// seconds) with window.render(t): no clocks, no requestAnimationFrame, so the
// capture is frame-exact and the same every run.
export const C = { bg: "#000", cream: "#e8e2d9", dim: "#867d73", line: "#24201d", accent: "#f97f3a", signal: "#F05201", red: "#f0827a", green: "#8fd694" };
export const W = 1920, H = 1080;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const bayer = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);

export function canvas() {
  const c = document.querySelector("canvas");
  c.width = W; c.height = H;
  return c.getContext("2d");
}

/** A 1-bit ordered-dither field: value(x, y) in 0..1 decides each cell. */
export function dither(ctx, cell, value, color, dot = 0.5) {
  ctx.fillStyle = color;
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell), s = cell * dot, o = (cell - s) / 2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    if (value(x * cell, y * cell) > bayer(x, y)) ctx.fillRect(x * cell + o, y * cell + o, s, s);
}

const BASE = ["..###..", ".#...#.", "#.....#", "#..#..#", "#.....#", ".#...#.", "..###.."];
export const N = 7;
export const lit = (x, y) => BASE[y][x] === "#";

/**
 * The mark: the kula ring drawn with kula rings, recursed until cells are `min` px.
 * `reveal(cx, cy, depth)` in 0..1 decides whether a leaf cell is drawn.
 */
export function mark(ctx, x0, y0, size, color, min = 3, reveal = () => 1, depth = 0) {
  const c = size / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!lit(x, y)) continue;
    const px = x0 + x * c, py = y0 + y * c;
    if (px > W || py > H || px + c < 0 || py + c < 0) continue;
    if (c / N >= min && depth < 6) mark(ctx, px, py, c, color, min, reveal, depth + 1);
    else if (reveal(px + c / 2, py + c / 2, depth) > 0.5) { ctx.fillStyle = color; ctx.fillRect(px, py, c * 0.86, c * 0.86); }
  }
}

/** Text typed out from t0 at `cps` characters a second. */
export const typed = (text, t, t0, cps = 38) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));

/** A 5×7 pixel face, so the wordmark never depends on a font. */
const GLYPH = {
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"], U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"], A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."], ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."], 0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
};
export function word(ctx, text, x0, y0, s, color, reveal = () => 1) {
  let x = x0;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (g) g.forEach((row, y) => [...row].forEach((c, i) => {
      if (c === "#" && reveal(x + i * s, y0 + y * s) > 0.5) { ctx.fillStyle = color; ctx.fillRect(x + i * s, y0 + y * s, s * 0.9, s * 0.9); }
    }));
    x += 6 * s;
  }
  return x;
}

export function text(ctx, s, x, y, { size = 56, weight = 600, color = C.cream, spacing = 0, align = "left" } = {}) {
  ctx.font = `${weight} ${size}px 'JBM'`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

/** The blinking block cursor, on the beat. */
export const cursorOn = (t, bpm = 90) => Math.floor(t / (60 / bpm / 2)) % 2 === 0;
