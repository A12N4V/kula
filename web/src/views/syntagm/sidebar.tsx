// Syntagm sidebar: CHAINS (searchable) and BLOCKS (tree), one filter on top.
// The flat row list is virtualised – 4 000+ leaves stay smooth because only
// the slice on screen (plus overscan) is in the DOM.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../ui";
import type { Block, Chain, LeafKind, Leaf } from "./types";

/** Kind glyphs, same language as colors.ts – fn / class / var / type. */
export const KIND_GLYPH: Record<LeafKind, string> = { fn: "ƒ", class: "C", var: "·", type: "▭" };
const GLYPH_COLOR: Record<LeafKind, string> = { fn: "var(--accent)", class: "var(--blue)", var: "var(--green)", type: "var(--violet)" };

export type SideRow =
  | { t: "header"; key: string; label: string }
  | { t: "chain"; chain: Chain; name: string }
  | { t: "block"; block: Block; open: boolean }
  | { t: "leaf"; id: number; name: string; kind: LeafKind; path: string };

type Props = {
  blocks: Record<string, Block>;
  chains: Chain[];
  leaves: Record<number, Leaf>;
  selChain: string | null;
  selLeaf: number | null;
  openRoot: string[];
  onChain: (c: Chain) => void;
  onLeaf: (id: number) => void;
  onToggle: (id: string) => void;
  onZoom: (id: string) => void;
  onClose?: () => void;
};

/** Expandable prefix: block ids the user has opened, deepest first in the tree. */
function flatten(rows: SideRow[]): (SideRow & { key: string })[] {
  return rows.map((r, i) => ({ ...r, key: `${r.t}:${r.t === "header" ? r.key : r.t === "leaf" ? r.id : r.t === "block" ? r.block.id : r.chain.id}:${i}` }));
}

export function SyntagmSidebar(p: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const scroll = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(760);
  // Row height follows the hit-target floor: 28px on desktop, 40px on phones
  // (the CSS in syntagm.css does the same under the same query).
  const [rowH, setRowH] = useState(() => (window.innerWidth <= 720 ? 40 : 28));
  useEffect(() => {
    const onR = () => setRowH(window.innerWidth <= 720 ? 40 : 28);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (t: string) => !s || t.toLowerCase().includes(s);
    const out: SideRow[] = [];
    // CHAINS
    const chainRows: SideRow[] = [];
    p.chains.forEach((c) => {
      const entry = p.leaves[c.entry];
      const name = entry?.name ?? c.id;
      if (hit(name)) chainRows.push({ t: "chain", chain: c, name });
    });
    if (chainRows.length) out.push({ t: "header", key: "h-chains", label: "Chains" }, ...chainRows);
    // BLOCKS tree, filtered: a block shows when it or any descendant/leaf matches.
    const blockHit = (b: Block): boolean =>
      hit(b.name) || b.children.some((c) => blockHit(p.blocks[c])) || b.symbols.some((id) => hit(p.leaves[id]?.name ?? ""));
    const blockStart = out.length;
    const walk = (id: string, open: boolean) => {
      const b = p.blocks[id];
      if (!b) return;
      if (!blockHit(b)) return;
      out.push({ t: "block", block: b, open });
      if (open) {
        if (b.children.length) b.children.forEach((c) => walk(c, p.openRoot.includes(c)));
        else for (const sid of b.symbols) {
          const l = p.leaves[sid];
          if (l && hit(l.name)) out.push({ t: "leaf", id: sid, name: l.name, kind: l.kind, path: l.path });
        }
      }
    };
    for (const c of p.openRoot.filter((id) => p.blocks[id]?.depth === 0)) walk(c, true);
    if (out.length > blockStart) out.splice(blockStart, 0, { t: "header", key: "h-blocks", label: "Blocks" });
    return flatten(out);
  }, [p.blocks, p.chains, p.leaves, p.openRoot, q]);

  // Windowing: only rows near the viewport exist in the DOM.
  const ROW = rowH, OVER = 8;
  const start = Math.max(0, Math.floor(top / ROW) - OVER);
  const end = Math.min(visible.length, Math.ceil((top + vh) / ROW) + OVER);
  const slice = visible.slice(start, end);

  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const onScroll = () => { setTop(el.scrollTop); setVh(el.clientHeight); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, []);

  // Keyboard: ↑ ↓ move the active row (headers are skipped), ↵ opens it,
  // / focuses the filter.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "/") {
      e.preventDefault();
      filterRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        let next = a < 0 ? (step > 0 ? 0 : visible.length - 1) : a + step;
        while (next >= 0 && next < visible.length && visible[next].t === "header") next += step;
        next = Math.min(visible.length - 1, Math.max(0, next));
        scroll.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
        return next;
      });
    } else if (e.key === "Enter" && active >= 0) {
      const row = visible[active];
      if (row) activate(row, true);
    }
  };

  const activate = (row: SideRow & { key: string }, viaKey = false) => {
    if (row.t === "chain") p.onChain(row.chain);
    else if (row.t === "leaf") p.onLeaf(row.id);
    else if (row.t === "header") { /* labels are not interactive */ }
    else if (!viaKey) p.onToggle(row.block.id);
    else { // keyboard open on a block: toggle, or zoom if already open
      if (row.open) p.onZoom(row.block.id); else p.onToggle(row.block.id);
    }
  };

  return (
    <div className="sy-side" data-testid="syntagm-sidebar">
      <div className="sy-side-head">
        <h2>Syntagm</h2>
        {p.onClose && <button className="btn sm ghost icon-only sy-side-close" data-testid="syntagm-side-close" aria-label="Hide sidebar" onClick={p.onClose}><Icon.sidebar /></button>}
      </div>
      <div className="sy-filter">
        <input
          className="input sy-filter-input" placeholder="Filter chains and blocks" value={q} ref={filterRef}
          onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} aria-label="Filter chains and blocks" data-testid="syntagm-filter"
        />
      </div>
      <div className="sy-side-scroll" ref={scroll} tabIndex={0} onKeyDown={onKey} data-testid="syntagm-side-scroll">
        <div style={{ height: visible.length * ROW, position: "relative" }}>
          <div style={{ position: "absolute", top: start * ROW, left: 0, right: 0 }}>
            {slice.map((row, i) => {
              const idx = start + i;
              const sel = row.t === "chain" && p.selChain === row.chain.id ? " on" : row.t === "leaf" && p.selLeaf === row.id ? " on" : "";
              const act = idx === active ? " act" : "";
              if (row.t === "header") {
                return <h3 key={row.key} data-row={idx} className="sy-section-label">{row.label}</h3>;
              }
              if (row.t === "chain") {
                const crossed = row.chain.blocks.length;
                return (
                  <button key={row.key} data-row={idx} className={`sy-row sy-chain${sel}${act}`} onClick={() => p.onChain(row.chain)}
                    title={row.chain.steps.map((s) => p.leaves[s]?.name ?? s).join(" → ")}>
                    <span className="sy-chain-name mono">{row.name}</span>
                    <span className="sy-row-meta">len {row.chain.len} · {crossed} blocks</span>
                  </button>
                );
              }
              if (row.t === "block") {
                const leafy = row.block.children.length === 0;
                return (
                  <div key={row.key} data-row={idx} className={`sy-row sy-block sy-d${row.block.depth}${sel}${act}`}>
                    <button className="sy-twist" aria-label={row.open ? `Collapse ${row.block.name}` : `Expand ${row.block.name}`}
                      aria-expanded={row.open} onClick={() => p.onToggle(row.block.id)}>
                      <Icon.chevron />
                    </button>
                    <button className="sy-block-name" title={`${row.block.name} – ${row.block.summary}`} onClick={() => p.onZoom(row.block.id)}>
                      <span className={`sy-kind sy-k-${row.block.kind}`}>{row.block.kind}</span>
                      <span className="sy-bname">{row.block.name}</span>
                    </button>
                    <span className="sy-row-meta">{leafy ? row.block.symbols.length : row.block.children.length}</span>
                  </div>
                );
              }
              return (
                <button key={row.key} data-row={idx} className={`sy-row sy-leaf${sel}${act}`} title={`${row.path}`} onClick={() => p.onLeaf(row.id)}>
                  <span className="sy-glyph" style={{ color: GLYPH_COLOR[row.kind] }}>{KIND_GLYPH[row.kind]}</span>
                  <span className="sy-leaf-name mono">{row.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        {visible.length === 0 && <div className="sy-empty">Nothing matches “{q}”</div>}
      </div>
    </div>
  );
}
