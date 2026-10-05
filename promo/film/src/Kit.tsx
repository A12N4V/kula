// Small pieces every scene uses: typed text, the beat cursor, a dither layer.
import { useLayoutEffect, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { BEAT, C, FONT, H, W, bayer } from "./theme";

/** `text` typed out from frame `from` at `cps` characters a second. */
export function typed(text: string, frame: number, from: number, cps = 34) {
  return text.slice(0, Math.max(0, Math.floor(((frame - from) / 30) * cps)));
}

/** A block cursor that blinks on the eighth notes. */
export function Cursor({ on = true, h = 0.9, color = C.accent }: { on?: boolean; h?: number; color?: string }) {
  const f = useCurrentFrame();
  const blink = Math.floor(f / (BEAT / 2)) % 2 === 0;
  return <span style={{ display: "inline-block", width: "0.55em", height: `${h}em`, marginLeft: "0.12em", verticalAlign: "-0.12em", background: on && blink ? color : "transparent" }} />;
}

/** Type that is typed: `lines` appear one after another, each from its own frame. */
export function Typed({ lines, size = 64, weight = 700, color = C.cream, gap = 1.25, cps = 34, cursor = true }: {
  lines: { text: string; from: number; color?: string; size?: number; weight?: number }[]; size?: number; weight?: number; color?: string; gap?: number; cps?: number; cursor?: boolean;
}) {
  const f = useCurrentFrame();
  const shown = lines.filter((l) => f >= l.from);
  return (
    <div style={{ fontFamily: FONT, letterSpacing: "-0.01em" }}>
      {shown.map((l, i) => {
        const s = typed(l.text, f, l.from, cps);
        const last = i === shown.length - 1;
        return (
          <div key={i} style={{ fontSize: l.size ?? size, fontWeight: l.weight ?? weight, color: l.color ?? color, lineHeight: gap, whiteSpace: "pre" }}>
            {s}{cursor && last && <Cursor />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A full-frame 1-bit ordered-dither layer: `value(x, y)` in 0..1 lights a cell
 * when it beats the cell's Bayer threshold. Drawn on a canvas each frame.
 */
export function Dither({ value, cell = 10, dot = 0.45, color = "#1d1a17" }: { value: (x: number, y: number) => number; cell?: number; dot?: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const f = useCurrentFrame();
  useLayoutEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    const s = cell * dot, o = (cell - s) / 2;
    for (let y = 0; y < H / cell; y++) for (let x = 0; x < W / cell; x++)
      if (value(x * cell, y * cell) > bayer(x, y)) ctx.fillRect(x * cell + o, y * cell + o, s, s);
  });
  return <canvas ref={ref} width={W} height={H} data-f={f} style={{ position: "absolute", inset: 0 }} />;
}

/** An eyebrow: tracked uppercase in the accent. */
export function Eyebrow({ children, color = C.accent }: { children: React.ReactNode; color?: string }) {
  return <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 600, letterSpacing: "0.18em", color, textTransform: "uppercase" }}>{children}</div>;
}
