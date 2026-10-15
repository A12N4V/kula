// fmap flow – the default view: the whole codebase as a left-to-right
// functional flow. Sections are laid out in layers – entry points on the
// left, then whatever execution reaches next, out to terminals and adapters
// on the right – with utilities, models and config in a band underneath.
// Arrows carry chain flow between sections (M1's `flows`, or summed from the
// chain families when the payload has none); a thick arrow is where most
// execution goes. A one-line headline says what the codebase executes.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, Leaf, MapData, Role } from "./types";
import { KindIcon, RoleMark } from "./icons";

const BAND_ROLES: Role[] = ["utility", "model", "config"];
const ROLE_LAYER: Partial<Record<Role, number>> = { entry: 0, orchestrator: 1, core: 2, adapter: 3 };
const TOP_FNS = 4;
const MAX_ARROWS = 48;

type Flow = { from: string; to: string; weight: number };
type Props = {
  data: MapData & { flows?: Flow[] };
  roles: Set<Role>;
  onDrill: (id: string) => void;
  onLeaf: (id: number) => void;
};

const title = (b: Block) => b.theme || b.name;

/** Every symbol under a block, depth-first. */
function symbolsUnder(blocks: Record<string, Block>, id: string, out: number[] = []): number[] {
  const b = blocks[id];
  if (!b) return out;
  out.push(...b.symbols);
  for (const c of b.children) symbolsUnder(blocks, c, out);
  return out;
}

export function FlowView({ data, roles, onDrill, onLeaf }: Props) {
  const { sections, layers, labels, band, flows, headline } = useMemo(() => layout(data), [data]);
  const wrap = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<{ d: string; w: number; key: string; hot: boolean }[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const shown = (b: Block) => roles.has(b.role);

  // Arrows are measured from the laid-out boxes, after layout and on resize.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const wr = el.getBoundingClientRect();
      const box = (id: string) => el.querySelector<HTMLElement>(`[data-flow-box="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const max = flows.reduce((m, f) => Math.max(m, f.weight), 0) || 1;
      const out: typeof arrows = [];
      for (const f of flows.slice(0, MAX_ARROWS)) {
        const a = box(f.from), b = box(f.to);
        if (!a || !b) continue;
        const forward = b.left >= a.right - 4;
        const x1 = (forward ? a.right : a.left + a.width / 2) - wr.left + el.scrollLeft;
        const y1 = (forward ? a.top + a.height / 2 : a.bottom) - wr.top + el.scrollTop;
        const x2 = (forward ? b.left : b.left + b.width / 2) - wr.left + el.scrollLeft;
        const y2 = (forward ? b.top + b.height / 2 : b.top) - wr.top + el.scrollTop;
        const d = forward
          ? `M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}`
          : `M${x1},${y1} C${x1},${y1 + 40} ${x2},${y2 - 40} ${x2},${y2}`;
        out.push({ d, w: 1 + 5 * Math.sqrt(f.weight / max), key: `${f.from}>${f.to}`, hot: hover === f.from || hover === f.to });
      }
      setArrows(out);
      setDim({ w: el.scrollWidth, h: el.scrollHeight });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [flows, layers, band, hover]);

  const card = (b: Block) => {
    const syms = symbolsUnder(data.blocks, b.id);
    // Lead with the functions that start or steer execution, then the rest.
    const rank = (id: number) => { const r = data.leaves[id]?.role; return r === "entry" ? 0 : r === "orchestrator" ? 1 : r === "core" ? 2 : 3; };
    const top = [...syms].filter((id) => data.leaves[id]).sort((x, y) => rank(x) - rank(y)).slice(0, TOP_FNS);
    return (
      <div key={b.id} className={`fm-flow-box fm-role-${b.role}${hover === b.id ? " hot" : ""}`} data-flow-box={b.id} data-testid={`fmap-flow-${b.id}`}
        onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)}>
        <button className="fm-flow-title" onClick={() => onDrill(b.id)} title={b.summary}>
          <RoleMark role={b.role} />
          <span className="fm-flow-name">{title(b)}</span>
          <span className="sy-row-meta">{syms.length}</span>
        </button>
        {b.theme && <span className="fm-flow-sub mono">{b.name}</span>}
        <div className="fm-flow-fns">
          {top.map((id) => <FnRow key={id} id={id} l={data.leaves[id]} onLeaf={onLeaf} />)}
          {syms.length > top.length && <button className="fm-flow-more" onClick={() => onDrill(b.id)}>+ {syms.length - top.length} more</button>}
        </div>
      </div>
    );
  };

  return (
    <div className="sy-canvas fm-flow" data-testid="fmap-flow">
      <div className="fm-headline" data-testid="fmap-headline">
        <span className="fm-headline-k">executes</span>
        <span className="fm-headline-v">{headline || "–"}</span>
      </div>
      <div className="sy-canvas-scroll fm-flow-scroll" ref={wrap}>
        <svg className="fm-arrows" data-figure aria-hidden="true" data-testid="fmap-arrows" width={dim.w} height={dim.h}>
          <defs>
            <marker id="fm-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fm-arrow-head" />
            </marker>
          </defs>
          {arrows.map((a) => <path key={a.key} d={a.d} strokeWidth={a.w} className={`fm-arrow${a.hot ? " hot" : ""}`} markerEnd="url(#fm-head)" />)}
        </svg>
        <div className="fm-layers">
          {layers.map((ids, i) => {
            const bs = ids.map((id) => sections[id]).filter(shown);
            if (!bs.length) return null;
            return (
              <div key={i} className="fm-layer" data-testid={`fmap-layer-${i}`}>
                <h3 className="sy-section-label">{labels[i]}</h3>
                {bs.map(card)}
              </div>
            );
          })}
        </div>
        {band.some((id) => shown(sections[id])) && (
          <div className="fm-band" data-testid="fmap-band">
            <h3 className="sy-section-label">utilities · models · config</h3>
            <div className="fm-band-row">{band.map((id) => sections[id]).filter(shown).map(card)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function FnRow({ id, l, onLeaf }: { id: number; l: Leaf; onLeaf: (id: number) => void }) {
  return (
    <button className="fm-fn" onClick={() => onLeaf(id)} title={`${l.path}:${l.line}`}>
      <KindIcon kind={l.kind} />
      <span className="mono fm-fn-name">{l.name}</span>
    </button>
  );
}

/** Sections, their layers, the utility band, section-level flows and the headline. */
export function layout(data: MapData & { flows?: Flow[] }) {
  const sections: Record<string, Block> = {};
  for (const b of Object.values(data.blocks)) if (b.depth === 0 && b.parent !== null) sections[b.id] = b;
  // Any block → its section.
  const secOf = new Map<string, string>();
  const up = (id: string): string | undefined => {
    if (secOf.has(id)) return secOf.get(id);
    const b = data.blocks[id];
    if (!b) return undefined;
    const s = sections[id] ? id : b.parent ? up(b.parent) : undefined;
    if (s) secOf.set(id, s);
    return s;
  };

  // Section-to-section flow: M1's block flows when present, else each chain
  // family's crossed blocks, consecutive pairs, weighted by its chain count
  // (log-scaled so one exploding family cannot drown the rest).
  const w = new Map<string, number>();
  const add = (a?: string, b?: string, v = 1) => {
    if (!a || !b || a === b) return;
    const k = `${a}\u0000${b}`;
    w.set(k, (w.get(k) ?? 0) + v);
  };
  if (data.flows?.length) for (const f of data.flows) add(up(f.from), up(f.to), f.weight);
  else for (const fam of data.families) {
    const secs = fam.blocks.map(up).filter((s, i, a) => s && a[i - 1] !== s) as string[];
    const v = Math.log1p(fam.count);
    for (let i = 1; i < secs.length; i++) add(secs[i - 1], secs[i], v);
  }
  const flows = [...w.entries()].map(([k, weight]) => { const [from, to] = k.split("\u0000"); return { from, to, weight }; })
    .sort((a, b) => b.weight - a.weight);

  // Layers: the function sections, by distance from the entry sections along
  // the flow; anything the flow never reaches falls back to its role's column.
  const fnIds = Object.values(sections).filter((b) => !BAND_ROLES.includes(b.role) && b.role !== "test" && b.role !== "glue").map((b) => b.id);
  const isFn = new Set(fnIds);
  const out = new Map<string, string[]>();
  for (const f of flows) if (isFn.has(f.from) && isFn.has(f.to)) (out.get(f.from) ?? out.set(f.from, []).get(f.from)!).push(f.to);
  const depth = new Map<string, number>();
  const queue = fnIds.filter((id) => sections[id].role === "entry");
  if (!queue.length) {
    // no classified entries: start from sections nothing flows into
    const into = new Set(flows.map((f) => f.to));
    queue.push(...fnIds.filter((id) => !into.has(id)));
  }
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const d = depth.get(queue[i])!;
    for (const n of out.get(queue[i]) ?? []) if (!depth.has(n)) { depth.set(n, d + 1); queue.push(n); }
  }
  // Unreached sections take their role's column, after the reached ones.
  const reached = depth.size ? Math.max(...depth.values()) + 1 : 0;
  for (const id of fnIds) if (!depth.has(id)) depth.set(id, (depth.size && reached ? reached : 0) + (ROLE_LAYER[sections[id].role] ?? 2));
  const nLayers = Math.max(...depth.values(), 0) + 1;
  const layers: string[][] = Array.from({ length: nLayers }, () => []);
  // Within a layer, the heaviest sections (most flow through them) lead.
  const through = (id: string) => flows.reduce((s, f) => s + (f.from === id || f.to === id ? f.weight : 0), 0);
  for (const id of fnIds) layers[depth.get(id)!].push(id);
  for (const l of layers) l.sort((a, b) => through(b) - through(a));
  const band = Object.values(sections).filter((b) => BAND_ROLES.includes(b.role)).map((b) => b.id).sort((a, b) => through(b) - through(a));

  // Headline: the heaviest section of each layer, left to right.
  const headline = layers.filter((l) => l.length).map((l) => title(sections[l[0]])).join(" → ");
  const kept = layers.filter((l) => l.length);
  // Name each column by what is in it: entry points, then steps, then where execution ends.
  const labels = kept.map((l, i) =>
    l.some((id) => sections[id].role === "entry") ? "entry"
      : i === kept.length - 1 && kept.length > 1 ? "terminal"
      : l.every((id) => sections[id].role === "adapter") ? "outside world"
      : `step ${i}`);
  return { sections, layers: kept, labels, band, flows, headline };
}
