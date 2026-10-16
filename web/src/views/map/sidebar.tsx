// MapView sidebar: CHAINS (chain families, searchable) and BLOCKS (tree),
// one filter on top. A family expands to page its chains in from
// /api/map/chains. The flat row list is virtualised – 10^5+ families stay
// smooth because only the slice on screen (plus overscan) is in the DOM, and
// the visible slice is memoised, not re-sorted per keystroke.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../ui";
import type { Block, Chain, ChainPage, Family, Leaf, LeafKind, Role } from "./types";
import { ROLE_RULES } from "./types";

import { KindIcon, RoleMark } from "./icons";

export type SideRow =
  | { t: "header"; key: string; label: string }
  | { t: "family"; fam: Family; name: string }
  | { t: "chain"; chain: Chain; name: string; famId: string }
  | { t: "chain-load"; famId: string }
  | { t: "block"; block: Block; open: boolean }
  | { t: "leaf"; id: number; name: string; kind: LeafKind; path: string };

type Props = {
  blocks: Record<string, Block>;
  families: Family[];
  leaves: Record<number, Leaf>;
  roles: Set<Role>;
  selChain: string | null;
  selLeaf: number | null;
  openRoot: string[];
  loadChains: (family: string, cursor?: string) => Promise<ChainPage>;
  onChain: (c: Chain) => void;
  onLeaf: (id: number) => void;
  onToggle: (id: string) => void;
  onZoom: (id: string) => void;
  onClose?: () => void;
};

/** Expandable prefix: block ids the user has opened, deepest first in the tree. */
function flatten(rows: SideRow[]): (SideRow & { key: string })[] {
  return rows.map((r, i) => ({
    ...r, key: `${r.t}:${r.t === "header" ? r.key : r.t === "leaf" ? r.id : r.t === "family" ? r.fam.id : r.t === "block" ? r.block.id : "chain"}:${i}`,
  }));
}

/** 12 340 stays 12 340; 8.4e17 saturates to exponent form. */
export function fmtCount(n: number): string {
  if (n >= 1e15) return n.toExponential(1).replace("e+", "e");
  return n.toLocaleString("en-US");
}

export function MapViewSidebar(p: Props) {
  const [q, setQ] = useState("");
  // One list at a time: the block tree, every function flat, or the chain families.
  const [sect, setSect] = useState<"blocks" | "functions" | "chains">("blocks");
  const [active, setActive] = useState(-1);
  const scroll = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(760);
  // Expanded families: the family ids, in the order the user opened them.
  const [openFams, setOpenFams] = useState<string[]>([]);
  // One page per expanded family, plus the cursor for the next page.
  const [pages, setPages] = useState<Record<string, ChainPage>>({});
  const [loadingFam, setLoadingFam] = useState<string | null>(null);
  // Row height follows the hit-target floor: 28px on desktop, 40px on phones
  // (the CSS in map.css does the same under the same query).
  const [rowH, setRowH] = useState(() => (window.innerWidth <= 720 ? 40 : 28));
  useEffect(() => {
    const onR = () => setRowH(window.innerWidth <= 720 ? 40 : 28);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const load = (famId: string, cursor?: string, append = false) => {
    setLoadingFam(famId);
    p.loadChains(famId, cursor)
      .then((page) => {
        setPages((prev) => {
          const before = append && prev[famId] ? prev[famId].chains : [];
          // steps as ids must make two equal paths one chain – dedupe by id
          const seen = new Set(before.map((c) => c.id));
          return { ...prev, [famId]: { chains: [...before, ...page.chains.filter((c) => !seen.has(c.id))], cursor: page.cursor, done: page.done } };
        });
      })
      .catch(() => { /* the family stays folded-in empty */ })
      .finally(() => setLoadingFam(null));
  };

  const expand = (famId: string) => {
    setOpenFams((o) => (o.includes(famId) ? o.filter((x) => x !== famId) : [...o, famId]));
    if (!openFams.includes(famId) && !pages[famId]) load(famId);
  };

  const famName = useCallback(
    (f: Family) => `${p.leaves[f.source]?.name ?? f.source} → ${p.leaves[f.terminal]?.name ?? f.terminal}`,
    [p.leaves]);

  const allLeaves = useMemo(() => Object.entries(p.leaves).map(([k, l]) => [Number(k), l] as const).sort((a, b) => a[1].name.localeCompare(b[1].name)), [p.leaves]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (t: string) => !s || t.toLowerCase().includes(s);
    const roleOK = (id: number) => {
      const role = p.leaves[id]?.role;
      return role ? p.roles.has(role) : true;
    };
    const out: SideRow[] = [];
    // CHAINS: every family, filtered by role (both ends) and search.
    const famRows: SideRow[] = [];
    if (sect === "chains") for (const f of p.families) {
      if (!roleOK(f.source) || !roleOK(f.terminal)) continue;
      const name = famName(f);
      if (!hit(name)) continue;
      famRows.push({ t: "family", fam: f, name });
      const at = openFams.includes(f.id);
      if (at) {
        const page = pages[f.id];
        if (page) for (const c of page.chains) famRows.push({ t: "chain", chain: c, name: c.id, famId: f.id });
        if (loadingFam === f.id && !page) famRows.push({ t: "chain-load", famId: f.id });
        if (page && !page.done && page.cursor) famRows.push({ t: "chain-load", famId: f.id });
      }
    }
    // BLOCKS tree, filtered: a block shows when the role filter passes for it
    // (its own role, or any leaf inside), AND the search hits it or its
    // subtree. The two filters compose – the role check never bypasses search.
    const rolePass = (b: Block): boolean =>
      p.roles.has(b.role) || b.children.some((c) => rolePass(p.blocks[c])) || b.symbols.some((id) => roleOK(id));
    const blockHit = (b: Block): boolean =>
      rolePass(b) && (hit(b.name) || b.children.some((c) => blockHit(p.blocks[c])) || b.symbols.some((id) => roleOK(id) && hit(p.leaves[id]?.name ?? "")));
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
          if (l && roleOK(sid) && hit(l.name)) out.push({ t: "leaf", id: sid, name: l.name, kind: l.kind, path: l.path });
        }
      }
    };
    if (sect === "blocks") for (const c of p.openRoot.filter((id) => p.blocks[id]?.depth === 0)) walk(c, true);
    if (out.length > blockStart) out.splice(blockStart, 0, { t: "header", key: "h-blocks", label: "Blocks" });
    // FUNCTIONS: every symbol in the repo, flat and sorted – single-function
    // blocks included, so nothing is only reachable by drilling.
    const fnStart = out.length;
    if (sect === "functions") for (const [sid, l] of allLeaves) if (roleOK(sid) && hit(l.name)) out.push({ t: "leaf", id: sid, name: l.name, kind: l.kind, path: l.path });
    if (out.length > fnStart) out.splice(fnStart, 0, { t: "header", key: "h-fns", label: `Functions · ${out.length - fnStart}` });
    // CHAINS last: the family list can run to 10^5 rows.
    if (famRows.length) out.push({ t: "header", key: "h-chains", label: `Chains · ${p.families.length}` }, ...famRows);
    return flatten(out);
  }, [sect, allLeaves, p.blocks, p.families, p.leaves, p.roles, p.openRoot, q, openFams, pages, loadingFam, famName]);

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
    if (row.t === "family") expand(row.fam.id);
    else if (row.t === "chain") p.onChain(row.chain);
    else if (row.t === "chain-load") { const page = pages[row.famId]; if (page?.cursor) load(row.famId, page.cursor, true); }
    else if (row.t === "leaf") p.onLeaf(row.id);
    else if (row.t === "header") { /* labels are not interactive */ }
    else if (!viaKey) p.onToggle(row.block.id);
    else { // keyboard open on a block: toggle, or zoom if already open
      if (row.open) p.onZoom(row.block.id); else p.onToggle(row.block.id);
    }
  };

  return (
    <div className="sy-side" data-testid="map-sidebar">
      <div className="sy-side-head">
        <h2>Structure</h2>
        {p.onClose && <button className="btn sm ghost icon-only sy-side-close" data-testid="map-side-close" aria-label="Hide sidebar" onClick={p.onClose}><Icon.sidebar /></button>}
      </div>
      <div className="sy-filter">
        <input
          className="input sy-filter-input" placeholder="Filter chains, blocks, functions" value={q} ref={filterRef}
          onChange={(e) => { setQ(e.target.value); setActive(-1); }} onKeyDown={onKey} aria-label="Filter chains, blocks, functions" data-testid="map-filter"
        />
      </div>
      <div className="sy-lens-group fm-sects" role="tablist" aria-label="Structure list">
        {(["blocks", "functions", "chains"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={sect === k} className={`tab-btn sy-lens-btn${sect === k ? " on" : ""}`}
            data-testid={`map-sect-${k}`} onClick={() => { setSect(k); setActive(-1); scroll.current?.scrollTo({ top: 0 }); }}>
            {k} <span className="sy-row-meta">{k === "blocks" ? Object.keys(p.blocks).length : k === "functions" ? allLeaves.length : fmtCount(p.families.length)}</span>
          </button>
        ))}
      </div>
      <div className="sy-side-scroll" ref={scroll} tabIndex={0} onKeyDown={onKey} data-testid="map-side-scroll">
        <div style={{ height: visible.length * ROW, position: "relative" }}>
          <div style={{ position: "absolute", top: start * ROW, left: 0, right: 0 }}>
            {slice.map((row, i) => {
              const idx = start + i;
              const sel = row.t === "chain" && p.selChain === row.chain.id ? " on" : row.t === "leaf" && p.selLeaf === row.id ? " on" : "";
              const act = idx === active ? " act" : "";
              if (row.t === "header") {
                return <h3 key={row.key} data-row={idx} className="sy-section-label">{row.label}</h3>;
              }
              if (row.t === "family") {
                const f = row.fam;
                const open = openFams.includes(f.id);
                const src = p.leaves[f.source];
                return (
                  <div key={row.key} data-row={idx} className={`sy-row sy-family${sel}${act}`}>
                    <button className="sy-twist" aria-label={open ? `Collapse ${row.name}` : `Expand ${row.name}`}
                      aria-expanded={open} onClick={() => expand(f.id)}>
                      <Icon.chevron />
                    </button>
                    <button className="sy-block-name" title={`${row.name} – ${fmtCount(f.count)} chains, len ${f.min_len}–${f.max_len}${f.exact ? "" : " (saturated)"}`}
                      onClick={() => expand(f.id)}>
                      <span className="mono sy-fam-name">{row.name}</span>
                    </button>
                    <span className="sy-row-meta">{fmtCount(f.count)} · len {f.min_len}–{f.max_len}</span>
                    {/* the entry leaf's role, one-line rule as its title */}
                    {src && <RoleMark role={src.role} />}
                  </div>
                );
              }
              if (row.t === "chain") {
                return (
                  <button key={row.key} data-row={idx} className={`sy-row sy-chain${sel}${act}`} onClick={() => p.onChain(row.chain)}
                    title={row.chain.steps.map((s) => (typeof s === "number" ? p.leaves[s]?.name ?? s : s)).join(" → ")}>
                    <span className="sy-chain-name mono">{row.name}</span>
                    <span className="sy-row-meta">len {row.chain.len} · {row.chain.blocks.length} blocks</span>
                  </button>
                );
              }
              if (row.t === "chain-load") {
                const page = pages[row.famId];
                return (
                  <button key={row.key} data-row={idx} className={`sy-row sy-chain-load${act}`} data-testid={`map-chain-load-${row.famId}`}
                    onClick={() => { if (page?.cursor) load(row.famId, page.cursor, true); }}>
                    <span className="sy-row-meta">{page ? "+ load more chains" : "loading chains…"}</span>
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
                      <RoleMark role={row.block.role} />
                      <span className="sy-bname">{row.block.name}</span>
                    </button>
                    <span className="sy-row-meta">{leafy ? row.block.symbols.length : row.block.children.length}</span>
                  </div>
                );
              }
              return (
                <button key={row.key} data-row={idx} className={`sy-row sy-leaf${sel}${act}`} title={`${row.path}`} onClick={() => p.onLeaf(row.id)}>
                  <KindIcon kind={row.kind} />
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
