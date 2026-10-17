// MapView – code as blocks and chains, on the map. Route #/map (deep link
// #map/<blockId> drills straight to a block). Three regions: a resizable
// sidebar (chain families + block tree, virtualised), the nested-box canvas
// with breadcrumb, role glyphs and chain path, and the readout table.
// Data comes from GET /api/map in one payload; the lens (Functions /
// Utilities / All) and the role filter are client-side, so switching is
// instant. While the map runs, /api/map/progress drives the progress state –
// never an empty view. Until M1's API lands, the fixture (same shapes) stands
// in, so the swap is a one-line change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useCode } from "../CodePanel";
import { Grip, listWidth } from "../resize";
import { fixture } from "./map/fixture";
import { BlockCanvas } from "./map/canvas";
import { Readout, SubwayStrip } from "./map/readout";
import { MapViewSidebar } from "./map/sidebar";
import { FlowKitView, CapsKitView } from "./map/flowKit";
import { ChainsStrips } from "./map/caps";
import { ProgressStrip, useMapProgress } from "./map/progress";
import { focusOf } from "./map/chainFocus";
import type { Chain, ChainPage, Lens, MapData, MapProgress, Role } from "./map/types";
import { LENS_ROLES, ROLES, ROLE_RULES } from "./map/types";

const PROGRESS_LABEL: Record<string, string> = {
  idle: "idle", load: "loading graph", graph: "building graph", similarity: "measuring similarity",
  map: "mapping", done: "done", error: "failed",
};
// The run reports phases as strings – the bar's percent follows the phase list.
const PHASES = ["load", "graph", "similarity", "map", "done"];

// The view owns its own sidebar visibility on phones (390 px): a drawer.
export default function MapView({ block }: { openSymbol?: (id: number) => void; version?: number; block?: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [prog, setProg] = useState<MapProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [selChain, setSelChain] = useState<Chain | null>(null);
  const [selLeaf, setSelLeaf] = useState<number | null>(null);
  const [openRoot, setOpenRoot] = useState<string[]>([]);
  const [roles, setRoles] = useState<Set<Role>>(() => new Set(ROLES));
  const [rolesOpen, setRolesOpen] = useState(false);
  const [side, setSide] = useState(false); // phone drawer
  // The landing view is the functional flow; "capabilities" reads the repo as
  // what you can do with it; "blocks" is the nested-box drill; "chains" the
  // top chain families as strips.
  const [view, setView] = useState<"flow" | "capabilities" | "blocks" | "chains">("flow");
  // The selected block fills the sidebar (the flow canvas selects, not drills);
  // a re-layout key and a pinned selection are the tinker levers.
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  // Focus mode: the selected chain stays on the flow canvas and dims everything
  // it does not cross. Plain chain selection still draws the blocks-canvas path.
  const [focusMode, setFocusMode] = useState(false);
  // Grouping depth on the flow canvas: sections as single nodes, or their blocks inside.
  const [depth, setDepth] = useState(2);
  const code = useCode();
  const live = useMapProgress();
  const wasActive = useRef(false);
  useEffect(() => {
    const active = !!live?.running;
    // While a pass runs, pull the partial map now and then; when it ends,
    // pull the finished one – no reload needed.
    if (active || wasActive.current) api.map().then(setData).catch(() => { /* keep what is shown */ });
    wasActive.current = active;
  }, [live?.running, live?.phase]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Live API first. With no map yet, /api/map/progress says whether the map is
  // still running – then the view shows its progress, not an empty state, and
  // polls until it lands. With no API at all (pre-M1) the fixture stands in.
  // The API lists blocks (contract JSON); the view indexes them by id, so
  // key them once – the fixture already has the Record shape.
  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The view hangs everything off a synthetic root keyed by id. If a payload
    // ever ships blocks as a flat list (depth-0 sections carry parent null),
    // rebuild the Record around the same root node the fixture uses.
    const normalize = (d: MapData): MapData => {
      if (!Array.isArray(d.blocks)) return d;
      const root: MapData["blocks"][string] = {
        id: "__root", parent: null, depth: 0, name: "repo", summary: "whole repo",
        kind: "section", symbols: [], children: [], files: 0, cohesion: 1, source: "graph", role: "glue",
      };
      const byId: MapData["blocks"] = { __root: root };
      for (const b of d.blocks) {
        if (b.parent === null && b.depth === 0) { b.parent = "__root"; root.children.push(b.id); }
        byId[b.id] = b;
      }
      return { ...d, blocks: byId };
    };
    const set = (d: MapData) => { if (!dead) setData(normalize(d)); };
    const loadMap = () => api.map().then(set).catch(() => set(fixture));
    const poll = () => {
      api.mapProgress()
        .then((p) => {
          if (dead) return;
          setProg(p);
          if (p.running) timer = setTimeout(poll, 500);
          else loadMap();
        })
        .catch(() => set(fixture)); // no progress endpoint yet – fixture
    };
    api.map()
      .then(set)
      .catch(() => poll());
    return () => { dead = true; clearTimeout(timer); };
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
      if (`#map/${next.join("/")}` !== location.hash) history.replaceState(null, "", `#map/${next.join("/")}`);
      return next;
    });
  }, []);
  const home = useCallback(() => { setPath([]); history.replaceState(null, "", "#map"); }, []);

  // Esc steps back out to the flow (unless a field or dialog has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement)?.closest?.("input, textarea, [role=dialog]")) return;
      if (path.length || selChain) { home(); setSelChain(null); setFocusMode(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path.length, selChain, home]);

  // The paged chain enumeration the sidebar expands: live API, with the
  // fixture's deterministic stand-in (same paged shape) until M1 lands.
  const loadChains = useCallback((family: string, cursor?: string): Promise<ChainPage> =>
    api.mapChains(family, cursor).catch(() => fixtureChains(family, cursor ?? null)), []);

  const chain: Chain | null = selChain;

  // The block the readout describes: the drilled block, the selected block
  // (the flow canvas selects rather than drills), the chain's entry block,
  // else the repo root.
  const readBlock = useMemo(() => {
    if (!data) return null;
    if (path.length) return data.blocks[path[path.length - 1]] ?? null;
    if (selBlock && data.blocks[selBlock]) return data.blocks[selBlock];
    const root = Object.values(data.blocks).find((b) => b.parent === null);
    if (root) return root;
    if (chain) {
      const leafBlock = [...chain.blocks].reverse().find((b) => data.blocks[b]);
      return leafBlock ? data.blocks[leafBlock] : null;
    }
    return null;
  }, [data, path, chain, selBlock]);

  const selectChain = useCallback((c: Chain) => {
    setSelChain((cur) => (cur?.id === c.id ? null : c));
    setSelLeaf(null);
    setFocusMode(false);
  }, []);

  const selectLeaf = useCallback((id: number) => {
    setSelLeaf(id);
    const l = data?.leaves[id];
    // CodePanel is a shell-level overlay – opening it here keeps the user in
    // MapView (openSymbol would bounce the tab to Graph).
    if (l) code.open({ path: l.path, line: l.line, name: l.name, kind: l.kind as never, id });
  }, [data, code]);

  const toggle = useCallback((id: string) => {
    setOpenRoot((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  }, []);

  const setLens = useCallback((l: Lens) => {
    setRoles(new Set(l === "all" ? ROLES : LENS_ROLES[l]));
  }, []);
  const toggleRole = useCallback((role: Role) => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
        if (next.size === 0) for (const r of ROLES) next.add(r); // never filter to nothing
      } else next.add(role);
      return next;
    });
  }, []);

  const lens: Lens = useMemo(() => {
    const f = LENS_ROLES.functions, u = LENS_ROLES.utilities;
    const has = (arr: Role[]) => arr.every((r) => roles.has(r)) && roles.size === arr.length;
    if (has(f)) return "functions";
    if (has(u)) return "utilities";
    return "all"; // mixed custom set reads as All
  }, [roles]);

  // Tinker: testing code is one toggle off, not a role chip hunt.
  const [hideTests, setHideTests] = useState(false);
  useEffect(() => {
    setRoles((prev) => {
      const next = new Set(prev);
      if (hideTests) next.delete("test"); else next.add("test");
      return next;
    });
  }, [hideTests]);
  // Pinned selection survives a re-render of the canvas (localStorage, wrapped).
  const [pinned, setPinned] = useState<string | null>(() => {
    try { return JSON.parse(localStorage.getItem("kula.map.pin") ?? "null"); } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem("kula.map.pin", JSON.stringify(pinned)); } catch { /* private window */ }
  }, [pinned]);
  // A pin is read back as well as written: on the first load, the stored block
  // fills the sidebar again (silently dropped when the map no longer has it).
  const restored = useRef(false);
  useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    if (pinned && data.blocks[pinned]) setSelBlock(pinned);
    else if (pinned) setPinned(null);
  }, [data, pinned]);

  if (!data) {
    if (prog?.running) {
      // The map is running – its progress, never an empty state.
      const at = PHASES.indexOf(prog.phase);
      const pct = at >= 0 ? Math.round(((at + 1) / PHASES.length) * 100) : 0;
      return (
        <div className="sy-root" data-testid="map-view">
          <ProgressStrip p={prog} />
          <div className="sy-progress" data-testid="map-progress" aria-live="polite">
            <h2>mapping</h2>
            <div className="sy-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="sy-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <table className="sy-t" data-testid="map-progress-table">
              <tbody>
                <tr><th>phase</th><td>{PROGRESS_LABEL[prog.phase] ?? prog.phase}</td></tr>
                <tr><th>blocks</th><td>{prog.blocks}</td></tr>
                <tr><th>chains</th><td>{prog.chains}</td></tr>
                <tr><th>elapsed</th><td>{(prog.ms / 1000).toFixed(1)}s</td></tr>
              </tbody>
            </table>
            <p className="sy-summary">the graph is usable – the map finishes in the background</p>
          </div>
        </div>
      );
    }
    return <div className="sy-root"><div className="view-loading" aria-live="polite">{err ?? "loading map…"}</div></div>;
  }


  return (
    <div className="sy-root" ref={rootRef} data-testid="map-view">
      <div className="sy-lens" data-testid="map-lens" role="toolbar" aria-label="Lens and role filter">
        <div className="sy-lens-group">
          {(["functions", "utilities", "all"] as Lens[]).map((l) => (
            <button key={l} className={`tab-btn sy-lens-btn${lens === l ? " on" : ""}`} data-testid={`map-lens-${l}`}
              aria-pressed={lens === l} onClick={() => setLens(l)}>{l}</button>
          ))}
        </div>
        <div className="sy-lens-group" role="group" aria-label="View">
          {(["flow", "capabilities", "blocks", "chains"] as const).map((v) => (
            <button key={v} className={`tab-btn sy-lens-btn${view === v ? " on" : ""}`} data-testid={`map-view-${v}`}
              aria-pressed={view === v} onClick={() => { setView(v); if (v === "flow") { home(); setSelChain(null); } }}>{v}</button>
          ))}
        </div>
        <button className="tab-btn sy-lens-btn" data-testid="map-depth" title="grouping depth: sections as single nodes, or their blocks inside the frames"
          onClick={() => setDepth((d) => (d === 2 ? 1 : 2))}>depth {depth}</button>
        <button className={`tab-btn sy-lens-btn${rolesOpen ? " on" : ""}`} data-testid="map-roles-btn"
          aria-expanded={rolesOpen} aria-controls="map-role-filter" onClick={() => setRolesOpen((o) => !o)}>roles</button>
        <button className={`tab-btn sy-lens-btn${hideTests ? " on" : ""}`} data-testid="map-hide-tests" aria-pressed={hideTests}
          onClick={() => setHideTests((t) => !t)}>hide tests</button>
        <button className="tab-btn sy-lens-btn" data-testid="map-relayout" title="re-run the layout"
          onClick={() => setLayoutKey((k) => k + 1)}>re-layout</button>
        <button className={`tab-btn sy-lens-btn${selBlock && pinned === selBlock ? " on" : ""}`} data-testid="map-pin" aria-pressed={!!selBlock && pinned === selBlock} title="pin this selection"
          onClick={() => setPinned((p) => (selBlock && p !== selBlock ? selBlock : null))}>pin</button>
      </div>
      {live?.running && <ProgressStrip p={live} />}
      {rolesOpen && (
        <div className="sy-roles" id="map-role-filter" data-testid="map-role-filter" role="group" aria-label="Role filter">
          {ROLES.map((role) => (
            <label key={role} className="sy-role-row" title={ROLE_RULES[role]}>
              <input type="checkbox" checked={roles.has(role)} onChange={() => toggleRole(role)} data-testid={`map-role-${role}`} />
              <span className="mono sy-role-name">{role}</span>
              <span className="sy-role-rule">{ROLE_RULES[role]}</span>
            </label>
          ))}
        </div>
      )}
      <button className="btn sm sy-side-toggle" aria-expanded={side} aria-controls="map-sidebar"
        onClick={() => setSide((s) => !s)} data-testid="map-side-toggle">Structure</button>
      <div className="sy-split" style={listWidth("map", 360)}>
        {view === "capabilities" && <CapsKitView data={data} roles={roles} selection={selBlock} onSelect={setSelBlock} />}
        {view === "chains" && <ChainsStrips data={data} roles={roles} onChain={selectChain} selChain={selChain?.id ?? null} loadChains={loadChains} onLeaf={selectLeaf} />}
        {view === "flow" && (!chain || focusMode) && !path.length
          ? <FlowKitView data={data} roles={roles} focus={chain ? focusOf(data, chain) : null} selection={selBlock} onSelect={setSelBlock} onDrill={drill} onLeaf={selectLeaf} depth={depth} onClearFocus={() => { setSelChain(null); setFocusMode(false); }} layoutKey={layoutKey} />
          : (view === "blocks" || chain || path.length) && view !== "capabilities" && view !== "chains"
            ? <BlockCanvas blocks={data.blocks} leaves={data.leaves} loops={data.loops} roles={roles} chain={chain} path={path} onDrill={drill} onLeaf={selectLeaf} onHome={home} />
            : null}
        {side && <div className="sy-scrim" onClick={() => setSide(false)} aria-hidden="true" />}
        {/* Right-hand structure panel, sized and resized like Graph's inspector. */}
        <aside className={`sy-side-wrap fm-right${side ? " open" : ""}`} id="map-sidebar" aria-label="map structure">
          <Grip id="map" edge="left" min={280} max={720} label="Resize structure panel" />
          <details className="fm-details" open={!!readBlock && (path.length > 0 || !!selChain || !!selBlock)}>
            <summary className="fm-details-sum">{readBlock?.name ?? "map"} – details</summary>
            {selChain && (
              <div className="fm-chain-card" data-testid="map-chain-card">
                <div className="fm-chain-card-head">
                  <span className="sy-section-label">chain</span>
                  <button className="tab-btn sy-lens-btn" data-testid="map-focus-chain" aria-pressed={focusMode} title="dim everything this chain does not cross"
                    onClick={() => setFocusMode((f) => !f)}>{focusMode ? "unfocus" : "focus"}</button>
                </div>
                <p className="sy-summary">{data.leaves[selChain.source]?.name} → {data.leaves[selChain.terminal]?.name} · {selChain.len} steps</p>
                <SubwayStrip data={data} chain={selChain} onStep={(s) => typeof s === "number" ? selectLeaf(s) : undefined} />
              </div>
            )}
            <Readout data={data} block={readBlock} onLeaf={selectLeaf} onFamily={(famId) => { loadChains(famId).then((p) => { const c = p.chains[0]; if (c) selectChain(c); }).catch(() => { /* no chains pageable */ }); }} />
          </details>
          <MapViewSidebar
            blocks={data.blocks} families={data.families} leaves={data.leaves} roles={roles}
            selChain={selChain?.id ?? null} selLeaf={selLeaf} openRoot={openRoot}
            loadChains={loadChains}
            onChain={selectChain} onLeaf={selectLeaf} onToggle={toggle} onZoom={drill}
            onClose={() => setSide(false)}
          />
        </aside>
      </div>
    </div>
  );
}

// Deterministic fixture enumeration with the same paged shape as the API.
function fixtureChains(family: string, cursor: string | null): Promise<ChainPage> {
  return import("./map/fixture").then((m) => m.fixtureChains(family, cursor));
}
