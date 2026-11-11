// Code map: the repository as blocks on the canvas. Each level shows the
// drilled block's children as frames with their own children inside, wired by
// the call chains that cross them (the wire label counts the chains). Double
// click (or Enter on a selected node) opens a block; at the bottom of the tree
// the functions themselves are the nodes, and opening one draws its body as a
// flowchart: steps, branches, loops, match arms and exits.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon, Kind } from "../ui";
import { useCode } from "../CodePanel";
import Canvas, { layered, type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import { fixture } from "./syntagm/fixture";
import { fromGraph } from "./codemap/fromGraph";
import { normalize } from "./codemap/normalize";
import type { Block, Leaf, SyntagmData } from "./syntagm/types";
import { chart, type Chart, type FKind } from "./codemap/flowchart";
import { Loading } from "./Overview";
import type { Nav } from "./agents/data";

const CELL = { w: 196, h: 52 }, GAP = 12, HEAD = 40, PAD = 14, COLS = 2, PER = 8;
const LEAF_KIND: Record<string, string> = { fn: "function", class: "class", var: "variable", type: "type" };
const F_ICON: Record<FKind, () => React.ReactElement> = { start: Icon.play, step: Icon.code, cond: Icon.branches, loop: Icon.refresh, match: Icon.flows, ret: Icon.back, end: Icon.check };

type Item = { id: string; title: string; sub: string; icon: React.ReactNode; leaf?: number; block?: string };

/** Frames in a grid, each holding a two-column grid of its items. */
function grid(frames: { id: string; title: string; sub: string; items: Item[]; more: number }[]) {
  const nodes: CNode[] = [];
  const fw = COLS * CELL.w + (COLS - 1) * GAP + PAD * 2;
  const per = Math.max(1, Math.round(Math.sqrt(frames.length * 1.6)));
  let y = 0;
  for (let r = 0; r < frames.length; r += per) {
    const row = frames.slice(r, r + per);
    const fh = (f: (typeof row)[number]) => HEAD + Math.ceil((f.items.length + (f.more ? 1 : 0)) / COLS) * (CELL.h + GAP) + PAD - GAP;
    const h = Math.max(...row.map(fh));
    row.forEach((f, c) => {
      const x = c * (fw + 56);
      nodes.push({ id: f.id, x, y, w: fw, h, frame: true, title: f.title, sub: f.sub, label: f.title, kind: "frame", icon: <Icon.box /> });
      f.items.forEach((it, i) => nodes.push({ id: it.id, x: x + PAD + (i % COLS) * (CELL.w + GAP), y: y + HEAD + Math.floor(i / COLS) * (CELL.h + GAP), ...CELL, title: it.title, sub: it.sub, icon: it.icon, label: it.title, kind: it.leaf ? "leaf" : "block" }));
      if (f.more) { const i = f.items.length; nodes.push({ id: `${f.id}~more`, x: x + PAD + (i % COLS) * (CELL.w + GAP), y: y + HEAD + Math.floor(i / COLS) * (CELL.h + GAP), ...CELL, h: 36, title: `+${f.more} more`, tone: "muted", kind: "more" }); }
    });
    y += h + 56;
  }
  return nodes;
}

export default function CodeMap({ go, version }: Nav) {
  const [data, setData] = useState<SyntagmData | null>(null);
  const [live, setLive] = useState(true);
  const [path, setPath] = useState<string[]>([]);
  const [fn, setFn] = useState<number | null>(null);
  const [flow, setFlow] = useState<Chart | "loading" | "none" | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("outline");
  const code = useCode();

  useEffect(() => {
    api.syntagm().then((d) => { setData(normalize(d)); setLive(true); })
      .catch(() => api.graph("symbol").then((g) => { setData(fromGraph(g)); setLive(true); }))
      .catch(() => { setData(fixture); setLive(false); });
  }, [version]);
  useEffect(() => {
    if (fn == null || !data) { setFlow(null); return; }
    const l = data.leaves[fn]; setFlow("loading");
    api.file(l.path).then((f) => { const c = chart(f.content, l.line, l.name); setFlow(c.nodes.length > 2 ? c : "none"); }).catch(() => setFlow("none"));
  }, [fn, data]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); else if (e.key === "Backspace" && !(e.target as HTMLElement).closest("input, textarea")) up(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  const B = data?.blocks ?? {};
  const cur: Block | null = path.length ? B[path[path.length - 1]] : null;
  const kids = (b: Block | null) => (b ? b.children : Object.values(B).filter((x) => x.depth === 0 && x.parent !== null).map((x) => x.id)).filter((id) => B[id]);
  const leafItem = (id: number, l: Leaf): Item => ({ id: `l${id}`, title: l.name, sub: `${l.path.split("/").pop()}:${l.line}`, icon: <Kind kind={LEAF_KIND[l.kind] ?? l.kind} size={14} />, leaf: id });
  const blockItem = (b: Block): Item => ({ id: `b${b.id}`, title: b.name, sub: b.children.length ? `${b.children.length} blocks · ${b.files} files` : `${b.symbols.length} symbols`, icon: <Icon.box />, block: b.id });

  const g = useMemo(() => {
    if (!data || fn != null) return null;
    const frames = (cur && !cur.children.length ? [cur.id] : kids(cur)).map((id) => {
      const b = B[id];
      const all: Item[] = b.children.length ? b.children.filter((c) => B[c]).map((c) => blockItem(B[c])) : b.symbols.filter((s) => data.leaves[s]).map((s) => leafItem(s, data.leaves[s]));
      return { id: `f${id}`, title: b.name, sub: b.summary, items: all.slice(0, id === cur?.id ? 200 : PER), more: id === cur?.id ? Math.max(0, all.length - 200) : Math.max(0, all.length - PER) };
    });
    const nodes = grid(frames);
    const shown = new Set(nodes.map((n) => n.id));
    // chains → wires between the visible items they pass through, counted
    const owner = new Map<string, string>(); // block id or leaf id → visible node id
    for (const n of nodes) if (n.kind === "block") owner.set(n.id.slice(1), n.id); else if (n.kind === "leaf") owner.set(n.id, n.id);
    const up1 = (bid: string): string | null => { for (let b: Block | undefined = B[bid]; b; b = b.parent ? B[b.parent] : undefined) { const o = owner.get(b.id) ?? (shown.has(`f${b.id}`) ? `f${b.id}` : null); if (o) return o; } return null; };
    const count = new Map<string, number>();
    for (const c of data.chains) {
      const seq = [...c.blocks.map(up1), ...c.steps.map((s) => owner.get(`l${s}`) ?? null)].filter((x): x is string => !!x);
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) { const k = `${seq[i - 1]}>${seq[i]}`; count.set(k, (count.get(k) ?? 0) + 1); }
    }
    const edges: CEdge[] = [...count].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, n]) => { const [from, to] = k.split(">"); return { id: k, from, to, label: n > 1 ? `${n}` : undefined }; });
    return { nodes, edges, frames };
  }, [data, path, fn]); // eslint-disable-line react-hooks/exhaustive-deps

  const fg = useMemo(() => {
    if (!flow || typeof flow === "string") return null;
    const size = (id: string) => { const k = flow.nodes.find((n) => n.id === id)?.kind; return k === "start" || k === "end" ? { w: 150, h: 40 } : { w: 220, h: 52 }; };
    const pos = layered(flow.nodes.map((n) => n.id), flow.edges.filter((e) => !e.back).map((e) => [e.from, e.to]), size, { x: 70, y: 22 });
    const nodes: CNode[] = flow.nodes.map((n) => { const I = F_ICON[n.kind]; return { id: n.id, ...size(n.id), ...pos.get(n.id)!, title: n.text, sub: n.lines.length > 1 ? `${n.lines.length} lines` : n.kind === "step" ? undefined : n.kind, icon: <I />, kind: `f-${n.kind}`, tone: n.kind === "start" ? "accent" : n.kind === "ret" ? "warn" : n.kind === "end" ? "muted" : undefined, label: n.text }; });
    const edges: CEdge[] = flow.edges.map((e, i) => ({ id: `${e.from}>${e.to}#${i}`, from: e.from, to: e.to, label: e.label, dashed: e.back, tone: e.label === "no" ? "warn" : e.label === "yes" ? "ok" : undefined }));
    return { nodes, edges };
  }, [flow]);

  if (!data) return <Loading text="Reading blocks…" />;

  const into = (id: string) => setPath((p) => (p.includes(id) ? p.slice(0, p.indexOf(id) + 1) : [...p, id]));
  const open = (id: string) => {
    setSel(null);
    if (id.startsWith("f")) into(id.slice(1));
    else if (id.startsWith("b")) into(id.slice(1));
    else if (id.startsWith("l") && data.leaves[Number(id.slice(1))]?.kind === "fn") setFn(Number(id.slice(1)));
  };
  function up() { if (fn != null) setFn(null); else setPath((p) => p.slice(0, -1)); setSel(null); }

  const leaf = fn != null ? data.leaves[fn] : sel?.startsWith("l") ? data.leaves[Number(sel.slice(1))] : null;
  const selBlock = sel && (sel.startsWith("b") || sel.startsWith("f")) ? B[sel.slice(1)] : null;
  const selStep = fg && sel ? (flow as Chart).nodes.find((n) => n.id === sel) : null;
  const openCode = (l: Leaf, id: number) => code.open({ path: l.path, line: l.line, name: l.name, kind: (LEAF_KIND[l.kind] ?? l.kind) as "function", id });

  const side = selBlock ? {
    title: selBlock.name, sub: `${selBlock.kind} · ${selBlock.files} files`, icon: <Icon.box />, onClose: () => setSel(null),
    body: <div className="side-sections">
      <section><h3>About</h3><div>{selBlock.summary}</div></section>
      <section className="cm-stats"><div><b className="tnum">{selBlock.children.length || selBlock.symbols.length}</b><span>{selBlock.children.length ? "blocks" : "symbols"}</span></div><div><b className="tnum">{selBlock.files}</b><span>files</span></div><div><b className="tnum">{Math.round(selBlock.cohesion * 100)}%</b><span>cohesion</span></div></section>
    </div>,
    actions: <button className="btn sm" aria-label="Open block" data-tip="Open  ↵" onClick={() => open(`b${selBlock.id}`)}><Icon.arrow /></button>,
  } : selStep ? {
    title: selStep.kind, sub: leaf?.name, icon: (() => { const I = F_ICON[selStep.kind]; return <I />; })(), onClose: () => setSel(null),
    body: <pre className="side-pre">{(selStep.lines.length ? selStep.lines : [selStep.text]).join("\n")}</pre>,
    actions: leaf && <button className="btn sm" aria-label="Open code" data-tip="Open code" onClick={() => openCode(leaf, fn!)}><Icon.code /></button>,
  } : sel?.startsWith("l") && leaf ? {
    title: leaf.name, sub: `${leaf.kind} · ${leaf.path}:${leaf.line}`, icon: <Kind kind={LEAF_KIND[leaf.kind] ?? leaf.kind} size={16} />, onClose: () => setSel(null),
    body: <div className="side-sections"><section><h3>In chains</h3><div className="tnum">{data.chains.filter((c) => c.steps.includes(Number(sel.slice(1)))).length}</div></section></div>,
    actions: <>
      {leaf.kind === "fn" && <button className="btn sm" aria-label="Flowchart" data-tip="Flowchart  ↵" onClick={() => open(sel)}><Icon.workflow /></button>}
      <button className="btn sm ghost" aria-label="Open code" data-tip="Open code" onClick={() => openCode(leaf, Number(sel.slice(1)))}><Icon.code /></button>
    </>,
  } : null;

  const crumbs = [{ id: null as string | null, name: "repo" }, ...path.map((id) => ({ id, name: B[id]?.name ?? id }))];
  const bar = (
    <div className="cm-bar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seg cm-mode" role="group" aria-label="Map mode">
        <button aria-label="Flows" data-tip="Flows" onClick={() => go?.("flows")}><Icon.map /></button>
        <button className="on" aria-pressed="true" aria-label="Blocks" data-tip="Blocks"><Icon.box /></button>
      </div>
      {(path.length > 0 || fn != null) && <button className="kc-tool" aria-label="Up a level" data-tip="Up  ⌫" onClick={up}><Icon.back /></button>}
      <nav className="cm-crumbs" aria-label="Level">
        {crumbs.map((c, i) => <button key={c.id ?? "root"} className={i === crumbs.length - 1 && fn == null ? "on" : ""} onClick={() => { setFn(null); setSel(null); setPath(c.id ? path.slice(0, path.indexOf(c.id) + 1) : []); }}>{c.name}</button>)}
        {fn != null && <button className="on"><Icon.workflow />{data.leaves[fn].name}</button>}
      </nav>
      {!live && <span className="tag" data-tip="Block API not reachable; showing sample data">sample</span>}
    </div>
  );

  const canvas = fn != null ? (
    flow === "loading" || flow == null ? <div className="kc"><div className="kc-empty">Reading {data.leaves[fn].name}…</div>{bar}</div>
    : flow === "none" ? <div className="kc"><div className="kc-empty">No body to chart for {data.leaves[fn].name}.</div>{bar}</div>
    : <><Canvas testid="flowchart" label="Function flowchart" nodes={fg!.nodes} edges={fg!.edges} selected={sel} onSelect={setSel} fitKey={`fn${fn}`} />{bar}</>
  ) : (
    <><Canvas testid="codemap" label="Code map" nodes={g!.nodes} edges={g!.edges} selected={sel} onSelect={(id) => setSel(id && !id.endsWith("~more") ? id : null)} onOpen={open} fitKey={path.join("/") || "root"} empty="Nothing in this block." />{bar}</>
  );

  return (
    <Workspace id="codemap" testid="codemap-ws" canvas={canvas} tab={tab} onTab={setTab} side={side} closedByDefault tabs={[
      { id: "outline", label: "Outline", icon: Icon.box, count: g?.frames.length, render: () => (
        <div className="ptable" role="grid" aria-label="Outline">
          <div className="pt-row pt-head" role="row"><span>size</span><span>block</span><span>about</span></div>
          {g?.frames.map((f) => { const b = B[f.id.slice(1)]; return (
            <div key={f.id} role="row" className={`pt-row ${sel === f.id ? "on" : ""}`} onClick={() => setSel(f.id)} onDoubleClick={() => open(f.id)}>
              <span className="tnum muted">{b.children.length || b.symbols.length}</span><span className="mono">{b.name}</span><span className="muted">{b.summary}</span>
            </div>); })}
        </div>) },
      { id: "chains", label: "Chains", icon: Icon.flows, count: data.chains.length, render: () => (
        <div className="ptable" role="grid" aria-label="Chains">
          <div className="pt-row pt-head" role="row"><span>len</span><span>entry</span><span>through</span></div>
          {data.chains.slice(0, 200).map((c) => (
            <div key={c.id} role="row" className="pt-row" onClick={() => { const l = data.leaves[c.entry]; if (l?.kind === "fn") setFn(c.entry); }}>
              <span className="tnum muted">{c.len}</span><span className="mono">{data.leaves[c.entry]?.name ?? c.entry}</span><span className="muted">{c.blocks.map((b) => B[b]?.name ?? b).join(" → ")}</span>
            </div>))}
        </div>) },
    ]} />
  );
}
