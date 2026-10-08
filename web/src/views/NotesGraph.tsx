// Notes as a knowledge graph, drawn like the codebase map: the repository as a
// hub, everything a note is attached to (files, symbols, commits) as hubs in
// their kind's territory, each note a node beside its target (agent memories in
// the accent), and the [[links]] inside a note as edges with dots running to the
// symbols they name. Click a target to see only its notes in the sidebar.
import type { Note } from "../api";
import { MiniGraph, type MiniEdge, type MiniNode } from "./MiniGraph";
import { cssVar } from "../graphfx";

const KIND = (t: string) => (t === "repo" ? "repo" : t.split(":")[0]);
const KCOLOR: Record<string, string> = { repo: "--accent", file: "--blue", symbol: "--violet", commit: "--yellow", cluster: "--green" };
const GLYPH: Record<string, string> = { repo: "◎", file: "F", symbol: "ƒ", commit: "C", cluster: "◇" };

export function linksOf(body: string) {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

export function NotesGraph({ notes, sel, onPick }: { notes: Note[]; sel: string; onPick: (target: string) => void }) {
  const nodes: MiniNode[] = [], edges: MiniEdge[] = [];
  const seen = new Set<string>();
  const short = (t: string) => { const s = t.replace(/^(file|symbol|commit|cluster):/, ""); return s.length > 30 ? "…" + s.slice(-29) : s; };
  const target = (t: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    const k = KIND(t);
    nodes.push({ id: t, label: t === "repo" ? "repo" : short(t), color: cssVar(KCOLOR[k] ?? "--text-2") || cssVar("--text-2"), size: t === "repo" ? 14 : 9, group: k === "repo" ? undefined : k, hub: true, glyph: GLYPH[k] ?? "·" });
    if (t !== "repo") edges.push({ source: t, target: "repo", color: cssVar("--line-2") });
  };
  target("repo");
  for (const n of notes) target(n.target);
  for (const n of notes) {
    const id = `note:${n.id}`;
    nodes.push({ id, label: `#${n.id} ${n.body.replace(/\s+/g, " ").slice(0, 26)}`, color: n.kind === "memory" ? cssVar("--accent") : cssVar("--text"), size: 5, group: KIND(n.target) === "repo" ? undefined : KIND(n.target) });
    edges.push({ source: id, target: n.target, color: cssVar("--text-3") });
    for (const l of linksOf(n.body)) { const t = l.includes(":") ? l : `symbol:${l}`; target(t); edges.push({ source: id, target: t, color: cssVar("--accent"), flow: true }); }
  }
  return (
    <div className="notes-graph">
      <MiniGraph nodes={nodes} edges={edges} sel={sel || undefined} label={`Notes as a graph: ${notes.length} notes on ${seen.size - 1} targets`}
        onPick={(id) => { const t = id.startsWith("note:") ? notes.find((n) => `note:${n.id}` === id)?.target ?? "" : id; onPick(t === sel ? "" : t); }}
        groupLabel={(k) => `${k}s`} />
      <div className="graph-legend">
        <span>{notes.length} notes · {seen.size - 1} targets</span>
        <span><i className="gk note" />note</span>
        <span><i className="gk mem" />agent memory</span>
        <span><i className="gk hand" />[[link]]</span>
      </div>
    </div>
  );
}
