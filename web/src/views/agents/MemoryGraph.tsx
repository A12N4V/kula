// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Memory graph (module M1): every agent memory a node, sitting on the layer it
// lives in (task / workflow / repo, from K2's memory_layers – the layer draws
// the ring, the territory it sits on), anchored to what it is about (file,
// symbol, commit, repo), with edges to other memories sharing an anchor and to
// the symbols a [[link]] names. Drawn on MiniGraph – the same renderer, seeded
// layout and territories as the codebase map and the notes graph; reused, not
// forked. Stale memories render hollow: the canvas fades their disc toward the
// ground, and each node also has a DOM counterpart under the graph (class
// m1-node, stale ones .stale) – that inventory is what the legend numbers key
// off and what clicks, hover text and the e2e hooks read. Hovering shows body,
// author agent, commit and layer; clicking a memory selects it in the list.

import { useEffect, useMemo, useState } from "react";
import { api, type Memory, type MemoryLayer } from "../../api";
import { cssVar, withAlpha } from "../../graphfx";
import { MiniGraph, type MiniEdge, type MiniNode } from "../MiniGraph";
import { linksOf } from "../NotesGraph";

const KIND = (t: string) => (t === "repo" ? "repo" : t.split(":")[0]);
const KCOLOR: Record<string, string> = { repo: "--accent", file: "--blue", symbol: "--violet", commit: "--yellow" };
const GLYPH: Record<string, string> = { repo: "◎", file: "F", symbol: "ƒ", commit: "C" };
const LAYERS = ["task", "workflow", "repo"] as const;

const strip = (author: string) => author.replace(/^(agent|user):/, "");

export function MemoryGraph({ mems, sel, onPickMem, onOpen }: {
  mems: Memory[]; sel: number; onPickMem: (idx: number) => void; onOpen: (target: string) => void;
}) {
  const [layers, setLayers] = useState<MemoryLayer[]>([]);
  // Layers are derived at read time on the server; refetch when the set of
  // memories changes (remember / forget / still-true all change ids or stale).
  const ids = mems.map((m) => m.id).join(",");
  useEffect(() => { api.memoryLayers().then(setLayers).catch(() => {}); }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const layerOf = (m: Memory) => layers.find((l) => l.id === m.id);

  const built = useMemo(() => {
    const nodes: MiniNode[] = [], edges: MiniEdge[] = [];
    const seen = new Set<string>();
    const anchorsCovered = new Set<string>();
    const perLayer: Record<string, number> = { task: 0, workflow: 0, repo: 0 };
    const perStale: Record<string, number> = { task: 0, workflow: 0, repo: 0 };
    const byAnchor = new Map<string, string[]>();
    const short = (t: string) => { const s = t.replace(/^(file|symbol|commit):/, ""); return s.length > 26 ? "…" + s.slice(-25) : s; };
    const target = (t: string) => {
      if (seen.has(t)) return;
      seen.add(t);
      const k = KIND(t);
      nodes.push({ id: t, label: t === "repo" ? "repo" : short(t), color: cssVar(KCOLOR[k] ?? "--text-2") || cssVar("--text-2"), size: 9, group: k === "repo" ? undefined : k, hub: true, glyph: GLYPH[k] ?? "·" });
      if (t !== "repo") edges.push({ source: t, target: "repo", color: cssVar("--line-2") });
    };
    nodes.push({ id: "repo", label: "repo", color: cssVar("--accent"), size: 14, hub: true, glyph: "◎" });
    seen.add("repo");
    for (const m of mems) {
      const l = layerOf(m);
      const scope = l?.scope ?? "repo";
      const agent = l?.agent ?? strip(m.author);
      const commit = l?.commit ?? "";
      perLayer[scope] = (perLayer[scope] ?? 0) + 1;
      if (m.stale) perStale[scope] = (perStale[scope] ?? 0) + 1;
      if (m.target !== "repo") anchorsCovered.add(m.target);
      byAnchor.set(m.target, [...(byAnchor.get(m.target) ?? []), `mem:${m.id}`]);
      // Hover (and the chip title) reads this line: layer · agent · commit · body.
      const label = `${scope}${l?.scope_name ? `:${l.scope_name}` : ""} · ${agent}${commit ? ` · ${commit}` : ""} · ${m.body.replace(/\s+/g, " ").slice(0, 34)}`;
      nodes.push({
        id: `mem:${m.id}`, label,
        // Hollow: a stale memory is the same node with its fill faded toward
        // the ground – the DOM inventory below carries the .stale class.
        color: m.stale ? withAlpha(cssVar("--yellow"), 0.3) : cssVar("--accent"),
        size: 5, group: scope,
      });
      edges.push({ source: `mem:${m.id}`, target: m.target, color: cssVar("--text-3") });
      if (m.target !== "repo") target(m.target);
      for (const link of linksOf(m.body)) { const t = link.includes(":") ? link : `symbol:${link}`; target(t); edges.push({ source: `mem:${m.id}`, target: t, color: cssVar("--accent"), flow: true }); }
    }
    // Memories that share an anchor hold each other up: one quiet edge per pair.
    for (const holders of byAnchor.values())
      for (let i = 0; i < holders.length; i++)
        for (let j = i + 1; j < holders.length; j++)
          edges.push({ source: holders[i], target: holders[j], color: cssVar("--line-2") });
    return { nodes, edges, perLayer, perStale, anchorsCovered: anchorsCovered.size, stale: mems.filter((m) => m.stale).length };
    // layerOf closes over layers; the ids key covers it.
  }, [mems, ids, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => {
    if (id.startsWith("mem:")) { const i = mems.findIndex((m) => `mem:${m.id}` === id); if (i >= 0) onPickMem(i); }
    else onOpen(id);
  };

  return (
    <div className="m1-graph" data-testid="memory-graph">
      <MiniGraph nodes={built.nodes} edges={built.edges}
        sel={sel >= 0 && mems[sel] ? `mem:${mems[sel].id}` : undefined}
        onPick={pick} groupLabel={(k) => (LAYERS.includes(k as typeof LAYERS[number]) ? `${k}` : `${k}s`)}
        label={`Memory graph: ${mems.length} memories on ${built.anchorsCovered} anchors`} />
      <div className="m1-under">
        <table className="m1-legend-t" aria-label="Memory graph numbers">
          <thead><tr><th>layer</th><th>memories</th><th>stale</th></tr></thead>
          <tbody>
            {LAYERS.map((k) => (
              <tr key={k}><th scope="row">{k}</th><td>{built.perLayer[k]}</td><td>{built.perStale[k]}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">anchors covered</th><td>{built.anchorsCovered}</td><td>{built.stale} hollow</td></tr></tfoot>
        </table>
        <ul className="m1-inventory" aria-label="Memory nodes">
          {mems.map((m, i) => {
            const l = layerOf(m);
            const scope = l?.scope ?? "repo";
            return (
              <li key={m.id}>
                <button className={`m1-node ${m.stale ? "stale" : ""}${i === sel ? " sel" : ""}`} data-mem={m.id} data-idx={i}
                  title={`${m.body} – ${l?.agent ?? strip(m.author)} · ${l?.commit || "no commit"} · ${scope} layer`}
                  onClick={() => onPickMem(i)}>#{m.id}</button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default MemoryGraph;
