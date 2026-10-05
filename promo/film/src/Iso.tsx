// The isometric world: the kula mark as a little city of code. Each lit cell of
// the mark is a file – a cube whose height is how much code it holds – and the
// calls between files run along the ground. The same world, posed differently,
// carries the intro (code without a map), the build (it folds flat into the
// mark), the break (fences rise around what agents may not touch) and the outro.
import type { ReactNode } from "react";
import { C, H, MARK_CELLS, W, bayer, clamp } from "./theme";

const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);

export type Pose = {
  /** 0 = isometric, 1 = straight down (the flat mark) */
  flat: number;
  /** rotation of the world about its centre, radians */
  spin: number;
  /** pixels per world unit */
  unit: number;
  cx: number;
  cy: number;
};

/** World (x, y on the ground, z up) → screen. */
export function project(p: Pose, x: number, y: number, z: number) {
  const r = Math.hypot(x, y), a = Math.atan2(y, x) + p.spin;
  const X = r * Math.cos(a), Y = r * Math.sin(a);
  const isoX = (X - Y) * COS, isoY = (X + Y) * SIN - z;
  const topX = X, topY = Y;
  const t = p.flat;
  return [p.cx + p.unit * (isoX * (1 - t) + topX * t), p.cy + p.unit * (isoY * (1 - t) + topY * t)] as const;
}

/** The files: the mark's cells, centred on the origin, with a height each. */
export const CELLS = MARK_CELLS.map(([x, y], i) => ({
  i, x: x - 3, y: y - 3,
  h: x === 3 && y === 3 ? 1.6 : 0.45 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 1.1,
  d: bayer(x, y),
}));

/** Calls between files: each ring cell to its neighbours, and spokes to the centre. */
export const CALLS: [number, number][] = (() => {
  const out: [number, number][] = [];
  const centre = CELLS.findIndex((c) => c.x === 0 && c.y === 0);
  const ring = CELLS.filter((c) => c.i !== centre).sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  ring.forEach((c, k) => out.push([c.i, ring[(k + 1) % ring.length].i]));
  ring.forEach((c, k) => { if (k % 3 === 0) out.push([c.i, centre]); });
  return out;
})();

export type CubeLook = { grow: number; fill?: string; edge?: string; top?: string; alpha?: number; dashed?: boolean };

/** One cube: three faces, painter-ordered by the caller. */
function Cube({ p, x, y, h, look }: { p: Pose; x: number; y: number; h: number; look: CubeLook }) {
  const s = 0.36; // half a cell
  const z = h * look.grow * (1 - p.flat);
  const P = (dx: number, dy: number, dz: number) => project(p, x + dx, y + dy, dz).join(",");
  const top = [P(-s, -s, z), P(s, -s, z), P(s, s, z), P(-s, s, z)].join(" ");
  const right = [P(s, -s, 0), P(s, s, 0), P(s, s, z), P(s, -s, z)].join(" ");
  const left = [P(-s, s, 0), P(s, s, 0), P(s, s, z), P(-s, s, z)].join(" ");
  const edge = look.edge ?? C.accent;
  const sw = 1.4;
  const dash = look.dashed ? "6 6" : undefined;
  return (
    <g opacity={look.alpha ?? 1}>
      {z > 0.01 && <polygon points={right} fill={look.fill ?? "#0d0b0a"} stroke={edge} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round" />}
      {z > 0.01 && <polygon points={left} fill={look.fill ? look.fill : "#121010"} stroke={edge} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round" />}
      <polygon points={top} fill={look.top ?? "#1a1614"} stroke={edge} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round" />
    </g>
  );
}

/** A fence: four translucent walls around a cell. */
function Fence({ p, x, y, rise, color }: { p: Pose; x: number; y: number; rise: number; color: string }) {
  const s = 0.47, z = 2.0 * rise;
  const P = (dx: number, dy: number, dz: number) => project(p, x + dx, y + dy, dz).join(",");
  const walls = [
    [P(-s, -s, 0), P(s, -s, 0), P(s, -s, z), P(-s, -s, z)],
    [P(s, -s, 0), P(s, s, 0), P(s, s, z), P(s, -s, z)],
    [P(s, s, 0), P(-s, s, 0), P(-s, s, z), P(s, s, z)],
    [P(-s, s, 0), P(-s, -s, 0), P(-s, -s, z), P(-s, s, z)],
  ];
  return <g>{walls.map((w, i) => <polygon key={i} points={w.join(" ")} fill={color} fillOpacity={0.09} stroke={color} strokeOpacity={0.85} strokeWidth={1.2} />)}</g>;
}

export function World({ pose, look, calls = 1, fences = [], extra, grid = 1 }: {
  pose: Pose; look: (i: number) => CubeLook; calls?: number;
  fences?: { cell: number; rise: number; color: string }[]; extra?: ReactNode; grid?: number;
}) {
  // ground grid
  const lines: ReactNode[] = [];
  const g = 5;
  for (let k = -g; k <= g; k++) {
    const a = project(pose, k, -g, 0), b = project(pose, k, g, 0), c = project(pose, -g, k, 0), d = project(pose, g, k, 0);
    lines.push(<line key={`a${k}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.line} strokeWidth={1} opacity={grid} />);
    lines.push(<line key={`b${k}`} x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} stroke={C.line} strokeWidth={1} opacity={grid} />);
  }
  // calls along the ground, drawn in by `calls` (0..1)
  const edges = CALLS.map(([a, b], k) => {
    const A = CELLS[a], B = CELLS[b];
    const t = clamp(calls * CALLS.length - k);
    if (t <= 0) return null;
    const p0 = project(pose, A.x, A.y, 0), p1 = project(pose, A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, 0);
    return <line key={k} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={C.accent} strokeOpacity={0.55} strokeWidth={1.6} />;
  });
  // painter's order: far cells first
  const order = CELLS.map((c) => {
    const [, sy] = project({ ...pose, flat: 0, unit: 1, cx: 0, cy: 0 }, c.x, c.y, 0);
    return { c, k: sy };
  }).sort((a, b) => a.k - b.k);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
      {lines}
      {edges}
      {order.map(({ c }) => (
        <g key={c.i}>
          <Cube p={pose} x={c.x} y={c.y} h={c.h} look={look(c.i)} />
          {fences.filter((fe) => fe.cell === c.i).map((fe, j) => <Fence key={j} p={pose} x={c.x} y={c.y} rise={fe.rise} color={fe.color} />)}
        </g>
      ))}
      {extra}
    </svg>
  );
}
