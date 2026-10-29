// Generate an agent organisation for any codebase from its map – the way the
// Workspace distils the code into sections, this distils the sections into
// divisions and staffs each one. Provider-free: every seat is a job with a
// fenced workflow; which model or plugin runs it is set per seat later.
import type { Team, Workflow } from "../../api";
import type { MapData } from "../map/types";
import { filesOf } from "../map/workspace";

export type OrgPlan = { teams: Team[]; workflows: Workflow[]; divisions: { name: string; dirs: string[]; files: number; sections: string[]; about: string }[] };

/** A seat named after its job, so keys stay unique inside a team. */
const seat = (role: string, workflow: string, up?: string, hands?: string[]) =>
  ({ name: role.replace(/\s+/g, "-"), role, workflow, agent: "any", ...(up ? { reports_to: up.replace(/\s+/g, "-") } : {}), ...(hands ? { hands_off: hands.map((h) => h.replace(/\s+/g, "-")) } : {}) });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "core";

/** The directory a file belongs to for staffing: its first two segments
 *  (src/map, web/src → web), so divisions follow how the repo is cut. */
function dirKey(path: string): string {
  const p = path.split("/");
  if (p.length <= 1) return ".";
  if (["src", "lib", "app", "packages", "crates", "apps", "services"].includes(p[0]) && p.length > 2) return `${p[0]}/${p[1]}`;
  return p[0];
}

/** The server sends blocks as a list with top sections parentless; the map
 *  view keys them and hangs the sections off one root – do the same. */
function keyed(d: MapData): MapData {
  if (!Array.isArray(d.blocks)) return d;
  const blocks: MapData["blocks"] = {};
  for (const b of d.blocks as MapData["blocks"][string][]) blocks[b.id] = b.parent === null && b.depth === 0 ? { ...b, parent: "__root" } : b;
  return { ...d, blocks };
}

export function generateOrg(raw: MapData, opts: { max?: number; prefix?: string; existing?: string[] } = {}): OrgPlan {
  const data = keyed(raw);
  const max = opts.max ?? 6;
  const taken = new Set(opts.existing ?? []);
  const name = (n: string) => { let x = n, i = 2; while (taken.has(x)) x = `${n}-${i++}`; taken.add(x); return x; };
  // section → its dominant directory; directory → sections, files
  const secs = Object.values(data.blocks).filter((b) => b.depth === 0 && b.parent !== null);
  const byDir = new Map<string, { files: Set<string>; sections: string[]; about: string[] }>();
  for (const b of secs) {
    const files = filesOf(data, b.id);
    if (!files.length) continue;
    const tally = new Map<string, number>();
    for (const f of files) tally.set(dirKey(f), (tally.get(dirKey(f)) ?? 0) + 1);
    const top = [...tally.entries()].sort((a, c) => c[1] - a[1])[0][0];
    const d = byDir.get(top) ?? { files: new Set(), sections: [], about: [] };
    files.forEach((f) => d.files.add(f));
    d.sections.push(b.id);
    d.about.push(b.theme || b.name);
    byDir.set(top, d);
  }
  const ranked = [...byDir.entries()].sort((a, b) => b[1].files.size - a[1].files.size);
  const head = ranked.slice(0, max - 1), tail = ranked.slice(max - 1);
  const divisions = head.map(([dir, d]) => ({ name: slug(dir.split("/").pop()!), dirs: [dir], files: d.files.size, sections: d.sections, about: d.about.slice(0, 2).join(", ") }));
  if (tail.length) divisions.push({
    name: "platform", dirs: tail.map(([d]) => d), files: tail.reduce((n, [, d]) => n + d.files.size, 0),
    sections: tail.flatMap(([, d]) => d.sections), about: "everything else: tooling, config, packaging",
  });

  const workflows: Workflow[] = [];
  const wf = (n: string, w: Omit<Workflow, "name">) => { const x = name(n); workflows.push({ name: x, ...w }); return x; };
  const read = wf("org-read", { about: "Reads anything, changes nothing – planning and review seats", scope: [], lock: ["**"], memory: "write" });
  const tests = wf("org-tests", { about: "Writes and runs tests only", scope: ["**/test/**", "**/tests/**", "**/*test*", "**/*spec*", "e2e/**"], memory: "write" });
  const teams: Team[] = [];
  const top = name("architecture");
  teams.push({ name: top, about: "sets direction, splits work across divisions, signs off cross-cutting changes", members: [
    seat("chief architect", read),
    seat("planner", read, "chief architect"),
  ] });
  for (const d of divisions) {
    const own = wf(`org-${d.name}`, { about: `Changes ${d.dirs.join(", ")} – ${d.about || "this division's code"}`, scope: d.dirs.map((x) => (x === "." ? "*" : `${x}/**`)), memory: "write" });
    teams.push({ name: name(d.name), under: top, about: `${d.files} files · ${d.about || d.dirs.join(", ")}`, members: [
      seat("tech lead", own),
      seat("engineer", own, "tech lead", ["test engineer"]),
      seat("test engineer", tests, "tech lead", ["reviewer"]),
      seat("reviewer", read, "tech lead"),
    ] });
  }
  teams.push({ name: name("quality"), under: top, about: "reviews every hand-off, red-teams the fences", members: [
    seat("head of quality", read),
    seat("security red team", read, "head of quality"),
    seat("release", tests, "head of quality"),
  ] });
  return { teams, workflows, divisions };
}
