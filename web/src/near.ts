// Where the user has just been: files and symbols opened in the code panel or
// focused in the graph. Note and memory composers autofill from it, so writing
// about the code you are looking at takes no typing.

export type Place = { path: string; name?: string; kind?: string; id?: number };

const MAX = 8;
let places: Place[] = [];
const subs = new Set<() => void>();

export function visit(p: Place) {
  if (!p.path) return;
  places = [p, ...places.filter((x) => !(x.path === p.path && x.name === p.name))].slice(0, MAX);
  subs.forEach((f) => f());
}

export const recent = () => places;

export function subscribe(f: () => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** The target string a note or memory uses for a place. */
export const targetOf = (p: { path: string; name?: string; kind?: string }) =>
  !p.name || p.kind === "file" ? `file:${p.path}` : `symbol:${p.path}:${p.name}`;
