// Persisted drag positions, per repo+view+layoutKey, in localStorage.
// Wrapped in try/catch – private mode or a full quota must never break the canvas.
// Positions are stored in ABSOLUTE canvas coordinates; children (group members,
// sub-nodes) are converted to/from their parent-relative positions on apply.
import { FlowNode, snap } from "./types";

const VERSION = "v1";
const key = (ns: string, layoutKey: string) => `kula.flow.pos.${VERSION}.${ns}.${layoutKey}`;

type PosMap = Record<string, { x: number; y: number }>;

/** Sizes (R0): block cards resize from their corner handle and the size
    persists beside the position – same namespace, same best-effort rules. */
type SizeMap = Record<string, { w: number; h: number }>;

const sizeKey = (ns: string, layoutKey: string) => `kula.flow.size.${VERSION}.${ns}.${layoutKey}`;

export function readSizes(ns: string, layoutKey: string): SizeMap {
  try {
    const raw = localStorage.getItem(sizeKey(ns, layoutKey));
    return raw ? (JSON.parse(raw) as SizeMap) : {};
  } catch {
    return {};
  }
}

function writeSizes(ns: string, layoutKey: string, map: SizeMap) {
  try {
    localStorage.setItem(sizeKey(ns, layoutKey), JSON.stringify(map));
  } catch {
    /* ignore – persistence is best effort */
  }
}

export function persistSizes(ns: string, layoutKey: string, sizes: { id: string; size: { w: number; h: number } }[]) {
  if (!sizes.length) return;
  const map = readSizes(ns, layoutKey);
  for (const s of sizes) map[s.id] = s.size;
  writeSizes(ns, layoutKey, map);
}

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

/** Absolute position of every node (parents come first in a laid-out array). */
function absolute(nodes: FlowNode[]): Map<string, { x: number; y: number }> {
  const abs = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = n.parent && abs.has(n.parent) ? abs.get(n.parent)! : { x: 0, y: 0 };
    abs.set(n.id, { x: p.x + (n.pos?.x ?? 0), y: p.y + (n.pos?.y ?? 0) });
  }
  return abs;
}

/** Apply persisted sizes (block cards, R0) to the nodes before layout, so
    dagre and the group frames size with the cards the user resized. */
export function applySizes(ns: string, layoutKey: string, nodes: FlowNode[]): FlowNode[] {
  const map = readSizes(ns, layoutKey);
  if (!Object.keys(map).length) return nodes;
  return nodes.map((n) => {
    const s = map[n.id];
    if (!s) return n;
    return { ...n, size: { ...n.size, w: s.w, h: s.h } };
  });
}

/** Apply persisted drags to laid-out positions (drags win). */
export function applyPersisted(ns: string, layoutKey: string, nodes: FlowNode[]): FlowNode[] {
  const map = read(ns, layoutKey);
  if (!Object.keys(map).length) return nodes;
  const abs = absolute(nodes);
  return nodes.map((n) => {
    const p = map[n.id];
    if (!p) return n;
    if (n.parent && abs.has(n.parent)) {
      const pa = abs.get(n.parent)!;
      return { ...n, pos: { x: snap(p.x - pa.x), y: snap(p.y - pa.y) } };
    }
    return { ...n, pos: { x: snap(p.x), y: snap(p.y) } };
  });
}

/** Save the positions of the given nodes (after a drag) – absolute coords. */
export function persist(ns: string, layoutKey: string, nodes: FlowNode[], all?: FlowNode[]) {
  const map = read(ns, layoutKey);
  const abs = all ? absolute(all) : null;
  for (const n of nodes) {
    const a = abs?.get(n.id);
    map[n.id] = a ?? { x: n.pos!.x, y: n.pos!.y };
  }
  write(ns, layoutKey, map);
}

/** Clear persisted drags – the "reset layout" action. */
export function clearPersisted(ns: string, layoutKey?: string) {
  try {
    if (layoutKey) {
      localStorage.removeItem(key(ns, layoutKey));
      localStorage.removeItem(sizeKey(ns, layoutKey));
    } else {
      const prefix = `kula.flow.pos.${VERSION}.${ns}.`;
      const drop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) drop.push(k);
      }
      for (const k of drop) localStorage.removeItem(k);
      const sprefix = `kula.flow.size.${VERSION}.${ns}.`;
      const sdrop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(sprefix)) sdrop.push(k);
      }
      for (const k of sdrop) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

const snapPos = (p: { x: number; y: number }) => ({ x: snap(p.x), y: snap(p.y) });
void snapPos;
