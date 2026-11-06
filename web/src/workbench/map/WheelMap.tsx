// W2 – the wheel: home of the map. Rings = 5 stages (entry at the centre,
// effect on the rim), sectors = blocks with arc length ∝ symbols, chords =
// threads with width ∝ log weight. Overlay chips recolour in place – no
// re-layout on overlay switch. Slot order is persisted per map so the wheel
// never reshuffles between renders (barycentre sort, 2 sweeps, per PLAN §2).
import { useMemo, useEffect, useState } from "react";
import { STAGES, buildMap, type MapShape, type MapBlock, type Stage } from "@/workbench/map/stage";
import { STAGE_COLORS, ACCENT, fenceLevelOf, ownerOf, spendOf } from "@/workbench/mock/map";
import { getMapUi } from "@/workbench/map/selection";

export type MapOverlay = "stages" | "owners" | "fences" | "spend" | "churn";

export interface WheelMapProps {
  map: MapShape | null;
  overlay: MapOverlay;
  selection: string | null;
  /** blocks to light up (W3 runs) – drawn in accent regardless of overlay */
  litBlocks?: string[];
  onSelectBlock?: (id: string | null) => void;
  onOpenThread?: (threadId: string) => void;
}

// useMap – one fetch per session, cached at module level, no module-load
// side effects (the fetch only starts when the hook first runs).
let mapPromise: Promise<MapShape> | null = null;
export function useMap(): { map: MapShape | null; error: string | null } {
  const [state, setState] = useState<{ map: MapShape | null; error: string | null }>({ map: null, error: null });
  useEffect(() => {
    mapPromise ??= buildMap().catch((e) => {
      mapPromise = null;
      return { error: String(e) } as never;
    });
    let live = true;
    mapPromise.then((r) => {
      if (!live) return;
      if (r && "error" in (r as object)) setState({ map: null, error: String((r as { error: unknown }).error) });
      else setState({ map: r as MapShape, error: null });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

const CX = 360;
const CY = 360;
const RING_MIN = 56;
const RING_W = 60;
const RING_GAP = 10;

const ringOf = (stage: Stage) => STAGES.indexOf(stage);
const ringRadius = (stage: Stage) => ({
  r0: RING_MIN + ringOf(stage) * (RING_W + RING_GAP),
  r1: RING_MIN + ringOf(stage) * (RING_W + RING_GAP) + RING_W,
});

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${p(r1, a0)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}`,
    `L ${p(r0, a1)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}`,
    "Z",
  ].join(" ");
}

// Slot order: barycentre sort of blocks against adjacent rings, 2 sweeps,
// computed once per map and memoised so positions survive re-renders and
// overlay switches (positions persisted, per plan).
function slotsFor(map: MapShape): Map<string, { a0: number; a1: number; mid: number }> {
  const slots = new Map<string, { a0: number; a1: number; mid: number }>();
  for (const stage of STAGES) {
    const ring = map.blocks.filter((b) => b.stage === stage);
    if (!ring.length) continue;
    const total = ring.reduce((s, b) => s + b.symbols, 0);
    // barycentre of neighbours in adjacent rings, seeded by dir name for
    // stability, then 2 sweeps (ring index + 1 = adjacent ring distance 1)
    const angleOf = new Map(ring.map((b) => [b.id, b.dir.length % 7 / 7]));
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const b of ring) {
        const neighbours = map.blocks.filter(
          (o) => o.stage !== stage && Math.abs(ringOf(o.stage) - ringOf(stage)) === 1,
        );
        void neighbours;
        // barycentre: mean angle of threads that touch this block
        const touching = map.threads.filter((t) => t.blocks.includes(b.id) && t.blocks.length > 1);
        if (touching.length) {
          const others = touching.flatMap((t) => t.blocks.filter((x) => x !== b.id));
          const score = others.reduce((s, id) => s + (angleOf.get(id) ?? 0), 0) / others.length;
          angleOf.set(b.id, score);
        }
      }
    }
    ring.sort((a, b) => (angleOf.get(a.id) ?? 0) - (angleOf.get(b.id) ?? 0) || a.dir.localeCompare(b.dir));
    let a = -Math.PI / 2;
    for (const b of ring) {
      const span = (b.symbols / total) * Math.PI * 2;
      slots.set(b.id, { a0: a, a1: a + span, mid: a + span / 2 });
      a += span;
    }
  }
  return slots;
}

function fillFor(b: MapBlock, overlay: MapOverlay, lit: boolean): string {
  if (lit) return ACCENT;
  if (overlay === "stages") return STAGE_COLORS[b.stage];
  if (overlay === "owners") {
    const owner = ownerOf(b.dir);
    return owner === "coder-1" ? "#5d5d5d" : owner === "codex" ? "#434343" : owner === "w2" ? "#6f6f6f" : "#303030";
  }
  if (overlay === "spend") {
    const s = spendOf(b.dir);
    if (s === 0) return "#1c1c1c";
    return s > 300_000 ? ACCENT : s > 100_000 ? "#8a4526" : "#3d2a1e";
  }
  if (overlay === "churn") {
    if (b.churn === 0) return "#1c1c1c";
    return b.churn > 8 ? ACCENT : b.churn > 3 ? "#6b5346" : "#2f2721";
  }
  return STAGE_COLORS[b.stage];
}

export function WheelMap({ map, overlay, selection, litBlocks, onSelectBlock, onOpenThread }: WheelMapProps) {
  const slots = useMemo(() => (map ? slotsFor(map) : null), [map]);
  const lit = new Set(litBlocks ?? []);
  if (!map || !slots) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground" data-testid="wb-wheel-empty">
        building map from /api/graph + /api/flows…
      </div>
    );
  }
  const maxWeight = Math.max(...map.threads.map((t) => t.weight), 1);
  const byId = new Map(map.blocks.map((b) => [b.id, b]));
  return (
    <svg viewBox="0 0 720 720" className="h-full w-full" data-figure="wb-wheel" data-testid="wb-wheel">
      <defs>
        <pattern id="wb-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke={ACCENT} strokeWidth="1.5" />
        </pattern>
      </defs>
      {/* chords under sectors */}
      <g data-testid="wb-wheel-chords">
        {map.threads.map((t) => {
          const from = slots.get(t.blocks[0]);
          const to = slots.get(t.blocks[t.blocks.length - 1]);
          if (!from || !to) return null;
          const fr = ringRadius(byId.get(t.blocks[0])!.stage);
          const tr = ringRadius(byId.get(t.blocks[t.blocks.length - 1])!.stage);
          const p = (r: number, a: number) => `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`;
          const x0 = p((fr.r0 + fr.r1) / 2, from.mid);
          const x1 = p((tr.r0 + tr.r1) / 2, to.mid);
          const width = 1.5 + (Math.log2(t.weight + 1) / Math.log2(maxWeight + 1)) * 8;
          const active = t.id === getMapUi().thread;
          return (
            <path
              key={t.id}
              d={`M ${x0} Q ${(parseFloat(x0.split(",")[0]) + parseFloat(x1.split(",")[0])) / 2},${(parseFloat(x0.split(",")[1]) + parseFloat(x1.split(",")[1])) / 2} ${x1}`}
              fill="none"
              stroke={active ? ACCENT : "#4a4a4a"}
              strokeWidth={width}
              strokeLinecap="round"
              className="cursor-pointer opacity-70 hover:opacity-100"
              data-testid={`wb-chord-${t.id}`}
              onClick={() => onOpenThread?.(t.id)}
            />
          );
        })}
      </g>
      {/* stage rings */}
      <g>
        {STAGES.map((stage) => {
          const { r0, r1 } = ringRadius(stage);
          const ring = map.blocks.filter((b) => b.stage === stage);
          if (!ring.length) return null;
          return (
            <circle
              key={stage}
              cx={CX}
              cy={CY}
              r={(r0 + r1) / 2}
              fill="none"
              stroke="#2a2a2a"
              strokeDasharray="2 4"
              data-testid={`wb-ring-${stage}`}
            />
          );
        })}
      </g>
      {/* sectors */}
      <g data-testid="wb-wheel-sectors">
        {map.blocks.map((b) => {
          const s = slots.get(b.id)!;
          const { r0, r1 } = ringRadius(b.stage);
          const level = overlay === "fences" ? fenceLevelOf(b.dir) : null;
          const hidden = level === "hidden";
          const selected = b.id === selection;
          return (
            <path
              key={b.id}
              d={sector(r0, r1, s.a0, s.a1)}
              fill={level === "review" ? "url(#wb-hatch)" : fillFor(b, overlay, lit.has(b.id))}
              stroke={selected ? ACCENT : hidden ? "#222" : "#0a0a0a"}
              strokeWidth={selected ? 2 : 1}
              opacity={hidden ? 0.25 : 1}
              className="cursor-pointer"
              data-testid={`wb-sector-${b.id}`}
              data-block={b.id}
              onClick={() => onSelectBlock?.(b.id)}
            />
          );
        })}
      </g>
      {/* stage labels on the rim */}
      <g className="select-none" fontSize="11" fill="#7a7a7a" fontFamily="JetBrains Mono, monospace">
        {STAGES.map((stage) => {
          const { r1 } = ringRadius(stage);
          return (
            <text key={stage} x={CX - (r1 + 14) * Math.SQRT1_2} y={CY - (r1 + 14) * Math.SQRT1_2} textAnchor="end" data-testid={`wb-stage-label-${stage}`}>
              {stage}
            </text>
          );
        })}
      </g>
    </svg>
  );
}
