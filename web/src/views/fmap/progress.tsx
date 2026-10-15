// Mapping progress, shared: one poller of /api/map/progress feeds both the
// fmap strip and the busy mark on the FMAP nav entry, so the person sees a
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
    .then((p) => { last = p; subs.forEach((f) => f(p)); timer = setTimeout(tick, p.active ? 700 : 5000); })
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

/** The strip on the fmap view while a pass runs: phase, batch n/N, elapsed. */
export function ProgressStrip({ p }: { p: MapProgress }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  return (
    <div className="fm-strip" role="status" aria-live="polite" data-testid="fmap-progress-strip">
      <span className="fm-strip-dot" aria-hidden="true" />
      <span className="fm-strip-k">mapping in progress</span>
      <span className="fm-strip-v">{PHASE_LABEL[p.phase] ?? p.phase}</span>
      {p.total > 0 && <span className="fm-strip-v mono">{p.done} / {p.total}</span>}
      <span className="fm-strip-v mono">{(p.elapsed_ms / 1000).toFixed(0)}s</span>
      <span className="fm-strip-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="fm-strip-note">results shown so far are provisional</span>
    </div>
  );
}
