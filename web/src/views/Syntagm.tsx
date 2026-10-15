// Syntagm – code as blocks and chains. Route #/syntagm (deep link
// #syntagm/<blockId> drills straight to a block). Three regions: a resizable
// sidebar (chains + block tree, virtualised), the nested-box canvas with
// breadcrumb and chain path, and the readout table with the embed chip.
// Data comes from GET /api/syntagm when B1's API is live; until then the
// fixture (same shapes) stands in, so the swap is a one-line change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useCode } from "../CodePanel";
import { Grip, listWidth } from "../resize";
import { fixture } from "./syntagm/fixture";
import { BlockCanvas } from "./syntagm/canvas";
import { Readout } from "./syntagm/readout";
import { SyntagmSidebar } from "./syntagm/sidebar";
import type { Chain, SyntagmData } from "./syntagm/types";

// The view owns its own sidebar visibility on phones (390 px): a drawer.
export default function Syntagm({ block }: { openSymbol?: (id: number) => void; version?: number; block?: string }) {
  const [data, setData] = useState<SyntagmData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [chainId, setChainId] = useState<string | null>(null);
  const [selLeaf, setSelLeaf] = useState<number | null>(null);
  const [openRoot, setOpenRoot] = useState<string[]>([]);
  const [side, setSide] = useState(false); // phone drawer
  const code = useCode();
  const rootRef = useRef<HTMLDivElement>(null);

  // Live API first; the fixture stands in until B1 lands (or if it errors).
  // The API lists blocks (contract JSON); the view indexes them by id, so
  // key them once – the fixture already has the Record shape.
  useEffect(() => {
    let dead = false;
    api.syntagm()
      .then((d) => {
        if (dead) return;
        if (Array.isArray(d.blocks)) {
          // The API's block list is flat (depth-0 sections carry parent null);
          // the view hangs everything off a synthetic root, like the
          // fixture's b0 node.
          const root: SyntagmData["blocks"][string] = {
            id: "__root", parent: null, depth: 0, name: "repo", summary: "whole repo",
            kind: "section", symbols: [], children: [], files: 0, cohesion: 1, source: "graph",
          };
          const byId: SyntagmData["blocks"] = { __root: root };
          for (const b of d.blocks) {
            if (b.parent === null && b.depth === 0) { b.parent = "__root"; root.children.push(b.id); }
            byId[b.id] = b;
          }
          setData({ ...d, blocks: byId });
        } else setData(d);
      })
      .catch(() => { if (!dead) setData(fixture); });
    return () => { dead = true; };
  }, []);

  // The deep link arrives as the shell's target.block (the shell owns the
  // hash – the lazy view mounts after its URL sync has run, so reading
  // location.hash here would already be too late). Seed once per new target.
  const [seeded, setSeeded] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (block === seeded) return;
    setSeeded(block);
    setPath(block ? [block] : []);
  }, [block, seeded]);
  // If the fixture is in use, the deep link has to wait for it.
  useEffect(() => {
    if (!data) return;
    if (path.length && !data.blocks[path[0]]) setPath([]);
    if (!openRoot.length) {
      setOpenRoot(Object.values(data.blocks).filter((b) => b.depth === 0).map((b) => b.id));
    }
  }, [data, path, openRoot]);

  const drill = useCallback((id: string) => {
    setPath((p) => {
      // Clicking an open ancestor pops back to it; a new block descends.
      const at = p.indexOf(id);
      const next = at >= 0 ? p.slice(0, at + 1) : [...p, id];
      if (`#syntagm/${next.join("/")}` !== location.hash) history.replaceState(null, "", `#syntagm/${next.join("/")}`);
      return next;
    });
  }, []);
  const home = useCallback(() => { setPath([]); history.replaceState(null, "", "#syntagm"); }, []);

  const chain: Chain | null = useMemo(
    () => (chainId ? data?.chains.find((c) => c.id === chainId) ?? null : null),
    [data, chainId],
  );

  // The block the readout describes: the drilled block, or the chain's entry block.
  const readBlock = useMemo(() => {
    if (!data) return null;
    if (path.length) return data.blocks[path[path.length - 1]] ?? null;
    const root = Object.values(data.blocks).find((b) => b.parent === null);
    if (root) return root;
    if (chain) {
      const leafBlock = [...chain.blocks].reverse().find((b) => data.blocks[b]);
      return leafBlock ? data.blocks[leafBlock] : null;
    }
    return null;
  }, [data, path, chain]);

  const selectChain = useCallback((c: Chain) => {
    setChainId(c.id === chainId ? null : c.id);
    setSelLeaf(null);
  }, [chainId]);

  const selectLeaf = useCallback((id: number) => {
    setSelLeaf(id);
    const l = data?.leaves[id];
    // CodePanel is a shell-level overlay – opening it here keeps the user in
    // Syntagm (openSymbol would bounce the tab to Graph).
    if (l) code.open({ path: l.path, line: l.line, name: l.name, kind: l.kind as never, id });
  }, [data, code]);

  const toggle = useCallback((id: string) => {
    setOpenRoot((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  }, []);

  if (!data) {
    return <div className="sy-root"><div className="view-loading" aria-live="polite">{err ?? "loading syntagm…"}</div></div>;
  }

  return (
    <div className="sy-root" ref={rootRef} data-testid="syntagm-view">
      <button className="btn sm sy-side-toggle" aria-expanded={side} aria-controls="syntagm-sidebar"
        onClick={() => setSide((s) => !s)} data-testid="syntagm-side-toggle">Chains & blocks</button>
      <div className="sy-split" style={listWidth("syntagm", 320)}>
        <div className={`sy-side-wrap${side ? " open" : ""}`}>
          <SyntagmSidebar
            blocks={data.blocks} chains={data.chains} leaves={data.leaves}
            selChain={chainId} selLeaf={selLeaf} openRoot={openRoot}
            onChain={selectChain} onLeaf={selectLeaf} onToggle={toggle} onZoom={drill}
            onClose={() => setSide(false)}
          />
        </div>
        <Grip id="syntagm" edge="right" target="prev" min={220} max={720} label="Resize sidebar" />
        {side && <div className="sy-scrim" onClick={() => setSide(false)} aria-hidden="true" />}
        <BlockCanvas blocks={data.blocks} leaves={data.leaves} chain={chain} path={path} onDrill={drill} onLeaf={selectLeaf} onHome={home} />
        <div className="sy-readout-wrap">
          <Readout data={data} block={readBlock} onLeaf={selectLeaf} />
        </div>
      </div>
    </div>
  );
}
