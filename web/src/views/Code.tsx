// Code: the codebase as modules on the canvas (directories wired by the calls
// and imports between them; a loop where two depend on each other), or as
// symbols in the full graph. The pane holds the working tree, history,
// branches, query and console; picking a module filters its files into the
// sidebar and lights the commits that touched it.
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type GraphData } from "../api";
import { Icon } from "../ui";
import { useCode } from "../CodePanel";
import { build } from "../Coupling";
import { groupDirs } from "../colors";
import Canvas, { layered, type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import type { Go, View } from "../nav";

const Changes = lazy(() => import("./GitViews").then((m) => ({ default: m.Changes })));
const History = lazy(() => import("./GitViews").then((m) => ({ default: m.History })));
const Branches = lazy(() => import("./GitViews").then((m) => ({ default: m.Branches })));
const Console = lazy(() => import("./GitViews").then((m) => ({ default: m.Console })));
const Query = lazy(() => import("./Query"));

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go: Go; target: import("../nav").Target };
const PANES: { id: View; label: string; icon: () => React.ReactElement }[] = [
  { id: "changes", label: "Working tree", icon: Icon.changes },
  { id: "history", label: "History", icon: Icon.history },
  { id: "branches", label: "Branches", icon: Icon.branches },
  { id: "query", label: "Query", icon: Icon.query },
  { id: "console", label: "Console", icon: Icon.console },
];
let lastPane: View = "changes";

export default function Code({ view, graph, nav }: { view: View; graph?: ReactNode; nav: Nav }) {
  const [g, setG] = useState<GraphData | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const code = useCode();
  const symbols = view === "graph";
  const [gpane, setGpane] = useState<View>(lastPane);
  const pane = symbols ? gpane : view;
  useEffect(() => { if (!symbols) lastPane = view; }, [view, symbols]);
  useEffect(() => { if (!symbols) api.graph("symbol").then(setG).catch(() => {}); }, [symbols, nav.version]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);

  const model = useMemo(() => (g ? build(g) : null), [g]);
  const files = useMemo(() => {
    if (!g) return new Map<string, string[]>();
    const code = g.nodes.filter((n) => n.kind !== "package");
    const groups = groupDirs(code.map((n) => n.path), 0);
    const m = new Map<string, Set<string>>();
    for (const n of code) { const d = groups.of(n.path); if (!m.has(d)) m.set(d, new Set()); m.get(d)!.add(n.path); }
    return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
  }, [g]);

  const { nodes, edges } = useMemo(() => {
    if (!model) return { nodes: [] as CNode[], edges: [] as CEdge[] };
    const ids = model.dirs.map((d) => d.key);
    const links: [string, string][] = [];
    const edges: CEdge[] = [];
    const loop = new Set(model.loops.map(([a, b]) => `${a}:${b}`));
    model.m.forEach((row, i) => row.forEach((v, j) => {
      if (i === j || !v) return;
      // draw each pair once, in its heavier direction
      if (model.m[j][i] > v || (model.m[j][i] === v && j < i)) return;
      links.push([ids[i], ids[j]]);
      const l = loop.has(`${Math.min(i, j)}:${Math.max(i, j)}`);
      edges.push({ id: `${ids[i]}>${ids[j]}`, from: ids[i], to: ids[j], label: l ? `${v} ⇄ ${model.m[j][i]}` : String(v), tone: l ? "warn" : undefined });
    }));
    const pos = layered(ids, links, () => ({ w: 200, h: 78 }), { x: 110, y: 28 });
    const nodes = model.dirs.map((d): CNode => ({
      id: d.key, ...pos.get(d.key)!, w: 200, h: 78, icon: <Icon.box />, title: d.label, label: d.label, sub: `${d.files} files`,
      body: <span className="tnum">in {d.fanIn} · out {d.fanOut} · inside {d.inside}</span>,
    }));
    return { nodes, edges };
  }, [model]);

  const d = model?.dirs.find((x) => x.key === sel);
  const side = d ? {
    title: d.label, sub: `${d.files} files · ${d.inside} calls inside`, icon: <Icon.box />, onClose: () => setSel(null),
    body: <div className="side-sections">
      <section><h3>Dependencies</h3><dl className="kv"><div><dt>Called by</dt><dd>{d.fanIn}</dd></div><div><dt>Calls out</dt><dd>{d.fanOut}</dd></div><div><dt>Inside</dt><dd>{d.inside}</dd></div></dl></section>
      <section><h3>Files <span className="muted tnum">{files.get(d.key)?.length ?? 0}</span></h3>{(files.get(d.key) ?? []).slice(0, 40).map((p) => <button key={p} className="side-link" onClick={() => code.open({ path: p })}><Icon.doc /><span className="mono">{p}</span></button>)}</section>
    </div>,
    actions: <><button className="btn sm" onClick={() => nav.go("graph", { search: d.key })}><Icon.graph /> Show symbols</button><button className="btn sm ghost" onClick={() => nav.go("history")}><Icon.history /> History</button></>,
  } : null;

  const mode = (
    <div className="kc-pick" role="group" aria-label="Canvas">
      <button className={`btn sm ${!symbols ? "on" : "ghost"}`} aria-pressed={!symbols} data-tip="Modules: directories and their calls" onClick={() => nav.go(lastPane)}><Icon.box /> Modules</button>
      <button className={`btn sm ${symbols ? "on" : "ghost"}`} aria-pressed={symbols} data-tip="Symbols: the full call graph" onClick={() => nav.go("graph")}><Icon.graph /> Symbols</button>
    </div>
  );
  const canvas = symbols
    ? <div className="code-graph">{graph}{mode}</div>
    : <><Canvas testid="code-canvas" label="Modules canvas" nodes={nodes} edges={edges} selected={sel} onSelect={setSel} fitKey="modules" empty={g ? "No modules indexed yet." : "Reading the graph…"} />{mode}</>;

  const p = { onChanged: nav.onChanged, openSymbol: nav.openSymbol, version: nav.version, go: nav.go, target: nav.target };
  return (
    <Workspace id={symbols ? "code-graph" : "code"} testid="code" canvas={canvas} side={side} tab={pane} paneTall={!symbols} closedByDefault={symbols}
      onTab={(t) => (symbols ? setGpane(t as View) : nav.go(t as View))}
      tabs={PANES.map((x) => ({ ...x, render: () => <Suspense fallback={<div className="view-loading">loading…</div>}>
        {x.id === "changes" && <Changes {...p} />}{x.id === "history" && <History {...p} />}{x.id === "branches" && <Branches {...p} />}
        {x.id === "query" && <Query {...p} />}{x.id === "console" && <Console {...p} />}
      </Suspense> }))} />
  );
}
