// Drag and drop across the Agents tab (u20). The obvious gestures work:
// an agent card drags onto a team tab or the team canvas to join the team, a
// skill row or a memory drags onto an agent card to attach or scope it, and a
// team seat dragged onto another seat sets reports_to (shift = hands_off).
// Every gesture keeps its keyboard equivalent in the panel that owns it, and
// the drop target is a 1px accent outline – no glow.

export type DragPayload =
  | { kind: "agent"; name: string }
  | { kind: "skill"; name: string }
  | { kind: "memory"; id: number }
  | { kind: "seat"; team: string; member: string };

const MIME = "application/x-kula-drag";

export function setDrag(e: React.DragEvent, p: DragPayload) {
  try { e.dataTransfer.setData(MIME, JSON.stringify(p)); } catch { /* IE */ }
  e.dataTransfer.setData("text/plain", p.kind === "memory" ? `memory:${p.id}` : "name" in p ? p.name : `seat:${p.member}`);
  e.dataTransfer.effectAllowed = "move";
}

export function getDrag(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try { return JSON.parse(raw) as DragPayload; } catch {
      // text fallback: "memory:<id>" or a name → agent
      if (raw.startsWith("memory:")) return { kind: "memory", id: Number(raw.slice(7)) };
      return { kind: "agent", name: raw };
    }
  } catch { return null; }
}

/** Drag-start for an agent card (Workflows passes this straight through). */
export function agentDragStart(e: React.DragEvent) {
  const el = (e.currentTarget as HTMLElement).closest<HTMLElement>(".ag-card");
  const name = el?.querySelector<HTMLElement>(".card__t")?.textContent ?? el?.getAttribute("data-testid")?.slice(8) ?? "";
  if (name) setDrag(e, { kind: "agent", name });
}

/** The three handlers a drop target needs. `onDrop` runs only when the
 *  payload matches `kinds`. Highlight = a class the CSS outlines in accent. */
export function dropHandlers(kinds: DragPayload["kind"][], onDrop: (p: DragPayload) => void) {
  const ok = (e: React.DragEvent) => {
    const p = getDrag(e);
    return !!p && kinds.includes(p.kind);
  };
  return {
    onDragOver: (e: React.DragEvent) => { if (ok(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } },
    onDrop: (e: React.DragEvent) => {
      const p = getDrag(e);
      if (p && kinds.includes(p.kind)) { e.preventDefault(); e.stopPropagation(); onDrop(p); }
    },
  };
}
