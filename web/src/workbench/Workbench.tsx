import { useState, useEffect, useCallback } from "react";
import "./workbench.css"; // shell-scoped Tailwind utilities (see file header)
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/workbench/kit/resizable";
import { TitleBar } from "@/workbench/shell/TitleBar";
import { ActivityBar } from "@/workbench/shell/ActivityBar";
import { ExplorerColumn } from "@/workbench/shell/ExplorerColumn";
import { CenterTabs } from "@/workbench/shell/CenterTabs";
import { InspectorColumn } from "@/workbench/shell/InspectorColumn";
import { BottomPanel } from "@/workbench/shell/BottomPanel";
import { CommandPalette } from "@/workbench/shell/CommandPalette";
import { WorkbenchRegistry } from "@/workbench/registry";
import type { Activity, BottomPanelTab } from "@/workbench/registry";
import { FileText, Box, GitBranch, GitCommitHorizontal, ShieldCheck } from "lucide-react";
// W2 map + fences activities register through ensurePlaceholders in rail order.
import { registerMapActivity, registerFencesActivity } from "@/workbench/map";
import { registerRunsActivity } from "@/workbench/runs";
import { registerAgentsActivity } from "@/workbench/agents";

// Placeholder activities so every slot is populated before W2–W4 land.
// They register real shapes ({id, icon, Explorer, Inspector, tabs}) that the
// later modules replace via WorkbenchRegistry.register.
function Placeholder({ what }: { what: string }) {
  return (
    <div className="p-4 text-xs text-muted-foreground" data-testid="wb-placeholder">
      {what} – placeholder, lands in a later module. <span className="opacity-40">MOCK</span>
    </div>
  );
}

const PLACEHOLDERS: Activity[] = [
  {
    id: "map",
    label: "Map",
    icon: Box,
    Explorer: () => <Placeholder what="map explorer" />,
    Inspector: () => <Placeholder what="map inspector" />,
    tabs: [{ id: "map-graph", label: "Graph", component: () => <Placeholder what="map graph" /> }],
  },
  {
    id: "runs",
    label: "Runs",
    icon: FileText,
    Explorer: () => <Placeholder what="runs explorer" />,
    Inspector: () => <Placeholder what="runs inspector" />,
    tabs: [{ id: "runs-lanes", label: "Lanes", component: () => <Placeholder what="run lanes" /> }],
  },
  {
    id: "agents",
    label: "Agents",
    icon: GitBranch,
    Explorer: () => <Placeholder what="agents explorer" />,
    Inspector: () => <Placeholder what="agents inspector" />,
    tabs: [{ id: "agents-table", label: "Agents", component: () => <Placeholder what="agent table" /> }],
  },
  {
    id: "fences",
    label: "Fences",
    icon: ShieldCheck,
    Explorer: () => <Placeholder what="fences explorer" />,
    Inspector: () => <Placeholder what="fences inspector" />,
    tabs: [{ id: "fences-list", label: "Guards", component: () => <Placeholder what="fence list" /> }],
  },
  {
    id: "git",
    label: "Git",
    icon: GitCommitHorizontal,
    Explorer: () => <Placeholder what="git explorer" />,
    Inspector: () => <Placeholder what="git inspector" />,
    tabs: [{ id: "git-log", label: "Log", component: () => <Placeholder what="git log" /> }],
  },
];

function ensurePlaceholders() {
  // W2 replaces the map and fences placeholders; rail order must stay
  // map, runs, agents, fences, git so ⌥1–5 keeps its meaning.
  registerMapActivity();
  registerRunsActivity();
  registerAgentsActivity();
  for (const p of PLACEHOLDERS.filter((p) => p.id !== "git" && p.id !== "fences")) {
    if (!WorkbenchRegistry.get(p.id)) WorkbenchRegistry.register(p);
  }
  registerFencesActivity();
  for (const p of PLACEHOLDERS.filter((p) => p.id === "git")) {
    if (!WorkbenchRegistry.get(p.id)) WorkbenchRegistry.register(p);
  }
}

// The workbench shell. Route: #/wb. Everything resizable via
// react-resizable-panels; keyboard: ⌘K palette, ⌘J bottom panel,
// ⌥I inspector, ⌥1–N activity. Scoped here – the App-level global palette
// owns ⌘K outside #/wb.
export function Workbench() {
  ensurePlaceholders();
  const activities = WorkbenchRegistry.list();
  const [active, setActive] = useState(() => {
    const fromHash = location.hash.slice(5);
    return activities.some((a) => a.id === fromHash) ? fromHash : (activities[0]?.id ?? "map");
  });
  // Selecting an activity deep-links: #/wb/<id>, so rail, ⌥1–9 and the
  // palette land on the same URL (replaceState – no history spam, no remount:
  // the route listener only checks the #/wb prefix).
  const selectActivity = useCallback((id: string) => {
    setActive(id);
    history.replaceState(null, "", `#/wb/${id}`);
  }, []);
  const [commandOpen, setCommandOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  // On a phone the three-column split leaves the explorer ~58px wide; the
  // inspector starts collapsed there so the explorer and centre get the width.
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 640);

  const panelTabs: BottomPanelTab[] = activities.flatMap((a) => a.panelTabs ?? []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanelOpen((o) => !o);
      } else if (e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInspectorOpen((o) => !o);
      } else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const a = activities[Number(e.key) - 1];
        if (a) {
          e.preventDefault();
          selectActivity(a.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activities]);

  const runVerb = useCallback((verb: string) => {
    // W1 keeps the palette wired to the shell only; verb execution lands with
    // the terminal integration. Echo into the ledger lane for now.
    setCommandOpen(false);
    setActive((cur) => cur);
    console.info("[wb] verb requested:", verb);
  }, []);

  return (
    <>
      {/* native scrollbars inside the workbench stay on-palette (warm grey on black) */}
      <style>{`.kwb-theme ::-webkit-scrollbar{width:8px;height:8px;background:#000}.kwb-theme ::-webkit-scrollbar-thumb{background:#24201d}`}</style>
      <div
        className="kwb-theme flex h-screen w-full flex-col overflow-hidden bg-background font-mono text-foreground"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#24201d #000000" }}
        data-testid="wb-root"
    >
      <TitleBar onOpenCommand={() => setCommandOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <ActivityBar activities={activities} active={active} onSelect={selectActivity} />
        <div className="min-w-0 flex-1">
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel>
              <ResizablePanelGroup direction="horizontal" autoSaveId="wb-main">
                <ResizablePanel defaultSize={20} minSize={10} data-testid="wb-panel-explorer">
                  <ExplorerColumn activities={activities} active={active} />
                </ResizablePanel>
                <ResizableHandle
                  className="w-7 border-x-[13.5px] border-transparent bg-border bg-clip-content"
                  aria-label="Resize explorer"
                />
                <ResizablePanel defaultSize={55} minSize={30}>
                  <CenterTabs activities={activities} active={active} />
                </ResizablePanel>
                <ResizableHandle
                  className="w-7 border-x-[13.5px] border-transparent bg-border bg-clip-content"
                  aria-label="Resize inspector"
                />
                {inspectorOpen && (
                  <>
                    <ResizablePanel defaultSize={25} minSize={12} data-testid="wb-panel-inspector">
                      <InspectorColumn activities={activities} active={active} />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </ResizablePanel>
            {panelOpen && (
              <>
                <ResizableHandle
                  className="w-7 border-x-[13.5px] border-transparent bg-border bg-clip-content"
                  aria-label="Resize bottom panel"
                />
                <ResizablePanel defaultSize={28} minSize={10}>
                  <BottomPanel extraTabs={panelTabs} onClose={() => setPanelOpen(false)} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        activities={activities}
        onActivity={(id) => {
          setCommandOpen(false);
          selectActivity(id);
        }}
        onVerb={runVerb}
        blocks={[
          { symbol: "parse_hash", path: "src/hash.rs:62" },
          { symbol: "Workbench", path: "web/src/workbench/Workbench.tsx" },
        ]}
      />
    </div>
    </>
  );
}

export default Workbench;
