// W4 – agents center tab (deck p.9 note 5): full-width team graph; when a
// file is open it splits – graph left, file right – via kit/resizable inside
// our own tab content (CenterTabs does not split; guidance-w1/w4 decision).
// Closing the file returns to the full graph.
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/workbench/kit/resizable";
import { ScrollArea } from "@/workbench/kit/scroll-area";
import { TeamGraph } from "@/workbench/agents/TeamGraph";
import { FileViewer } from "@/workbench/agents/FileViewer";
import { MemoryEditor } from "@/workbench/agents/MemoryEditor";
import { useAgentsUi, setAgentsUi } from "@/workbench/agents/selection";
import { MOCK_MEMORIES } from "@/workbench/mock/agents";

export function AgentsTab() {
  const ui = useAgentsUi();
  const open = ui.openFile;
  const isMemory = !!open && MOCK_MEMORIES.some((m) => m.id === open);

  return (
    <div data-testid="wb-agents-tab" className="flex min-h-0 flex-1 flex-col">
      {open ? (
        <ResizablePanelGroup direction="horizontal" autoSaveId="wb-agents-split">
          <ResizablePanel defaultSize={55} minSize={25}>
            <ScrollArea className="h-full">
              <TeamGraph />
            </ScrollArea>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={45} minSize={25}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[10px] text-muted-foreground">
                <span>file · {open}</span>
                <button
                  type="button"
                  data-testid="wb-file-close"
                  onClick={() => setAgentsUi({ openFile: null, memoryOpen: null, pendingDiff: null })}
                  className="border border-border px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                  close · back to full graph
                </button>
              </div>
              {isMemory ? <MemoryEditor /> : <FileViewer path={open} />}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <ScrollArea className="h-full">
          <TeamGraph />
        </ScrollArea>
      )}
    </div>
  );
}
