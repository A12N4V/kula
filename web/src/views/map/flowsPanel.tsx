// Value-flow canvas – the map as a flowchart of what the program achieves.
// Left to right: entry tiles (the kit's D shape) → flow tiles (name under the
// tile, outcome as the subtitle) → the sections that implement them. Nodes
// are `kind: "tile"` per docs/design/flow-canvas.md §2.1; icons come from
// views/map/icons.tsx (KindIcon / RoleMark). Selection opens the inspector's
// deep link for a section. The old `flows` key (chain-family edges) is not
// touched – this reads only the additive `value_flows` from /api/map.
//
// U7 – journeys: the value-flow list is the right column's Journeys panel
// (one row per flow: hue swatch, plain title, step count); picking one shows
// its numbered sentence steps over the map (JourneyStrip) and walks the
// camera square to square. Contract: docs/design/plain-map.md §3 – ids
// x5-journey-row / x5-journey-strip / x5-journey-step-<n> / -next / -prev.

import { useEffect, useMemo, useRef, useState } from "react";
import { FlowCanvas, type FlowEdge, type FlowNode } from "../../flow";
import { Harmonograph } from "../../harmonograph";
import { Icon } from "../../ui";
import { KindIcon, RoleMark, ROLE_COLOR } from "./icons";
import type { MapData, Role, ValueFlow } from "./types";

type Props = {
  data: MapData;
  /** Open a section in the block canvas (Map's deep link). */
  onSection?: (blockId: string) => void;
};

/** One hue per value flow (vivid, distinct from the directory hues' role):
 *  the list swatch, the ring on its squares and its wires share it. */
export const FLOW_HUES = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#cc5de8", "#22b8cf", "#ff922b", "#f06595", "#94d82d", "#845ef7"];
export const flowHue = (i: number) => FLOW_HUES[i % FLOW_HUES.length];
const entId = (n: number) => `vf:e${n}`;
const flowId = (i: number) => `vf:f${i}`;
const secId = (b: string) => `vf:b${b}`;

/** Flow tiles ranked left to right: the API's order is already the stable
 *  (name, entry) sort, so the canvas needs no second opinion. */
export function flowsToNodes(data: MapData): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const flows = data.value_flows ?? [];
  const entryNodes = new Map<number, FlowNode>();
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    const el = data.leaves[f.entry];
    if (!entryNodes.has(f.entry)) {
      const n: FlowNode = {
        id: entId(f.entry), kind: "tile", entry: true,
        title: el?.name ?? `entry ${f.entry}`, subtitle: "entry",
        icon: el ? <KindIcon kind={el.kind} /> : <RoleMark role="entry" />,
        color: ROLE_COLOR.entry,
      };
      entryNodes.set(f.entry, n);
      nodes.push(n);
    }
    nodes.push({
      id: flowId(i), kind: "tile", title: f.name, subtitle: f.outcome,
      icon: <Harmonograph seed={f.name} size={32} />, color: "var(--text-2)",
      badge: f.members.length > 1 ? `${f.members.length}` : undefined,
    });
    edges.push({ id: `vf:${f.entry}:${i}`, source: entId(f.entry), target: flowId(i), main: true, weight: 2 });
    for (const b of f.sections) {
      const blk = data.blocks[b];
      const role = (blk?.role ?? "core") as Role;
      if (!nodes.some((n) => n.id === secId(b))) {
        nodes.push({
          id: secId(b), kind: "tile", title: blk?.name ?? b, subtitle: role,
          icon: <Harmonograph seed={b} size={32} />, color: ROLE_COLOR[role], noOut: true,
        });
      }
      edges.push({ id: `vf:f${i}:${b}`, source: flowId(i), target: secId(b), main: true, weight: 1 });
    }
  }
  return { nodes, edges };
}

/** The value-flow lens: one LR flowchart, entries leftmost, no hard-coded
 *  count – an empty map shows its empty state and nothing else breaks. */
export function FlowsPanel({ data, onSection }: Props) {
  const flows = data.value_flows ?? [];
  const { nodes, edges } = useMemo(() => flowsToNodes(data), [data]);
  const [sel, setSel] = useState<string | null>(null);
  const open = (id: string) => {
    if (id.startsWith(secId(""))) onSection?.(id.slice(secId("").length));
  };
  if (!flows.length) {
    return (
      <div className="sy-root vf-empty" data-testid="map-flows-empty">
        <div className="empty">
          <p>No value flows yet – the extractor found no entry-to-side-effect chains.</p>
          <p className="muted">Rebuild the map, or check <code>KULA_FLOWS_MAX</code> and the entry detection.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="vf-canvas" style={{ height: "100%", minHeight: 320 }} data-testid="map-flows">
      <FlowCanvas
        nodes={nodes} edges={edges}
        selection={sel} onSelect={setSel}
        onOpen={open}
        ns="map-flows" testId="vf-canvas"
        minZoom={0.25}
      />
    </div>
  );
}

/** Plain words for a step: the explain payload's journey sentence for this
    flow when the user's agent has written one, else the block's plain name,
    else its theme, else its code name (plain-map.md §3.3 – never show a
    technical name while plain words exist). */
type ExplainBlocks = Record<string, { plain?: string; journeys?: string[] } | undefined>;
export function journeySentences(data: MapData, f: ValueFlow, ex: ExplainBlocks): string[] {
  return f.sections.map((b, i) => {
    const j = ex[b]?.journeys?.[i];
    if (j) return j;
    const blk = data.blocks[b];
    return blk?.theme || blk?.name || b;
  });
}

/** The Journeys panel (U7): one row per value flow in the right column –
    hue swatch, plain title, step count. Picking a flow rings its squares in
    its hue and opens the journey strip (the base's ring + wire tint stays);
    picking again clears it. Double-click fans a journey's sections into the
    inspector (the old FlowsOverlay capability, kept as a secondary action).
    A flow with no visible sections is a dead journey – its row is disabled,
    visible as dead, not broken (X6 §2.4). */
export function JourneysPanel({ data, onFlow, active, onSection }: { data: MapData; onFlow?: (i: number | null) => void; active?: number | null; onSection?: (blockId: string) => void }) {
  const flows = data.value_flows ?? [];
  if (!flows.length)
    return <p className="sy-summary u7-journeys-empty" data-testid="map-flows-empty">No journeys yet – the extractor found no entry-to-side-effect chains.</p>;
  return (
    <div className="u7-journeys" data-testid="map-flows-list">
      <span className="sy-section-label">Journeys</span>
      <ol className="u7-j-rows">
        {flows.slice(0, 24).map((f, i) => {
          const dead = f.sections.length === 0;
          return (
            <li key={i} className={`u7-j-row${active === i ? " on" : ""}`} data-testid="x5-journey-row" style={{ ["--vf-hue" as string]: flowHue(i) }}>
              <button className="u7-j-btn" data-testid={`map-flow-${i}`} title={`${f.name} – ${f.outcome}`} aria-pressed={active === i}
                disabled={dead || undefined}
                onClick={() => { if (!dead) onFlow?.(active === i ? null : i); }}
                onDoubleClick={() => { if (!dead) { onFlow?.(i); for (const b of f.sections) onSection?.(b); } }}>
                <span className="vf-swatch" aria-hidden="true" />
                <span className="u7-j-name vf-row-name">{f.name}</span>
                <span className="u7-j-meta mono">{dead ? "no steps" : `${f.sections.length} ${f.sections.length === 1 ? "step" : "steps"}`}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The numbered sentence steps over the map (plain-map.md §3): a strip docked
    to the bottom of the canvas while a journey is picked. Next/Prev (and
    ←/→, scoped to a picked journey) walk the camera square to square through
    onPickStep – the kit's reveal pan does the moving, never a second loop.
    Sentences come from /api/map/explain when the agent has written them,
    else the block's plain words. */
export function JourneyStrip({ data, flowPick, onPickStep, onClose }: {
  data: MapData;
  flowPick: number;
  /** Pan the camera to a step's square (the kit's reveal). */
  onPickStep: (blockId: string) => void;
  /** Unpick the journey. */
  onClose?: () => void;
}) {
  const flows = data.value_flows ?? [];
  const f = flows[flowPick];
  const [step, setStep] = useState(0);
  const [ex, setEx] = useState<ExplainBlocks>({});
  // The strip owns the walk; the camera rides the parent's reveal, so the
  // callback is read through a ref and never re-fires the effect above.
  const onPickStepRef = useRef(onPickStep);
  onPickStepRef.current = onPickStep;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Placement: the map root sits inside transformed/offset ancestors
  // (.view-enter), so CSS anchoring lands off-screen – measure the strip's
  // containing block and the floating inspector (graph.css) and dock the
  // strip between the viewport's left edge and the inspector. Desktop only;
  // the phone bottom sheet stays pure CSS.
  const stripRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (window.innerWidth <= 720) { setPlace(null); return; }
    const measure = () => {
      const el = stripRef.current;
      const cb = (el?.offsetParent ?? null) as HTMLElement | null;
      if (!el || !cb) return;
      const cbr = cb.getBoundingClientRect();
      const insp = document.querySelector(".map-insp") as HTMLElement | null;
      const rightVp = insp ? insp.getBoundingClientRect().left - 12 : Math.min(window.innerWidth - 16, cbr.right - 16);
      // The left rail (#rail) owns the canvas's left edge – the strip docks
      // between the rail's right edge and the inspector, never under the rail
      // (the critic's repro: Prev sat beneath it and the clicks were swallowed).
      const rail = document.querySelector("#rail") as HTMLElement | null;
      const leftVp = rail ? rail.getBoundingClientRect().right + 12 : 16;
      const width = Math.max(240, Math.min(640, rightVp - leftVp - 12));
      setPlace({ left: leftVp - cbr.left, width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    const inspEl = document.querySelector(".map-insp");
    if (inspEl) ro.observe(inspEl);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  // A new journey starts at its first square – picking walks the camera there.
  // Pans are serialized through one latest-target queue: a pick and a Next
  // click in the same frame both land on the LAST requested square (the old
  // rAF-per-call version raced itself – the pick's pan could fire after the
  // click's and walk the camera back, flaking the walk test 1 in 3).
  const panCameraToRef = useRef<(b: string, step?: number) => boolean>(() => false);
  const targetRef = useRef<{ b: string; step: number } | null>(null);
  const triesRef = useRef(0);
  const rafRef = useRef(0);
  const requestPan = (b: string, step: number) => {
    targetRef.current = { b, step };
    triesRef.current = 0;
    if (rafRef.current) return;
    const tick = () => {
      rafRef.current = 0;
      const t = targetRef.current;
      if (!t) return;
      // The square may not exist yet – reveal opens its branch asynchronously
      // (layout worker) – and reveal/selection animations (≤ 200 ms) can move
      // the camera back under a finished pan. Verify by measurement: keep
      // ticking until the square stays centred across two confirmations.
      const good = panCameraToRef.current(t.b, t.step);
      ok = good ? ok + 1 : 0;
      if (++triesRef.current < 25 && ok < 2)
        rafRef.current = window.setTimeout(tick, good ? 320 : 120);
    };
    let ok = 0;
    rafRef.current = requestAnimationFrame(tick);
  };
  const walk0 = useRef<(b: string, step: number) => void>(() => {});
  walk0.current = (b, step) => { onPickStepRef.current(b); requestPan(b, step); };
  useEffect(() => { setStep(0); const f = (data.value_flows ?? [])[flowPick]; if (f?.sections[0]) walk0.current(f.sections[0], 0); }, [flowPick]);
  // Plain words arrive from the user's own agent (U9's API, read-only here);
  // until then the strip shows the block plain names – never a blank step.
  // One GET with the page's token (the api module's own pattern), read-only.
  useEffect(() => {
    let dead = false;
    const token = document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "";
    fetch("/api/map/explain", { headers: { "x-kula-token": token } })
      .then((r) => r.json())
      .then((r) => { if (!dead && r?.blocks) setEx(r.blocks); })
      .catch(() => { /* plain names stand in */ });
    return () => { dead = true; };
  }, []);
  const sentences = useMemo(() => (f ? journeySentences(data, f, ex) : []), [data, f, ex]);
  const n = sentences.length;
  /** Pan the camera by dragging the canvas pane through React Flow's own
      handlers – the walk moves the same camera the reader pans with, no
      second rAF loop. reveal alone cannot walk: it only pans to squares
      that are NOT already visible (flow/FlowCanvas.tsx). Returns false when
      the square is not in the DOM yet (the caller retries). */
  const panCameraTo = (blockId: string, step = 0): boolean => {
    const pane = document.querySelector('[data-testid="map-flow-canvas"] .react-flow__pane') as HTMLElement | null;
    const node = document.querySelector(`[data-testid="fc-node-${blockId}"]`) as HTMLElement | null;
    const rfEl = document.querySelector('[data-testid="map-flow-canvas"] .react-flow') as HTMLElement | null;
    if (!pane || !node || !rfEl) return false;
    const nr = node.getBoundingClientRect();
    const fr = rfEl.getBoundingClientRect();
    // The square should land centred in the canvas area the reader sees
    // (clear of the floating inspector on the right). A small alternating
    // dock by step parity guarantees consecutive steps visibly move the
    // camera even when two squares would centre within a pixel (fit zoom).
    const insp = document.querySelector(".map-insp") as HTMLElement | null;
    const right = insp ? insp.getBoundingClientRect().left : fr.right;
    const left = Math.max(fr.left, 0);
    const dock = (step % 2 === 0 ? -1 : 1) * Math.min(48, (right - left) * 0.08);
    const tx = left + (right - left) / 2 + dock - nr.width / 2;
    const ty = Math.max(fr.top, 0) + (Math.min(fr.bottom, window.innerHeight) - Math.max(fr.top, 0)) / 2 - nr.height / 2;
    const dx = nr.left - tx, dy = nr.top - ty;
    // Centred within a few px? Then the camera already shows this square –
    // done (a fit reset re-centres later pans through the retry loop).
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return true;
    // A drag in pane space: down at a point that is verifiably the pane (not
    // a square – a pointerdown on a square is a select, not a pan), move by
    // -delta, up. Candidates sweep the canvas edges; the old fixed corner
    // landed on squares depending on layout and the drag was swallowed.
    const atPane = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(".react-flow__pane") != null;
    let sx = 0, sy = 0, found = false;
    for (const fy of [0.92, 0.85, 0.1, 0.5, 0.7]) {
      for (const fx of [0.95, 0.05, 0.5, 0.3, 0.7]) {
        const px = fr.left + fr.width * fx, py = fr.top + fr.height * fy;
        if (px > 0 && py > 0 && px < window.innerWidth && py < window.innerHeight && atPane(px, py)) { sx = px; sy = py; found = true; break; }
      }
      if (found) break;
    }
    if (!found) { sx = fr.right - 60; sy = Math.min(fr.bottom, window.innerHeight) - 120; }
    const ev = (type: string, cx: number, cy: number, buttons: number): PointerEvent =>
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: cx, clientY: cy });
    pane.dispatchEvent(ev("pointerdown", sx, sy, 1));
    pane.dispatchEvent(ev("pointermove", sx - dx, sy - dy, 1));
    pane.dispatchEvent(ev("pointerup", sx - dx, sy - dy, 0));
    // Verified pan: the square must sit at its target after the drag – a fit
    // reset (selection focus) can move the camera back under us.
    const nr2 = node.getBoundingClientRect();
    return Math.abs(nr2.left - tx) < 8 && Math.abs(nr2.top - ty) < 8;
  };
  panCameraToRef.current = panCameraTo;
  const go = (to: number) => {
    if (!f || !n) return;
    const next = Math.max(0, Math.min(n - 1, to));
    setStep(next);
    const b = f.sections[next];
    if (b) { onPickStepRef.current(b); requestPan(b, next); }
  };
  // ←/→ walk the camera while a journey is picked – scoped here so the rest
  // of the map's keys (n8n canvas, rail search) never see it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(step + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(step - 1); }
      // X6 §2.2 – Esc unpicks the journey, same input guard as ←/→.
      else if (e.key === "Escape") { e.preventDefault(); onCloseRef.current?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, n, f]);
  if (!f || !n) return null;
  return (
    <div ref={stripRef} className="u7-strip" style={{ ["--vf-hue" as string]: flowHue(flowPick), ...(place ? { left: place.left, width: place.width, maxWidth: "none", transform: "none" } : {}) }} data-testid="x5-journey-strip" role="region" aria-label="Journey steps">
      <button className="u7-step-btn" data-testid="x5-journey-prev" title="Previous step  ←" disabled={step === 0} aria-label="Previous step" onClick={() => go(step - 1)}><span className="u7-chev l" aria-hidden="true"><Icon.chevron /></span></button>
      <ol className="u7-steps">
        {sentences.map((s, i) => (
          <li key={i}>
            <button className={`u7-step${i === step ? " cur" : ""}${i < step ? " done" : ""}`}
              data-testid={`x5-journey-step-${i + 1}`} aria-current={i === step ? "step" : undefined}
              onClick={() => go(i)}>
              <span className="u7-step-n mono">{i + 1}</span>
              <span className="u7-step-txt">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <button className="u7-step-btn" data-testid="x5-journey-next" title="Next step  →" disabled={step === n - 1} aria-label="Next step" onClick={() => go(step + 1)}><span className="u7-chev r" aria-hidden="true"><Icon.chevron /></span></button>
      {onClose && <button className="u7-step-btn u7-strip-close" data-testid="u7-journey-close" title="Close journey" aria-label="Close journey" onClick={onClose}><Icon.close /></button>}
    </div>
  );
}


/** The compact flows list (R0): flows are overlays on the one canvas, not
    tabs. Picking a flow selects its entry block on the canvas and the flow's
    sections into the inspector's flow path (the canvas highlights what it
    crosses). Pure list, no canvas of its own.
    Kept for the flows lens (FlowsPanel kit) – the right column reads
    JourneysPanel now. */
export function FlowsOverlay({ data, onSection, onFlow, active }: { data: MapData; onSection?: (blockId: string) => void; onFlow?: (i: number | null) => void; active?: number | null }) {
  const flows = data.value_flows ?? [];
  if (!flows.length)
    return <p className="sy-summary" data-testid="map-flows-empty">No value flows yet – the extractor found no entry-to-side-effect chains.</p>;
  return (
    <div className="vf-list" data-testid="map-flows-list">
      <span className="sy-section-label">value flows</span>
      <ol className="vf-rows">
        {flows.slice(0, 24).map((f, i) => (
          <li key={i} className={`vf-row${active === i ? " on" : ""}`} style={{ ["--vf-hue" as string]: flowHue(i) }}>
            <button className="vf-row-btn" data-testid={`map-flow-${i}`} title={`${f.name} – ${f.outcome}`} aria-pressed={active === i}
              onClick={() => { onFlow?.(active === i ? null : i); for (const b of f.sections) onSection?.(b); }}>
              <span className="vf-swatch" aria-hidden="true" />
              <span className="mono vf-row-n">{i + 1}</span>
              <span className="vf-row-name">{f.name}</span>
              <span className="vf-row-meta mono">{f.sections.length} sections</span>
            </button>
            <div className="vf-row-secs">
              {f.sections.slice(0, 6).map((b) => (
                <button key={b} className="vf-sec mono" data-testid={`map-flow-sec-${i}-${b}`}
                  onClick={() => onSection?.(b)} title={data.blocks[b]?.theme || data.blocks[b]?.name || b}>
                  {data.blocks[b]?.theme || data.blocks[b]?.name || b}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
