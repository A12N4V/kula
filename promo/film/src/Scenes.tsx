import type React from "react";
// The film's own scenes, drawn in Remotion: the problem, the build into the
// mark, the break where fences rise, and the outro.
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { CELLS, World, project, type Pose } from "./Iso";
import { Dither, Eyebrow, Typed, typed, Cursor } from "./Kit";
import { BAR, C, FONT, H, W, bayer, clamp, easeInOut, easeOut } from "./theme";

const GLYPH: Record<string, string[]> = {
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"], U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"], A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."], ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."], "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
};

/** A word in the mark's own 5×7 pixels, revealed in ordered dither by `show` (0..1). */
export function PixelWord({ text, x, y, s, color, show = 1 }: { text: string; x: number; y: number; s: number; color: string; show?: number }) {
  const rects: React.ReactElement[] = [];
  let cx = x;
  for (const ch of text) {
    GLYPH[ch]?.forEach((row, gy) => [...row].forEach((c, gx) => {
      if (c === "#" && show * 1.15 > bayer(gx + Math.round(cx / s), gy)) rects.push(<rect key={`${cx}-${gx}-${gy}`} x={cx + gx * s} y={y + gy * s} width={s * 0.9} height={s * 0.9} fill={color} />);
    }));
    cx += 6 * s;
  }
  return <>{rects}</>;
}

const glow = (cx: number, cy: number, rx: number, ry: number, k: number) => (x: number, y: number) => k * Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));

// ------------------------------------------------------------------ intro: code without a map

export function Problem() {
  const f = useCurrentFrame();
  const pose: Pose = { flat: 0, spin: interpolate(f, [0, 3 * BAR], [-0.55, 0.12]), unit: 84, cx: 1420, cy: 570 };
  const fog = clamp((f - 125) / 30);         // "it can't see the shape of it"
  const strike = f >= 165 && f < 200;        // "it touches what it shouldn't"
  const forget = clamp((f - 190) / 35);      // "and it forgets"
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Dither value={glow(1420, 570, 820, 520, 0.5 * clamp(f / 25))} cell={12} />
      <World
        pose={pose}
        grid={clamp(f / 20)}
        calls={clamp((f - 50) / 70) * (1 - forget)}
        look={(i) => {
          const c = CELLS[i];
          const grow = easeOut((f - 8 - c.d * 55) / 26);
          const lost = fog > c.d;
          if (strike && i === 6) return { grow, top: C.red, edge: C.red };
          return { grow, alpha: lost ? 0.35 : 1, dashed: lost, edge: lost ? C.dim : C.accent };
        }}
      />
      <div style={{ position: "absolute", left: 140, top: 250, width: 820 }}>
        <Eyebrow color={C.dim}>Stack Overflow 2025 · 84% use AI · 46% don't trust it</Eyebrow>
        <div style={{ height: 34 }} />
        <Typed cps={40} lines={[
          { text: "Your AI writes more", from: 14, size: 66 },
          { text: "of your code every day.", from: 30, size: 66 },
          { text: "It can't see its shape.", from: 112, size: 44, weight: 500, color: C.dim },
          { text: "It touches what it shouldn't.", from: 150, size: 44, weight: 500, color: C.dim },
          { text: "It forgets.", from: 186, size: 44, weight: 500, color: C.dim },
        ]} />
      </div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ build: the city folds into the mark

export function Build() {
  const f = useCurrentFrame();
  const t = easeInOut(f / 46);
  const move = easeInOut((f - 44) / 22);
  const pose: Pose = {
    flat: t,
    spin: interpolate(t, [0, 1], [0.12, 0]),
    unit: interpolate(t, [0, 1], [84, 64]) * interpolate(move, [0, 1], [1, 0.82]),
    cx: interpolate(t, [0, 1], [1420, 960]) + interpolate(move, [0, 1], [0, -380]),
    cy: interpolate(t, [0, 1], [570, 540]),
  };
  const word = clamp((f - 54) / 16);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Dither value={glow(pose.cx, pose.cy, 700, 500, 0.45)} cell={12} />
      <World pose={pose} grid={1 - t} calls={1 - t}
        look={() => ({ grow: 1, top: t > 0.6 ? C.signal : "#1a1614", edge: t > 0.85 ? C.signal : C.accent, fill: t > 0.85 ? C.signal : undefined })} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }} shapeRendering="crispEdges">
        <PixelWord text="KULA" x={880} y={470} s={20} color={C.cream} show={word} />
        <PixelWord text="1.0" x={880 + 4 * 6 * 20 + 6} y={470 + 7 * 20 - 7 * 8} s={8} color={C.accent} show={clamp((f - 66) / 8)} />
      </svg>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ break: fences rise

const LOCKED = [2, 9, 13], HIDDEN = [4, 15], REVIEW = [11];

export function Fences() {
  const f = useCurrentFrame();
  const pose: Pose = { flat: 0, spin: interpolate(f, [0, 2 * BAR], [0.35, -0.15]), unit: 80, cx: 1420, cy: 600 };
  const rise = (k: number) => easeOut((f - 34 - k * 7) / 18);
  const fences = [
    ...LOCKED.map((cell, k) => ({ cell, rise: rise(k), color: C.red })),
    ...HIDDEN.map((cell, k) => ({ cell, rise: rise(k + 3), color: C.violet })),
    ...REVIEW.map((cell, k) => ({ cell, rise: rise(k + 5), color: C.yellow })),
  ];
  // An agent walks toward a locked file and is turned back at the fence.
  const from = CELLS[7], to = CELLS[LOCKED[1]];
  const go = clamp((f - 80) / 26), back = clamp((f - 108) / 22);
  const k = go * 0.62 - back * 0.62;
  const ax = from.x + (to.x - from.x) * k, ay = from.y + (to.y - from.y) * k;
  const [px, py] = project(pose, ax, ay, 0.25);
  const hit = f >= 104 && f < 116;
  const [hx, hy] = project(pose, from.x + (to.x - from.x) * 0.62, from.y + (to.y - from.y) * 0.62, 0.6);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Dither value={glow(1420, 600, 780, 520, 0.45)} cell={12} />
      <World pose={pose} calls={1} fences={fences}
        look={(i) => ({ grow: 1, alpha: HIDDEN.includes(i) ? 0.25 + 0.75 * (1 - rise(3)) : 1, dashed: HIDDEN.includes(i) && rise(3) > 0.5 })}
        extra={<>
          {f >= 78 && <rect x={px - 11} y={py - 11} width={22} height={22} fill={C.accent} />}
          {hit && <circle cx={hx} cy={hy} r={18 + (f - 104) * 4} fill="none" stroke={C.red} strokeWidth={2} opacity={1 - (f - 104) / 12} />}
        </>} />
      <div style={{ position: "absolute", left: 140, top: 330, width: 760 }}>
        <Eyebrow>Agents</Eyebrow>
        <div style={{ height: 26 }} />
        <Typed cps={30} lines={[{ text: "Now let the agents in.", from: 8, size: 76 }, { text: "On your terms.", from: 50, size: 76, color: C.accent }]} />
        <div style={{ height: 44, opacity: clamp((f - 40) / 10) }} />
        <div style={{ display: "grid", gap: 10, fontFamily: FONT, fontSize: 20, color: C.dim, opacity: clamp((f - 40) / 10) }}>
          {([["locked", C.red, "read, never edit"], ["hidden", C.violet, "never shown"], ["review", C.yellow, "a person checks"]] as const).map(([l, c, d]) => (
            <div key={l}><span style={{ display: "inline-block", minWidth: 110, padding: "1px 8px", marginRight: 16, border: `1px solid ${c}`, color: c, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", fontSize: 15, textAlign: "center" }}>{l}</span>{d}</div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ outro

const CMD = "brew install A12N4V/tap/kula";

export function Outro({ frames }: { frames: number }) {
  const f = useCurrentFrame();
  const pose: Pose = { flat: 1, spin: 0, unit: 52, cx: 470, cy: 520 };
  const show = clamp(f / 26);
  const out = clamp((f - (frames - 36)) / 32);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Dither value={glow(470, 520, 700, 500, 0.5 * show)} cell={12} />
      <World pose={pose} grid={0} calls={0} look={(i) => ({ grow: 1, top: C.signal, fill: C.signal, edge: C.signal, alpha: show * 1.2 > CELLS[i].d ? 1 : 0 })} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }} shapeRendering="crispEdges">
        <PixelWord text="KULA" x={860} y={300} s={22} color={C.cream} show={clamp((f - 14) / 16)} />
        <PixelWord text="1.0" x={860 + 4 * 6 * 22 + 8} y={300 + 7 * 22 - 7 * 9} s={9} color={C.accent} show={clamp((f - 28) / 8)} />
      </svg>
      <div style={{ position: "absolute", left: 860, top: 520, fontFamily: FONT, color: C.cream }}>
        <div style={{ fontSize: 40, fontWeight: 500 }}>{typed("git, with a map – for you and your agents.", f, 30, 40)}</div>
        <div style={{ height: 40 }} />
        {f >= 78 && (
          <div style={{ display: "inline-block", padding: "14px 22px", border: `1px solid ${C.line2}`, fontSize: 28 }}>
            <span style={{ color: C.accent }}>$ </span>{typed(CMD, f, 82, 26)}<Cursor on={f < 170} />
          </div>
        )}
        <div style={{ height: 22 }} />
        <div style={{ fontSize: 20, color: C.dim, opacity: clamp((f - 120) / 10) }}>or curl · apt · npm · pip · cargo · nix</div>
        <div style={{ height: 34 }} />
        <div style={{ opacity: clamp((f - 140) / 10) }}><Eyebrow color={C.dim}>workflows · fences · memory · the graph · mcp</Eyebrow></div>
        <div style={{ height: 14 }} />
        <div style={{ opacity: clamp((f - 160) / 10) }}><Eyebrow>github.com/A12N4V/kula · GPL-3.0 · one binary, no account</Eyebrow></div>
      </div>
      {out > 0 && <Dither value={() => out * 1.05} cell={8} dot={1} color={C.bg} />}
    </AbsoluteFill>
  );
}
