// U2 – Map chrome: the Explorer (search, panels, layers, canvas verbs in
// one top-right toggle), the layer toggle (Blocks · Flows · Chains · Fences ·
// Agents · Runs), the Map · Runs · Evals icon switch and the tidy strip (explicit tidy, one-click
// undo). Contract: docs/design/fused-canvas.md §5 (layer names and defaults,
// verb list), §7 (empty states teach); fused-interactions.md §2 (states) as
// summarised in handoff-x3. All pieces live here so MapView.tsx stays a
// wiring file – it is the most-merged file in the repo.

import { PaneControls } from "../../resize";
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
/** Defaults: Blocks, Flows, Agents and Runs on – agents live on the map, beside the code they cover. */
export const DEFAULT_LAYERS: Layers = { blocks: true, flows: true, chains: false, fences: false, agents: true, runs: true };

const LAYER_ICON: Record<LayerId, () => React.ReactElement> = {
  blocks: Icon.box, flows: Icon.flows, chains: Icon.workflow, fences: Icon.fence, agents: Icon.agents, runs: Icon.play,
};

/** One compact toggle, no sub-tabs (contract §5): six icon chips in a grid.
    Turning a layer off hides its marks and never navigates. */
export function LayerBar({ layers, onToggle }: { layers: Layers; onToggle: (id: LayerId) => void }) {
  return (
    <div className="u2-layers" role="group" aria-label="Layers" data-testid="u2-layers">
      {LAYERS.map((l) => {
        const I = LAYER_ICON[l.id];
        return (
          <button key={l.id} className={`u2-layer${layers[l.id] ? " on" : ""}`} data-testid={`u2-layer-${l.id}`}
            aria-pressed={layers[l.id]} title={`${l.label} – ${l.hint}`} onClick={() => onToggle(l.id)}>
            <I /><span>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The view switch in the run bar: three icons, one picked. Map · Runs ·
    Evals re-frame the same canvas (ux §7.217) – the canvas never unmounts.
    Layers (Agents among them) live in the Explorer, so nothing here is a
    toggle posing as a tab. */
export type Frame = "map" | "runs" | "evals";
const FRAMES: { id: Frame; label: string; I: () => React.ReactElement }[] = [
  { id: "map", label: "Map", I: Icon.map },
  { id: "runs", label: "Runs", I: Icon.play },
  { id: "evals", label: "Evals", I: Icon.flask },
];
export function FrameSwitch({ frame, onFrame, counts }: {
  frame: Frame; onFrame: (f: Frame) => void;
  counts?: { runs?: string; evals?: string };
}) {
  // Arrow keys move the tab cursor and pick (a tablist's contract); the
  // roving focus follows the selection so tab order stays one stop.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const at = FRAMES.findIndex((f) => f.id === frame);
    const next = FRAMES[(at + (e.key === "ArrowRight" ? 1 : FRAMES.length - 1)) % FRAMES.length];
    onFrame(next.id);
    // React nulls synthetic currentTarget after dispatch – resolve the
    // button from the document inside the frame.
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-testid=u2-frame-${next.id}]`)?.focus();
    });
  };
  return (
    <div className="u2-frames" role="tablist" aria-label="View" data-testid="u2-frames" onKeyDown={onKey}>
      {FRAMES.map(({ id, label, I }) => {
        const n = id !== "map" ? counts?.[id] : undefined;
        return (
          <button key={id} role="tab" aria-selected={frame === id} tabIndex={frame === id ? 0 : -1}
            aria-label={n ? `${label} – ${n}` : label} title={n ? `${label} – ${n}` : label}
            className={`u2-frame${frame === id ? " on" : ""}`} data-testid={`u2-frame-${id}`} onClick={() => onFrame(id)}>
            <I />
            {n ? <b className="u2-frame-n">{n}</b> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The Explorer: one toggle in the canvas's top-right corner instead of a
    column of buttons down the right edge. It opens a compact sheet – search,
    the panels (pipeline, agents, changes, structure, roles), the layers and
    the canvas verbs (add agent, note, tidy). Click away or Esc closes it. */
export function Explorer({ open, onOpen, search, panels, layers, verbs }: {
  open: boolean; onOpen: (o: boolean) => void;
  search: React.ReactNode; panels: React.ReactNode; layers: React.ReactNode; verbs: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Closing hands focus back to the toggle whenever the close came from the
  // keyboard (e, Escape) or from within the sheet – a pointer click away on
  // the canvas never steals focus.
  const close = (e?: Event) => {
    const inside = e ? ref.current?.contains(e.target as Node) : true;
    if (inside || e instanceof KeyboardEvent) btnRef.current?.focus();
    onOpen(false);
  };
  useEffect(() => {
    // `e` toggles the Explorer – ignored while typing, with modifiers, or
    // inside another control's shortcut scope (inputs, selects, editors).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "e" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as Element | null;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (open) close(e); else onOpen(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onOpen]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!ref.current?.contains(t) && !t.closest?.("#map-role-filter")) close(e);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as Element)?.closest?.("input")) close(e); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onOpen]);
  // Arrow keys move through the sheet's controls (and wrap); Tab is left to
  // the browser so the search input keeps its natural order.
  const roam = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = ref.current?.querySelectorAll<HTMLElement>(
      ".ex-sheet button:not(:disabled), .ex-sheet input, .ex-sheet select");
    if (!items || !items.length) return;
    e.preventDefault();
    const list = Array.from(items);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = list[(at + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
    next?.focus();
  };
  return (
    <div className="ex-wrap" ref={ref} data-testid="map-hud" onKeyDown={roam}>
      <button ref={btnRef} className={`ex-btn${open ? " on" : ""}`} data-testid="map-explorer-btn" aria-expanded={open} aria-controls="map-explorer"
        title="Explorer – panels, layers, search  e" onClick={() => onOpen(!open)}>
        <Icon.explore /><span>Explore</span>
      </button>
      {open && (
        <div className="ex-sheet" id="map-explorer" data-testid="map-explorer" role="dialog" aria-label="Explorer">
          <div className="ex-search">{search}</div>
          <div className="ex-sec"><span className="ex-h">Panels</span><div className="ex-panels">{panels}</div></div>
          <div className="ex-sec"><span className="ex-h">Layers</span>{layers}</div>
          <div className="ex-sec"><span className="ex-h">Canvas</span><div className="ex-verbs" data-testid="u2-rail">{verbs}</div></div>
        </div>
      )}
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
export function EvalsBoard({ onRuns, onClose }: { onRuns: () => void; onClose: () => void }) {
  return (
    <div className="u2-evals" data-testid="u2-evals" role="region" aria-label="Evals">
      <div className="u2-evals-card" data-pane>
        <div className="u2-evals-head"><span className="sy-section-label">evals</span><PaneControls onClose={onClose} closeTitle="Close evals  esc" testId="evals" /></div>
        <h2>No eval runs yet</h2>
        <p className="ws-hint">Run a task with an eval gate and its scores land here – pass rate, cost and time per agent, per run.</p>
        <button className="btn sm" data-testid="u2-evals-open-runs" onClick={onRuns}><Icon.flows /> Open Runs</button>
      </div>
    </div>
  );
}
