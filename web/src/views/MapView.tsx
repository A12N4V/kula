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
import { Readout } from "./map/readout";
import { MapViewSidebar } from "./map/sidebar";
import { FlowView } from "./map/flow";
import { ProgressStrip, useMapProgress } from "./map/progress";
import type { Chain, ChainPage, Lens, MapData, MapProgress, Role } from "./map/types";
import { LENS_ROLES, ROLES, ROLE_RULES } from "./map/types";

const PROGRESS_LABEL: Record<MapProgress["phase"], string> = {
  idle: "idle", scc: "condensing cycles", dp: "counting paths", blocks: "forming blocks",
  families: "grouping families", done: "done",
};

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
  // The landing view is the functional flow; "blocks" is the nested-box drill.
  const [view, setView] = useState<"flow" | "blocks">("flow");
  const code = useCode();
  const live = useMapProgress();
  const wasActive = useRef(false);
  useEffect(() => {
    const active = !!live?.active;
    // While a pass runs, pull the partial map now and then; when it ends,
    // pull the finished one – no reload needed.
    if (active || wasActive.current) api.map().then(setData).catch(() => { /* keep what is shown */ });
    wasActive.current = active;
  }, [live?.active, live?.phase]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Live API first. With no map yet, /api/map/progress says whether the map is
  // still running – then the view shows its progress, not an empty state, and
  // polls until it lands. With no API at all (pre-M1) the fixture stands in.
  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (d: MapData) => { if (!dead) setData(d); };
    const loadMap = () => api.map().then(set).catch(() => set(fixture));
    const poll = () => {
      api.mapProgress()
        .then((p) => {
          if (dead) return;
          setProg(p);
          if (p.active) timer = setTimeout(poll, 500);
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
      if (path.length || selChain) { home(); setSelChain(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path.length, selChain, home]);

  // The paged chain enumeration the sidebar expands: live API, with the
  // fixture's deterministic stand-in (same paged shape) until M1 lands.
  const loadChains = useCallback((family: string, cursor?: string): Promise<ChainPage> =>
    api.mapChains(family, cursor).catch(() => fixtureChains(family, cursor ?? null)), []);

  const chain: Chain | null = selChain;

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
    setSelChain((cur) => (cur?.id === c.id ? null : c));
    setSelLeaf(null);
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

  if (!data) {
    if (prog?.active) {
      // The map is running – its progress, never an empty state.
      const pct = prog.total > 0 ? Math.min(100, Math.round((prog.done / prog.total) * 100)) : 0;
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
                <tr><th>done</th><td>{prog.done} / {prog.total}</td></tr>
                <tr><th>elapsed</th><td>{(prog.elapsed_ms / 1000).toFixed(1)}s</td></tr>
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
          {(["flow", "blocks"] as const).map((v) => (
            <button key={v} className={`tab-btn sy-lens-btn${view === v ? " on" : ""}`} data-testid={`map-view-${v}`}
              aria-pressed={view === v} onClick={() => { setView(v); if (v === "flow") { home(); setSelChain(null); } }}>{v}</button>
          ))}
        </div>
        <button className={`tab-btn sy-lens-btn${rolesOpen ? " on" : ""}`} data-testid="map-roles-btn"
          aria-expanded={rolesOpen} aria-controls="map-role-filter" onClick={() => setRolesOpen((o) => !o)}>roles</button>
      </div>
      {live?.active && <ProgressStrip p={live} />}
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
        {view === "flow" && !chain && !path.length
          ? <FlowView data={data} roles={roles} onDrill={drill} onLeaf={selectLeaf} />
          : <BlockCanvas blocks={data.blocks} leaves={data.leaves} loops={data.loops} roles={roles} chain={chain} path={path} onDrill={drill} onLeaf={selectLeaf} onHome={home} />}
        {side && <div className="sy-scrim" onClick={() => setSide(false)} aria-hidden="true" />}
        {/* Right-hand structure panel, sized and resized like Graph's inspector. */}
        <aside className={`sy-side-wrap fm-right${side ? " open" : ""}`} id="map-sidebar" aria-label="map structure">
          <Grip id="map" edge="left" min={280} max={720} label="Resize structure panel" />
          <details className="fm-details" open={!!readBlock && path.length > 0}>
            <summary className="fm-details-sum">{readBlock?.name ?? "map"} – details</summary>
            <Readout data={data} block={readBlock} onLeaf={selectLeaf} />
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
