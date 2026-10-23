// U2 – Map chrome: the right rail (add, search, note, panel), the layer
// toggle (Blocks · Flows · Chains · Fences · Agents · Runs), the centred
// Map · Runs · Evals switch and the tidy strip (explicit tidy, one-click
// undo). Contract: docs/design/fused-canvas.md §5 (layer names and defaults,
// verb list), §7 (empty states teach); fused-interactions.md §2 (states) as
// summarised in handoff-x3. All pieces live here so MapView.tsx stays a
// wiring file – it is the most-merged file in the repo.

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../ui";

export type LayerId = "blocks" | "flows" | "chains" | "fences" | "agents" | "runs";
export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: "blocks", label: "Blocks", hint: "block cards and sections" },
  { id: "flows", label: "Flows", hint: "data-flow edges between blocks" },
  { id: "chains", label: "Chains", hint: "chain focus – dim everything a chain does not cross" },
  { id: "fences", label: "Fences", hint: "fence rings, hulls and marks" },
  { id: "agents", label: "Agents", hint: "the actor band and agent marks" },
  { id: "runs", label: "Runs", hint: "last-run dots and run state" },
];
export type Layers = Record<LayerId, boolean>;
/** Contract §5 defaults: Blocks + Agents + Runs on; the rest off until picked. */
export const DEFAULT_LAYERS: Layers = { blocks: true, flows: true, chains: false, fences: false, agents: false, runs: true };

/** One compact toggle, no sub-tabs (contract §5): six square chips in a row.
    Turning a layer off hides its marks and never navigates. */
export function LayerBar({ layers, onToggle }: { layers: Layers; onToggle: (id: LayerId) => void }) {
  return (
    <div className="u2-layers" role="group" aria-label="Layers" data-testid="u2-layers">
      {LAYERS.map((l) => (
        <button key={l.id} className={`u2-layer${layers[l.id] ? " on" : ""}`} data-testid={`u2-layer-${l.id}`}
          aria-pressed={layers[l.id]} title={`${l.label} – ${l.hint}`} onClick={() => onToggle(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Centred segmented switch (ux §7.217): the segments re-frame the same data –
    Runs brings the pipeline and transport forward, Evals shows the (empty)
    eval board. They are not new views, so the canvas never unmounts. */
export type Frame = "map" | "runs" | "evals";
/** The bottom summary (U5): Map · Runs · Evals · Agents in the run bar,
    each with its live count, so the top of the map carries no chrome. */
export function FrameSwitch({ frame, onFrame, counts, agentsOn, onAgents }: {
  frame: Frame; onFrame: (f: Frame) => void;
  counts?: { runs?: string; evals?: string; agents?: string };
  agentsOn?: boolean; onAgents?: () => void;
}) {
  return (
    <div className="u2-frames" role="tablist" aria-label="Map · Runs · Evals · Agents" data-testid="u2-frames">
      {(["map", "runs", "evals"] as const).map((f) => (
        <button key={f} role="tab" aria-selected={frame === f} className={`u2-frame${frame === f ? " on" : ""}`}
          data-testid={`u2-frame-${f}`} onClick={() => onFrame(f)}>
          {f === "map" ? "Map" : f === "runs" ? "Runs" : "Evals"}
          {f !== "map" && counts?.[f] ? <b className="u2-frame-n">{counts[f]}</b> : null}
        </button>
      ))}
      {onAgents && (
        <button className={`u2-frame${agentsOn ? " on" : ""}`} data-testid="u2-frame-agents" aria-pressed={!!agentsOn} onClick={onAgents}>
          Agents{counts?.agents ? <b className="u2-frame-n">{counts.agents}</b> : null}
        </button>
      )}
    </div>
  );
}

/** The right rail (contract §8.6): the first click of the add flow (rail +
    opens the R1 add form), search, note, panel. n8n keeps canvas chrome in
    one edge column – the HUD owns the top-right corner, the rail the middle
    of the edge, so `map-roles-btn` stays reachable with the inspector open. */
export function MapRail({ onAdd, onSearch, onNote, onPanel, search }: {
  onAdd: () => void; onSearch: () => void; onNote: () => void; onPanel: () => void;
  search: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div className="u2-rail" ref={ref} data-testid="u2-rail">
      {search}
      <button className="u2-rail-btn" data-testid="u2-rail-add" title="Add agent  n" aria-label="Add agent" onClick={onAdd}><Icon.plus /></button>
      <button className={`u2-rail-btn${search ? " on" : ""}`} data-testid="u2-rail-search" title="Search  /" aria-label="Search"
        onClick={() => { setOpen(false); onSearch(); }}><Icon.search /></button>
      <button className="u2-rail-btn" data-testid="u2-rail-note" title="Add sticky note  ⇧S" aria-label="Add sticky note" onClick={onNote}><Icon.doc /></button>
      <button className="u2-rail-btn" data-testid="u2-rail-panel" title="Pipeline panel" aria-label="Pipeline panel" onClick={onPanel}><Icon.flows /></button>
    </div>
  );
}

/** Tidy is explicit and undoable (PLAN P4.6): one confirmation-free click,
    one undo. The strip rides above the canvas zoom bar (fit · in · out ·
    minimap live there); the undo chip appears only while a tidy can be
    undone. */
export function TidyStrip({ onTidy, canUndo, onUndo }: { onTidy: () => void; canUndo: boolean; onUndo: () => void }) {
  return (
    <div className="u2-tidy" data-testid="u2-tidy-strip">
      <button className="u2-tidy-btn" data-testid="u2-tidy" title="Tidy – re-run the layout (T)" onClick={onTidy}><Icon.sweep /> Tidy</button>
      {canUndo && <button className="u2-tidy-btn u2-tidy-undo" data-testid="u2-tidy-undo" title="Undo tidy  ⌘Z" onClick={onUndo}><Icon.rerun /> Undo tidy</button>}
    </div>
  );
}

/** The Evals frame: no eval backend yet, so the frame teaches (contract §7) –
    what will land here, and the nearest real surface today. */
export function EvalsBoard({ onRuns }: { onRuns: () => void }) {
  return (
    <div className="u2-evals" data-testid="u2-evals" role="region" aria-label="Evals">
      <div className="u2-evals-card">
        <span className="sy-section-label">evals</span>
        <h2>No eval runs yet</h2>
        <p className="ws-hint">Run a task with an eval gate and its scores land here – pass rate, cost and time per agent, per run.</p>
        <button className="btn sm" data-testid="u2-evals-open-runs" onClick={onRuns}><Icon.flows /> Open Runs</button>
      </div>
    </div>
  );
}
