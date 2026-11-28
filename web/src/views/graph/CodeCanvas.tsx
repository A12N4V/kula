// The code canvas: folders as hollow boxes, files as bars as tall as their code,
// links drawn line to line. The centre pane only draws; the pick and its link filters
// dock into the shell's right sidebar and the Project tree picks files in place.
// Model, layout and paint live beside this file.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { api, type GraphData } from "../../api";
import { useCode } from "../../CodePanel";
import { Empty, Icon, Kind, useToast } from "../../ui";
import { hitTest, paint, readColors, type Hit, type View } from "./draw";
import { CodePeek, type PeekFn } from "./CodePeek";
import { place, type Box } from "./layout";
import { Docked, useDockTree } from "../../studio/Dock";
import { build, connected, kindOf, KINDS, selKey, type FileN, type KindId, type Model, type Selection, type Sym } from "./model";
import { SelectedPanel } from "./SelectedPanel";
import { usePrefs } from "./state";

type Props = { focus: number | null; setFocus: (id: number | null) => void; version: number };

export default function CodeCanvas(props: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [repo, setRepo] = useState("repo");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setErr("");
    return api.graph("symbol").then(setData).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { load(); }, [load, props.version]);
  useEffect(() => { api.repo().then((r) => setRepo(r.name)).catch(() => {}); }, []);
  const m = useMemo(() => (data ? build(data, repo) : null), [data, repo]);

  const rescan = async () => {
    setBusy(true);
    try { await api.reindex(); await load(); toast("Rescanned"); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };

  if (err) return <div className="ct"><Empty title="Graph did not load">{err}</Empty></div>;
  if (!m) return <div className="ct"><div className="ct-loading">Reading the graph</div></div>;
  if (!m.files.size) return <div className="ct"><Empty title="Nothing indexed yet"><button className="btn sm" onClick={rescan}>Scan</button></Empty></div>;
  return <Canvas key={repo} m={m} {...props} rescan={rescan} busy={busy} />;
}

function Canvas({ m, focus, setFocus, rescan, busy }: Props & { m: Model; rescan: () => void; busy: boolean }) {
  const code = useCode();
  const [p, set] = usePrefs();
  const [sel, setSel] = useState<Selection>(null);
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);

  const on = useMemo(() => new Set<KindId>(p.on), [p.on]);
  const bodyOn = useMemo(() => new Set<KindId>(p.bodyOn), [p.bodyOn]);
  const shut = useMemo(() => new Set(p.shut), [p.shut]);
  const conn = useMemo(() => (sel ? connected(m, sel, on) : null), [m, sel, on]);
  const only = p.only && !!sel;
  const placed = useMemo(
    () => place(m.root, (f) => !only || !!conn?.has(f), shut),
    [m, only, conn, shut],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(KINDS.map((k) => [k.id, 0])) as Record<KindId, number>;
    for (const l of m.links) { if (l.sf === l.df) continue; const k = kindOf(l, sel); if (k) c[k]++; }
    return c;
  }, [m, sel]);

  // the canvas itself: sized to its box, painted on the next frame after any change
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const frame = useRef(0);
  const peek = useRef<PeekFn | null>(null);
  const now = { m, p: placed, sel, hover: (hover?.hit?.type === "file" ? hover.hit.file : hover?.hit?.type === "sym" ? hover.hit.sym : null) as FileN | Sym | null, on, strength: p.strength, bodies: p.bodies, bodyOn, bodyStrength: p.bodyStrength, dim: conn && !only ? conn : null };
  const state = useRef(now);
  state.current = now;
  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const c = cv.current, ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      paint(ctx, size.current.w, size.current.h, window.devicePixelRatio || 1, { ...state.current, view: view.current });
      peek.current?.(view.current, state.current.p);
    });
  }, []);
  useEffect(draw);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const fit = useCallback((b: Box = placed.bounds, max = 1.6) => {
    const { w, h } = size.current;
    if (!w || !h || !b.w) return;
    const k = Math.min(max, (w - 64) / b.w, (h - 96) / b.h);
    view.current = { k, x: (w - b.w * k) / 2 - b.x * k, y: (h - b.h * k) / 2 - b.y * k + 20 };
    draw();
  }, [placed, draw]);
  const fitted = useRef(false);
  useEffect(() => {
    const el = wrap.current, c = cv.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height };
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
      if (!fitted.current && r.width) { fitted.current = true; fit(); } else draw();
    });
    ro.observe(el);
    readColors();
    return () => ro.disconnect();
  }, [fit, draw]);
  // refit when the set of drawn files changes shape
  const shape = `${placed.bounds.w}x${placed.bounds.h}`;
  const lastShape = useRef(shape);
  useEffect(() => { if (lastShape.current !== shape) { lastShape.current = shape; if (only) fit(); } }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  const center = useCallback((b: Box) => {
    const { w, h } = size.current;
    const k = Math.max(view.current.k, Math.min(1.6, (h - 120) / Math.max(b.h, 1), (w - 120) / Math.max(b.w, 1), 1.1));
    view.current = { k, x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k };
    draw();
  }, [draw]);

  const boxOf = useCallback((s: Selection): Box | null => {
    if (!s) return null;
    if (s.type === "dir") return placed.dirs.get(s.dir) ?? null;
    const f = s.type === "file" ? s.file : s.sym.file;
    for (let d = f.dir; d; d = d.parent!) { const b = placed.dirs.get(d); if (b?.shut) return b; if (!d.parent) break; }
    return placed.files.get(f) ?? null;
  }, [placed]);

  const pick = useCallback((s: Selection, pan = true) => {
    setSel((cur) => (selKey(cur) === selKey(s) && s ? cur : s));
    if (s?.type === "file") setFocus(s.file.id); else if (s?.type === "sym") setFocus(s.sym.id);
    if (pan && s) {
      const b = boxOf(s);
      if (b) {
        const { k, x, y } = view.current, { w, h } = size.current;
        const sx = b.x * k + x, sy = b.y * k + y;
        if (sx < 40 || sy < 60 || sx + b.w * k > w - 40 || sy + Math.min(b.h * k, h / 2) > h - 40) center(b);
      }
    }
  }, [boxOf, center, setFocus]);

  // follow focus from elsewhere in the app
  useEffect(() => {
    if (focus == null) return;
    const s = m.syms.get(focus), f = m.files.get(focus);
    const next: Selection = s ? { type: "sym", sym: s } : f ? { type: "file", file: f } : null;
    if (next && selKey(next) !== selKey(sel)) pick(next);
  }, [focus, m]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSrc = useCallback((s: Sym | null) => {
    if (s) code.open({ path: s.file.path, line: s.line, end: s.end, name: s.name, kind: s.kind, id: s.id });
    else if (sel?.type === "file") code.open({ path: sel.file.path, name: sel.file.name, kind: "file", id: sel.file.id });
  }, [code, sel]);

  // pointer: drag pans, click picks, wheel zooms or pans like the trackpad means it
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const world = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect(), v = view.current;
    return [(e.clientX - r.left - v.x) / v.k, (e.clientY - r.top - v.y) / v.k] as const;
  };
  const hitAt = (e: { clientX: number; clientY: number }) => { const [wx, wy] = world(e); return hitTest({ p: placed, bodies: p.bodies, view: view.current }, wx, wy); };
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const v = view.current, k = Math.min(8, Math.max(0.05, v.k * factor));
    view.current = { k, x: sx - (sx - v.x) * (k / v.k), y: sy - (sy - v.y) * (k / v.k) };
    draw();
  };
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouse) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
      else { view.current = { ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY }; draw(); }
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      view.current = { ...view.current, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y };
      setHover(null);
      draw();
      return;
    }
    const hit = hitAt(e);
    const r = wrap.current!.getBoundingClientRect();
    const key = (h: Hit) => (!h ? "" : h.type === "file" ? `f${h.file.id}` : h.type === "sym" ? `s${h.sym.id}` : `${h.type}${h.dir.path}`);
    setHover((cur) => (hit && (hit.type === "file" || hit.type === "sym" || hit.type === "toggle") ? (cur && key(cur.hit) === key(hit) ? { ...cur, x: e.clientX - r.left, y: e.clientY - r.top } : { hit, x: e.clientX - r.left, y: e.clientY - r.top }) : null));
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const hit = hitAt(e);
    if (!hit) return pick(null, false);
    if (hit.type === "toggle") { set({ shut: shut.has(hit.dir.path) ? p.shut.filter((x) => x !== hit.dir.path) : [...p.shut, hit.dir.path] }); return; }
    if (hit.type === "dir") return pick(hit.dir.parent ? { type: "dir", dir: hit.dir } : null, false);
    if (hit.type === "file") return pick({ type: "file", file: hit.file }, false);
    if (hit.type === "sym") pick({ type: "sym", sym: hit.sym }, false);
  };
  const onDouble = (e: MouseEvent) => {
    const hit = hitAt(e);
    if (hit?.type === "sym") code.edit({ path: hit.sym.file.path, line: hit.sym.line, end: hit.sym.end, name: hit.sym.name, kind: hit.sym.kind, id: hit.sym.id });
    else if (hit?.type === "file") code.edit({ path: hit.file.path, name: hit.file.name, kind: "file", id: hit.file.id });
    else if (hit?.type === "dir" || hit?.type === "toggle") { const b = placed.dirs.get(hit.dir); if (b) fit(b, 3); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as Element)?.closest?.("input, textarea")) return;
      setSel(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  // the Project tree in the left sidebar picks files here instead of opening them
  const selFile = sel?.type === "file" ? sel.file : sel?.type === "sym" ? sel.sym.file : null;
  useDockTree((path) => {
    for (const f of m.files.values()) if (f.path === path) { pick({ type: "file", file: f }); return true; }
    return false;
  }, selFile?.path ?? null);

  const hovered = hover?.hit?.type === "sym" ? hover.hit.sym : null;

  return (
    <div className="ct">
      <header className="qv-head graph-head">
        <Crumbs m={m} sel={sel} pick={(s) => pick(s)} />
      </header>
      <div className="ct-stage" ref={wrap}>
        <canvas ref={cv} className="ct-canvas" aria-label="Code canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => !drag.current && setHover(null)} onDoubleClick={onDouble}
          style={{ cursor: hover ? "pointer" : "default" }} />
        <CodePeek reg={peek} sym={sel?.type === "sym" ? sel.sym : hovered} file={selFile} redraw={draw} open={openSrc} />
        <div className="ct-zoom" role="group" aria-label="Zoom">
          <button className="btn sm" aria-label="Fit" title="Fit" onClick={() => fit()}><Icon.fit /></button>
          <button className="btn sm" aria-label="Locate" title="Locate selection" disabled={!sel} onClick={() => { const b = boxOf(sel); if (b) center(b); }}><Icon.target /></button>
          <i className="ct-zoom-sep" />
          <button className="btn sm" aria-label="Zoom out" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 0.8)}><Icon.minus /></button>
          <button className="btn sm" aria-label="Zoom in" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.25)}><Icon.plus /></button>
        </div>
        {hover && <Tip hit={hover.hit} x={hover.x} y={hover.y} m={m} />}
        {!placed.files.size && <div className="ct-empty">No files to draw<button className="btn sm" onClick={() => set({ only: false })}>Show all</button></div>}
      </div>
      <Docked label="Selected">
        <SelectedPanel m={m} sel={sel} p={p} counts={counts} set={set} pick={(s) => pick(s)} open={openSrc} rescan={rescan} busy={busy} />
      </Docked>
    </div>
  );
}

/** Where the pick sits, from the repo down; each folder in the trail picks itself. */
function Crumbs({ m, sel, pick }: { m: Model; sel: Selection; pick: (s: Selection) => void }) {
  const d = sel?.type === "dir" ? sel.dir : sel?.type === "file" ? sel.file.dir : sel?.type === "sym" ? sel.sym.file.dir : null;
  const trail: typeof m.root[] = [];
  for (let x = d; x && x.parent; x = x.parent) trail.unshift(x);
  return (
    <nav className="ct-crumbs" aria-label="Path">
      <button onClick={() => pick(null)}>{m.root.name}/</button>
      {trail.map((x) => <button key={x.path} onClick={() => pick({ type: "dir", dir: x })}>{x.name}/</button>)}
    </nav>
  );
}

function Tip({ hit, x, y, m }: { hit: Hit; x: number; y: number; m: Model }) {
  if (!hit) return null;
  const body = hit.type === "toggle"
    ? <><b>{hit.dir.name}/</b><span>{hit.dir.count} files</span></>
    : hit.type === "file"
      ? <><b>{hit.file.path}</b><span>{hit.file.loc} lines</span></>
      : hit.type === "sym"
        ? <><Kind kind={hit.sym.kind} size={12} /><b>{hit.sym.name}</b><span>{(m.into.get(hit.sym.id)?.length ?? 0)} in {(m.out.get(hit.sym.id)?.length ?? 0)} out</span></>
        : null;
  if (!body) return null;
  return <div className="ct-tip" style={{ left: x + 14, top: y + 14 }}>{hit.type !== "sym" && <span className="ct-dot" />}{body}</div>;
}
