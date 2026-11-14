// Territories (P3.16): the repository's regions as the canvas draws them, and
// the small rules the scope brush, the pins and the pockets share.

import type { AgentsInfo, GuardLevel, Memory, Team, Territory } from "../../api";

type Member = Team["members"][number];

/** The file a memory target sits on, or null for `repo` and bare symbols. */
export function pathOf(target: string): string | null {
  if (target.startsWith("file:")) return target.slice(5);
  if (target.startsWith("symbol:")) {
    const rest = target.slice(7);
    const i = rest.lastIndexOf(":");
    const p = i > 0 ? rest.slice(0, i) : rest;
    return /[./]/.test(p) ? p : null;
  }
  return null;
}

/** The deepest area that holds a path. */
export function areaOf(areas: Territory[], path: string): string | null {
  let best: string | null = null;
  for (const a of areas) {
    const hit = a.path === "." || path === a.path || path.startsWith(a.path + "/");
    if (hit && (best === null || best === "." || a.path.length > best.length)) best = a.path;
  }
  return best;
}

const bare = (e: string) => e.replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\/$/, "");

/** How a scope covers an area: all of it, part of it, or none. An empty scope is the whole repository. */
export function coverage(scope: string[], area: string): "all" | "part" | "none" {
  if (!scope.length) return "all";
  let part = false;
  for (const raw of scope) {
    const e = bare(raw);
    if (e === "" || e === "." || e === "**" || e === area || area.startsWith(e + "/")) return "all";
    if (area === "." ? !e.includes("/") : e.startsWith(area + "/")) part = true;
  }
  return part ? "part" : "none";
}

/** The scope a seat works under: its own, else its workflow's. */
export function seatScope(info: AgentsInfo, m: Member): string[] {
  if (m.scope?.length) return m.scope;
  return info.workflows.find((w) => w.name === m.workflow)?.scope ?? [];
}

/** The fence an area shows for a workflow, falling back to the repository's own. */
export function levelFor(t: Territory, workflow?: string): { level: GuardLevel; mixed: boolean } {
  return (workflow && t.workflows[workflow]) || t.base;
}

/** Why the brush may not paint an area for this seat, or null when it may. */
export function refusal(t: Territory, m: Member): string | null {
  if (t.path === ".") return "root files are painted with the repository";
  const { level } = levelFor(t, m.workflow);
  if (level === "locked") return `${t.path} is locked`;
  if (level === "hidden") return `${t.path} is hidden`;
  if (level === "scope") return `${t.path} is outside the ${m.workflow} workflow`;
  return null;
}

/** Fresh and stale memories anchored in each area; `repo` and unplaced ones go to the shelf. */
export function pins(areas: Territory[], memories: Memory[]) {
  const by = new Map<string, { fresh: number; stale: number }>();
  const shelf = { fresh: 0, stale: 0 };
  for (const m of memories) {
    const p = pathOf(m.target);
    const a = p ? areaOf(areas, p) : null;
    const slot = a ? (by.get(a) ?? by.set(a, { fresh: 0, stale: 0 }).get(a)!) : shelf;
    if (m.stale) slot.stale++; else slot.fresh++;
  }
  return { by, shelf };
}

/** The memories a seat carries: repository wide ones and those anchored inside its scope it may read. */
export function pocket(info: AgentsInfo, areas: Territory[], m: Member): Memory[] {
  const scope = seatScope(info, m);
  return info.memories.filter((x) => {
    const p = pathOf(x.target);
    if (!p) return true;
    const a = areaOf(areas, p);
    const t = a ? areas.find((y) => y.path === a) : undefined;
    if (t && levelFor(t, m.workflow).level === "hidden") return false;
    if (!scope.length) return true;
    return scope.some((raw) => { const e = bare(raw); return p === e || p.startsWith(e + "/"); });
  });
}
