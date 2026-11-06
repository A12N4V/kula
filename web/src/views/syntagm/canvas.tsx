// Syntagm canvas: nested blocks as boxes inside boxes (CSS grid, not sigma).
// Renders only the drilled level plus one below, so 4 000+ leaves never all
// mount. A selected chain draws an ordered SVG path across the boxes it
// crosses; selecting a leaf opens the shared CodePanel (handled by the parent).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../ui";
import type { Block, Chain, Leaf, LeafKind } from "./types";
import { KIND_GLYPH } from "./sidebar";

type Props = {
  blocks: Record<string, Block>;
  leaves: Record<number, Leaf>;
  chain: Chain | null;
  path: string[];           // drilled block ids, root first
  onDrill: (id: string) => void;
  onLeaf: (id: number) => void;
  onHome: () => void;
};

const MAX_ROWS = 40; // a sub-block never carries more leaves than this (contract)

/** The boxes to show at this drill level: the children of the drilled block. */
function level(blocks: Record<string, Block>, path: string[]) {
  const cur = path.length ? blocks[path[path.length - 1]] : null;
  // Top level shows the sections, not the root again (the breadcrumb speaks for it).
  const ids = cur ? cur.children : Object.values(blocks).filter((b) => b.depth === 0 && b.parent !== null).map((b) => b.id);
  return { cur, ids: ids.filter((id) => blocks[id]) };
}

export function BlockCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<Record<string, HTMLElement | null>>({});
  const registerKid = useCallback((id: string, el: HTMLButtonElement | null) => { box.current[id] = el; }, []);
  const [seg, setSeg] = useState<{ x1: number; y1: number; x2: number; y2: number; i: number }[]>([]);
  const { cur, ids } = level(p.blocks, p.path);
  // On phones the single column is windowed: boxes far outside the viewport
  // are not mounted at all, so their rects can never reach the readout below.
  const [phone, setPhone] = useState(() => window.innerWidth <= 720);
  const [st, setSt] = useState(0);
  const [vh, setVh] = useState(600);
  useEffect(() => {
    const onR = () => setPhone(window.innerWidth <= 720);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const on = () => { setSt(el.scrollTop); setVh(el.clientHeight); };
    on();
    el.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", on); ro.disconnect(); };
  }, []);

  // Chain path: after layout, measure the on-screen boxes the chain crosses and
  // draw ordered connector segments between consecutive visible ones. Static
  // strokes – no animation, and none needed under reduced motion.
  useLayoutEffect(() => {
    const recompute = () => {
      if (!p.chain || !wrap.current) { setSeg([]); return; }
      const w = wrap.current;
      const wr = w.getBoundingClientRect();
      const pts: { x: number; y: number }[] = [];
      for (const id of p.chain.blocks) {
        // straight from the DOM: box divs and kid buttons both carry data-block
        const el = w.querySelector(`[data-block="${id}"]`);
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        // content-visibility collapses skipped boxes to a zero rect – skip them
        if (r.width < 2 || r.height < 2) continue;
        pts.push({ x: r.left + r.width / 2 - wr.left, y: r.top + r.height / 2 - wr.top });
      }
      const s: typeof seg = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        // skip fully offscreen spans; draw the rest as straight ordered hops
        if ((a.y < 0 && b.y < 0) || (a.y > wr.height && b.y > wr.height)) continue;
        s.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, i: i - 1 });
      }
      setSeg(s);
    };
    recompute();
    // rects move on scroll too, and the first layout after a mode switch can
    // still be settling – re-measure on the next frame and on scroll.
    const raf = requestAnimationFrame(recompute);
    const ro = new ResizeObserver(recompute);
    if (wrap.current) { ro.observe(wrap.current); wrap.current.addEventListener("scroll", recompute, { passive: true }); }
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize", recompute);
      wrap.current?.removeEventListener("scroll", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.chain?.id, p.path.join(">")]);

  const chainBlocks = new Set(p.chain?.blocks ?? []);
  // Chain rail: the crossed blocks in order, consecutive repeats collapsed.
  const rail = (p.chain?.blocks ?? []).filter((id, i, a) => p.blocks[id] && a[i - 1] !== id);
  // each crossed block shows the chain steps that live in it
  const stepsIn: Record<string, number[]> = {};
  if (p.chain) for (const sid of p.chain.steps) {
    const host = Object.values(p.blocks).find((b) => b.symbols.includes(sid));
    if (host) (stepsIn[host.id] ??= []).push(sid);
  }

  return (
    <div className="sy-canvas" data-testid="syntagm-canvas">
      <div className="sy-bread" data-testid="syntagm-breadcrumb">
        <button className="crumb-link" onClick={p.onHome} aria-label="Top of the block tree">repo</button>
        {p.path.map((id, i) => {
          const b = p.blocks[id];
          return (
            <span key={id} className="sy-bread-seg">
              <span className="sy-bread-sep" aria-hidden="true"><Icon.chevron /></span>
              <button className={`crumb-link${i === p.path.length - 1 ? " on" : ""}`} onClick={() => p.onDrill(id)}>{b?.name ?? id}</button>
            </span>
          );
        })}
        {p.chain && <span className="sy-bread-chain mono" data-testid="syntagm-chain-label">{p.leaves[p.chain.entry]?.name} · {p.chain.len} steps</span>}
      </div>
      <div className="sy-canvas-scroll" ref={wrap} style={{ position: "relative" }}>
        {seg.length > 0 && (
          <svg className="sy-path" data-figure data-testid="syntagm-path" width="100%" height="100%" aria-hidden="true">
            {seg.map((s) => (
              <line key={s.i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            ))}
          </svg>
        )}
        {p.chain && (
          <div className="sy-steps" data-testid="syntagm-steps">
            {p.chain.steps.map((id, i) => {
              const l = p.leaves[id];
              return (
                <button key={i} className="sy-step mono" onClick={() => l && p.onLeaf(id)} title={l?.path}>
                  <span className="sy-step-n">{i + 1}</span>{l?.name ?? id}
                </button>
              );
            })}
          </div>
        )}
        {p.chain ? (
          // Chain mode: the boxes the chain crosses, in order, joined by the path.
          <div className="sy-rail" data-testid="syntagm-rail">
            {rail.map((id) => (
              <Box key={id} b={p.blocks[id]} blocks={p.blocks} leaves={p.leaves} chainIds={chainBlocks} stepLeaves={stepsIn[id]} onDrill={p.onDrill} onLeaf={p.onLeaf} register={(el) => { box.current[id] = el; }} registerKid={registerKid} />
            ))}
          </div>
        ) : phone ? (
          <WindowedBoxes ids={ids} blocks={p.blocks} leaves={p.leaves} chainBlocks={chainBlocks} st={st} vh={vh} onDrill={p.onDrill} onLeaf={p.onLeaf} register={(id, el) => { box.current[id] = el; }} registerKid={registerKid} />
        ) : (
          <div className="sy-grid">
            {ids.map((id) => (
              <Box key={id} b={p.blocks[id]} blocks={p.blocks} leaves={p.leaves} chainIds={chainBlocks} onDrill={p.onDrill} onLeaf={p.onLeaf} register={(el) => { box.current[id] = el; }} registerKid={registerKid} />
            ))}
          </div>
        )}
        {cur && cur.children.length === 0 && (
          <LeafList leaves={cur.symbols} map={p.leaves} onLeaf={p.onLeaf} />
        )}
        {ids.length === 0 && (!cur || cur.children.length === 0) && <div className="sy-empty">No blocks here.</div>}
      </div>
    </div>
  );
}

/** One block box. Its children (one level below) render inside, capped. */
function Box({ b, blocks, leaves, chainIds, onDrill, onLeaf, register, registerKid, preview = true, stepLeaves }: {
  b: Block; blocks: Record<string, Block>; leaves: Record<number, Leaf>; chainIds: Set<string>;
  onDrill: (id: string) => void; onLeaf: (id: number) => void;
  register: (el: HTMLDivElement | null) => void; registerKid: (id: string, el: HTMLButtonElement | null) => void;
  /** false on the phone column for boxes that straddle the fold: their lower
      rows would be clipped by the scroll, but their rects would still reach
      the readout below. The header alone is enough of a preview. */
  preview?: boolean;
  /** chain mode: this block's step leaves, shown alone (marked) so the whole
      rail stays on screen and the path can be drawn across all of it. */
  stepLeaves?: number[];
}) {
  const chainMark = chainIds.has(b.id);
  const ref = useRef<HTMLDivElement>(null);
  // layout effect: the ref must be in place before the parent's path recompute
  useLayoutEffect(() => { register(ref.current); return () => register(null); }, [register]);
  const kids = b.children.filter((c) => blocks[c]).slice(0, 12);
  return (
    <div ref={ref} className={`sy-box sy-box-${b.kind}${chainMark ? " sy-on-chain" : ""}`} data-block={b.id} data-testid={`syntagm-box-${b.id}`}>
      <div className="sy-box-head">
        <button className="sy-box-title" onClick={() => onDrill(b.id)} title={b.summary}>
          {b.children.length > 0 ? <Icon.chevron /> : null}
          <span className="sy-bname">{b.name}</span>
        </button>
        <span className="sy-box-meta">{b.files} files · {(b.cohesion * 100).toFixed(0)}%</span>
      </div>
      {preview && kids.length > 0 && (
        <div className="sy-box-kids">
          {kids.map((c) => {
            const cb = blocks[c];
            return (
              <button key={c} ref={(el) => registerKid(c, el)} className={`sy-kid${chainIds.has(c) ? " sy-on-chain" : ""}`} data-block={c} onClick={() => onDrill(c)} title={cb.summary}>
                <span className="sy-kname">{cb.name}</span>
                <span className="sy-row-meta">{cb.files}f · {(cb.cohesion * 100).toFixed(0)}%</span>
              </button>
            );
          })}
          {b.children.length > kids.length && <button className="sy-kid sy-kid-more" onClick={() => onDrill(b.id)}>+ {b.children.length - kids.length} more – zoom in</button>}
        </div>
      )}
      {preview && kids.length === 0 && b.symbols.length > 0 && stepLeaves === undefined &&
        <LeafList leaves={b.symbols.slice(0, MAX_ROWS)} map={leaves} onLeaf={onLeaf} more={Math.max(0, b.symbols.length - MAX_ROWS)} onDrill={onDrill} id={b.id} />}
      {preview && kids.length === 0 && stepLeaves !== undefined && (
        <div className="sy-leafs">
          {stepLeaves.map((lid) => {
            const l = leaves[lid];
            if (!l) return null;
            return (
              <button key={lid} className="sy-leaf-row sy-on-chain" data-leaf={lid} onClick={() => onLeaf(lid)} title={`${l.path}:${l.line}`}>
                <span className="sy-glyph">{KIND_GLYPH[l.kind as LeafKind] ?? "·"}</span>
                <span className="sy-leaf-name mono">{l.name}</span>
              </button>
            );
          })}
          {b.symbols.length > stepLeaves.length &&
            <button className="sy-leaf-row sy-more" onClick={() => onDrill(b.id)}>+ {b.symbols.length - stepLeaves.length} more – zoom in</button>}
        </div>
      )}
    </div>
  );
}

/** Leaf rows with kind glyphs. Row click opens the CodePanel via the parent. */
export function LeafList({ leaves, map, onLeaf, more = 0, onDrill, id }: {
  leaves: number[]; map: Record<number, Leaf>; onLeaf: (id: number) => void;
  more?: number; onDrill?: (id: string) => void; id?: string;
}) {
  return (
    <div className="sy-leafs">
      {leaves.map((lid) => {
        const l = map[lid];
        if (!l) return null;
        return (
          <button key={lid} className="sy-leaf-row" data-leaf={lid} onClick={() => onLeaf(lid)} title={`${l.path}:${l.line}`}>
            <span className="sy-glyph">{KIND_GLYPH[l.kind as LeafKind] ?? "·"}</span>
            <span className="sy-leaf-name mono">{l.name}</span>
            <span className="sy-row-meta">:{l.line}</span>
          </button>
        );
      })}
      {more > 0 && onDrill && id && <button className="sy-leaf-row sy-more" onClick={() => onDrill(id)}>+ {more} more – zoom in</button>}
    </div>
  );
}

/** Phone layout: one column, windowed. Box heights are deterministic
 *  (head 44 + padding 16 + kids × 46 on the phone floor), so offsets are
 *  exact without measuring. Only boxes near the viewport mount. */
function WindowedBoxes({ ids, blocks, leaves, chainBlocks, st, vh, onDrill, onLeaf, register, registerKid }: {
  ids: string[]; blocks: Record<string, Block>; leaves: Record<number, Leaf>; chainBlocks: Set<string>;
  st: number; vh: number; onDrill: (id: string) => void; onLeaf: (id: number) => void;
  register: (id: string, el: HTMLDivElement | null) => void; registerKid: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const KID = 46, HEAD = 60;
  // A box may mount with its top above the fold, but its rows only render
  // when the whole box fits: clipped rows still carry rects that would reach
  // the readout below the scroll. 100px of grace keeps the pop-in subtle.
  const fold = st + vh + 100;
  const off: number[] = [];
  let acc = 0;
  for (const id of ids) {
    off.push(acc);
    acc += HEAD + (blocks[id]?.children.length ?? 0) * KID;
  }
  const kidsOK = new Map<string, boolean>();
  const shown: string[] = [];
  ids.forEach((id, i) => {
    const h = HEAD + (blocks[id]?.children.length ?? 0) * KID;
    if (off[i] < fold && off[i] + h > st - 300) {
      shown.push(id);
      kidsOK.set(id, off[i] + h <= fold);
    }
  });
  const at = new Map(ids.map((id, i) => [id, off[i]]));
  return (
    <div style={{ position: "relative", height: acc }}>
      {shown.map((id) => (
        <div key={id} style={{ position: "absolute", top: at.get(id)!, left: 0, right: 0 }}>
          <Box b={blocks[id]} blocks={blocks} leaves={leaves} chainIds={chainBlocks} onDrill={onDrill} onLeaf={onLeaf} preview={kidsOK.get(id) ?? false} register={(el) => register(id, el)} registerKid={registerKid} />
        </div>
      ))}
    </div>
  );
}
