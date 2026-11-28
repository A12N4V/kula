// The Map view: one header, one canvas slot per variant, shared overlays,
// shared inspector, shared find. Variants plug in through the Variant
// interface below; the stub here keeps the view working before wave 2.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { fuzzyScore } from "../../nav";
import { buildMapModel, type MapModel } from "./model";
import { buildOverlays, type OverlayState } from "./overlays";
import { useEvents } from "../hub/live";
import { domainGrid, flowColor, inks, roundRect, withAlpha, LAYER_COLORS } from "./layout-common";
import { Inspector, HoverCard } from "./Inspector";
import { Test } from "./Test";
import { metroVariantFor } from "./metro";
import {
  parsePick, pickCode, VARIANTS, VARIANT_LABEL, type Pick, type VariantId,
} from "./ab";
import "./map.css";

export type OverlayKey = "fences" | "live" | "churn" | "owners";
export type ShowFlags = Record<OverlayKey, boolean>;
/** What a variant draws with: the overlay numbers plus which toggles are on. */
export type DrawOverlays = OverlayState & { show: ShowFlags };
/** The view transform: world → screen is (x·scale + ox, y·scale + oy). */
export interface VariantView { w: number; h: number; scale: number; ox: number; oy: number }
export type MapPick = Pick;

/** One drawing of the map. A and B are canvas; C may be a React component. */
export interface Variant {
  id: VariantId;
  draw(ctx: CanvasRenderingContext2D, model: MapModel, view: VariantView, overlays: DrawOverlays, sel: MapPick | null): void;
  hit(x: number, y: number, view: VariantView): MapPick | null;
  fit(pick: MapPick, view: VariantView, set: (v: VariantView) => void): void;
}

export interface MapRoute { variant: VariantId; /** pick code `s/<id>` · `f/<id>` · `d/<id>`, "" for none */ pick: string; test: boolean }
export type SetRoute = (r: MapRoute) => void;

const WORLD = { w: 1600, h: 1000 };

/* ---------------------------------------------------------------- stub ---- */

interface StubLayout {
  domains: { id: number; x: number; y: number; w: number; h: number }[];
  stations: { id: string; x: number; y: number; degree: number }[];
}

/** The stub's own layout: districts in a grid, flows as rows of stations. Deterministic. */
function stubLayout(model: MapModel): StubLayout {
  const rects = domainGrid(model, WORLD.w, WORLD.h);
  const byDomain = new Map<number, { id: number; label: string; flows: string[] }>();
  for (const f of model.flows) {
    const d = byDomain.get(f.domain) ?? { id: f.domain, label: model.domains.find((x) => x.id === f.domain)?.label ?? "", flows: [] };
    if (!byDomain.has(f.domain)) byDomain.set(f.domain, d);
    d.flows.push(f.id);
  }
  const stations: StubLayout["stations"] = [];
  const seen = new Set<string>();
  for (const r of rects) {
    const d = byDomain.get(r.id);
    if (!d) continue;
    const rows = Math.max(1, d.flows.length);
    const rowH = Math.min(46, (r.h - 40) / rows);
    d.flows.forEach((fid, i) => {
      const flow = model.flows.find((f) => f.id === fid);
      if (!flow) return;
      const y = r.y + 34 + i * rowH;
      const pts = flow.steps.map((s) => s.station);
      const uniq = [...new Set(pts)];
      uniq.forEach((sid, j) => {
        const x = r.x + 18 + (j * (r.w - 36)) / Math.max(1, uniq.length - 1 || 1);
        if (!seen.has(sid)) {
          seen.add(sid);
          const st = model.stations.find((s) => s.id === sid);
          stations.push({ id: sid, x, y, degree: st?.degree ?? 1 });
        }
      });
    });
  }
  return { domains: rects, stations };
}

/** The stub variant: districts, flow lines, station dots. Enough to prove the shell. */
const stubVariant: Variant = {
  id: "a",
  draw(ctx, model, view, overlays, sel) {
    const lay = stubLayout(model);
    const ink = inks();
    ctx.save();
    ctx.setTransform(view.scale * devicePixelRatio, 0, 0, view.scale * devicePixelRatio, view.ox * devicePixelRatio, view.oy * devicePixelRatio);
    ctx.fillStyle = ink.bg;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    // districts
    for (const r of lay.domains) {
      const d = model.domains.find((x) => x.id === r.id);
      ctx.strokeStyle = ink.line2;
      ctx.lineWidth = 1;
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.stroke();
      ctx.fillStyle = ink.text;
      ctx.font = "13px 'Jost Variable', sans-serif";
      ctx.fillText(`${d?.label ?? ""} · ${d?.flows.length ?? 0}`, r.x + 10, r.y + 18);
    }
    // flow lines through stations, per flow row (recompute rows as in layout)
    const byDomain = new Map<number, string[]>();
  for (const f of model.flows) {
    const a = byDomain.get(f.domain) ?? [];
    if (!byDomain.has(f.domain)) byDomain.set(f.domain, a);
    a.push(f.id);
  }
  const flowIdx = new Map<string, number>(model.flows.map((f: { id: string }, i: number) => [f.id, i] as [string, number]));
    for (const r of lay.domains) {
      const fl = byDomain.get(r.id) ?? [];
      fl.forEach((fid, i) => {
        const flow = model.flows.find((f) => f.id === fid);
        if (!flow) return;
        const y = r.y + 34 + i * Math.min(46, (r.h - 40) / Math.max(1, fl.length));
        const uniq = [...new Set(flow.steps.map((s) => s.station))];
        const pts = uniq
          .map((sid, j) => ({ sid, x: r.x + 18 + (j * (r.w - 36)) / Math.max(1, uniq.length - 1 || 1), y }))
          .filter((p) => lay.stations.some((s) => s.id === p.sid));
        if (pts.length < 2) return;
        ctx.strokeStyle = withAlpha(flowColor(flowIdx.get(fid) ?? 0).trim().startsWith("var") ? "#ff6a14" : flowColor(flowIdx.get(fid) ?? 0), 0.9);
        // resolve the CSS var colour through the palette index instead
        ctx.strokeStyle = STUB_LINE[(flowIdx.get(fid) ?? 0) % STUB_LINE.length];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
        // selected flow is the accent
        if (sel?.kind === "flow" && sel.id === fid) {
          ctx.strokeStyle = ink.accent;
          ctx.lineWidth = 5;
          ctx.stroke();
        }
      });
    }
    // stations
    for (const s of lay.stations) {
      const st = model.stations.find((x) => x.id === s.id);
      const r = s.degree >= 2 ? 7 : 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = st ? LAYER_COLORS[st.layer].startsWith("var") ? "#1fd66a" : LAYER_COLORS[st.layer] : "#1fd66a";
      ctx.fill();
      ctx.strokeStyle = ink.bg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (s.degree >= 2) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = ink.text;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // overlay marks: fence ring, live halo, churn tick
      if (overlays.show.fences && overlays.fences[s.id]) {
        ctx.strokeStyle = "#ffc414";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (overlays.show.live && overlays.live[s.id]) {
        ctx.strokeStyle = withAlpha("#ff6a14", Math.min(1, 0.25 + overlays.live[s.id]));
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (overlays.show.churn && overlays.churn[s.id]) {
        ctx.fillStyle = "#ff463a";
        ctx.fillRect(s.x - 2, s.y - r - 10, 4, 4);
      }
      if (overlays.show.owners && overlays.owners[s.id]) {
        ctx.fillStyle = "#2e8bff";
        ctx.beginPath();
        ctx.arc(s.x + r + 7, s.y - r - 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // selection ring
      if (sel?.kind === "station" && sel.id === s.id) {
        ctx.strokeStyle = ink.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (view.scale > 0.9) {
        ctx.fillStyle = ink.text;
        ctx.font = "11px 'JetBrains Mono Variable', monospace";
        ctx.fillText(st?.name ?? s.id, s.x + r + 4, s.y + 4);
      }
    }
    ctx.restore();
  },
  hit(x, y, view) {
    const lay = stubLayoutCached;
    if (!lay) return null;
    const wx = (x - view.ox) / view.scale;
    const wy = (y - view.oy) / view.scale;
    let best: { d: number; pick: MapPick } | null = null;
    for (const s of lay.stations) {
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < 12 && (!best || d < best.d)) best = { d, pick: { kind: "station", id: s.id } };
    }
    if (best) return best.pick;
    for (const r of lay.domains) {
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return { kind: "domain", id: String(r.id) };
    }
    return null;
  },
  fit(pick, view, set) {
    const lay = stubLayoutCached;
    if (!lay) return;
    const at = pick.kind === "domain"
      ? lay.domains.find((r) => String(r.id) === pick.id)
      : (() => { const s = lay.stations.find((x) => x.id === pick.id); return s ? { x: s.x, y: s.y } : undefined; })();
    if (!at) return;
    const cx = at.x + ("w" in at ? (at as { w: number }).w / 2 : 0);
    const cy = at.y + ("h" in at ? (at as { h: number }).h / 2 : 0);
    set({ ...view, scale: 1.5, ox: view.w / 2 - cx * 1.5, oy: view.h / 2 - cy * 1.5 });
  },
};

/** Raw hex twins of the CSS map palette: canvas cannot read var() colours. */
const STUB_LINE = ["#ff6a14", "#00d2dc", "#1fd66a", "#ffc414", "#a45bff", "#2e8bff", "#ff3d8e", "#ff463a"];
const STUB_LAYER: Record<string, string> = {
  entry: "#ff6a14", handler: "#00d2dc", logic: "#1fd66a", data: "#ffc414", io: "#2e8bff", test: "#a45bff",
};

let stubLayoutCached: StubLayout | null = null;

/* ---------------------------------------------------------------- shell ---- */

export default function MapView({ route, setRoute }: { route: MapRoute; setRoute: SetRoute }) {
  const [model, setModel] = useState<MapModel | null>(null);
  const [overlays, setOverlays] = useState<OverlayState>({ fences: {}, live: {}, churn: {}, owners: {} });
  const [show, setShow] = useState<ShowFlags>({ fences: false, live: false, churn: false, owners: false });
  const [view, setView] = useState<VariantView>({ w: 800, h: 600, scale: 0.5, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ text: string; x: number; y: number }>({ text: "", x: 0, y: 0 });
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const baseRef = useRef<{ graph: import("../../api").GraphData | null; info: import("../../api").AgentsInfo | null }>({ graph: null, info: null });
  const { events } = useEvents(show.live);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvas2 = useRef<HTMLCanvasElement>(null);

  // The model, once per data version. The overlays follow the same data.
  useEffect(() => {
    let dead = false;
    Promise.all([api.flowmap(), api.graph(), api.agents()])
      .then(([fm, graph, info]) => {
        if (dead) return;
        const m = buildMapModel(fm, graph);
        baseRef.current = { graph, info };
        setModel(m);
        setOverlays(buildOverlays(m, { events: [], now: Date.now(), graph, info }));
        stubLayoutCached = stubLayout(m);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  // Live events rebuild the live overlay: heat is a sum over recent events,
  // anchored at now, so every arrival (or the stream going quiet) recomputes.
  useEffect(() => {
    if (!model) return;
    setOverlays((o) => ({ ...o, live: buildOverlays(model, { events, now: Date.now() }).live }));
  }, [model, events]);

  // Expose the pure model builder and current model for tests and the probe.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__kulaMap = {
      build: buildMapModel,
      model,
      layout: stubLayoutCached,
      view,
    };
  }, [model, view]);

  const pick = route.pick ? parsePick(route.pick) : null;
  const setPick = useCallback((p: Pick | null) => setRoute({ ...route, pick: p ? pickCode(p) : "" }), [route, setRoute]);

  // Fit the whole world when the canvas first has a size.
  useEffect(() => {
    const el = box.current;
    if (!el || model == null) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      setView((v) => {
        if (v.w === w && v.h === h) return v;
        const scale = Math.min(w / WORLD.w, h / WORLD.h);
        return { w, h, scale, ox: (w - WORLD.w * scale) / 2, oy: (h - WORLD.h * scale) / 2 };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [model]);

  const drawOverlays: DrawOverlays = useMemo(() => ({ ...overlays, show }), [overlays, show]);

  // Variant dispatch: a is the metro variant, b and c stay on the stub until
  // their modules land. Wired by MA (map-ma hand-off); M4 owns this file.
  const active = useMemo(
    () => (route.variant === "a" && model ? metroVariantFor(model) : stubVariant),
    [route.variant, model],
  );

  const paint = useCallback((cv: HTMLCanvasElement | null, v: VariantView) => {
    if (!cv || !model) return;
    const dpr = devicePixelRatio || 1;
    if (cv.width !== v.w * dpr || cv.height !== v.h * dpr) {
      cv.width = v.w * dpr;
      cv.height = v.h * dpr;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    active.draw(ctx, model, v, drawOverlays, pick);
  }, [model, drawOverlays, pick, active]);

  useEffect(() => { paint(canvas.current, view); }, [paint, view]);
  useEffect(() => { paint(canvas2.current, view); }, [paint, view]);

  const hitAt = (e: React.PointerEvent | React.MouseEvent): Pick | null => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return null;
    return active.hit(e.clientX - r.left, e.clientY - r.top, view);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const p = hitAt(e);
    if (!p) return;
    setPick(p);
    // a flow line is long and thin: clicking it also flies to it, so the
    // whole route is in view (the proof's fit-to-a-flow)
    if (p.kind === "flow") active.fit(p, view, setView);
  };

  // Double click zooms to the thing under the pointer; Esc clears the pick,
  // which the shell treats as zooming back out.
  const onCanvasDoubleClick = (e: React.MouseEvent) => {
    const p = hitAt(e);
    if (p) active.fit(p, view, setView);
  };

  const onCanvasMove = (e: React.MouseEvent) => {
    const p = hitAt(e);
    if (!p) { setHover((h) => (h.text ? { ...h, text: "" } : h)); return; }
    const st = p.kind === "station" ? model?.stations.find((s) => s.id === p.id) : null;
    const fl = p.kind === "flow" ? model?.flows.find((f) => f.id === p.id) : null;
    const dm = p.kind === "domain" ? model?.domains.find((d) => String(d.id) === p.id) : null;
    const text = st ? `${st.name} · ${st.layer} · ${st.path}` : fl ? fl.label : dm ? `${dm.label} · ${dm.flows.length} flows` : "";
    setHover({ text, x: e.clientX - (box.current?.getBoundingClientRect().left ?? 0), y: e.clientY - (box.current?.getBoundingClientRect().top ?? 0) });
  };

  // Pan and zoom on the stub: drag to pan, wheel to zoom.
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy }; };
  const onMoveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView((v) => ({ ...v, ox: drag.current!.ox + (e.clientX - drag.current!.x), oy: drag.current!.oy + (e.clientY - drag.current!.y) }));
  };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => {
      const k = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.max(0.1, Math.min(8, v.scale * k));
      const f = scale / v.scale;
      return { ...v, scale, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f };
    });
  };

  // ⌘K find on map: capture phase, so the global palette does not take it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFindOpen((o) => !o);
      }
      if (e.key === "Escape") {
        if (findOpen) setFindOpen(false);
        else if (pick) setPick(null);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, [findOpen, pick, setPick]);

  const hits = useMemo(() => {
    if (!model || !find.trim()) return [];
    const q = find.trim();
    const score = (t: string) => fuzzyScore(q, t);
    const out: { label: string; sub: string; pick: Pick; s: number }[] = [];
    for (const st of model.stations) {
      const s = score(st.name);
      if (s >= 0) out.push({ label: st.name, sub: `station · ${st.path}`, pick: { kind: "station", id: st.id }, s });
    }
    for (const f of model.flows) {
      const s = score(f.label);
      if (s >= 0) out.push({ label: f.label, sub: `flow · ${f.kind}`, pick: { kind: "flow", id: f.id }, s });
    }
    for (const d of model.domains) {
      const s = score(d.label);
      if (s >= 0) out.push({ label: d.label, sub: "district", pick: { kind: "domain", id: String(d.id) }, s });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 8);
  }, [model, find]);

  const gotoPick = (p: Pick) => {
    setPick(p);
    setFindOpen(false);
    setFind("");
    active.fit(p, view, setView);
  };

  if (!model) {
    return <div className="map-view" data-testid="map-view"><div className="view-loading" aria-live="polite">loading…</div></div>;
  }

  const other = VARIANTS[(VARIANTS.indexOf(route.variant) + 1) % VARIANTS.length];

  return (
    <div className="map-view" data-testid="map-view">
      <header className="map-header">
        <span className="map-brand">Map</span>
        <div className="map-seg" role="tablist" aria-label="Variant">
          {VARIANTS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={route.variant === v}
              className={`map-seg-btn${route.variant === v ? " on" : ""}`}
              data-testid={`variant-${v}`}
              onClick={() => setRoute({ ...route, variant: v })}
            >{v.toUpperCase()}</button>
          ))}
        </div>
        <button className={`btn sm${compare ? " on" : ""}`} data-testid="map-compare" onClick={() => setCompare((c) => !c)}>Compare</button>
        <div className="map-overlays" role="group" aria-label="Overlays">
          {(["fences", "live", "churn", "owners"] as OverlayKey[]).map((k) => (
            <button
              key={k}
              className={`map-ov${show[k] ? " on" : ""}`}
              data-testid={`overlay-${k}`}
              aria-pressed={show[k]}
              onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            >{k}</button>
          ))}
        </div>
        <div className="map-find">
          <input
            className="map-find-input"
            placeholder="Find on map"
            value={find}
            data-testid="map-find"
            onChange={(e) => { setFind(e.target.value); setFindOpen(true); }}
            onFocus={() => setFindOpen(true)}
          />
          {findOpen && hits.length > 0 && (
            <ul className="map-find-list" data-testid="map-find-list">
              {hits.map((h) => (
                <li key={`${h.pick.kind}:${h.pick.id}`}>
                  <button onClick={() => gotoPick(h.pick)}>
                    <span>{h.label}</span><span className="map-find-sub">{h.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className={`btn sm${route.test ? " on" : ""}`}
          data-testid="map-test-toggle"
          onClick={() => setRoute({ ...route, test: !route.test })}
        >Test</button>
      </header>
      <div className={`map-stage${compare ? " compare" : ""}`} ref={box}>
        <div className="map-pane">
          <canvas
            ref={canvas}
            data-testid="map-canvas"
            onClick={onCanvasClick}
            onDoubleClick={onCanvasDoubleClick}
            onMouseMove={onCanvasMove}
            onPointerDown={onDown}
            onPointerMove={onMoveDrag}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onWheel={onWheel}
          />
          {!compare && <span className="map-pane-tag">{VARIANT_LABEL[route.variant]}</span>}
        </div>
        {compare && (
          <div className="map-pane">
            <canvas ref={canvas2} data-testid="map-canvas-2" />
            <span className="map-pane-tag">{VARIANT_LABEL[other]}</span>
          </div>
        )}
        <HoverCard text={hover.text} x={hover.x} y={hover.y} />
        {pick && <Inspector pick={pick} model={model} overlays={overlays} onClose={() => setPick(null)} onPick={(p) => { setPick(p); active.fit(p, view, setView); }} />}
        {route.test && (
          <Test model={model} overlays={overlays} now={Date.now()} pick={pick} onVariant={(v) => setRoute({ ...route, variant: v })} />
        )}
      </div>
    </div>
  );
}

export { parsePick, pickCode, VARIANT_LABEL };
