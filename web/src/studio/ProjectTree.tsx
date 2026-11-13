// The Project tool window: every indexed file as a folder tree, changed files
// marked the way an IDE marks them, a click opens the file as an editor tab.

import { useEffect, useMemo, useState } from "react";
import { api, type FileStatus } from "../api";
import { Icon } from "../ui";

type Dir = { name: string; path: string; dirs: Map<string, Dir>; files: string[] };

function build(paths: string[]): Dir {
  const root: Dir = { name: "", path: "", dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let d = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = d.dirs.get(parts[i]);
      if (!next) { next = { name: parts[i], path, dirs: new Map(), files: [] }; d.dirs.set(parts[i], next); }
      d = next;
    }
    d.files.push(p);
  }
  return root;
}

const OPEN_KEY = "kula.studio.tree";
function readOpen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[\"src\"]")); } catch { return new Set(["src"]); }
}

export default function ProjectTree({ repo, version, active, onOpen }: { repo: string; version: number; active: string | null; onOpen: (path: string) => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [status, setStatus] = useState<FileStatus[]>([]);
  const [open, setOpen] = useState<Set<string>>(readOpen);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.graph("file").then((g) => setFiles(g.nodes.filter((n) => n.kind === "file").map((n) => n.path).sort())).catch(() => setFiles([]));
    api.status().then((s) => setStatus(s.files)).catch(() => {});
  }, [version]);
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* private window */ } }, [open]);
  // Reveal the active file: open every folder above it.
  useEffect(() => {
    if (!active) return;
    const parts = active.split("/");
    setOpen((o) => { const n = new Set(o); for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/")); return n.size === o.size ? o : n; });
  }, [active]);

  const changed = useMemo(() => new Map(status.map((f) => [f.path, f.untracked ? "new" : "mod"])), [status]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (files ?? []).filter((p) => !q || p.toLowerCase().includes(q));
  }, [files, filter]);
  const tree = useMemo(() => build(shown), [shown]);
  const dirty = (d: Dir) => [...changed.keys()].some((p) => p.startsWith(d.path + "/"));
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const rows: React.ReactNode[] = [];
  const walk = (d: Dir, depth: number) => {
    const sorted = [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const sub of sorted) {
      const isOpen = !!filter || open.has(sub.path);
      rows.push(
        <button key={`d:${sub.path}`} className={`pt-row dir ${dirty(sub) ? "mod" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(sub.path)} aria-expanded={isOpen}>
          <span className={`pt-caret ${isOpen ? "open" : ""}`}><Icon.chevron /></span><Icon.folder /><span className="pt-name">{sub.name}</span>
        </button>,
      );
      if (isOpen) walk(sub, depth + 1);
    }
    for (const f of d.files) {
      const name = f.slice(f.lastIndexOf("/") + 1);
      const st = changed.get(f);
      rows.push(
        <button key={f} className={`pt-row file ${st ?? ""} ${active === f ? "on" : ""}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onOpen(f)} title={f}>
          <Icon.file /><span className="pt-name">{name}</span>
        </button>,
      );
    }
  };
  walk(tree, 0);

  return (
    <div className="tw-body project-tree" data-testid="project-tree">
      <div className="pt-root"><Icon.project /><b>{repo}</b><span className="muted">{files ? `${files.length} files` : ""}</span></div>
      <input className="pt-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files" />
      <div className="pt-rows" role="tree">
        {files == null && <div className="tw-empty">loading…</div>}
        {files != null && !rows.length && <div className="tw-empty">{filter ? "No match" : "No files indexed"}</div>}
        {rows}
      </div>
    </div>
  );
}
