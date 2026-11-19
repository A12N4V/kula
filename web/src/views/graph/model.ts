// The code canvas model: the repo as a tree of folders and files, each file
// holding its symbols by line, and every call or import as a link between them.
// Built once per graph export; layout and drawing only read it.

import type { GraphData, Node } from "../../api";

export type Sym = { id: number; name: string; kind: Node["kind"]; line: number; end: number; file: FileN };
export type FileN = { id: number; path: string; name: string; lang: string; loc: number; syms: Sym[]; dir: DirN };
export type DirN = { path: string; name: string; dirs: DirN[]; files: FileN[]; parent: DirN | null; loc: number; count: number };

/** What a link means. Calls into a class or interface read as a type use. */
export type Base = "calls" | "imports" | "types";
export type Link = { src: number; dst: number; sf: FileN; df: FileN; base: Base; sl: number; dl: number };

export type Model = {
  root: DirN;
  files: Map<number, FileN>;
  byPath: Map<string, FileN>;
  syms: Map<number, Sym>;
  dirs: Map<string, DirN>;
  links: Link[];
  /** links leaving and entering each symbol or file id */
  out: Map<number, Link[]>;
  into: Map<number, Link[]>;
};

/** The kinds a person can toggle. In and out only split once something is picked. */
export type KindId = "out" | "in" | "imports" | "importers" | "types";
export const KINDS: { id: KindId; label: string; base: Base; dir: "out" | "in" | "both"; color: string }[] = [
  { id: "out", label: "Calls out", base: "calls", dir: "out", color: "--map-orange" },
  { id: "in", label: "Calls in", base: "calls", dir: "in", color: "--map-blue" },
  { id: "imports", label: "Imports", base: "imports", dir: "out", color: "--map-green" },
  { id: "importers", label: "Imported by", base: "imports", dir: "in", color: "--map-violet" },
  { id: "types", label: "Type uses", base: "types", dir: "both", color: "--map-yellow" },
];

const TYPEY = new Set(["class", "interface"]);
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

export function build(data: GraphData, repo = "repo"): Model {
  const root: DirN = { path: "", name: repo, dirs: [], files: [], parent: null, loc: 0, count: 0 };
  const dirs = new Map<string, DirN>([["", root]]);
  const dirFor = (path: string): DirN => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf("/");
    const parent = dirFor(cut < 0 ? "" : path.slice(0, cut));
    const d: DirN = { path, name: path.slice(cut + 1), dirs: [], files: [], parent, loc: 0, count: 0 };
    parent.dirs.push(d);
    dirs.set(path, d);
    return d;
  };
  const files = new Map<number, FileN>(), byPath = new Map<string, FileN>(), syms = new Map<number, Sym>();
  for (const n of data.nodes) {
    if (n.kind !== "file") continue;
    const cut = n.path.lastIndexOf("/");
    const dir = dirFor(cut < 0 ? "" : n.path.slice(0, cut));
    const f: FileN = { id: n.id, path: n.path, name: n.path.slice(cut + 1), lang: n.lang, loc: Math.max(1, n.end_line), syms: [], dir };
    dir.files.push(f);
    files.set(n.id, f);
    byPath.set(n.path, f);
  }
  for (const n of data.nodes) {
    if (n.kind === "file" || n.kind === "package") continue;
    const f = byPath.get(n.path);
    if (!f) continue;
    const s: Sym = { id: n.id, name: n.name, kind: n.kind, line: Math.max(1, n.start_line), end: Math.max(n.start_line, n.end_line), file: f };
    f.syms.push(s);
    f.loc = Math.max(f.loc, s.end);
    syms.set(n.id, s);
  }
  for (const f of files.values()) f.syms.sort((a, b) => a.line - b.line);

  const links: Link[] = [];
  const out = new Map<number, Link[]>(), into = new Map<number, Link[]>();
  const where = (id: number): [FileN, number] | null => {
    const s = syms.get(id);
    if (s) return [s.file, s.line];
    const f = files.get(id);
    return f ? [f, 0] : null;
  };
  for (const e of data.edges) {
    if (e.kind !== "CALLS" && e.kind !== "IMPORTS") continue;
    const a = where(e.src), b = where(e.dst);
    if (!a || !b) continue;
    const base: Base = e.kind === "IMPORTS" ? "imports" : TYPEY.has(syms.get(e.dst)?.kind ?? "") ? "types" : "calls";
    const l: Link = { src: e.src, dst: e.dst, sf: a[0], df: b[0], base, sl: a[1], dl: b[1] };
    links.push(l);
    push(out, e.src, l);
    push(into, e.dst, l);
  }

  // fold chains of lone folders into one box, the way paths read: "web/src/"
  const fold = (d: DirN) => {
    while (d !== root && d.files.length === 0 && d.dirs.length === 1) {
      const only = d.dirs[0];
      d.name = `${d.name}/${only.name}`;
      d.dirs = only.dirs;
      d.files = only.files;
      for (const c of d.dirs) c.parent = d;
      for (const f of d.files) f.dir = d;
      dirs.set(only.path, d);
      d.path = only.path;
    }
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.name.localeCompare(b.name));
    d.dirs.forEach(fold);
    d.loc = d.files.reduce((t, f) => t + f.loc, 0) + d.dirs.reduce((t, c) => t + c.loc, 0);
    d.count = d.files.length + d.dirs.reduce((t, c) => t + c.count, 0);
  };
  fold(root);
  return { root, files, byPath, syms, dirs, links, out, into };
}

/** Every file under a folder, depth first. */
export function filesUnder(d: DirN, acc: FileN[] = []): FileN[] {
  acc.push(...d.files);
  for (const c of d.dirs) filesUnder(c, acc);
  return acc;
}

export const within = (f: FileN, d: DirN) => { for (let x: DirN | null = f.dir; x; x = x.parent) if (x === d) return true; return false; };

/**
 * The filter box: terms split on "|", each a glob ("*.rs"), a folder ("src/")
 * or a plain piece of the path. Empty matches everything.
 */
export function matcher(q: string): (path: string) => boolean {
  const terms = q.split("|").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return () => true;
  const tests = terms.map((t) => {
    if (/[*?]/.test(t)) {
      const re = new RegExp(`^${t.replace(/[.+^${}()[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);
      return (p: string) => re.test(p) || re.test(p.slice(p.lastIndexOf("/") + 1));
    }
    if (t.endsWith("/")) return (p: string) => p.startsWith(t) || p.includes(`/${t}`);
    return (p: string) => p.includes(t);
  });
  return (path) => { const p = path.toLowerCase(); return tests.some((f) => f(p)); };
}

export type Selection = { type: "file"; file: FileN } | { type: "sym"; sym: Sym } | { type: "dir"; dir: DirN } | null;

export const selKey = (s: Selection) => (!s ? "" : s.type === "dir" ? `d:${s.dir.path}` : s.type === "file" ? `f:${s.file.id}` : `s:${s.sym.id}`);

/**
 * Which kind a link counts as for the current pick. With nothing picked every
 * link counts in its outgoing kind; with a pick, only links that touch it count.
 */
export function kindOf(l: Link, sel: Selection): KindId | null {
  if (l.base === "types") return touches(l, sel) ? "types" : null;
  const io = touches(l, sel);
  if (!io) return null;
  const dir = io === "both" ? "out" : io;
  if (l.base === "imports") return dir === "out" ? "imports" : "importers";
  return dir;
}

function touches(l: Link, sel: Selection): "out" | "in" | "both" | null {
  if (!sel) return "both";
  if (sel.type === "sym") return l.src === sel.sym.id ? "out" : l.dst === sel.sym.id ? "in" : null;
  if (sel.type === "file") return l.sf === sel.file && l.df !== sel.file ? "out" : l.df === sel.file && l.sf !== sel.file ? "in" : null;
  const a = within(l.sf, sel.dir), b = within(l.df, sel.dir);
  return a && !b ? "out" : b && !a ? "in" : null;
}

/** Files the pick is wired to through the kinds that are on. */
export function connected(m: Model, sel: Selection, on: Set<KindId>): Set<FileN> {
  const out = new Set<FileN>();
  if (!sel) return out;
  for (const l of m.links) {
    const k = kindOf(l, sel);
    if (k && on.has(k)) { out.add(l.sf); out.add(l.df); }
  }
  if (sel.type === "dir") for (const f of filesUnder(sel.dir)) out.add(f);
  else out.add(sel.type === "file" ? sel.file : sel.sym.file);
  return out;
}
