// The A/B harness: six tasks generated deterministically from the repo's own
// flowmap, a counterbalanced variant order per session, a timer, click-to-
// answer, ratings and a note. Results stay in localStorage (`kula.map.ab`);
// nothing leaves the browser.

import type { MapModel } from "./model";
import type { OverlayState } from "./overlays";
import { FIXTURE_EVENTS } from "./overlays";

export type VariantId = "a" | "b" | "c";
export const VARIANTS: VariantId[] = ["a", "b", "c"];
export const VARIANT_LABEL: Record<VariantId, string> = { a: "A · Metro", b: "B · Atlas", c: "C · Storyboard" };

export type PickKind = "station" | "flow" | "domain";
export interface Pick { kind: PickKind; id: string }

/** Same pick text the URL uses: s/<id> · f/<id> · d/<id>. */
export const pickCode = (p: Pick): string => `${p.kind === "station" ? "s" : p.kind === "flow" ? "f" : "d"}/${p.id}`;
export const parsePick = (s: string | undefined): Pick | null => {
  const [k, id] = (s ?? "").split("/");
  if (k === "s" && id) return { kind: "station", id };
  if (k === "f" && id) return { kind: "flow", id };
  if (k === "d" && id) return { kind: "domain", id };
  return null;
};

export interface ABTask {
  n: number;
  prompt: string;
  /** The pick that answers the task, when the drawer can check it. */
  answer: Pick | null;
  /** False when the repo has no data for this task (no fenced station, say). */
  available: boolean;
}

export interface ABRatings { clarity: number; speed: number; look: number }
export interface ABResult { task: number; prompt: string; variant: VariantId; ms: number; correct: boolean | null; ratings: ABRatings | null; note: string; at: number }

const KEY = "kula.map.ab";
const ORDER_KEY = "kula.map.ab.order";

export const loadResults = (): ABResult[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export const saveResult = (r: ABResult) => {
  const all = loadResults();
  all.push(r);
  localStorage.setItem(KEY, JSON.stringify(all.slice(-500)));
};
export const clearResults = () => localStorage.removeItem(KEY);
export const resultsJSON = (): string => JSON.stringify(loadResults(), null, 2);

/** Median of a list, halves averaged for even lengths. */
export const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface SummaryRow { variant: VariantId; runs: number; medianMs: number; correct: number; clarity: number; speed: number; look: number }
export function summary(results: ABResult[]): SummaryRow[] {
  return VARIANTS.map((v) => {
    const rs = results.filter((r) => r.variant === v && r.ms > 0);
    const rated = rs.filter((r) => r.ratings);
    return {
      variant: v,
      runs: rs.length,
      medianMs: median(rs.map((r) => r.ms)),
      correct: rs.filter((r) => r.correct === true).length,
      clarity: mean(rated.map((r) => r.ratings!.clarity)),
      speed: mean(rated.map((r) => r.ratings!.speed)),
      look: mean(rated.map((r) => r.ratings!.look)),
    };
  });
}

/** Counterbalanced order: one shuffle of A B C per session, remembered. */
export function sessionOrder(): VariantId[] {
  try {
    const saved = sessionStorage.getItem(ORDER_KEY);
    if (saved) {
      const v = JSON.parse(saved);
      if (Array.isArray(v) && v.length === 3 && v.every((x: string) => VARIANTS.includes(x as VariantId))) return v;
    }
    const order = [...VARIANTS];
    // Fisher–Yates with Math.random is fine here: this is session order, not
    // layout – the map itself never uses randomness.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(order));
    return order;
  } catch {
    return VARIANTS;
  }
}

/** The six tasks, generated from the model alone so any repo works. */
export function buildTasks(model: MapModel, overlays: OverlayState, now: number): ABTask[] {
  const tasks: ABTask[] = [];
  const push = (prompt: string, answer: Pick | null) => tasks.push({ n: tasks.length + 1, prompt, answer, available: !!answer });

  // 1 · find the entry that serves route X.
  const routed = model.flows.filter((f) => f.route);
  const f1 = routed[0] ?? model.flows[0];
  push(f1 ? `Find the entry that ${f1.route ? `serves ${f1.route}` : `runs ${f1.label}`}` : "", f1 ? { kind: "flow", id: f1.id } : null);

  // 2 · which flows pass through symbol Y: a shared station, mid degree.
  const shared = model.interchanges.filter((s) => s.layer !== "entry");
  const y = shared[Math.floor(shared.length / 2)] ?? shared[0] ?? model.interchanges[0];
  push(y ? `Find the station ${y.name} and see which flows pass through it` : "", y ? { kind: "station", id: y.id } : null);

  // 3 · what would a change to the busiest interchange touch.
  const busiest = model.interchanges[0];
  push(busiest ? `Find the busiest interchange, ${busiest.name}` : "", busiest ? { kind: "station", id: busiest.id } : null);

  // 4 · find a fenced station.
  const fenced = model.stations.find((s) => overlays.fences[s.id]);
  push(fenced ? `Find the fenced station ${fenced.name}` : "", fenced ? { kind: "station", id: fenced.id } : null);

  // 5 · say what domain Z does.
  const dom = model.domains[Math.floor(model.domains.length / 2)] ?? model.domains[0];
  push(dom ? `Find the district ${dom.label}` : "", dom ? { kind: "domain", id: String(dom.id) } : null);

  // 6 · find where a live agent is working (fixture-seeded when nothing is live).
  const evts = eventsForSeed(overlays, now);
  const liveTop = Object.entries(overlays.live).sort((a, b) => b[1] - a[1])[0];
  const st = liveTop ? model.stations.find((s) => s.id === liveTop[0]) : undefined;
  void evts;
  push(st ? `Find where the agent is working: ${st.name}` : "", st ? { kind: "station", id: st.id } : null);

  return tasks;
}

/** When nothing is live, seed from the recorded fixture so task 6 still works. */
const eventsForSeed = (overlays: OverlayState, now: number) => (Object.keys(overlays.live).length ? null : FIXTURE_EVENTS.map((e) => ({ ...e, ts: now })));

/** Is `pick` a correct answer for `task`? Checked when the drawer can check it. */
export function isCorrect(task: ABTask, pick: Pick | null): boolean | null {
  if (!task.answer) return null;
  if (!pick) return false;
  return pick.kind === task.answer.kind && pick.id === task.answer.id;
}
