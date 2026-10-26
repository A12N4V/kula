// Agents: how AI agents work in this repository, and everything you can change
// about it. Workflows (work modes with their own fences, scope, steps, docs and
// memory policy), the fences in kula.toml, the memories agents keep, the docs
// they read, and which agents are wired up. Every edit here writes the same
// files the CLI does (kula.toml, refs/kula/meta, AGENTS.md, each agent's
// config), so MCP, the pre-edit hook and `kula check` see it at once.

// Memory tab: the facts agents keep in refs/kula/meta, with the memory graph
// (module M1) above the list – every memory a node on its layer, the list
// filter (`/`) narrowing graph and list together, a graph click selecting and
// scrolling the list row, and the exact numbers under the graph.

import { useEffect, useMemo, useState } from "react";
import { get, post, relTime, type AgentsInfo, type Memory } from "../../api";
import { Chips, CodeField, HereHint, LinkArea } from "../../Autofill";
import { Icon, useToast } from "../../ui";
import type { Act } from "./data";
import { AgentMark, Card, ListFilter, useFilterList } from "./parts";
import MemoryGraph from "./MemoryGraph";

/** One store memory_sources found: a TencentDB Agent Memory directory. */
interface MemorySource { dir: string; kind: string; memories: number; wiki: string[] | number; mcp?: string }

/** Compact import banner for a TencentDB Agent Memory store: counts, one
    Import button (idempotent, toast with added/skipped), and the MCP adopt
    button – disabled with a tooltip until mcp_adopt answers on this build. */
function TencentBanner() {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [src, setSrc] = useState<MemorySource | null | undefined>(undefined);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);
  const [adopted, setAdopted] = useState<"idle" | "ok" | "no">("idle");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ sources: MemorySource[] }>("/api/agent/memory_sources")
      .then((r) => setSrc(r.sources?.find((s) => s.kind === "tencentdb") ?? null))
      .catch(() => setSrc(null));
  }, []);
  if (!src) return null;
  const wikiN = Array.isArray(src.wiki) ? src.wiki.length : Number(src.wiki ?? 0);
  const importAll = () => {
    if (busy) return;
    setBusy(true);
    post<{ added: number; skipped: number }>("/api/agent/memory_import", { dir: src.dir })
      .then((r) => { setDone(r); setOpen(false); toast(`${r.added} added · ${r.skipped} skipped`); })
      .catch((e) => toast(e.message, "err"))
      .then(() => setBusy(false));
  };
  const adopt = () => {
    // B1's contract is { name } – the server key in .mcp.json to adopt.
    post<{ written?: string[] }>("/api/agents/mcp_adopt", { name: src.mcp || "tencentdb-memory" })
      .then(() => { setAdopted("ok"); toast("TencentDB MCP adopted by every agent"); })
      .catch((e) => { setAdopted("no"); toast(e.message || "mcp_adopt failed", "err"); });
  };
  return (
    <div className={`mem-x10${open ? "" : " mem-x10-closed"}`} data-testid="mem-tencent">
      <span className="mem-x10-badge">TencentDB Agent Memory in AGENTS</span>
      <span className="muted mem-x10-counts">{src.memories} memories · {wikiN} wiki page{wikiN === 1 ? "" : "s"}</span>
      <span className="spacer" />
      {!open && <button className="btn sm ghost" onClick={() => setOpen(true)} aria-expanded={open} data-testid="mem-banner-open">show</button>}
      {done
        ? <span className="tag green" data-testid="mem-import-done">added {done.added} · skipped {done.skipped}</span>
        : <button className="btn sm primary" disabled={busy} onClick={importAll} data-testid="mem-import">Import</button>}
      <button className="btn sm ghost" onClick={adopt} disabled={adopted === "ok"}
        title={adopted === "no" ? "mcp_adopt is not on this build yet" : adopted === "ok" ? "Adopted" : "Copy its MCP server into every agent's config"}
        data-testid="mem-adopt">Use its MCP for every agent</button>
    </div>
  );
}

export default function MemoryTab({ info, act, open }: { info: AgentsInfo; act: Act; open: (t: string) => void }) {
  const [filter, setFilter] = useState<"all" | "stale" | "agents" | "people">("all");
  const [sort, setSort] = useState<"newest" | "target" | "author">("newest");
  const [target, setTarget] = useState("repo");
  const [text, setText] = useState("");
  // First screen answers "what does each agent remember and why": grouped by
  // agent, the graph is a toggle – not the default view.
  const [graphOn, setGraphOn] = useState(false);
  const mems = useMemo(() => info.memories
    .filter((m) => filter === "all" || (filter === "stale" ? m.stale : filter === "agents" ? m.author.startsWith("agent:") : !m.author.startsWith("agent:")))
    .sort((a, b) =>
      sort === "newest" ? Number(b.stale) - Number(a.stale) || b.created - a.created
      : sort === "target" ? a.target.localeCompare(b.target) || b.created - a.created
      : a.author.localeCompare(b.author) || b.created - a.created), [info, filter, sort]);
  const { filter: q, setFilter: setQ, inputRef, props: navProps, sel, setSel } = useFilterList(mems.length, (i) => open(mems[i].target), `${filter}:${sort}`);
  const shown = useMemo(() => mems
    .filter((m) => !q || `${m.target} ${m.body} ${m.author}`.toLowerCase().includes(q.toLowerCase())), [mems, q]);
  const n = (f: typeof filter) => info.memories.filter((m) => f === "all" || (f === "stale" ? m.stale : f === "agents" ? m.author.startsWith("agent:") : !m.author.startsWith("agent:"))).length;
  // grouped by the agent (or person) that wrote each memory
  const byAuthor = useMemo(() => {
    const g = new Map<string, Memory[]>();
    shown.forEach((m) => g.set(m.author, [...(g.get(m.author) ?? []), m]));
    return [...g.entries()];
  }, [shown]);
  const remember = () => act("remember", { target, text }, "Remembered – anchored to this code").then(() => setText("")).catch(() => {});
  return (
    <Card title="Memory" sub="refs/kula/meta" className="ag-memory"
      right={<>
        <ListFilter inputRef={inputRef} value={q} onChange={setQ} label="Filter memories" placeholder="/ search memories" />
        <button className={`btn sm ghost${graphOn ? " on" : ""}`} data-testid="mem-graph-toggle" aria-pressed={graphOn} onClick={() => setGraphOn(!graphOn)}><Icon.graph /> Graph</button>
        <div className="seg">{(["all", "stale", "agents", "people"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f} {n(f)}</button>)}</div>
      </>}>
      <TencentBanner />
      {info.memories.length === 0
        ? <div className="muted ag-empty">No memories yet – agents remember facts about this code here. An agent writes one with <code>kula memory add &lt;target&gt; "one fact" --by agent:&lt;name&gt;</code>, or anchor one yourself below.</div>
        : <>
          {graphOn && <MemoryGraph mems={shown} allMems={info.memories} sel={sel} onPickMem={setSel} onOpen={open} />}
          <div {...navProps}>
            {byAuthor.map(([author, list]) => (
              <div key={author} className="ag-mem-group">
                <div className="ag-mem-author"><AgentMark id={author.replace(/^agent:/, "")} /><span className="mono">{author}</span><span className="muted ag-meta">{list.length} memor{list.length === 1 ? "y" : "ies"}</span></div>
                {list.map((m, i) => <MemoryRow key={m.id} m={m} idx={i} sel={sel === i} open={open} act={act} />)}
              </div>
            ))}
            {shown.length === 0 && info.memories.length > 0 && <div className="muted ag-empty">Nothing matches.</div>}
          </div>
        </>}
      <form className="ag-remember" onSubmit={(e) => { e.preventDefault(); remember(); }}>
        <div className="stack-tight">
          <CodeField value={target} onChange={setTarget} placeholder="repo · file:path · symbol" label="Memory target" />
          <HereHint onUse={setTarget} />
        </div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="One fact agents should know, e.g. tokens are hashed twice for legacy clients" aria-label="Memory text" />
        <button className="btn sm primary" disabled={!text.trim() || !info.memory_enabled}>Remember</button>
      </form>
    </Card>
  );
}

function MemoryRow({ m, open, act, idx, sel }: { m: Memory; open: (t: string) => void; act: Act; idx: number; sel: boolean }) {
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(m.body);
  const [target, setTarget] = useState(m.target);
  // A background refresh replaces m and would clobber an in-progress edit with
  // the old body – only re-sync when the form is closed (fresh mount, or after
  // save/cancel closes it).
  useEffect(() => { if (!edit) { setBody(m.body); setTarget(m.target); } }, [m, edit]);
  const save = () => act("memory_edit", { id: m.id, text: body !== m.body ? body : "", target: target !== m.target ? target : "" }, "Memory updated").then(() => setEdit(false)).catch(() => {});
  return (
    <div className={`ag-mem ${m.stale ? "stale" : ""} ${sel ? "kb-sel" : ""}`} data-idx={idx} id={`list-item-${idx}`} draggable
      onDragStart={(e) => { try { e.dataTransfer.setData("application/x-kula-drag", JSON.stringify({ kind: "memory", id: m.id })); e.dataTransfer.setData("text/plain", `memory:${m.id}`); } catch { /* */ } }}
      title="Drag onto an agent card to scope it to that agent">
      <div className="row ag-mem-head">
        <span className={`tag ${m.stale ? "yellow" : "green"}`} title={m.stale ? "The code changed after this was written" : "Written about the code as it is"}>{m.stale ? "stale" : "fresh"}</span>
        <button className="ag-target mono" onClick={() => open(m.target)} title="Open">{m.target.replace(/^symbol:/, "")}</button>
        <span className="spacer" />
        <span className="muted ag-meta">#{m.id} · {m.author} · {relTime(m.created)}</span>
        {m.stale
          ? <button className="btn sm" onClick={() => act("confirm", { id: m.id }, "Still true – re-anchored")} title="It still holds: anchor it to the code as it is now">Still true</button>
          : <button className="btn sm ghost" onClick={() => act("memory_stale", { id: m.id }, "Marked stale")} title="Agents will verify it before relying on it">Mark stale</button>}
        <button className="btn sm ghost" onClick={() => setEdit(!edit)} aria-expanded={edit}><Icon.edit /> Edit</button>
        <button className="btn sm ghost danger" onClick={() => { if (confirm("Forget this memory?")) act("forget", { id: m.id }, "Forgotten"); }}>Forget</button>
      </div>
      {edit ? (
        <div className="stack ag-mem-edit">
          <CodeField value={target} onChange={setTarget} placeholder="target" label="Target" />
          <LinkArea value={body} onChange={setBody} onSubmit={save} minHeight={70} label="Memory text" />
          <div className="row"><span className="muted ag-meta">moving it re-anchors to the new target · ⌘↵ saves</span><span className="spacer" /><button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button><button className="btn sm primary" disabled={!body.trim() || (body === m.body && target === m.target)} onClick={save}>Save</button></div>
        </div>
      ) : <div className="ag-mem-body">{m.body}</div>}
    </div>
  );
}
