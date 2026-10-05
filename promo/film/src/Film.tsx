// The film, bar by bar (90 BPM: a bar is 80 frames). Every shot is cut on a bar
// line of the score, but none of them cuts hard: each one starts LEAD frames
// early and dissolves in over the last moments of the one before, pushing in
// as it comes. The voices sit on top and the score ducks under them.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from "remotion";
import cues from "../public/cues.json";
import vo from "../public/vo.json";
import { ClaudeCode, Connected, CursorApp, Install } from "./Agents";
import { Lead, useF } from "./Kit";
import { Build, Fences, Outro, Problem } from "./Scenes";
import { Shot, type Ev } from "./Shot";
import { BAR, FPS, clamp, easeInOut } from "./theme";

import graph from "../public/clips/graph.json";
import impact from "../public/clips/impact.json";
import contrast from "../public/clips/contrast.json";
import query from "../public/clips/query.json";
import console_ from "../public/clips/console.json";
import accept from "../public/clips/accept.json";
import research from "../public/clips/research.json";
import teams from "../public/clips/teams.json";

const EV: Record<string, Ev[]> = {
  graph: graph.events as Ev[], impact: impact.events as Ev[], contrast: contrast.events as Ev[], query: query.events as Ev[], console: console_.events as Ev[],
  accept: accept.events as Ev[], research: research.events as Ev[], teams: teams.events as Ev[],
};

type Scene = "problem" | "install" | "build" | "fences-iso" | "connected" | "claude" | "cursor" | "verify" | "outro";
type Item = { scene: Scene; bars: number } | { clip: string; bars: number; from: number; span: number; zoom?: number; at?: [number, number] };

/** The edit. Bars must add up to the score's (promo/score.py --layout=launch). */
export const EDL: Item[] = [
  // intro – the problem
  { scene: "problem", bars: 4 },
  // build – install, init, the mark
  { scene: "install", bars: 2 },
  { scene: "build", bars: 1 },
  // drop A – the map
  { clip: "graph", bars: 3, from: 3.3, span: 7.0 },
  { clip: "impact", bars: 2, from: 1.2, span: 5.4 },
  { clip: "contrast", bars: 2, from: 0.5, span: 5.6 },
  { clip: "query", bars: 2, from: 0.3, span: 4.0 },
  { clip: "console", bars: 1, from: 0.3, span: 4.2 },
  // break – the agents come in
  { scene: "fences-iso", bars: 2 },
  { scene: "connected", bars: 2 },
  // drop B – the session: Claude Code tries the shortcut and proposes instead, a person accepts,
  // Cursor tries three ways round the fences and ships, Claude Code checks; then a research loop and the team
  { scene: "claude", bars: 5 },
  { clip: "accept", bars: 2, from: 0.5, span: 5.3 },
  { scene: "cursor", bars: 7 },
  { scene: "verify", bars: 1 },
  { clip: "research", bars: 3, from: 0.4, span: 8.2, zoom: 1.45, at: [990, 420] },
  { clip: "teams", bars: 2, from: 0.6, span: 6.0, zoom: 1.4, at: [990, 450] },
  // outro
  { scene: "outro", bars: 4 },
];

export const BARS = EDL.reduce((n, i) => n + i.bars, 0);
if (BARS !== cues.bars) throw new Error(`the edit is ${BARS} bars; the score is ${cues.bars}`);
export const TOTAL = Math.round(cues.duration * FPS) - 60; // the last chord, then out

/** How early each shot starts, to dissolve over the one before. */
const LEAD = 14;

/** The score dips while someone is speaking. */
function duck(f: number) {
  const t = f / FPS;
  let v = 1;
  for (const l of vo.lines) {
    const a = l.start - 0.15, b = l.start + l.duration + 0.1;
    const w = t < a - 0.25 || t > b + 0.4 ? 0 : t < a ? (t - (a - 0.25)) / 0.25 : t > b ? 1 - (t - b) / 0.4 : 1;
    v = Math.min(v, 1 - 0.6 * Math.max(0, Math.min(1, w)));
  }
  return v;
}

/** In over the shot before: fade up while pushing in from a little too close; out by easing back. */
function Dissolve({ first, frames, children }: { first: boolean; frames: number; children: React.ReactNode }) {
  const f = useF();
  const a = first ? 1 : easeInOut(clamp((f + LEAD) / LEAD));
  const out = easeInOut(clamp((f - (frames - LEAD)) / LEAD));
  return <AbsoluteFill style={{ opacity: a, transform: `scale(${(1 + 0.05 * (1 - a)) * (1 - 0.035 * out)})` }}>{children}</AbsoluteFill>;
}

function render(it: Item, frames: number, k: number) {
  if ("clip" in it) return <Shot clip={it.clip} from={it.from} span={it.span} frames={frames} events={EV[it.clip]} lead={LEAD} tilt={k % 2 ? 1 : -1} zoom={it.zoom} at={it.at} />;
  switch (it.scene) {
    case "problem": return <Problem />;
    case "install": return <Install />;
    case "build": return <Build />;
    case "fences-iso": return <Fences />;
    case "connected": return <Connected frames={frames} />;
    case "claude": return <ClaudeCode part={1} frames={frames} />;
    case "cursor": return <CursorApp frames={frames} />;
    case "verify": return <ClaudeCode part={2} frames={frames} />;
    case "outro": return <Outro frames={frames} />;
  }
}

export function Film() {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {EDL.map((it, k) => {
        const from = at, last = k === EDL.length - 1;
        const frames = it.bars * BAR + (last ? TOTAL - (at + it.bars * BAR) : 0);
        at += it.bars * BAR;
        const lead = k === 0 ? 0 : LEAD;
        return (
          <Sequence key={k} from={from - lead} durationInFrames={frames + lead}>
            <Lead.Provider value={lead}>
              <Dissolve first={k === 0} frames={last ? 9999 : frames}>{render(it, frames, k)}</Dissolve>
            </Lead.Provider>
          </Sequence>
        );
      })}
      <Audio src={staticFile("score.wav")} volume={(fr) => duck(fr) * 0.42 * interpolate(fr, [TOTAL - 45, TOTAL], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      {vo.lines.map((l, k) => (
        <Sequence key={`vo${k}`} from={Math.round(l.start * FPS)}>
          <Audio src={staticFile(l.file)} volume={1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
