// Homonin's ground: absolute black, warm lines, cream type, one orange.
export const C = {
  bg: "#000", panel: "#0c0b0a", line: "#24201d", line2: "#332d28", cream: "#e8e2d9", dim: "#867d73",
  accent: "#f97f3a", signal: "#F05201", red: "#f0827a", violet: "#d49cf0", yellow: "#f2cc60", green: "#8fd694",
};
export const FONT = "JBM, 'JetBrains Mono', ui-monospace, monospace";
export const FPS = 30;
export const W = 1920, H = 1080;
/** One bar of the score at 90 BPM: 8/3 s, exactly 80 frames. */
export const BAR = 80;
export const BEAT = 20;

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const bayer = (x: number, y: number) => (BAYER[y & 3][x & 3] + 0.5) / 16;
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x: number) => { const t = clamp(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/** The mark's seven rows: the kula ring around a centre node. */
export const BASE = ["..###..", ".#...#.", "#.....#", "#..#..#", "#.....#", ".#...#.", "..###.."];
export const MARK_CELLS: [number, number][] = [];
BASE.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") MARK_CELLS.push([x, y]); }));
