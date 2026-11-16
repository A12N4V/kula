// Left pane of the code canvas: the repo as a tree with a checkbox per row to
// hide files from the canvas, and a filter that reads globs, folders and "a|b".

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../ui";
import { filesUnder, matcher, type DirN, type FileN, type Model, type Selection } from "./model";

const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

type Props = {
  m: Model; sel: Selection; hidden: Set<string>; filter: string; links: number;
  setFilter: (q: string) => void;
  setHidden: (paths: string[], hide: boolean) => void;
  pick: (s: Selection) => void;
};

export function FileTree({ m, sel, hidden, filter, links, setFilter, setHidden, pick }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["", ...m.root.dirs.map((d) => d.path)]));
  const match = useMemo(() => matcher(filter), [filter]);
  const filtering = filter.trim() !== "";
  const total = useMemo(() => filesUnder(m.root).length, [m]);
  const selPath = sel?.type === "dir" ? `d:${sel.dir.path}` : sel?.type === "file" ? sel.file.path : sel?.type === "sym" ? sel.sym.file.path : "";

  // reveal the pick in the tree
  useEffect(() => {
    const d = sel?.type === "dir" ? sel.dir.parent : sel?.type === "file" ? sel.file.dir : sel?.type === "sym" ? sel.sym.file.dir : null;
    if (!d) return;
    setOpen((o) => {
      const n = new Set(o);
      for (let x: DirN | null = d; x; x = x.parent) n.add(x.path);
      return n.size === o.size ? o : n;
    });
  }, [sel]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector(".ct-row.on")?.scrollIntoView({ block: "nearest" }); }, [selPath]);

  const shown = (d: DirN): FileN[] => filesUnder(d).filter((f) => match(f.path));
  const rows: ReactNode[] = [];
  const walk = (d: DirN, depth: number) => {
    const fs = shown(d);
    if (filtering && !fs.length) return;
    const hid = fs.filter((f) => hidden.has(f.path)).length;
    const isOpen = filtering || open.has(d.path);
    if (d !== m.root) {
      rows.push(
        <div key={`d:${d.path}`} className={`ct-row dir${selPath === `d:${d.path}` ? " on" : ""}`} style={{ paddingLeft: 6 + depth * 12 }}>
          <button className="ct-chev" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(d.path)) n.delete(d.path); else n.add(d.path); return n; })}>
            <span className={isOpen ? "open" : ""}><Icon.chevron /></span>
          </button>
          <Check state={hid === 0 ? "on" : hid === fs.length ? "off" : "some"} onChange={(on) => setHidden(fs.map((f) => f.path), !on)} label={`Show ${d.name}`} />
          <button className="ct-name" onClick={() => pick({ type: "dir", dir: d })} title={d.path}>{d.name}/</button>
          <span className="ct-num">{fmt(d.loc)}</span>
        </div>,
      );
    }
    if (!isOpen) return;
    for (const c of d.dirs) walk(c, d === m.root ? depth : depth + 1);
    const inner = d === m.root ? depth : depth + 1;
    for (const f of d.files) {
      if (!match(f.path)) continue;
      rows.push(
        <div key={f.path} className={`ct-row${selPath === f.path ? " on" : ""}${hidden.has(f.path) ? " off" : ""}`} style={{ paddingLeft: 6 + inner * 12 + 18 }}>
          <Check state={hidden.has(f.path) ? "off" : "on"} onChange={(on) => setHidden([f.path], !on)} label={`Show ${f.name}`} />
          <button className="ct-name" onClick={() => pick({ type: "file", file: f })} title={f.path}>{f.name}</button>
          <span className="ct-num">{fmt(f.loc)}</span>
        </div>,
      );
    }
  };
  walk(m.root, 0);

  return (
    <aside className="ct-tree" aria-label="Files">
      <div className="ct-head">
        <span className="ct-repo">{m.root.name}</span>
        <span className="ct-stats">{total} files · {fmt(m.root.loc)} lines · {fmt(links)} links</span>
      </div>
      <label className="ct-filter">
        <Icon.search />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name, *.rs, src/, a|b" spellCheck={false} aria-label="Filter files" />
        {filter && <button className="ct-x" aria-label="Clear filter" onClick={() => setFilter("")}><Icon.close /></button>}
      </label>
      <div className="ct-list" ref={list} role="tree">{rows.length ? rows : <p className="ct-none">No files match</p>}</div>
      {hidden.size > 0 && <button className="ct-reset" onClick={() => setHidden([...hidden], false)}>Show {hidden.size} hidden</button>}
    </aside>
  );
}

function Check({ state, onChange, label }: { state: "on" | "off" | "some"; onChange: (on: boolean) => void; label: string }) {
  return (
    <button className={`ct-check ${state}`} role="checkbox" aria-checked={state === "some" ? "mixed" : state === "on"} aria-label={label} onClick={() => onChange(state !== "on")}>
      {state === "on" ? <Icon.check /> : state === "some" ? <i /> : null}
    </button>
  );
}
