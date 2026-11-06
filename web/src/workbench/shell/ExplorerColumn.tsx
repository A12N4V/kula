import { FileTree } from "@/workbench/kit/file-tree/file-tree";
import type { FileTreeNode } from "@/workbench/kit/file-tree/file-tree";
import type { ExplorerNode } from "@/workbench/mock/state";
import { mockExplorerTree } from "@/workbench/mock/state";
import type { Activity } from "@/workbench/registry";
import { useState } from "react";

function TreeStub() {
  const [sel, setSel] = useState<string | null>(null);
  return <FileTree nodes={mockExplorerTree as unknown as FileTreeNode[]} selectedId={sel} onSelect={(n) => setSel(n.id)} />;
}

// Left column: the active activity's Explorer. Each activity owns its own.
export function ExplorerColumn({ activities, active }: { activities: Activity[]; active: string }) {
  const a = activities.find((x) => x.id === active);
  if (!a) return null;
  const E = a.Explorer;
  return (
    <div data-testid="wb-explorer" data-figure="wb-explorer" className="flex h-full flex-col bg-card">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        {a.label} · explorer <span className="ml-auto text-[9px] tracking-normal normal-case opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <E />
      </div>
    </div>
  );
}

export { TreeStub };
export type { ExplorerNode };
