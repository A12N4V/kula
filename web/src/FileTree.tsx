// The file tree: every file the view knows, folded into directories, with a
// filter. Shared by the Map's route menu and the Graph's Files menu – both
// open it from a dropdown in their top strip, so a cut-off route or a lost
// file is one click away.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

type Dir = { name: string; path: string; dirs: Map<string, Dir>; files: string[] };

function build(paths: string[]): Dir {
  const root: Dir = { name: "", path: "", dirs: new Map(), files: [] };
  for (const p of [...new Set(paths)].sort()) {
    const parts = p.split("/");
    let d = root;
    for (const seg of parts.slice(0, -1)) {
      const at = d.path ? `${d.path}/${seg}` : seg;
      if (!d.dirs.has(seg)) d.dirs.set(seg, { name: seg, path: at, dirs: new Map(), files: [] });
      d = d.dirs.get(seg)!;
    }
    d.files.push(p);
  }
  return root;
}

function DirRows({ d, depth, open, toggle, onPick, active }: {
  d: Dir; depth: number; open: Set<string>; toggle: (p: string) => void; onPick: (p: string) => void; active?: string | null;
}) {
  return (<>
    {[...d.dirs.values()].map((c) => (
      <div key={c.path}>
        <button className="ft-row ft-dir" style={{ paddingLeft: 8 + depth * 14 }} aria-expanded={open.has(c.path)} onClick={() => toggle(c.path)} data-testid={`ft-dir-${c.path}`}>
          <span className={`ft-caret${open.has(c.path) ? " on" : ""}`}><Icon.chevron /></span>{c.name}
        </button>
        {open.has(c.path) && <DirRows d={c} depth={depth + 1} open={open} toggle={toggle} onPick={onPick} active={active} />}
      </div>
    ))}
    {d.files.map((f) => (
      <button key={f} className={`ft-row ft-file${active === f ? " on" : ""}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onPick(f)} title={f} data-testid={`ft-file-${f}`}>
        <Icon.doc />{f.slice(f.lastIndexOf("/") + 1)}
      </button>
    ))}
  </>);
}

export function FileTree({ paths, onPick, active }: { paths: string[]; onPick: (path: string) => void; active?: string | null }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const shown = useMemo(() => (q ? paths.filter((p) => p.toLowerCase().includes(q.toLowerCase())) : paths), [paths, q]);
  const tree = useMemo(() => build(shown), [shown]);
  // a filter unfolds every directory that still holds a hit
  const openAll = useMemo(() => {
    if (!q) return open;
    const s = new Set<string>();
    for (const p of shown) { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("/")); }
    return s;
  }, [q, shown, open]);
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return (
    <div className="ft" data-testid="file-tree">
      <input className="ft-q" placeholder={`Filter ${paths.length} files`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="file-tree-q" aria-label="Filter files" />
      <div className="ft-list" role="tree">
        <DirRows d={tree} depth={0} open={openAll} toggle={toggle} onPick={onPick} active={active} />
        {!shown.length && <div className="ft-empty">No file matches</div>}
      </div>
    </div>
  );
}

/** A dropdown anchored in a top strip: the trigger, then a sheet below it.
 *  The sheet renders on <body>, placed under the trigger, so a scrolling
 *  strip (the Graph's phone bar) can never clip it. Escape or a click away
 *  closes it. */
export function StripMenu({ label, title, children, testId, className = "" }: {
  label: ReactNode; title?: string; children: (close: () => void) => ReactNode; testId: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 428)) });
    };
    place();
    window.addEventListener("resize", place);
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !sheet.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className={`strip-menu ${className}`} ref={ref}>
      <button className={`strip-menu-btn${open ? " on" : ""}`} aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {label}<span className="strip-caret"><Icon.chevron /></span>
      </button>
      {open && createPortal(<div className="strip-sheet" ref={sheet} style={at} data-testid={`${testId}-sheet`}>{children(() => setOpen(false))}</div>, document.body)}
    </div>
  );
}
