// The agent as a portfolio card: its own harmonograph draws itself slowly in
// its gradient on top, then the body – agent id and where it lives, the name,
// one line of role, and the tags line at the bottom. The whole card is the
// button: clicking it opens the agent sidebar (AgentSidebar).

import { agentGradient, harmonographPath, svgId } from "../../flow/agentMark";
import { Icon } from "../../ui";
import type { Workflow } from "../../api";

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

/** The card's art: the harmonograph at card scale, drawing itself once, slowly
 *  (pathLength 1 + a long dashoffset run). Reduced motion keeps it still –
 *  the full curve, already drawn. */
export function CardArt({ name }: { name: string }) {
  const [a, b] = agentGradient(name);
  const id = `hgc-${svgId(name)}`;
  return (
    <svg className="ag-card-art-svg" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-figure data-testid={`ag-art-${name}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <path className="ag-card-hg" d={harmonographPath(name)} pathLength={1} fill="none" stroke={`url(#${id})`} strokeWidth="0.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AgentCard({ card, live, onOpen }: { card: CardData; live: boolean; onOpen: () => void }) {
  return (
    <button className="card ag-card" data-testid={`ag-card-${card.name}`} onClick={onOpen} aria-haspopup="dialog">
      <span className="card__art" aria-hidden="true"><CardArt name={card.name} /></span>
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
    </button>
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
