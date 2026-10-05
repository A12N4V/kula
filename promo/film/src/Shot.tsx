// An app shot: a real recording of the UI, with a camera that knows where the
// action is. capture.mjs logs every click and burst of typing; the camera eases
// in on each one, holds while it happens, and eases back out – the way a
// screen-recording editor would cut it by hand, but placed by the data.
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Typed, Eyebrow } from "./Kit";
import { C, FONT, FPS, H, W, clamp } from "./theme";

export type Ev = { kind: "click" | "point" | "type"; t: number; end?: number; x: number; y: number };

const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** How strongly the camera is drawn to an event at clip time `ct`. */
function pull(e: Ev, ct: number) {
  const a = e.kind === "type" ? e.t - 0.35 : e.t - 0.55;
  const b = e.kind === "type" ? (e.end ?? e.t) + 0.55 : e.t + 1.05;
  if (ct < a || ct > b + 0.6) return 0;
  if (ct < a + 0.45) return ease(clamp((ct - a) / 0.45));
  if (ct <= b) return 1;
  return 1 - ease(clamp((ct - b) / 0.6));
}

export function Shot({ clip, from, span, frames, events, cap }: {
  clip: string; from: number; span: number; frames: number; events: Ev[];
  cap?: { k: string; t: string };
}) {
  const f = useCurrentFrame();
  const ct = from + (f / frames) * span; // where we are in the recording
  // Strongest pull wins the focus; zoom grows with it.
  let w = 0, fx = W / 2, fy = H / 2, zoomTo = 1.55;
  for (const e of events) {
    const p = pull(e, ct);
    if (p > w) { w = p; fx = e.x; fy = e.y; zoomTo = e.kind === "type" ? 1.75 : 1.6; }
  }
  // A slow push-in under everything, and a punch on the cut.
  const base = interpolate(f, [0, frames], [1.0, 1.035]);
  const punch = interpolate(f, [0, 7], [1.06, 1], { extrapolateRight: "clamp", easing: ease });
  const s = base * punch * (1 + (zoomTo - 1) * w);
  // Keep the frame inside the picture: the focus point can only pull the view so far.
  const half = { x: W / 2 / s, y: H / 2 / s };
  const cx = clamp(W / 2 + (fx - W / 2) * w, half.x, W - half.x);
  const cy = clamp(H / 2 + (fy - H / 2) * w, half.y, H - half.y);
  const rate = span / (frames / FPS);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${W / 2}px, ${H / 2}px) scale(${s}) translate(${-cx}px, ${-cy}px)`, transformOrigin: "0 0" }}>
        <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={Math.round(from * FPS)} playbackRate={rate} muted style={{ width: W, height: H }} />
      </AbsoluteFill>
      {/* a thin frame and a vignette keep the UI from bleeding into black */}
      <AbsoluteFill style={{ boxShadow: `inset 0 0 0 1px ${C.line}, inset 0 0 160px 40px rgba(0,0,0,.55)` }} />
      {cap && <Caption k={cap.k} t={cap.t} frames={frames} />}
    </AbsoluteFill>
  );
}

/** Lower-left caption: the eyebrow wipes in, the line types itself, both leave on the bar. */
export function Caption({ k, t, frames }: { k: string; t: string; frames: number }) {
  const f = useCurrentFrame();
  const inn = interpolate(f, [2, 9], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(f, [frames - 6, frames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 88, bottom: 84, padding: "18px 26px 20px", background: "#000", border: `1px solid ${C.line2}`, fontFamily: FONT,
      clipPath: `inset(0 ${100 - inn * 100}% 0 0)`, opacity: out, maxWidth: 1240 }}>
      <Eyebrow>{k}</Eyebrow>
      <div style={{ height: 8 }} />
      <Typed lines={[{ text: t, from: 6 }]} size={44} weight={700} cps={48} />
    </div>
  );
}
