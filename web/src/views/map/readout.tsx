// MapView readout: the right/foot panel. Block facts as a two-column table
// (label left, value right – the house style): role, theme (when embedded),
// and the chain flow through the block, plus the map stats. The embed chip
// opens the Settings dialog, where the Embeddings section lives (the same
// keydown-"," path the palette uses).

import { useMemo } from "react";
import type { Block, Chain, EmbedState, MapData } from "./types";
import { ROLE_RULES } from "./types";
import { KindIcon, RoleMark } from "./icons";

const EMBED_LABEL: Record<EmbedState, string> = { off: "off", on: "on", stale: "stale" };

/** 12 340 stays 12 340; 8.4e17 saturates to exponent form. */
export function fmt(n: number): string {
  if (n >= 1e15) return n.toExponential(1).replace("e+", "e");
  return n.toLocaleString("en-US");
}

/** A 4-step cohesion bar – the mini bar the sidebar table carries. */
export function MiniBar({ v, label }: { v: number; label: string }) {
  const steps = 4;
  const on = Math.round(v * steps);
  return (
    <span className="fm-minibar" role="img" aria-label={label} title={label}>
      {Array.from({ length: steps }, (_, i) => (
        <i key={i} className={i < on ? "on" : ""} />
      ))}
    </span>
  );
}

/** The chain's subway strip: one stop per step, each clickable into the code panel. */
export function SubwayStrip({ data, chain, onStep }: { data: MapData; chain: Chain; onStep: (id: number | string) => void }) {
  return (
    <ol className="fm-subway" data-testid="map-subway" aria-label="chain steps">
      {chain.steps.map((s, i) => {
        const leaf = typeof s === "number" ? data.leaves[s] : null;
        const loop = typeof s !== "number";
        return (
          <li key={`${s}-${i}`} className="fm-subway-stop">
            <button className={`fm-subway-btn${loop ? " loop" : ""}`} onClick={() => onStep(s)} title={`${i + 1} · ${leaf ? `${leaf.path}:${leaf.line}` : `loop ${s}`}`}>
              {leaf ? <KindIcon kind={leaf.kind} /> : <span className="fm-kind">↻</span>}
              <span className="mono fm-subway-name">{leaf ? leaf.name : `loop ${s}`}</span>
              <span className="fm-subway-n mono">{i + 1}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ChainLine({ famId, label, count, onChoose }: { famId: string; label: string; count: number; onChoose?: (famId: string) => void }) {
  return <button className="sy-t-like" title="select this chain" onClick={() => onChoose?.(famId)}>
    <span className="mono">→ {label}</span><span className="sy-row-meta">{count}</span>
  </button>;
}

export function Readout({ data, block, onLeaf, onFamily }: { data: MapData; block: Block | null; onLeaf: (id: number) => void; onFamily?: (famId: string) => void }) {
  const counts = { fn: 0, class: 0, var: 0, type: 0 } as Record<string, number>;
  let leaves = 0;
  if (block) {
    if (block.children.length === 0) {
      for (const id of block.symbols) {
        const k = data.leaves[id]?.kind;
        if (k) counts[k] = (counts[k] ?? 0) + 1;
      }
      leaves = block.symbols.length;
    } else {
      for (const c of block.children) leaves += data.blocks[c]?.symbols.length ?? 0;
    }
  }

  // Chain flow through the block: the families whose chains cross it, and the
  // chains they carry. Memoised – the family list can be 10^5+ long.
  const flow = useMemo(() => {
    if (!block) return { families: 0, chains: 0, exact: true, maxCount: 0, inW: 0, outW: 0, top: [] as { id: string; label: string; count: number }[] };
    let families = 0, chains = 0, exact = true, inW = 0, outW = 0, maxCount = 0;
    const top: { id: string; label: string; count: number }[] = [];
    const lids = data.leaves;
    for (const f of data.families) {
      if (!f.blocks.includes(block.id)) continue;
      families++;
      chains += f.count;
      maxCount = Math.max(maxCount, f.count);
      if (!f.exact) exact = false;
      // flow in/out: a family's first block feeds in, its last drains out.
      const first = f.blocks[0], last = f.blocks[f.blocks.length - 1];
      if (first === block.id) outW += f.count;
      if (last === block.id) inW += f.count;
      if (top.length < 5 || f.count > top[top.length - 1].count) {
        top.push({ id: f.id, label: `${lids[f.source]?.name ?? f.source} → ${lids[f.terminal]?.name ?? f.terminal}`, count: f.count });
        top.sort((a, b) => b.count - a.count);
        if (top.length > 5) top.length = 5;
      }
    }
    return { families, chains, exact, inW, outW, maxCount, top };
  }, [data, block]);
  const inflow = flow.inW, outflow = flow.outW;
  const weightBar = flow.maxCount ? Math.min(1, Math.log1p(flow.maxCount) / Math.log1p(flow.chains || 1)) : 0;
  const topFams = flow.top;

  return (
    <aside className="sy-readout" data-testid="map-readout" aria-label="MapView readout">
      {block && (
        <>
          <h2 className="mono">{block.name}</h2>
          <p className="sy-summary">{block.summary}</p>
          <table className="sy-t" data-testid="map-block-table">
            <tbody>
              <tr><th>role</th><td title={ROLE_RULES[block.role]} data-testid="map-role-line"><RoleMark role={block.role} /> {block.role}<span className="sy-role-hint"> – {ROLE_RULES[block.role]}</span></td></tr>
              {block.theme && <tr><th>theme</th><td>{block.theme}</td></tr>}
              <tr><th>kind</th><td>{block.kind}</td></tr>
              <tr><th>source</th><td>{block.source}</td></tr>
              <tr><th>files</th><td>{block.files}</td></tr>
              <tr><th>cohesion</th><td><MiniBar v={block.cohesion} label={`cohesion ${(block.cohesion * 100).toFixed(0)}%`} /> {(block.cohesion * 100).toFixed(0)}%</td></tr>
              <tr><th>leaves</th><td>{block.children.length === 0 ? leaves : `${leaves} (one level down)`}</td></tr>
              <tr><th>flow in</th><td>{fmt(inflow)} / <b>out</b> {fmt(outflow)}<MiniBar v={weightBar} label="relative chain flow through this block" /></td></tr>
              <tr><th>families through</th><td>{fmt(flow.families)}</td></tr>
              <tr><th>chains through</th><td>{fmt(flow.chains)}{flow.exact ? "" : " (saturated)"}</td></tr>
              {block.children.length === 0 && (Object.keys(counts) as string[]).map((k) =>
                counts[k] > 0 ? <tr key={k}><th>{k}</th><td>{counts[k]}</td></tr> : null)}
            </tbody>
          </table>
          {topFams.length > 0 && (
            <div className="fm-top-chains" data-testid="map-top-chains">
              <span className="sy-section-label">top chains through</span>
              {topFams.map((f) => <ChainLine key={f.id} famId={f.id} label={f.label} count={f.count} onChoose={onFamily} />)}
            </div>
          )}
        </>
      )}
      <table className="sy-t" data-testid="map-stats-table">
        <tbody>
          <tr><th>build</th><td>{(data.stats.ms / 1000).toFixed(1)}s</td></tr>
          <tr><th>chains</th><td>{fmt(data.stats.chains)}{data.stats.exact ? "" : " (saturated)"}</td></tr>
          <tr><th>families</th><td>{fmt(data.families.length)}</td></tr>
          <tr><th>loops</th><td>{data.loops.filter((l) => l.members.length > 0).length}</td></tr>
          <tr><th>blocks</th><td>{Object.keys(data.blocks).length}</td></tr>
          <tr><th>threads</th><td>{data.stats.threads}</td></tr>
          <tr><th>embedding</th><td>{EMBED_LABEL[data.stats.embed]}</td></tr>
        </tbody>
      </table>
      <button className={`chip-btn sy-embed-chip embed-${data.stats.embed}`} data-testid="map-embed-chip"
        title="Embeddings – Settings (,)" aria-haspopup="dialog"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "," }))}>
        embedding: {EMBED_LABEL[data.stats.embed]} – Settings →
      </button>
      <p className="sy-summary">enable embeddings in Settings to re-form blocks thematically</p>
    </aside>
  );
}
