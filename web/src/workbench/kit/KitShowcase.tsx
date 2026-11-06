import * as React from "react";
import { Badge } from "@/workbench/kit/badge";
import { Button } from "@/workbench/kit/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/workbench/kit/resizable";
import { ScrollArea } from "@/workbench/kit/scroll-area";
import { Separator } from "@/workbench/kit/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/workbench/kit/tabs";
import { Input } from "@/workbench/kit/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/workbench/kit/tooltip";
import { FileTree, type FileTreeNode } from "@/workbench/kit/file-tree/file-tree";
import { CodeView, type BlameLine, type CodeLine } from "@/workbench/kit/code-view/code-view";
import { LaneChart, type LaneChartLane, type LaneChartTask } from "@/workbench/kit/lane-chart/lane-chart";

const tree: FileTreeNode[] = [
  {
    id: "src",
    name: "src",
    children: [
      { id: "src-main", name: "main.rs" },
      {
        id: "src-kit",
        name: "kit",
        children: [
          { id: "src-kit-theme", name: "theme.css" },
          { id: "src-kit-readme", name: "README.md" },
        ],
      },
    ],
  },
  { id: "cargo", name: "Cargo.toml" },
];

const lines: CodeLine[] = [
  { id: "l1", text: "use kula::graph::Graph;" },
  { id: "l2", text: "let g = Graph::open(path)?;", kind: "add" },
  { id: "l3", text: "g.sync()?;" },
  { id: "l4", text: "// blame lands here", kind: "mod" },
  { id: "l5", text: "g.close()" },
];

const blame: BlameLine[] = [
  { lineId: "l1", author: "a.sharma", rev: "a1b2c3d", date: "2025-01-04" },
  { lineId: "l2", author: "a.sharma", rev: "e4f5a6b", date: "2025-01-06" },
  { lineId: "l4", author: "k.team", rev: "b7c8d9e", date: "2025-01-11" },
];

const lanes: LaneChartLane[] = [
  { id: "s1", label: "S1 · kit" },
  { id: "s2", label: "S2 · shell" },
  { id: "s3", label: "S3 · graph" },
];

const tasks: LaneChartTask[] = [
  { id: "t1", laneId: "s1", label: "tailwind + shadcn", start: 0, end: 3 },
  { id: "t2", laneId: "s2", label: "workspace", start: 2, end: 5 },
  { id: "t3", laneId: "s3", label: "indexer", start: 4, end: 7 },
];

export function KitShowcase() {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showBlame, setShowBlame] = React.useState(true);

  return (
    <div className="kwb-theme min-h-screen bg-background p-4 text-foreground">
      <h1 className="mb-3 text-sm uppercase tracking-[0.14em] text-muted-foreground">
        workbench kit – S1 showcase
      </h1>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm">primary</Button>
        <Button variant="outline" size="sm">outline</Button>
        <Badge>accent</Badge>
        <Badge variant="outline">outline</Badge>
        <Input className="w-40" placeholder="filter…" data-testid="kwb-input" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="kwb-tooltip-btn">?</Button>
            </TooltipTrigger>
            <TooltipContent>radius 0, mono, #ff5a1f</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <button
          type="button"
          data-testid="kwb-blame-toggle"
          className="border border-border px-2 py-1 text-xs text-foreground"
          onClick={() => setShowBlame((v) => !v)}
        >
          blame: {showBlame ? "on" : "off"}
        </button>
      </div>
      <Separator className="mb-3" />
      <ResizablePanelGroup direction="horizontal" className="h-[420px]">
        <ResizablePanel defaultSize={30} minSize={20}>
          <ScrollArea className="h-full pr-2">
            <Tabs defaultValue="tree" data-testid="kwb-tabs">
              <TabsList>
                <TabsTrigger value="tree">tree</TabsTrigger>
                <TabsTrigger value="lanes">lanes</TabsTrigger>
              </TabsList>
              <TabsContent value="tree">
                <FileTree nodes={tree} selectedId={selected} onSelect={(n) => setSelected(n.id)} />
              </TabsContent>
              <TabsContent value="lanes">
                <LaneChart lanes={lanes} tasks={tasks} slots={8} />
              </TabsContent>
            </Tabs>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={70}>
          <CodeView lines={lines} blame={blame} showBlame={showBlame} path="src/kit.ts" />
        </ResizablePanel>
      </ResizablePanelGroup>
      <p data-testid="kwb-selection" className="mt-2 text-xs text-muted-foreground">
        selected: {selected ?? "none"}
      </p>
    </div>
  );
}
