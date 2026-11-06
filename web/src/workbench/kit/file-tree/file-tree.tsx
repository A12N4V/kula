import * as React from "react";
import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/workbench/kit/collapsible";
import { cn } from "cn";

export type FileTreeNode = {
  id: string;
  name: string;
  children?: FileTreeNode[];
};

export type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedId?: string | null;
  onSelect?: (node: FileTreeNode) => void;
  defaultOpenIds?: string[];
  className?: string;
};

/* kula variant of the umriss-ui TreeView (21st.dev, MIT):
   radius 0, hairline greys, accent row selection, no shadows.
   Folders collapse via the shadcn Collapsible primitive. */
export function FileTree({
  nodes,
  selectedId,
  onSelect,
  defaultOpenIds = [],
  className,
}: FileTreeProps) {
  const openIds = React.useMemo(() => new Set(defaultOpenIds), [defaultOpenIds]);

  const renderNodes = (list: FileTreeNode[], depth: number) => (
    <ul role="group" className="m-0 list-none p-0">
      {list.map((node) => {
        const isFolder = !!node.children?.length;
        const selected = node.id === selectedId;
        return (
          <li key={node.id}>
            <Collapsible defaultOpen={openIds.has(node.id)}>
              <div
                data-testid={`file-tree-item-${node.id}`}
                data-kwb-selected={selected || undefined}
                className={cn(
                  "group flex items-center gap-1 py-[3px] pr-2 text-[13px] leading-5",
                  "text-foreground/80 hover:bg-secondary",
                  selected && "bg-secondary text-primary",
                )}
                style={{ paddingLeft: depth * 14 }}
              >
                {isFolder ? (
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex h-6 w-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                      aria-label={`Toggle ${node.name}`}
                    >
                      <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                    </button>
                  </CollapsibleTrigger>
                ) : (
                  <span className="inline-block w-6 shrink-0" />
                )}
                {isFolder ? (
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <button
                  type="button"
                  className="truncate border-0 bg-transparent p-0 text-left text-inherit hover:text-foreground"
                  onClick={() => onSelect?.(node)}
                >
                  {node.name}
                </button>
              </div>
              {isFolder && (
                <CollapsibleContent>
                  {renderNodes(node.children!, depth + 1)}
                </CollapsibleContent>
              )}
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div
      data-testid="kwb-file-tree"
      className={cn("kwb-file-tree overflow-auto text-sm", className)}
    >
      {renderNodes(nodes, 0)}
    </div>
  );
}
