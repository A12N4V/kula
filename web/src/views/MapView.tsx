// Map: the repository's execution flows on the canvas. An entry point (a
// function nothing calls that calls at least two others) and everything it
// reaches, column by call depth, wired caller to callee. The bottom pane lists
// every flow and the steps of this one; selecting a step on either side lights
// it on the other and opens its details in the sidebar.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Context, type Flow, type ImpactHit } from "../api";
import { Icon, Kind } from "../ui";
import { useCode } from "../CodePanel";
import Canvas, { layered, type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import type { Nav } from "./agents/data";
import { Loading } from "./Overview";

const PER_DEPTH = 14, DEPTH = 4;
const SIZE = { w: 220, h: 54 };

function build(f: Flow) {
  const steps = f.steps.filter((s) => s.depth <= DEPTH);
  const kept: ImpactHit[] = [];
  const more: Record<number, number> = {};
  for (let d = 1; d <= DEPTH; d++) {
    const at = steps.filter((s) => s.depth === d);
    kept.push(...at.slice(0, PER_DEPTH));
    if (at.length > PER_DEPTH) more[d] = at.length - PER_DEPTH;
  }
  const ids = new Set(kept.map((s) => s.node.id));
  const entry = `n${f.entry.id}`;
  const links: [string, string][] = kept.map((s) => [s.via != null && ids.has(s.via) ? `n${s.via}` : entry, `n${s.node.id}`]);
  const moreIds = Object.keys(more).map((d) => `more${d}`);
  for (const d of Object.keys(more)) {
    const last = kept.filter((s) => s.depth === Number(d)).pop();
    links.push([last?.via != null && ids.has(last.via) ? `n${last.via}` : entry, `more${d}`]);
  }
  const all = [entry, ...kept.map((s) => `n${s.node.id}`), ...moreIds];
  const pos = layered(all, links, () => SIZE, { x: 90, y: 18 });
  const nodes: CNode[] = [
    { id: entry, ...SIZE, ...pos.get(entry)!, title: f.entry.name, sub: `${f.entry.path}:${f.entry.start_line}`, icon: <Kind kind={f.entry.kind} size={14} />, tone: "accent", kind: "entry", badge: <span className="tnum">{f.reach}</span>, label: f.entry.name },
    ...kept.map((s): CNode => ({ id: `n${s.node.id}`, ...SIZE, ...pos.get(`n${s.node.id}`)!, title: s.node.name, sub: `${s.node.path}:${s.node.start_line}`, icon: <Kind kind={s.node.kind} size={14} />, kind: s.node.kind, label: s.node.name })),
    ...Object.entries(more).map(([d, n]): CNode => ({ id: `more${d}`, ...SIZE, h: 36, ...pos.get(`more${d}`)!, title: `+${n} more at step ${d}`, tone: "muted", kind: "more" })),
  ];
  const edges: CEdge[] = links.map(([a, b]) => ({ id: `${a}>${b}`, from: a, to: b }));
  return { nodes, edges, kept };
}

export default function MapView({ openSymbol, version }: Nav) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("steps");
  const [ctx, setCtx] = useState<Context | null>(null);
  const code = useCode();
  useEffect(() => { api.flows().then(setFlows).catch(() => setFlows([])); }, [version]);
  const f = flows?.[cur];
  const g = useMemo(() => (f ? build(f) : null), [f]);
  const symId = sel?.startsWith("n") ? Number(sel.slice(1)) : null;
  useEffect(() => { setCtx(null); if (symId) api.symbol(symId).then(setCtx).catch(() => {}); }, [symId]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  // linked scrolling: the selected step's row comes into view in the pane
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => { pane.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel, tab]);

  if (!flows) return <Loading text="Tracing execution flows…" />;
  const pick = (i: number) => { setCur(i); setSel(null); };
  const inFlow = (id: number) => g?.nodes.some((n) => n.id === `n${id}`);
  const goSym = (id: number) => (inFlow(id) ? setSel(`n${id}`) : openSymbol(id));

  const n = ctx?.node;
  const side = sel && symId && g ? {
    title: n?.name ?? g.nodes.find((x) => x.id === sel)?.label ?? "…",
    sub: n ? `${n.kind} · ${n.path}:${n.start_line}` : undefined,
    icon: n ? <Kind kind={n.kind} size={16} /> : undefined,
    onClose: () => setSel(null),
    body: !ctx ? <div className="muted">loading…</div> : <div className="side-sections">
      <section><h3>Inputs <span className="muted tnum">{ctx.callers.length}</span></h3>{ctx.callers.slice(0, 12).map((c) => <button key={c.id} className="side-link" onClick={() => goSym(c.id)}><Kind kind={c.kind} size={12} /><span className="mono">{c.name}</span>{inFlow(c.id) && <span className="tag accent">in flow</span>}</button>)}{!ctx.callers.length && <div className="muted">Nothing calls this.</div>}</section>
      <section><h3>Outputs <span className="muted tnum">{ctx.callees.length}</span></h3>{ctx.callees.slice(0, 12).map((c) => <button key={c.id} className="side-link" onClick={() => goSym(c.id)}><Kind kind={c.kind} size={12} /><span className="mono">{c.name}</span>{inFlow(c.id) && <span className="tag accent">in flow</span>}</button>)}{!ctx.callees.length && <div className="muted">Calls nothing indexed.</div>}</section>
      {ctx.community && <section><h3>Cluster</h3><div className="mono">{ctx.community}</div></section>}
      {ctx.snippet && <section><h3>Source</h3><pre className="side-pre">{ctx.snippet}</pre></section>}
    </div>,
    actions: <>
      <button className="btn sm" onClick={() => n && code.open({ path: n.path, line: n.start_line, name: n.name, kind: n.kind, id: n.id })}><Icon.code /> Open code</button>
      <button className="btn sm ghost" onClick={() => openSymbol(symId)}><Icon.graph /> Show on graph</button>
    </>,
  } : null;

  const canvas = !f ? <div className="kc"><div className="kc-empty">No flows found. Entry points are functions nothing calls that call at least two others.</div></div> : (
    <>
      <Canvas testid="map-canvas" label="Flow canvas" nodes={g!.nodes} edges={g!.edges} selected={sel} onSelect={(id) => setSel(id && id.startsWith("n") ? id : null)} fitKey={`flow${cur}`} />
      <div className="kc-pick">
        <select aria-label="Flow" value={cur} onChange={(e) => pick(Number(e.target.value))}>
          {flows.map((x, i) => <option key={x.entry.id} value={i}>{x.entry.name} · reaches {x.reach}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <Workspace id="map" testid="map" canvas={canvas} tab={tab} onTab={setTab} side={side} tabs={[
      { id: "steps", label: "Steps", icon: Icon.flows, count: g?.kept.length, render: () => (
        <div className="ptable" ref={pane} role="grid" aria-label="Steps">
          <div className="pt-row pt-head" role="row"><span>step</span><span>symbol</span><span>file</span></div>
          {f && [{ node: f.entry, depth: 0, via: null } as ImpactHit, ...g!.kept].map((s) => (
            <div key={s.node.id} role="row" data-row={`n${s.node.id}`} className={`pt-row ${sel === `n${s.node.id}` ? "on" : ""}`} onClick={() => setSel(`n${s.node.id}`)}>
              <span className="tnum muted">{s.depth || "entry"}</span><span className="mono row" style={{ gap: 6 }}><Kind kind={s.node.kind} size={12} />{s.node.name}</span><span className="muted">{s.node.path}:{s.node.start_line}</span>
            </div>))}
        </div>) },
      { id: "flows", label: "Flows", icon: Icon.map, count: flows.length, render: () => (
        <div className="ptable" role="grid" aria-label="Flows">
          <div className="pt-row pt-head" role="row"><span>reach</span><span>entry</span><span>file</span></div>
          {flows.map((x, i) => (
            <div key={x.entry.id} role="row" data-flow={i} className={`pt-row ${cur === i ? "on" : ""}`} onClick={() => pick(i)}>
              <span className="tnum muted">{x.reach}</span><span className="mono">{x.entry.name}</span><span className="muted">{x.entry.path}</span>
            </div>))}
        </div>) },
    ]} />
  );
}
