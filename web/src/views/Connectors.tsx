// Connectors: which agents are wired to this repository and how. Each agent
// (Claude Code, Codex, Cursor…) connects to kula over MCP and its pre-edit
// hook; kula hands every connected agent the repository's workflows. Solid
// wires are live, dashed ones are not set up yet.
import { useEffect, useState } from "react";
import { Icon, Logo } from "../ui";
import Canvas, { type CEdge, type CNode } from "../canvas/Canvas";
import Workspace from "../canvas/Workspace";
import Connect from "./agents/Connect";
import Docs from "./agents/Docs";
import { AgentMark } from "./agents/parts";
import { useAgents } from "./useAgents";
import { Loading } from "./Overview";
import type { Nav } from "./agents/data";

export default function Connectors({ version, onChanged, go }: Nav) {
  const { info, err, act } = useAgents(version, onChanged);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("setup");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  if (err && !info) return <div className="page"><div className="muted">{err}</div></div>;
  if (!info) return <Loading text="Reading connectors…" />;

  const cs = info.connections, wfs = info.workflows;
  const H = 70, GAP = 20;
  const colY = (n: number, i: number, h = H) => i * (h + GAP) - ((n - 1) * (h + GAP)) / 2;
  const nodes: CNode[] = [
    ...cs.map((c, i): CNode => ({ id: `c:${c.id}`, x: 0, y: colY(cs.length, i), w: 210, h: H, icon: <AgentMark id={c.id} size={14} />, title: c.name, label: c.name,
      sub: c.mcp && c.hook ? "MCP and hook" : c.mcp ? "MCP only" : c.hook ? "hook only" : "not connected", tone: c.mcp && c.hook ? "ok" : "muted",
      badge: info.default_agent === c.id ? "default" : undefined })),
    { id: "kula", x: 330, y: -55, w: 200, h: 110, icon: <Logo size={14} />, title: "kula", label: "kula", tone: "accent",
      sub: info.mcp_registered ? "MCP server registered" : "MCP server not registered", body: <span>{info.hook_installed ? "git hooks installed" : "git hooks missing"}</span> },
    ...wfs.map((w, i): CNode => ({ id: `w:${w.name}`, x: 650, y: colY(wfs.length, i, 50), w: 190, h: 50, icon: <Icon.workflow />, title: w.name, label: w.name, sub: w.about })),
  ];
  const edges: CEdge[] = [
    ...cs.map((c): CEdge => ({ id: `c:${c.id}>kula`, from: `c:${c.id}`, to: "kula", label: c.mcp ? "mcp" : undefined, dashed: !(c.mcp && c.hook), tone: c.mcp && c.hook ? "ok" : undefined })),
    ...wfs.map((w): CEdge => ({ id: `kula>w:${w.name}`, from: "kula", to: `w:${w.name}` })),
  ];
  const c = sel?.startsWith("c:") ? cs.find((x) => x.id === sel.slice(2)) : null;
  const w = sel?.startsWith("w:") ? wfs.find((x) => x.name === sel.slice(2)) : null;
  const side = c ? {
    title: c.name, sub: c.docs, icon: <AgentMark id={c.id} size={16} />, onClose: () => setSel(null),
    body: <div className="side-sections">
      <section><h3>Wiring</h3><dl className="kv"><div><dt>MCP</dt><dd>{c.mcp ? "connected" : "missing"}</dd></div><div><dt>Hook</dt><dd>{c.hook ? "installed" : "missing"}</dd></div><div><dt>Reads</dt><dd className="mono">{c.docs}</dd></div></dl></section>
      <section><h3>Files it writes</h3>{c.files.map((f) => <div key={f} className="mono muted">{f}</div>)}</section>
      {!!c.workflows.length && <section><h3>Workflows</h3><div className="side-chips">{c.workflows.map((x) => <button key={x} className="tag" onClick={() => setSel(`w:${x}`)}>{x}</button>)}</div></section>}
    </div>,
    actions: <><button className={`btn sm ${c.mcp && c.hook ? "" : "primary"}`} onClick={() => act("connect", { agent: c.id }, `${c.name} connected`).catch(() => {})}><Icon.plug /> {c.mcp && c.hook ? "Rewrite" : "Connect"}</button></>,
  } : w ? {
    title: w.name, sub: w.about, icon: <Icon.workflow />, onClose: () => setSel(null),
    body: <dl className="kv"><div><dt>Scope</dt><dd className="mono">{w.scope?.join(", ") || "whole repo"}</dd></div><div><dt>Locked</dt><dd className="mono">{w.lock?.join(", ") || "–"}</dd></div><div><dt>Hidden</dt><dd className="mono">{w.hide?.join(", ") || "–"}</dd></div><div><dt>Memory</dt><dd>{w.memory || "write"}</dd></div></dl>,
    actions: <button className="btn sm" onClick={() => go?.("agents", { tab: "workflows" })}><Icon.workflow /> Edit in Agents</button>,
  } : sel === "kula" ? {
    title: "kula", sub: "the repository's MCP server and hooks", icon: <Logo size={16} />, onClose: () => setSel(null),
    body: <dl className="kv"><div><dt>MCP</dt><dd>{info.mcp_registered ? "registered" : "not registered"}</dd></div><div><dt>Git hooks</dt><dd>{info.hook_installed ? "installed" : "missing"}</dd></div><div><dt>kula.toml</dt><dd>{info.kula_toml ? "present" : "absent"}</dd></div><div><dt>Default agent</dt><dd>{info.default_agent ?? "–"}</dd></div></dl>,
    actions: !info.hook_installed ? <button className="btn sm primary" onClick={() => act("hooks_install", {}, "git hooks installed").catch(() => {})}>Install hooks</button> : undefined,
  } : null;

  return (
    <Workspace id="connectors" testid="connectors" side={side} tab={tab} onTab={setTab}
      canvas={<Canvas testid="connectors-canvas" label="Connectors canvas" nodes={nodes} edges={edges} selected={sel} onSelect={(id) => { setSel(id); if (id?.startsWith("c:")) setTab("table"); }} fitKey="connectors" />}
      tabs={[
        { id: "setup", label: "Setup", icon: Icon.plug, render: () => <div className="page agents"><Connect info={info} act={act} /></div> },
        { id: "table", label: "Connectors", icon: Icon.agents, count: cs.length, render: () => (
          <div className="ptable" role="grid" aria-label="Connectors">
            <div className="pt-row pt-head"><span>state</span><span>agent</span><span>reads</span></div>
            {cs.map((x) => <div key={x.id} data-row={`c:${x.id}`} className={`pt-row ${sel === `c:${x.id}` ? "on" : ""}`} onClick={() => setSel(`c:${x.id}`)}>
              <span className={x.mcp && x.hook ? "" : "muted"}>{x.mcp && x.hook ? "live" : "off"}</span><span className="row" style={{ gap: 6 }}><AgentMark id={x.id} size={12} />{x.name}</span><span className="muted mono">{x.docs}</span></div>)}
          </div>) },
        { id: "docs", label: "Docs", icon: Icon.doc, render: () => <div className="page agents"><Docs info={info} act={act} /></div> },
      ]} />
  );
}
