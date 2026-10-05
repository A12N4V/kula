// An app shot: a real recording of the UI, with a camera that knows where the
// action is. capture.mjs logs every click and burst of typing; the camera eases
// in on each one, holds while it happens, and eases back out – the way a
// screen-recording editor would cut it by hand, but placed by the data. The
// recording floats as a window: it swings in at an angle, settles flat, and
// grows to fill the frame whenever the camera closes in.
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile } from "remotion";
import { useF } from "./Kit";
import { C, FPS, H, W, clamp, easeInOut } from "./theme";

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

export function Shot({ clip, from, span, frames, events, lead, tilt = 1 }: {
  clip: string; from: number; span: number; frames: number; events: Ev[]; lead: number; tilt?: -1 | 1;
}) {
  const f = useF();
  const ct = from + (f / frames) * span; // where we are in the recording
  // Strongest pull wins the focus; zoom grows with it.
  let w = 0, fx = W / 2, fy = H / 2, zoomTo = 1.55;
  for (const e of events) {
    const p = pull(e, ct);
    if (p > w) { w = p; fx = e.x; fy = e.y; zoomTo = e.kind === "type" ? 1.75 : 1.6; }
  }
  // A slow push-in under everything.
  const s = interpolate(f, [0, frames], [1.0, 1.04]) * (1 + (zoomTo - 1) * w);
  const half = { x: W / 2 / s, y: H / 2 / s };
  const cx = clamp(W / 2 + (fx - W / 2) * w, half.x, W - half.x);
  const cy = clamp(H / 2 + (fy - H / 2) * w, half.y, H - half.y);
  // The window: in at an angle, flat while it plays, filling the frame as the camera closes in.
  const inn = ease(clamp((f + lead) / (lead + 30)));
  const out = easeInOut((f - (frames - 18)) / 18);
  const frame = (0.9 + 0.08 * inn) * (1 - 0.04 * out) + (1 - (0.9 + 0.08 * inn)) * w;
  const rx = 9 * (1 - inn) - 4 * out, ry = tilt * (-13 * (1 - inn) + 6 * out);
  const rate = span / (frames / FPS);
  const start = Math.max(0, Math.round((from - (lead / frames) * span) * FPS));
  return (
    <AbsoluteFill style={{ background: C.bg, perspective: 2400 }}>
      <AbsoluteFill style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${frame})`, borderRadius: 10 * (1 - w), overflow: "hidden", border: `1px solid ${C.line2}` }}>
        <AbsoluteFill style={{ transform: `translate(${W / 2}px, ${H / 2}px) scale(${s}) translate(${-cx}px, ${-cy}px)`, transformOrigin: "0 0" }}>
          <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} startFrom={start} playbackRate={rate} muted style={{ width: W, height: H }} />
        </AbsoluteFill>
        <AbsoluteFill style={{ boxShadow: "inset 0 0 160px 40px rgba(0,0,0,.5)" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
