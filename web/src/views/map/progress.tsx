// Mapping progress, shared: one poller of /api/map/progress feeds both the
// map strip and the busy mark on the MAP nav entry, so the person sees a
// map (or embedding) pass running from any tab. Polls fast while a pass is
// active, slowly while idle, and stops if the endpoint does not exist.

import { useEffect, useState } from "react";
import { api } from "../../api";
import type { MapProgress } from "./types";

export const PHASE_LABEL: Record<string, string> = {
  idle: "idle", scc: "condensing cycles", dp: "counting paths", blocks: "forming blocks",
  families: "grouping families", embed: "embedding", install: "installing model", done: "done",
};

let last: MapProgress | null = null;
const subs = new Set<(p: MapProgress | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let gone = false;

function tick() {
  timer = undefined;
  if (gone || subs.size === 0) return;
  api.mapProgress()
    .then((p) => { last = p; subs.forEach((f) => f(p)); timer = setTimeout(tick, p.running ? 700 : 5000); })
    .catch(() => { gone = true; last = null; subs.forEach((f) => f(null)); });
}

export function useMapProgress(): MapProgress | null {
  const [p, setP] = useState<MapProgress | null>(last);
  useEffect(() => {
    subs.add(setP);
    if (!timer && !gone) tick();
    return () => { subs.delete(setP); };
  }, []);
  return p;
}

/** Ask for a fresh reading now (after starting a remap or an embed run). */
export function pokeMapProgress() {
  gone = false;
  if (timer) clearTimeout(timer);
  tick();
}

/** The strip on the map view while a pass runs: phase, counts so far, elapsed. */
export function ProgressStrip({ p }: { p: MapProgress }) {
  return (
    <div className="fm-strip" role="status" aria-live="polite" data-testid="map-progress-strip">
      <span className="fm-strip-dot" aria-hidden="true" />
      <span className="fm-strip-k">mapping in progress</span>
      <span className="fm-strip-v">{PHASE_LABEL[p.phase] ?? p.phase}</span>
      {p.blocks > 0 && <span className="fm-strip-v mono">{p.blocks} blocks · {p.chains} chains</span>}
      <span className="fm-strip-v mono">{(p.ms / 1000).toFixed(0)}s</span>
      <span className="fm-strip-bar indeterminate" aria-hidden="true"><span /></span>
      <span className="fm-strip-note">results shown so far are provisional</span>
    </div>
  );
}
