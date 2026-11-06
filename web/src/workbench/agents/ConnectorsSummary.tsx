// W4 – explorer top: connectors summary (deck p.9, PLAN §3). One line per
// kind: count + status dot; drift/down render in the accent (needs you).
// Click opens its config file in the center split tab. Glance level: name,
// one number, one dot – no lists until expanded.
import { useMemo, useState } from "react";
import { MOCK_CONNECTORS, type ConnectorKind } from "@/workbench/mock/agents";
import { setAgentsUi, useAgentsUi } from "@/workbench/agents/selection";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/workbench/kit/collapsible";
import { ChevronRight } from "lucide-react";

const KIND_LABEL: Record<ConnectorKind, string> = {
  harnesses: "harnesses",
  mcp: "mcp servers",
  skills: "skills",
  hooks: "hooks",
  services: "services",
};

const KIND_ORDER: ConnectorKind[] = ["harnesses", "mcp", "skills", "hooks", "services"];

function statusDot(status: "ok" | "drift" | "down") {
  // ok = ink grey dot; drift/down = accent (needs you), deck p.9.
  return status === "ok" ? "bg-muted-foreground" : "bg-primary";
}

export function ConnectorsSummary() {
  const ui = useAgentsUi();
  const [openKind, setOpenKind] = useState<ConnectorKind | null>(null);

  const byKind = useMemo(() => {
    const m = new Map<ConnectorKind, typeof MOCK_CONNECTORS>();
    for (const k of KIND_ORDER) m.set(k, []);
    for (const c of MOCK_CONNECTORS) m.get(c.kind)!.push(c);
    return m;
  }, []);

  // One line per kind: count + a drift flag if any member drifted.
  const kindLine = (k: ConnectorKind) => {
    const items = byKind.get(k)!;
    const bad = items.filter((c) => c.status !== "ok").length;
    const count = k === "services" ? items.map((c) => c.name).join(" · ") : String(items.reduce((n, c) => n + c.count, 0));
    return { count, bad };
  };

  return (
    <div data-testid="wb-connectors" className="text-xs">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Connectors {MOCK_CONNECTORS.length}</span>
        <span className="opacity-40">MOCK</span>
      </div>
      {KIND_ORDER.map((k) => {
        const { count, bad } = kindLine(k);
        const open = openKind === k;
        return (
          <Collapsible key={k} open={open} onOpenChange={(o) => setOpenKind(o ? k : null)}>
            <div className="flex items-center justify-between border-b border-border/50">
              <CollapsibleTrigger
                data-testid={`wb-connector-${k}`}
                className="flex min-h-10 flex-1 items-center gap-2 px-2 py-1.5 text-left text-foreground/80 hover:bg-accent/10 md:min-h-0"
              >
                <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="flex-1 truncate">{KIND_LABEL[k]}</span>
                <span className={`shrink-0 px-1.5 tabular-nums ${bad ? "text-primary" : "text-muted-foreground"}`}>{count}</span>
                <span aria-hidden data-testid={`wb-connector-dot-${k}`} className={`inline-block size-2 shrink-0 rounded-full ${statusDot(bad ? "drift" : "ok")}`} />
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div role="group" className="border-b border-border/50 bg-secondary/30">
                {byKind.get(k)!.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`wb-connector-item-${c.id}`}
                    onClick={() => setAgentsUi({ openFile: c.config, memoryOpen: null })}
                    className="flex min-h-9 w-full items-center justify-between gap-2 px-3 py-1 text-left text-foreground/70 hover:bg-accent/10 md:min-h-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-full ${statusDot(c.status)}`} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{c.kind === "services" ? c.name : c.count}</span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
        Click a kind or a member to open its config. {ui.agentId ? "Drift and broken wiring show in Problems (⌘J)." : ""}
      </p>
    </div>
  );
}
