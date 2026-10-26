// U3 · Actors on the terrain: the actor band on top of the map canvas
// (contract §1 – 144px, horizontal scroll, never wraps) and the fence hull
// (§8.5). Agents and teams live here; selecting one draws its fence hull on
// the canvas and dims every non-fenced block (§8.5), dragging a block or a
// pipeline step onto an agent adds it to the fence (§8.5, B7), and the
// unconnected Fence port carries a "+" stub that opens the R1 add form (§8.6).

import { useLayoutEffect, useRef, useState } from "react";
import type { AgentsInfo, Workflow } from "../../api";
import { Harmonograph } from "../../ui";
import { isItemDrag, ITEM_DRAG, type Item } from "../map/pipeline";
import { agentGradient } from "../../flow/agentMark";
import { readCfg, AUTONOMY_LABEL } from "./agentConfig";

export type ActorBandProps = {
  info: AgentsInfo | null;
  selected: string | null;
  onSelect: (name: string | null) => void;
  fencePaths: (name: string) => string[];
  editFence: boolean;
  onEditFence: (on: boolean) => void;
  /** A block (or a pipeline step acting on one) was dropped on this agent. */
  onDropBlock: (agent: string, item: Item | null) => void;
  /** The band's own "+ agent" and the unconnected Fence port "+" both open the R1 add form. */
  onAdd: () => void;
};

const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const titleCase = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** An agent is missing its Model when no connected integration serves it –
    an integration with no per-workflow list serves every agent. */
export function hasModel(info: AgentsInfo | null, name: string): boolean {
  return !!info?.connections.some((c) => (c.mcp || c.hook) && (!c.workflows.length || c.workflows.includes(name)));
}

/** One actor card: harmonograph mark, role line, fence size, last-run dot,
    autonomy state, the four typed ports on the bottom edge (contract §3),
    and a red mark when the Model is missing (§7). It is a drop target while
    a block or step is being dragged (B7: fence a block in ≤ 2 moves). */
export function ActorCard({ info, wf, selected, onSelect, fencePaths, onDropBlock, onAdd }: {
  info: AgentsInfo; wf: Workflow; selected: boolean; onSelect: () => void;
  fencePaths: (name: string) => string[]; onDropBlock: (item: Item | null) => void; onAdd: () => void;
}) {
  const cfg = readCfg(wf.name);
  const autonomy = cfg.autonomy;
  const paths = fencePaths(wf.name);
  const missing = !hasModel(info, wf.name);
  const [over, setOver] = useState(false);
  return (
    <div className={`at-card${selected ? " sel" : ""}${over ? " over" : ""}${missing ? " missing" : ""}`}
      data-testid={`at-agent-${wf.name}`} data-agent={wf.name}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDragOver={(e) => { if (isItemDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!isItemDrag(e)) return;
        e.preventDefault(); setOver(false);
        let item: Item | null = null;
        try { item = JSON.parse(e.dataTransfer.getData(ITEM_DRAG)) as Item; } catch { /* a bare drop still arms */ }
        onDropBlock(item);
      }}>
      <div className="at-card-head">
        <span className="at-mark" data-figure aria-hidden="true"><Harmonograph seed={wf.name} size={22} /></span>
        <span className="at-name mono">{titleCase(wf.name)}</span>
        {missing && <span className="at-missing" data-testid="agent-missing-model" title="No model connected – open Setup to set one" aria-label="missing model" />}
        {selected && <span className="at-sel-dot" aria-hidden="true" />}
      </div>
      <div className="at-role">{short(wf.about ?? "work mode", 34)}</div>
      <div className="at-meta mono">
        <span title="fenced paths">{paths.length ? `⧉ ${paths.length}` : "no fence"}</span>
        <span title={`autonomy – ${AUTONOMY_LABEL[autonomy]}`}>{AUTONOMY_LABEL[autonomy]}</span>
        {info.task?.workflow === wf.name && <span className="at-run" title="running now">run</span>}
      </div>
      <div className="at-ports" role="group" aria-label={`${wf.name} ports`}>
        {(["Model", "Tools", "Fence", "Memory"] as const).map((p) => (
          <span key={p} className={`fc-port at-port${missing && p === "Model" ? " err" : ""}`} data-testid={`port-${p}`}>
            <span className="fc-dot fc-dot-typed" aria-hidden="true" />
            <span className="fc-port-label">{p}{p === "Model" ? "*" : ""}</span>
            {p === "Fence" && (
              <button className="fc-stub fc-stub-btn at-port-add" data-testid="port-add" title="Add the fenced block"
                onClick={(e) => { e.stopPropagation(); onAdd(); }}>+</button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The band: one row of actor cards above the canvas, never wrapping. The
    header carries the actor verbs that are band-level: edit fence on canvas
    and the band "+" (R1 add form). */
export function ActorBand({ info, selected, onSelect, fencePaths, editFence, onEditFence, onDropBlock, onAdd }: ActorBandProps) {
  if (!info) return null;
  const agents = info.workflows.filter((w) => !w.research && !w.builtin);
  const teams = info.teams;
  return (
    <section className="at-band" data-testid="actor-band" aria-label="Agents and teams on the terrain">
      <div className="at-band-head">
        <span className="ws-eyebrow">Actors</span>
        <button className={`btn sm ghost at-edit${editFence ? " on" : ""}`} data-testid="at-edit-fence"
          disabled={!selected} aria-pressed={editFence}
          title={selected ? "Click blocks on the canvas to add or remove them from the fence" : "Select an agent first"}
          onClick={() => onEditFence(!editFence)}>Edit fence on canvas</button>
        <span className="spacer" />
        <button className="btn sm ghost lib-add" data-testid="at-band-add" title="Add an agent – the compact R1 form" onClick={onAdd}>+ agent</button>
      </div>
      <div className="at-band-row">
        {teams.map((t) => (
          <div className="at-team" key={t.name} data-testid={`at-team-${t.name}`}>
            <div className="at-team-head mono"><span className="at-team-glyph" aria-hidden="true" /> {titleCase(t.name)} <span className="at-team-n">{t.members.length}</span></div>
            <div className="at-team-members">
              {t.members.map((m) => {
                const wf = agents.find((w) => w.name === (m.workflow || m.agent));
                return wf
                  ? <ActorCard key={wf.name} info={info} wf={wf} selected={selected === wf.name}
                      onSelect={() => onSelect(selected === wf.name ? null : wf.name)} fencePaths={fencePaths} onAdd={onAdd}
                      onDropBlock={(it) => onDropBlock(wf.name, it)} />
                  : <span key={m.agent ?? m.workflow ?? "?"} className="at-team-mono mono" title="agent not in the library">{titleCase(m.workflow || m.agent || "")}</span>;
              })}
            </div>
          </div>
        ))}
        {agents.filter((w) => !teams.some((t) => t.members.some((m) => (m.workflow || m.agent) === w.name))).map((wf) => (
          <ActorCard key={wf.name} info={info} wf={wf} selected={selected === wf.name}
            onSelect={() => onSelect(selected === wf.name ? null : wf.name)} fencePaths={fencePaths} onAdd={onAdd}
            onDropBlock={(it) => onDropBlock(wf.name, it)} />
        ))}
      </div>
    </section>
  );
}

/** The fence hull: a dashed frame around every fenced section's node on the
    canvas, drawn in the agent's own gradient when picked, with the agent's
    label. Measured from the DOM so it tracks the real layout; redraws when
    the selection, the fence or the layout moves. */
export function FenceHull({ canvas, fencedIds, agent }: { canvas: React.RefObject<HTMLElement | null>; fencedIds: string[]; agent: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ l: number; t: number; r: number; b: number } | null>(null);
  const g = agent ? agentGradient(agent) : null;
  useLayoutEffect(() => {
    if (!agent || !fencedIds.length || !canvas.current) { setRect(null); return; }
    const measure = () => {
      const c = canvas.current!.getBoundingClientRect();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const id of fencedIds) {
        // a section renders as its frame, its `sec:` card or, when the picked
        // block opened it, an `open:` frame – any of the three hosts the hull
        const el = canvas.current!.querySelector(
          `[data-testid="fc-node-${CSS.escape(id)}"], [data-testid="fc-node-sec:${CSS.escape(id)}"], [data-testid="fc-node-open:${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!el) continue;
        const n = el.getBoundingClientRect();
        l = Math.min(l, n.left - c.left); t = Math.min(t, n.top - c.top);
        r = Math.max(r, n.right - c.left); b = Math.max(b, n.bottom - c.top);
      }
      setRect(Number.isFinite(l) && r > l ? { l, t, r, b } : null);
    };
    measure();
    // the canvas may re-lay out after the pick (a square opens, the camera
    // moves) – measure again once it settles
    const late = window.setTimeout(measure, 450);
    const ro = new ResizeObserver(measure);
    ro.observe(canvas.current!);
    return () => { ro.disconnect(); window.clearTimeout(late); };
  }, [canvas, fencedIds.join("|"), agent]);
  if (!rect || !agent) return null;
  return (
    <div className="at-hull" data-testid="fence-hull" ref={ref}
      style={{ left: rect.l - 10, top: rect.t - 10, width: rect.r - rect.l + 20, height: rect.b - rect.t + 20, ...(g ? { borderColor: g[0] } : {}) }}>
      <span className="at-hull-label mono" data-testid="fence-hull-label"
        style={g ? { color: g[0], borderColor: g[0] } : undefined}>fence · {titleCase(agent)}</span>
    </div>
  );
}