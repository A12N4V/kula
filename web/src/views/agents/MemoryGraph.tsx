// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Memory graph (module M1, rebuilt on the flow canvas in A3): every agent
// memory a circle node on the shared canvas, anchored to what it is about
// (file, symbol, commit, repo), with edges to other memories sharing an anchor
// and to the symbols a [[link]] names. Scope layers (task / workflow / repo)
// draw as group frames; a stale memory carries the error corner mark. The DOM
// inventory under the graph (m1-node) is what the legend numbers key off and
// what clicks, hover text and the e2e hooks read – one truth, two views.

import { useEffect, useMemo, useState } from "react";
import { api, type Memory, type MemoryLayer } from "../../api";
import { FlowCanvas, FlowSidebar } from "../../flow";
import { linksOf } from "../NotesGraph";

const LAYERS = ["task", "workflow", "repo"] as const;
const ANCHOR_GLYPH: Record<string, string> = { repo: "◎", file: "F", symbol: "ƒ", commit: "C" };

const strip = (author: string) => author.replace(/^(agent|user):/, "");
const KIND = (t: string) => (t === "repo" ? "repo" : t.split(":")[0]);

export function MemoryGraph({ mems, allMems, sel, onPickMem, onOpen }: {
  mems: Memory[]; allMems: Memory[]; sel: number; onPickMem: (idx: number) => void; onOpen: (target: string) => void;
}) {
  const [layers, setLayers] = useState<MemoryLayer[]>([]);
  // Layers are derived at read time on the server; refetch when the set of all
  // memories changes (remember / forget / still-true all change ids or stale) –
  // the unfiltered set, not the filtered view: layer data is per memory, not
  // per view, so filter keystrokes must not refetch. On failure the previous
  // layers stay, so the legend never silently recounts every row as repo.
  const allIds = allMems.map((m) => m.id).join(",");
  useEffect(() => { api.memoryLayers().then(setLayers).catch(() => {}); }, [allIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const layerOf = (m: Memory) => layers.find((l) => l.id === m.id);

  const built = useMemo(() => {
    const nodes = [], edges = [];
    const seen = new Set<string>();
    const anchorsCovered = new Set<string>();
    const perLayer: Record<string, number> = { task: 0, workflow: 0, repo: 0 };
    const perStale: Record<string, number> = { task: 0, workflow: 0, repo: 0 };
    const byAnchor = new Map<string, string[]>();
    const short = (t: string) => { const s = t.replace(/^(file|symbol|commit):/, ""); return s.length > 26 ? "…" + s.slice(-25) : s; };
    const anchor = (t: string) => {
      if (seen.has(t)) return;
      seen.add(t);
      nodes.push({
        id: t, kind: "circle" as const, title: t === "repo" ? "repo" : short(t),
        subtitle: t === "repo" ? undefined : KIND(t),
        color: t === "repo" ? "var(--accent)" : "var(--text-2)",
        icon: ANCHOR_GLYPH[KIND(t)] ?? "·",
      });
      if (t !== "repo") edges.push({ id: `a:${t}`, source: t, target: "repo", main: false });
    };
    nodes.push({ id: "repo", kind: "circle" as const, title: "repo", color: "var(--accent)", icon: ANCHOR_GLYPH.repo, noOut: true });
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
        id: `mem:${m.id}`, kind: "circle" as const, parent: `scope:${scope}`, title: `#${m.id}`, subtitle: m.body.slice(0, 24),
        // Stale memories carry the error corner mark, not a second legend.
        status: m.stale ? ("error" as const) : undefined,
        color: m.stale ? "var(--yellow)" : "var(--accent)",
        // The hover text the inventory chip carried now lives on the node.
        icon: (
          <span className="m1-node-glyph" title={`${m.body} – ${agent} · ${commit || "no commit"} · ${scope} layer`}>{m.id}</span>
        ),
      });
      edges.push({ id: `m:${m.id}`, source: `mem:${m.id}`, target: m.target, main: false });
      if (m.target !== "repo") anchor(m.target);
      for (const link of linksOf(m.body)) { const t = link.includes(":") ? link : `symbol:${link}`; anchor(t); edges.push({ id: `l:${m.id}:${t}`, source: `mem:${m.id}`, target: t, main: false }); }
    }
    // Memories that share an anchor hold each other up: one quiet edge per pair.
    for (const holders of byAnchor.values())
      for (let i = 0; i < holders.length; i++)
        for (let j = i + 1; j < holders.length; j++)
          edges.push({ id: `h:${holders[i]}:${holders[j]}`, source: holders[i], target: holders[j], main: false });
    return { nodes, edges, perLayer, perStale, anchorsCovered: anchorsCovered.size, stale: mems.filter((m) => m.stale).length };
    // layerOf closes over layers; the allIds key covers it.
  }, [mems, allIds, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  // One group frame per scope layer, framing its memories.
  const groups = useMemo(() => {
    const per = new Map<string, string[]>();
    for (const m of mems) {
      const scope = layerOf(m)?.scope ?? "repo";
      per.set(scope, [...(per.get(scope) ?? []), `mem:${m.id}`]);
    }
    return [...per.entries()].map(([scope, members]) => ({ id: `scope:${scope}`, label: scope, members }));
  }, [mems, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const selId = sel >= 0 && mems[sel] ? `mem:${mems[sel].id}` : null;
  const selMem = sel >= 0 ? mems[sel] : undefined;
  const selLayer = selMem ? layerOf(selMem) : undefined;
  const pick = (id: string) => {
    if (id.startsWith("mem:")) { const i = mems.findIndex((m) => `mem:${m.id}` === id); if (i >= 0) onPickMem(i); }
    else onOpen(id);
  };
  const label = `Memory graph: ${mems.length} memories on ${built.anchorsCovered} anchors`;

  const sidebar = (
    <FlowSidebar
      title={selMem ? `#${selMem.id}` : selId ? "anchor" : "memory graph"}
      desc={selMem ? selMem.body.replace(/\s+/g, " ") : "every agent memory, on the layer it lives in, anchored to what it is about"}
      kv={selMem ? [
        ["target", selMem.target],
        ["author", selLayer?.agent ?? strip(selMem.author)],
        ["commit", selLayer?.commit || "no commit"],
        ["layer", `${selLayer?.scope ?? "repo"}${selLayer?.scope_name ? `:${selLayer.scope_name}` : ""}`],
        ["state", selMem.stale ? "stale – superseded or code moved" : "still true"],
      ] : undefined}
      related={selMem ? undefined : <span className="muted">pick a memory to read it; pick an anchor to open it</span>}
    />
  );

  return (
    <div className="m1-graph" data-testid="memory-graph">
      {/* The counts read without a canvas: this label is the graph's name. */}
      <svg className="m1-a11y" role="img" aria-label={label} data-figure />
      <FlowCanvas nodes={built.nodes} edges={built.edges} groups={groups}
        selection={selId} onSelect={(id) => (id ? pick(id) : onPickMem(-1))}
        layoutKey="memory-graph" ns="agents-memory" sidebar={sidebar} testId="memory-canvas" />
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