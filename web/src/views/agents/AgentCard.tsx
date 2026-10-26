// The agent as a portfolio card: its own harmonograph draws itself slowly in
// its gradient on top, then the body – agent id and where it lives, the name,
// one line of role, and the tags line at the bottom. The whole card is the
// button: clicking it opens the agent sidebar (AgentSidebar).

import { useMemo } from "react";
import { harmonographPath, harmonographSegments, svgId, useLogo, type MarkFamily } from "../../flow/agentMark";
import { openLogoStudio } from "./LogoStudio";
import { Icon } from "../../ui";
import type { Workflow } from "../../api";
import { dropHandlers, getDrag, setDrag, type DragPayload } from "./dnd";

export interface CardData {
  name: string;
  role: string;
  description: string;
  tags: string[];
  agent: string;
  builtin: boolean;
}

/** Derive the card shape from AgentsInfo – the same fields /api/agent/cards
 *  returns, so the view reads one shape whether the route exists yet or not. */
export function toCard(w: Workflow): CardData {
  const tags = [
    ...(w.scope ?? []).slice(0, 2),
    (w.steps?.length ?? 0) + " steps",
    w.research ? "autoresearch" : "",
  ].filter(Boolean);
  return {
    name: w.name,
    role: w.about || "",
    description: w.prompt || w.about || "",
    tags: tags.slice(0, 3),
    agent: w.name,
    builtin: !!w.builtin,
  };
}

/** The card data the backend serves (/api/agent/cards, module B1). Until it
 *  lands, `fetchCards` falls back to the same fields derived from AgentsInfo. */
export async function fetchCards(): Promise<CardData[] | null> {
  try {
    const r = await fetch("/api/agent/cards", { headers: { "x-kula-token": sessionStorage.getItem("kula.token") ?? "" } });
    if (!r.ok) return null;
    const cards = await r.json();
    return Array.isArray(cards) && cards.length ? cards : null;
  } catch { return null; }
}

/** The card's art: the 3D harmonograph seen from its one angle, a fine line
 *  whose colour flows along the trace. It draws itself once, slowly: a mask
 *  path runs its dashoffset (pathLength 1). Reduced motion keeps it still –
 *  the full curve, already drawn. Clicking the mark opens the logo studio
 *  (module U17) while the rest of the card opens the agent – the card itself
 *  stays one button, so the art is a click region, not a nested control. A
 *  saved logo replaces the hashed curve. */
export function CardArt({ name, family = "agent", onStudio = true }: { name: string; family?: MarkFamily; onStudio?: boolean }) {
  const logo = useLogo(family, name);
  const id = `hgm-${svgId(name)}`;
  const segs = useMemo(() => harmonographSegments(name, 2400, 24, family), [name, family]);
  const whole = useMemo(() => harmonographPath(name, 2400), [name]);
  const open = (e: { stopPropagation: () => void }) => {
    if (!onStudio) return;
    e.stopPropagation();
    openLogoStudio(family, name);
  };
  const studioProps = onStudio ? { type: "button" as const, "aria-label": `Edit logo – ${name}` } : {};
  if (logo) {
    return (
      <button className={`ag-card-art-svg logo-saved${onStudio ? " logo-click" : ""}`} data-testid={`ag-art-${name}`} data-figure
        onClick={open} {...studioProps} style={{ display: "block", aspectRatio: "1" }} dangerouslySetInnerHTML={{ __html: logo.svg }} />
    );
  }
  return (
    <button className={`ag-card-art-svg${onStudio ? " logo-click" : ""}`} data-testid={`ag-art-${name}`}
      onClick={open} {...studioProps}>
      <svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden={onStudio ? undefined : true} data-figure>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path className="ag-card-hg" d={whole} pathLength={1} fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        {segs.map((g, i) => <path key={i} d={g.d} fill="none" stroke={g.stroke} strokeOpacity={g.opacity} className="ag-card-seg" strokeLinecap="round" strokeLinejoin="round" />)}
      </g>
      </svg>
    </button>
  );
}

export default function AgentCard({ card, live, onOpen, onDelete, onDragStart, onDropPayload }: { card: CardData; live: boolean; onOpen: () => void; onDelete?: () => void; onDragStart?: (e: React.DragEvent) => void; onDropPayload?: (p: DragPayload) => void }) {
  const open = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
  };
  return (
    <div className="card ag-card" data-testid={`ag-card-${card.name}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={open}
      aria-haspopup="dialog" draggable={!!onDragStart} onDragStart={onDragStart}
      {...(onDropPayload ? dropHandlers(["skill", "memory"], onDropPayload) : {})}>
      <span className="card__art"><CardArt name={card.name} /></span>
      <span className="card__body">
        <span className="card__meta">
          <span className="mono">{card.agent}</span>
          <span>{card.builtin ? "built in" : "kula.toml"}</span>
          {live && <span className="ag-card-live">in use now</span>}
        </span>
        <span className="card__t">{card.name}</span>
        <span className="card__d">{card.description || card.role || <span className="muted">no role yet</span>}</span>
        <span className="card__fmt">{card.tags.join(" · ") || "–"}</span>
      </span>
      {onDelete && (
        <span className="ag-card-ovf" onClick={(e) => e.stopPropagation()}>
          <button className="btn sm ghost" aria-label={`Delete ${card.name}`} title="Delete this agent" data-testid={`ag-card-del-${card.name}`}
            onClick={() => { if (confirm(`Delete the ${card.name} agent?`)) onDelete(); }}>Delete</button>
        </span>
      )}
    </div>
  );
}

/** The last card in the grid: the one way to add an agent. */
export function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <button className="card ag-card ag-card-add" data-testid="ag-card-add" onClick={onClick} aria-label="New workflow">
      <span className="card__art ag-card-add-art" aria-hidden="true"><Icon.plus /></span>
      <span className="card__body">
        <span className="card__meta">new</span>
        <span className="card__t">Add agent</span>
        <span className="card__d">A work mode with its own role, steps and fences.</span>
      </span>
    </button>
  );
}
