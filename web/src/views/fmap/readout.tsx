// Fmap readout: the right/foot panel. Block facts as a two-column table
// (label left, value right – the house style): role, theme (when embedded),
// and the chain flow through the block, plus the map stats. The embed chip
// opens the Settings dialog, where the Embeddings section lives (the same
// keydown-"," path the palette uses).

import { useMemo } from "react";
import type { Block, EmbedState, MapData } from "./types";
import { ROLE_RULES } from "./types";

const EMBED_LABEL: Record<EmbedState, string> = { off: "off", on: "on", stale: "stale" };

/** 12 340 stays 12 340; 8.4e17 saturates to exponent form. */
function fmt(n: number): string {
  if (n >= 1e15) return n.toExponential(1).replace("e+", "e");
  return n.toLocaleString("en-US");
}

export function Readout({ data, block, onLeaf }: { data: MapData; block: Block | null; onLeaf: (id: number) => void }) {
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
    if (!block) return { families: 0, chains: 0, exact: true };
    let families = 0, chains = 0, exact = true;
    for (const f of data.families) {
      if (!f.blocks.includes(block.id)) continue;
      families++;
      chains += f.count;
      if (!f.exact) exact = false;
    }
    return { families, chains, exact };
  }, [data.families, block]);

  return (
    <aside className="sy-readout" data-testid="fmap-readout" aria-label="Fmap readout">
      {block && (
        <>
          <h2 className="mono">{block.name}</h2>
          <p className="sy-summary">{block.summary}</p>
          <table className="sy-t" data-testid="fmap-block-table">
            <tbody>
              <tr><th>role</th><td title={ROLE_RULES[block.role]}>{block.role}</td></tr>
              {block.theme && <tr><th>theme</th><td>{block.theme}</td></tr>}
              <tr><th>kind</th><td>{block.kind}</td></tr>
              <tr><th>source</th><td>{block.source}</td></tr>
              <tr><th>files</th><td>{block.files}</td></tr>
              <tr><th>cohesion</th><td>{(block.cohesion * 100).toFixed(0)}%</td></tr>
              <tr><th>leaves</th><td>{block.children.length === 0 ? leaves : `${leaves} (one level down)`}</td></tr>
              <tr><th>families through</th><td>{fmt(flow.families)}</td></tr>
              <tr><th>chains through</th><td>{fmt(flow.chains)}{flow.exact ? "" : " (saturated)"}</td></tr>
              {block.children.length === 0 && (Object.keys(counts) as string[]).map((k) =>
                counts[k] > 0 ? <tr key={k}><th>{k}</th><td>{counts[k]}</td></tr> : null)}
            </tbody>
          </table>
        </>
      )}
      <table className="sy-t" data-testid="fmap-stats-table">
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
      <button className={`chip-btn sy-embed-chip embed-${data.stats.embed}`} data-testid="fmap-embed-chip"
        title="Embeddings – Settings (,)" aria-haspopup="dialog"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "," }))}>
        embedding: {EMBED_LABEL[data.stats.embed]} – Settings →
      </button>
      <p className="sy-summary">enable embeddings in Settings to re-form blocks thematically</p>
    </aside>
  );
}
