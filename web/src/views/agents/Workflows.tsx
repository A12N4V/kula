// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Agents tab: a grid of portfolio cards, one per work mode. The card's art is
// the agent's own harmonograph, drawing itself slowly in its gradient. Clicking
// a card opens the agent sidebar – the editor, moved behind the click
// (complexity masking: the first screen is the choice, the fields are one
// interaction away).

import { useEffect, useState } from "react";
import type { AgentsInfo, Workflow } from "../../api";
import { Empty } from "../../ui";
import { blank, takeStashedAdd, type Act, type Tab } from "./data";
import { SuggestionRow } from "./parts";
import { AddForm } from "./AddForm";
import AgentCard, { AddCard, fetchCards, toCard, type CardData } from "./AgentCard";
import AgentSidebar from "./AgentSidebar";

const BUILTIN = ["explore", "fix", "refactor", "tests", "docs", "autoresearch"];

export default function Workflows({ info, act, onGraph }: { info: AgentsInfo; act: Act; onGraph: (wf?: string) => void; setTab?: (t: Tab) => void }) {
  // The open agent (sidebar). null = the grid only. "" means the new-agent
  // draft (no name yet); a name means the card's agent.
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [orig, setOrig] = useState<string | null>(null);
  const cur = info.workflows.find((w) => w.name === sel);
  // A workflow created from the map's Library rail lands here open (see
  // workspace.tsx stashNewItem).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("kula.agents.new");
      if (!raw) return;
      sessionStorage.removeItem("kula.agents.new");
      const { kind, name } = JSON.parse(raw) as { kind: string; name: string };
      if (kind === "agent" && name) openCard(name);
    } catch { /* private mode */ }
  }, []);
  const own = info.workflows.filter((w) => !w.builtin);
  const dirty = !!draft && !!cur && JSON.stringify({ ...blank(), ...cur, memory: cur.memory || "write", builtin: undefined }) !== JSON.stringify({ ...draft, builtin: undefined });
  const isNew = orig === null;
  // The one add flow (module R1): the + card opens the compact AddForm –
  // name, role, fence, start-from – instead of a half-built draft editor.
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (takeStashedAdd() === "agent") { setDraft(null); setOrig(null); setAdding(true); } }, []);

  const openCard = (name: string) => {
    setAdding(false);
    setSel(name);
    const w = info.workflows.find((x) => x.name === name);
    if (w) { setDraft({ ...blank(), ...w, memory: w.memory || "write" }); setOrig(w.name); }
  };
  const close = () => { setSel(null); setDraft(null); setOrig(null); };
  const save = async () => {
    if (!draft) return;
    const next = [...own.filter((w) => w.name !== orig && w.name !== draft.name), { ...draft, builtin: undefined, memory: draft.memory === "write" ? "" : draft.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${draft.name} to kula.toml`).catch(() => {});
    setOrig(draft.name);
    setSel(draft.name);
  };
  const createFrom = async (wf: Workflow) => {
    const next = [...own.filter((w) => w.name !== wf.name), { ...wf, builtin: undefined, memory: wf.memory === "write" ? "" : wf.memory }];
    await act("workflows_save", { workflows: next }, `Saved ${wf.name} to kula.toml`).catch(() => {});
    setAdding(false);
    // the sidebar opens on the new agent, in edit mode
    setSel(wf.name);
    setDraft({ ...blank(), ...wf, memory: wf.memory || "write" });
    setOrig(wf.name);
  };
  const remove = async () => {
    if (!draft || !orig) return;
    const builtin = BUILTIN.includes(orig);
    if (!confirm(builtin ? `Reset ${orig} to kula's built-in?` : `Delete the ${orig} workflow from kula.toml?`)) return;
    await act("workflows_save", { workflows: own.filter((w) => w.name !== orig) }, builtin ? "Reset to built-in" : "Deleted").catch(() => {});
    close();
  };
  const set = (k: keyof Workflow, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const sugg = info.suggestions.filter((s) => s.kind === "workflow");

  // Card data: the backend route (module B1) when it answers, otherwise the
  // same shape derived from AgentsInfo – one view, one shape, either way.
  // Research loops are their own tab (U19): they never show as agent cards.
  const [remote, setRemote] = useState<CardData[] | null>(null);
  useEffect(() => { fetchCards().then(setRemote); }, [info]);
  const agents = info.workflows.filter((w) => !w.research);
  const cards: (CardData | null)[] = (remote ?? agents.map(toCard)).filter((c) => c && agents.some((w) => w.name === c.name));
  return (
    <div className="wf-tabs">
      {sugg.map((s) => <SuggestionRow key={s.id} s={s} act={act} />)}
      <div className="cards ag-cards" aria-label="Agents">
        {cards.map((c) => c && <AgentCard key={c.name} card={c} live={info.workflow?.name === c.name} onOpen={() => openCard(c.name)} />)}
        <AddCard onClick={() => { setDraft(null); setOrig(null); setAdding(true); }} />
      </div>
      {adding && <AddForm kind="agent" info={info} onCreate={createFrom} onCancel={() => setAdding(false)} />}
      {!adding && isNew && draft && (
        <div className="wf-from">
          <span className="muted">start from</span>
          {info.workflows.map((w) => (
            <button key={w.name} className="chip-toggle" title={w.about} onClick={() => setDraft({ ...blank(), ...w, name: `${w.name}-copy`, builtin: undefined, memory: w.memory || "write" })}>{w.name}</button>
          ))}
          <button className="chip-toggle" onClick={() => setDraft(blank())}>blank</button>
        </div>
      )}
      {!adding && (isNew ? draft : sel && draft) ? (
        <AgentSidebar
          wf={draft!} orig={orig} info={info} isNew={isNew} dirty={dirty} act={act}
          onGraph={(w) => onGraph(w)} onSet={set}
          onSave={save} onRemove={remove} onClose={close} />
      ) : !adding && !draft && <Empty title="Pick a card" />}
    </div>
  );
}

export { BUILTIN };
