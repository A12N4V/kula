// Persisted drag positions, per repo+view+layoutKey, in localStorage.
// Wrapped in try/catch – private mode or a full quota must never break the canvas.
import { FlowNode, snap } from "./types";

const VERSION = "v1";
const key = (ns: string, layoutKey: string) => `kula.flow.pos.${VERSION}.${ns}.${layoutKey}`;

type PosMap = Record<string, { x: number; y: number }>;

function read(ns: string, layoutKey: string): PosMap {
  try {
    const raw = localStorage.getItem(key(ns, layoutKey));
    return raw ? (JSON.parse(raw) as PosMap) : {};
  } catch {
    return {};
  }
}

function write(ns: string, layoutKey: string, map: PosMap) {
  try {
    localStorage.setItem(key(ns, layoutKey), JSON.stringify(map));
  } catch {
    /* ignore – persistence is best effort */
  }
}

/** Apply persisted drags to laid-out positions (drags win). */
export function applyPersisted(ns: string, layoutKey: string, nodes: FlowNode[]): FlowNode[] {
  const map = read(ns, layoutKey);
  if (!Object.keys(map).length) return nodes;
  return nodes.map((n) => (map[n.id] ? { ...n, pos: snapPos(map[n.id]) } : n));
}

/** Save the positions of the given nodes (after a drag). */
export function persist(ns: string, layoutKey: string, nodes: FlowNode[]) {
  const map = read(ns, layoutKey);
  for (const n of nodes) map[n.id] = { x: n.pos!.x, y: n.pos!.y };
  write(ns, layoutKey, map);
}

/** Clear persisted drags – the "reset layout" action. */
export function clearPersisted(ns: string, layoutKey?: string) {
  try {
    if (layoutKey) localStorage.removeItem(key(ns, layoutKey));
    else {
      const prefix = `kula.flow.pos.${VERSION}.${ns}.`;
      const drop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) drop.push(k);
      }
      for (const k of drop) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

const snapPos = (p: { x: number; y: number }) => ({ x: snap(p.x), y: snap(p.y) });
