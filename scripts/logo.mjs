// kula's mark: the opening's dithered graph-sphere, frozen at one angle.
// Same scene as web/src/Dither.tsx (directory clusters on a Fibonacci sphere,
// gaussian members, ordered 8×8 Bayer threshold) on a fixed synthetic graph,
// so the logo is the thing the app draws, not a drawing of it.
// usage: node scripts/logo.mjs [grid=32] → prints the SVG path of lit pixels
const G = +(process.argv[2] ?? 32);
let m = [[0]];
for (let n = 1; n < 8; n *= 2) {
  const nx = Array.from({ length: n * 2 }, () => Array(n * 2).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = m[y][x] * 4; nx[y][x] = v; nx[y][x + n] = v + 2; nx[y + n][x] = v + 3; nx[y + n][x + n] = v + 1; }
  m = nx;
}
const B = m.map((r) => r.map((v) => (v + 0.5) / 64));
let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const K = 9, golden = Math.PI * (3 - Math.sqrt(5)), pts = [], links = [];
for (let i = 0; i < K; i++) {
  const y = 1 - (2 * (i + 0.5)) / K, r = Math.sqrt(1 - y * y), t = i * golden;
  const c = { x: Math.cos(t) * r * 0.82, y: y * 0.82, z: Math.sin(t) * r * 0.82 };
  const size = 6 + ((i * 7) % 11), base = pts.length;
  for (let j = 0; j < size; j++) {
    const s = 0.035 + Math.sqrt(size) * 0.009;
    pts.push({ x: c.x + gauss() * s, y: c.y + gauss() * s, z: c.z + gauss() * s, w: j === 0 ? 3 : 1 + rnd() });
    if (j) links.push([base, base + j]);
  }
  if (i) links.push([base, base - 1 - ((i * 5) % 7)]), links.push([base, 0]);
}
const w = G, h = G, buf = new Float32Array(w * h);
const ang = 0.6, ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(0.38), st = Math.sin(0.38), scale = G * 0.44;
const proj = pts.map((p) => {
  const rx = p.x * ca + p.z * sa, rz = -p.x * sa + p.z * ca, ry = p.y * ct - rz * st, rz2 = p.y * st + rz * ct, k = 1.9 / (1.9 + rz2);
  return { x: w / 2 + rx * scale * k, y: h / 2 + ry * scale * k, d: Math.max(0.15, Math.min(1, 0.62 - rz2 * 0.55)) };
});
for (const [a, b] of links) {
  const A = proj[a], P = proj[b], steps = Math.ceil(Math.hypot(P.x - A.x, P.y - A.y) * 2);
  for (let s = 0; s <= steps; s++) { const f = s / steps, x = Math.round(A.x + (P.x - A.x) * f), y = Math.round(A.y + (P.y - A.y) * f); if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] += 0.16 * (A.d + P.d); }
}
proj.forEach((p, i) => { const r = (1.1 + pts[i].w * p.d) * G / 40 + 0.4, v = 1.3 * p.d;
  for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(h - 1, Math.ceil(p.y + r)); y++)
    for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(w - 1, Math.ceil(p.x + r)); x++) { const d = (x - p.x) ** 2 + (y - p.y) ** 2; if (d < r * r) buf[y * w + x] += v * (1 - d / (r * r)); } });
let d = "";
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[y * w + x] > B[y & 7][x & 7]) d += `M${x} ${y}h1v1h-1z`;
console.log(d);
