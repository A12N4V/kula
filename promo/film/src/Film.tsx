// The film, bar by bar (90 BPM: a bar is 80 frames). Every shot starts on a bar
// line of the score; the voiceover sits on top and the score ducks under it.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import cues from "../public/cues.json";
import vo from "../public/vo.json";
import { Build, Fences, Outro, Problem } from "./Scenes";
import { Shot, type Ev } from "./Shot";
import { BAR, FPS } from "./theme";

import graph from "../public/clips/graph.json";
import impact from "../public/clips/impact.json";
import contrast from "../public/clips/contrast.json";
import query from "../public/clips/query.json";
import console_ from "../public/clips/console.json";
import agents from "../public/clips/agents.json";
import workflows from "../public/clips/workflows.json";
import fences from "../public/clips/fences.json";
import hook from "../public/clips/hook.json";
import memory from "../public/clips/memory.json";
import connect from "../public/clips/connect.json";

const EV: Record<string, Ev[]> = { graph: graph.events as Ev[], impact: impact.events as Ev[], contrast: contrast.events as Ev[], query: query.events as Ev[], console: console_.events as Ev[],
  agents: agents.events as Ev[], workflows: workflows.events as Ev[], fences: fences.events as Ev[], hook: hook.events as Ev[], memory: memory.events as Ev[], connect: connect.events as Ev[] };

type Item =
  | { scene: "problem" | "build" | "fences-iso" | "outro"; bars: number }
  | { clip: string; bars: number; from: number; span: number; cap: { k: string; t: string } };

/** The edit. Bars must add up to the score's. */
export const EDL: Item[] = [
  { scene: "problem", bars: 3 },
  { scene: "build", bars: 1 },
  { clip: "graph", bars: 2, from: 3.3, span: 4.6, cap: { k: "01 · the map", t: "Every symbol. Every call." } },
  { clip: "impact", bars: 1, from: 1.4, span: 3.6, cap: { k: "02 · impact", t: "What breaks if this changes." } },
  { clip: "contrast", bars: 1, from: 3.0, span: 3.2, cap: { k: "03 · contrast", t: "What a branch does to the architecture." } },
  { clip: "query", bars: 1, from: 0.6, span: 2.9, cap: { k: "04 · rdf + sparql", t: "Ask the graph anything." } },
  { clip: "console", bars: 1, from: 0.1, span: 3.1, cap: { k: "05 · still git", t: "kula commit · kula rebase · kula impact" } },
  { scene: "fences-iso", bars: 2 },
  { clip: "agents", bars: 1, from: 0.8, span: 3.0, cap: { k: "06 · workflows", t: "How work gets done here." } },
  { clip: "workflows", bars: 1, from: 0.4, span: 2.9, cap: { k: "07 · your own", t: "explore · fix · refactor · tests · docs" } },
  { clip: "fences", bars: 1, from: 1.8, span: 3.4, cap: { k: "08 · fences", t: "Lock a function, not just a path." } },
  { clip: "hook", bars: 1, from: 0.15, span: 3.5, cap: { k: "09 · the hook", t: "Turned back – with the reason." } },
  { clip: "memory", bars: 1, from: 0.6, span: 2.9, cap: { k: "10 · memory", t: "It knows when it's stale." } },
  { clip: "connect", bars: 1, from: 0.4, span: 2.9, cap: { k: "11 · any agent", t: "Claude Code · Cursor · Codex · Gemini" } },
  { scene: "outro", bars: 3 },
];

export const BARS = EDL.reduce((n, i) => n + i.bars, 0);
if (BARS !== cues.bars) throw new Error(`the edit is ${BARS} bars; the score is ${cues.bars}`);
export const TOTAL = Math.round(cues.duration * FPS) - 60; // the last chord, then out

/** The score dips while someone is speaking. */
function duck(f: number) {
  const t = f / FPS;
  let v = 1;
  for (const l of vo.lines) {
    const a = l.start - 0.15, b = l.start + l.duration + 0.1;
    const w = t < a - 0.25 || t > b + 0.4 ? 0 : t < a ? (t - (a - 0.25)) / 0.25 : t > b ? 1 - (t - b) / 0.4 : 1;
    v = Math.min(v, 1 - 0.55 * Math.max(0, Math.min(1, w)));
  }
  return v;
}

export function Film() {
  const f = useCurrentFrame();
  let at = 0;
  const end = interpolate(f, [TOTAL - 45, TOTAL], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {EDL.map((it, k) => {
        const from = at, frames = it.bars * BAR + (k === EDL.length - 1 ? TOTAL - (at + it.bars * BAR) : 0);
        at += it.bars * BAR;
        return (
          <Sequence key={k} from={from} durationInFrames={frames}>
            {"scene" in it ? (
              it.scene === "problem" ? <Problem /> : it.scene === "build" ? <Build /> : it.scene === "fences-iso" ? <Fences /> : <Outro frames={frames} />
            ) : (
              <Shot clip={it.clip} from={it.from} span={it.span} frames={frames} events={EV[it.clip]} cap={it.cap} />
            )}
          </Sequence>
        );
      })}
      <Audio src={staticFile("score.wav")} volume={(fr) => duck(fr) * 0.45 * end} />
      {vo.lines.map((l, k) => (
        <Sequence key={`vo${k}`} from={Math.round(l.start * FPS)}>
          <Audio src={staticFile(l.file)} volume={1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
