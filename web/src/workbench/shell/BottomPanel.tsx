import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/workbench/kit/tabs";
import { PanelBottom, X } from "lucide-react";
import type { BottomPanelTab } from "@/workbench/registry";

export const BUILT_IN_PANEL_TABS: BottomPanelTab[] = [
  { id: "ledger", label: "Ledger", component: LedgerTab, order: 10 },
  { id: "terminal", label: "Terminal", component: TerminalTab, order: 20 },
  { id: "diff", label: "Diff", component: DiffTab, order: 30 },
  { id: "tests", label: "Tests", component: TestsTab, order: 40 },
  { id: "check", label: "Check", component: CheckTab, order: 50 },
  { id: "problems", label: "Problems", component: ProblemsTab, order: 60 },
];

function Row({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-xs text-muted-foreground">{children}</div>;
}

function LedgerTab() {
  return (
    <div data-testid="wb-panel-ledger">
      {[
        ["09:41:02", "commit", "s1: kit merged – 21 primitives themed"],
        ["09:44:17", "agent", "W2 · Map started run #42"],
        ["09:47:55", "agent", "W3 · Ledger waiting on /api/agents"],
        ["09:52:10", "commit", "w1: shell frame"],
      ].map(([ts, kind, text]) => (
        <Row key={ts}>
          <span className="opacity-60">{ts}</span> <span className="text-accent">{kind}</span> {text}
        </Row>
      ))}
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

function TerminalTab() {
  return (
    <div data-testid="wb-panel-terminal">
      <Row>kula agents ls</Row>
      <Row>id   name   state    tokens</Row>
      <Row>w2   map    running   412k</Row>
      <Row>w3   ledger idle      188k</Row>
      <Row>$ <span className="ml-1 inline-block h-3 w-1.5 bg-accent align-middle" /></Row>
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

function DiffTab() {
  return (
    <div data-testid="wb-panel-diff" className="font-mono text-xs">
      {[
        ["ctx", 61, "  fn parse_hash(h: &str) -> Option<Dest> {"],
        ["del", 62, "-   match VIEWS.binary_search(h) {"],
        ["add", 62, "+   if let Some(wb) = h.strip_prefix(\"#/wb\") {"],
        ["add", 63, "+       return Some(Dest::Workbench);"],
        ["ctx", 64, "  }"],
      ].map(([kind, no, text]) => (
        <Row key={String(no) + String(kind)}>
          <span className={kind === "add" ? "text-green-600" : kind === "del" ? "text-red-500" : ""}>{text}</span>
        </Row>
      ))}
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

function TestsTab() {
  return (
    <div data-testid="wb-panel-tests">
      {[
        ["e2e/wbkit.spec.ts", "pass", "412ms"],
        ["e2e/workbench.spec.ts", "run", "…"],
        ["e2e/map.spec.ts", "pass", "1.18s"],
      ].map(([f, s, ms]) => (
        <Row key={f}>{f} <span className={s === "pass" ? "text-green-600" : "text-accent"}>{s}</span> <span className="opacity-60">{ms}</span></Row>
      ))}
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

function CheckTab() {
  return (
    <div data-testid="wb-panel-check">
      {[["cargo clippy", "pass"], ["tsc", "pass"], ["e2e wbkit", "pass"]].map(([n, s]) => (
        <Row key={n}>{n} <span className="text-green-600">{s}</span></Row>
      ))}
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

function ProblemsTab() {
  return (
    <div data-testid="wb-panel-problems">
      <Row>Workbench.tsx:12 <span className="text-muted-foreground">info</span> panel state not persisted yet – W1 todo</Row>
      <Row><span className="opacity-40">MOCK</span></Row>
    </div>
  );
}

// Bottom panel: Ledger, Terminal, Diff, Tests, Check, Problems plus any
// panelTabs registered by activities. ⌘J toggles the whole panel.
export function BottomPanel({
  extraTabs = [],
  onClose,
}: {
  extraTabs?: BottomPanelTab[];
  onClose: () => void;
}) {
  // De-duplicate by topic (keep the earliest order): activities may register
  // a panel tab for a topic the shell also ships as a built-in placeholder
  // under a different id, and two tabs labelled alike would both render.
  const seen = new Set<string>();
  const tabs = [...BUILT_IN_PANEL_TABS, ...extraTabs]
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id))
    .filter((t) => !seen.has(t.label) && seen.add(t.label));
  return (
    <div data-testid="wb-bottom-panel" data-figure="wb-bottom-panel" className="flex h-full min-h-0 flex-col border-t border-border bg-card">
      <Tabs defaultValue={tabs[0]?.id} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex h-8 shrink-0 items-center border-b border-border px-1">
          <TabsList className="h-8 gap-0 rounded-none bg-transparent p-0">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`wb-panel-tab-${t.id}`}
                className="h-8 rounded-none bg-transparent px-3 text-xs data-[state=active]:text-accent"
              >
                {t.label}
                <X size={10} className="ml-1.5 opacity-30" />
              </TabsTrigger>
            ))}
          </TabsList>
          <button
            type="button"
            data-testid="wb-panel-close"
            aria-label="Hide bottom panel"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 cursor-pointer items-center justify-center bg-transparent text-muted-foreground hover:text-foreground"
          >
            <PanelBottom size={14} />
          </button>
        </div>
        {tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="mt-0 min-h-0 flex-1 overflow-auto">
            <t.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
