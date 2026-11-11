// The node canvas every destination draws on: nodes on a dotted grid, smooth
// bezier wires between them, pan (drag the ground or scroll), zoom (pinch or
// ctrl/⌘ + scroll), a minimap, and fit. Clean-room: written from how a node
// editor behaves, not from any editor's source.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../ui";

export type Tone = "accent" | "ok" | "warn" | "bad" | "muted" | "info";
export type CNode = {
  id: string; x: number; y: number; w: number; h: number;
  title: ReactNode; sub?: ReactNode; icon?: ReactNode; badge?: ReactNode; body?: ReactNode;
  tone?: Tone; kind?: string; frame?: boolean; live?: boolean; label?: string;
};
export type CEdge = { id: string; from: string; to: string; label?: string; tone?: Tone; dashed?: boolean };
type View = { x: number; y: number; k: number };

const MIN_K = 0.2, MAX_K = 2;

export function wire(a: CNode, b: CNode) {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
  // a backward wire loops out and around instead of folding through its nodes
  const dx = x2 >= x1 ? Math.max(40, (x2 - x1) / 2) : Math.max(80, (x1 - x2) / 2 + 60);
  return { d: `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

export function bounds(nodes: CNode[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export default function Canvas({ nodes, edges, selected, onSelect, onOpen, onMove, onDrop, highlight, fitKey, toolbar, empty, label = "Canvas", testid }: {
  nodes: CNode[]; edges: CEdge[]; selected?: string | null; onSelect?: (id: string | null) => void; onOpen?: (id: string) => void;
  onMove?: (id: string, x: number, y: number, done: boolean) => void;
  onDrop?: (data: string, at: { x: number; y: number }, over: string | null) => void;
  highlight?: Set<string>; fitKey?: string | number; toolbar?: ReactNode; empty?: ReactNode; label?: string; testid?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const [mini, setMini] = useState(() => { try { return localStorage.getItem("kula.canvas.minimap") !== "0"; } catch { return true; } });
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const fit = useCallback((pad = matchMedia?.("(max-width: 760px)").matches ? 16 : 40) => {
    const el = host.current; if (!el) return;
    const b = bounds(nodes);
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const k = Math.max(MIN_K, Math.min(1, (W - pad * 2) / b.w, (H - pad * 2) / b.h));
    setView({ k, x: (W - b.w * k) / 2 - b.x * k, y: (H - b.h * k) / 2 - b.y * k });
  }, [nodes]);
  // refit when the content identity changes (a new flow, a new team), not on every drag
  const fitted = useRef<string | number | undefined>(undefined);
  useLayoutEffect(() => {
    const key = fitKey ?? nodes.length;
    if (fitted.current === key || !nodes.length) return;
    fitted.current = key; fit();
  }, [fitKey, nodes.length, fit]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (fitted.current !== undefined) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [fit]);

  // Selection from elsewhere (the bottom pane): bring the node into view.
  useEffect(() => {
    const n = selected ? byId.get(selected) : null, el = host.current;
    if (!n || !el) return;
    const v = viewRef.current, W = el.clientWidth, H = el.clientHeight;
    const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
    if (sx >= 0 && sy >= 0 && sx + n.w * v.k <= W && sy + n.h * v.k <= H) return;
    setView({ ...v, x: W / 2 - (n.x + n.w / 2) * v.k, y: H / 2 - (n.y + n.h / 2) * v.k });
  }, [selected, byId]);

  const zoomAt = (k: number, cx: number, cy: number) => {
    const v = viewRef.current, nk = Math.max(MIN_K, Math.min(MAX_K, k));
    setView({ k: nk, x: cx - ((cx - v.x) / v.k) * nk, y: cy - ((cy - v.y) / v.k) * nk });
  };
  useEffect(() => {
    const el = host.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(viewRef.current.k * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pointers: one drags the ground (pan) or a node (move); two pinch.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; k: number } | null>(null);
  const down = (e: React.PointerEvent, id?: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea, a, .kc-body-live")) return;
    e.stopPropagation();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { host.current?.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: viewRef.current.k }; drag.current = null; return;
    }
    const n = id ? byId.get(id) : null;
    drag.current = n && onMove
      ? { kind: "node", id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false }
      : { kind: "pan", id, sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]; const r = host.current!.getBoundingClientRect();
      zoomAt(pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return;
    }
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else onMove?.(d.id!, Math.round((d.ox + dx / viewRef.current.k) / 8) * 8, Math.round((d.oy + dy / viewRef.current.k) / 8) * 8, false);
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === "node" && d.moved) { const n = byId.get(d.id!); if (n) onMove?.(d.id!, n.x, n.y, true); return; }
    if (!d.moved) onSelect?.(d.id ?? null);
  };

  const toWorld = (cx: number, cy: number) => { const r = host.current!.getBoundingClientRect(), v = viewRef.current; return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }; };
  const frameAt = (p: { x: number; y: number }) => nodes.find((n) => n.frame && p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h)?.id ?? null;

  const lit = (id: string) => selected === id || highlight?.has(id);
  const sorted = useMemo(() => [...nodes].sort((a, b) => Number(!a.frame) - Number(!b.frame)), [nodes]);
  const b = bounds(nodes);

  return (
    <div className="kc" data-testid={testid ?? "canvas"} aria-label={label} role="application"
      ref={host} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop ? (e) => { e.preventDefault(); const data = e.dataTransfer.getData("text/kula"); if (data) { const p = toWorld(e.clientX, e.clientY); onDrop(data, p, frameAt(p)); } } : undefined}
      style={{ backgroundSize: `${20 * view.k}px ${20 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
      <div className="kc-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg data-figure className="kc-wires" style={{ left: b.x - 400, top: b.y - 400, width: b.w + 800, height: b.h + 800 }} viewBox={`${b.x - 400} ${b.y - 400} ${b.w + 800} ${b.h + 800}`} aria-hidden="true">
          <defs><marker id="kc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="context-stroke" /></marker></defs>
          {edges.map((e) => {
            const a = byId.get(e.from), c = byId.get(e.to); if (!a || !c) return null;
            const w = wire(a, c); const on = lit(e.from) || lit(e.to);
            return (
              <g key={e.id} className={`kc-wire ${e.tone ?? ""} ${on ? "on" : ""} ${e.dashed ? "dashed" : ""}`} data-edge={e.id}>
                <path d={w.d} markerEnd="url(#kc-arrow)" />
                {e.label && <text x={w.mx} y={w.my - 6} textAnchor="middle">{e.label}</text>}
              </g>
            );
          })}
        </svg>
        {sorted.map((n) => (
          <div key={n.id} data-node={n.id} data-kind={n.kind} role="button" tabIndex={0} aria-label={n.label ?? (typeof n.title === "string" ? n.title : n.id)} aria-pressed={selected === n.id}
            className={`kc-node ${n.frame ? "frame" : ""} ${n.tone ?? ""} ${selected === n.id ? "sel" : ""} ${highlight?.has(n.id) ? "hl" : ""} ${n.live ? "live" : ""} ${onMove ? "movable" : ""}`}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
            onPointerDown={(e) => down(e, n.id)}
            onDoubleClick={onOpen ? (e) => { e.stopPropagation(); onOpen(n.id); } : undefined}
            onKeyDown={(e) => { if (e.key === "Enter" && onOpen && selected === n.id) { e.preventDefault(); onOpen(n.id); } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(n.id); } }}>
            <div className="kc-head">
              {n.icon && <span className="kc-ico">{n.icon}</span>}
              <span className="kc-title">{n.title}</span>
              {n.badge && <span className="kc-badge">{n.badge}</span>}
            </div>
            {n.sub && <div className="kc-sub">{n.sub}</div>}
            {n.body && <div className="kc-body">{n.body}</div>}
            {!n.frame && <><i className="kc-port in" /><i className="kc-port out" /></>}
          </div>
        ))}
      </div>
      {!nodes.length && empty && <div className="kc-empty">{empty}</div>}
      <div className="kc-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className="kc-tool" aria-label="Zoom in" data-tip="Zoom in" data-tip-place="top" onClick={() => { const el = host.current!; zoomAt(view.k * 1.2, el.clientWidth / 2, el.clientHeight / 2); }}><Icon.plus /></button>
        <button className="kc-tool" aria-label="Zoom out" data-tip="Zoom out" data-tip-place="top" onClick={() => { const el = host.current!; zoomAt(view.k / 1.2, el.clientWidth / 2, el.clientHeight / 2); }}><Icon.minus /></button>
        <button className="kc-tool" aria-label="Fit to view" data-tip="Fit" data-tip-place="top" onClick={() => fit()}><Icon.fit /></button>
        <button className={`kc-tool ${mini ? "on" : ""}`} aria-label="Minimap" aria-pressed={mini} data-tip="Minimap" data-tip-place="top" onClick={() => setMini((m) => { try { localStorage.setItem("kula.canvas.minimap", m ? "0" : "1"); } catch { /* ignore */ } return !m; })}><Icon.minimap /></button>
        {toolbar}
      </div>
      {mini && nodes.length > 0 && <Minimap nodes={nodes} view={view} host={host} selected={selected} onCenter={(x, y) => { const el = host.current!; setView((v) => ({ ...v, x: el.clientWidth / 2 - x * v.k, y: el.clientHeight / 2 - y * v.k })); }} />}
    </div>
  );
}

function Minimap({ nodes, view, host, selected, onCenter }: { nodes: CNode[]; view: View; host: React.RefObject<HTMLDivElement | null>; selected?: string | null; onCenter: (x: number, y: number) => void }) {
  const b = bounds(nodes), pad = 60;
  const W = host.current?.clientWidth ?? 0, H = host.current?.clientHeight ?? 0;
  const vx = -view.x / view.k, vy = -view.y / view.k, vw = W / view.k, vh = H / view.k;
  const x0 = Math.min(b.x - pad, vx), y0 = Math.min(b.y - pad, vy), x1 = Math.max(b.x + b.w + pad, vx + vw), y1 = Math.max(b.y + b.h + pad, vy + vh);
  const box = `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect(), s = Math.max((x1 - x0) / r.width, (y1 - y0) / r.height);
    const ox = (r.width - (x1 - x0) / s) / 2, oy = (r.height - (y1 - y0) / s) / 2;
    onCenter(x0 + (e.clientX - r.left - ox) * s, y0 + (e.clientY - r.top - oy) * s);
  };
  return (
    <svg data-figure className="kc-mini" viewBox={box} preserveAspectRatio="xMidYMid meet" onPointerDown={pick} aria-label="Minimap" data-testid="minimap">
      {nodes.map((n) => <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} className={`${n.frame ? "frame" : ""} ${selected === n.id ? "sel" : ""}`} />)}
      <rect className="vp" x={vx} y={vy} width={vw} height={vh} />
    </svg>
  );
}

/** Columns by depth from the roots (entries first), rows in input order. */
export function layered(ids: string[], links: [string, string][], size: (id: string) => { w: number; h: number }, gap = { x: 80, y: 24 }) {
  const preds = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const [a, b] of links) preds.get(b)?.push(a);
  const depth = new Map<string, number>();
  const at = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const p = preds.get(id) ?? [];
    const d = p.length ? Math.max(...p.map((x) => at(x, seen) + 1)) : 0;
    depth.set(id, d); return d;
  };
  ids.forEach((i) => at(i));
  const cols: string[][] = [];
  for (const i of ids) (cols[depth.get(i)!] ??= []).push(i);
  const pos = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const col of cols) {
    if (!col) continue;
    const w = Math.max(...col.map((i) => size(i).w));
    const total = col.reduce((s, i) => s + size(i).h + gap.y, -gap.y);
    let y = -total / 2;
    for (const i of col) { pos.set(i, { x, y }); y += size(i).h + gap.y; }
    x += w + gap.x;
  }
  return pos;
}
