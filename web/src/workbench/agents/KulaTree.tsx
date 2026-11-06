// W4 – explorer below connectors: the kula:// virtual tree (deck p.9, PLAN §4).
// One real source per file, shown in the file header when opened. Runs are
// read-only; memory counts come from the mock record. Tree rows and graph
// badges open the same file (shared selection store).
import { useMemo, useState } from "react";
import { FileTree, type FileTreeNode } from "@/workbench/kit/file-tree/file-tree";
import { setAgentsUi, useAgentsUi } from "@/workbench/agents/selection";
import { MOCK_MEMORIES } from "@/workbench/mock/agents";
import { MOCK_FILES } from "@/workbench/mock/files";

// Build the tree from the shape in PLAN §4. Memory counts derive from the
// mock record; the file sources come from mock/files.ts (one auditable map).
function buildTree(): FileTreeNode[] {
  const memories = MOCK_MEMORIES;
  const stale = memories.filter((m) => !m.fresh);
  const byBlock: FileTreeNode[] = [];
  const seenBlocks = new Map<string, FileTreeNode>();
  for (const m of memories) {
    let folder = seenBlocks.get(m.block);
    if (!folder) {
      folder = { id: `folder:by-block/${m.block}`, name: m.block, children: [] };
      seenBlocks.set(m.block, folder);
      byBlock.push(folder);
    }
    folder.children!.push({ id: m.id, name: `${m.title}${m.fresh ? "" : " · stale"}` });
  }
  return [
    {
      id: "folder:connectors",
      name: "connectors",
      children: [
        { id: "kula://connectors/harnesses.toml", name: "harnesses.toml" },
        { id: "kula://connectors/mcp.json", name: "mcp.json" },
        { id: "kula://connectors/skills", name: "skills" },
      ],
    },
    {
      id: "folder:teams",
      name: "teams",
      children: [
        {
          id: "folder:teams/map-rework",
          name: "map-rework",
          children: [
            { id: "kula://teams/map-rework/team.toml", name: "team.toml" },
            { id: "kula://teams/map-rework/planner.toml", name: "planner.toml" },
            { id: "kula://teams/map-rework/coder-1.toml", name: "coder-1.toml" },
            { id: "kula://teams/map-rework/coder-2.toml", name: "coder-2.toml" },
            { id: "kula://teams/map-rework/critic.toml", name: "critic.toml" },
            { id: "kula://teams/map-rework/prompts/coder-1.md", name: "prompts/coder-1.md" },
          ],
        },
      ],
    },
    {
      id: "folder:workflows",
      name: "workflows",
      children: [
        { id: "kula://workflows/fix.toml", name: "fix.toml" },
        { id: "kula://workflows/review.toml", name: "review.toml" },
        { id: "kula://workflows/research.toml", name: "research.toml" },
      ],
    },
    { id: "kula://fences.toml", name: "fences.toml" },
    {
      id: "folder:memory",
      name: `memory ${memories.length + stale.length}`,
      children: [
        { id: "folder:memory/by-block", name: "by-block", children: byBlock },
        { id: "folder:memory/by-agent", name: "by-agent", children: [{ id: "kula://memory/by-agent/(symlinked view)", name: "same notes, symlinked view" }] },
        { id: "folder:memory/stale", name: `stale ${stale.length}`, children: stale.map((m) => ({ id: m.id, name: m.title })) },
      ],
    },
    {
      id: "folder:runs",
      name: "runs",
      children: [
        { id: "kula://runs/42.jsonl", name: "42.jsonl" },
        { id: "kula://runs/41.jsonl", name: "41.jsonl" },
      ],
    },
  ];
}

// Branches open at first glance – the deck wants content visible, not a
// closed tree (deck p.9 note 2).
const OPEN_AT_START = ["folder:connectors", "folder:teams", "folder:teams/map-rework", "folder:memory", "folder:memory/by-block", "folder:by-block/indexer", "folder:by-block/map-engine"];

export function KulaTree() {
  const ui = useAgentsUi();
  const [nodes] = useState(buildTree);
  // Memory files open in the blame editor; everything else as a plain file.
  const isMemory = (id: string) => MOCK_MEMORIES.some((m) => m.id === id);
  const selectable = useMemo(
    () => new Set(Object.keys(MOCK_FILES)),
    [],
  );

  const open = (id: string) => {
    if (!selectable.has(id)) return;
    if (isMemory(id)) setAgentsUi({ memoryOpen: id, openFile: id });
    else setAgentsUi({ openFile: id, memoryOpen: null });
  };

  return (
    <div data-testid="wb-kula-tree" className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex items-center justify-between border-y border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">kula://</span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <FileTree
          nodes={nodes}
          selectedId={ui.openFile ?? ui.memoryOpen}
          onSelect={(n) => open(n.id)}
          size="md"
          defaultOpenIds={OPEN_AT_START}
        />
      </div>
      <p className="border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
        Virtual: each file maps to one real source, named in its header. Enter opens; runs are read-only.
      </p>
    </div>
  );
}
