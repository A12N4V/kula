// W4 – inspector: the selected agent's config plus the memory access table
// (deck p.9 right column, PLAN §5). Matrix rows = memory folders, columns =
// read / write / authored / last – a table, not a second tree (guidance-w4
// decision). Reads · 7d come from ledger memory.read events (mocked).
import { useMemo } from "react";
import {
  MOCK_AGENTS,
  MOCK_CONNECTORS,
  MOCK_READS,
  type MemoryAccessRow,
} from "@/workbench/mock/agents";
import { useAgentsUi, setAgentsUi } from "@/workbench/agents/selection";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/workbench/kit/table";
import { MOCK_FILES } from "@/workbench/mock/files";

function Dot({ on }: { on: boolean }) {
  return <span aria-label={on ? "yes" : "no"} className={`inline-block size-2 rounded-full ${on ? "bg-primary" : "bg-muted-foreground/40"}`} />;
}

function Section({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) {
  return (
    <section data-testid={testid} className="border-b border-border/60 px-3 py-2">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="pt-1">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right text-foreground/90">{v}</span>
    </div>
  );
}

export function AgentInspector() {
  const ui = useAgentsUi();
  const agent = useMemo(() => MOCK_AGENTS.find((a) => a.id === ui.agentId) ?? null, [ui.agentId]);

  if (!agent) {
    return (
      <div className="p-3 text-xs text-muted-foreground" data-testid="wb-agents-inspector">
        No agent selected – click a node in the team graph.
      </div>
    );
  }

  const skills = MOCK_CONNECTORS.filter((c) => c.kind === "skills");
  const connectorsUsed: [string, string][] = [
    ["mcp", agent.mcp.join(", ")],
    ["skills", `${agent.skills.length} of ${skills.reduce((n, s) => n + s.count, 0)}`],
    ["hooks", "pre-edit, post-edit"],
  ];

  return (
    <div data-testid="wb-agents-inspector" className="flex h-full min-h-0 flex-col overflow-y-auto text-xs">
      <Section title={`Agent · ${agent.name}`} testid="wb-inspector-identity">
        <Row k="harness" v={agent.harness} />
        <Row k="model" v={agent.model} />
        <Row k="workflow" v={agent.workflow} />
        <Row k="scope" v={agent.scope.join(", ")} />
        <Row k="budget" v={<span className="tabular-nums">{agent.budget.toLocaleString("en-US")}</span>} />
        <Row k="wave" v={String(agent.wave)} />
        <button
          type="button"
          data-testid="wb-inspector-open-config"
          onClick={() => setAgentsUi({ agentId: agent.id, openFile: agent.file, memoryOpen: null })}
          onKeyDown={(e) => {
            if (e.key === "Enter") setAgentsUi({ agentId: agent.id, openFile: agent.file, memoryOpen: null });
          }}
          className="mt-1 border border-border px-2 py-1 text-[11px] text-foreground/80 hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
        >
          Open {agent.name}.toml ▫
        </button>
      </Section>

      <Section title="Connectors used">
        {connectorsUsed.map(([k, v]) => (
          <Row key={k} k={k} v={v} />
        ))}
      </Section>

      <Section title={`Memory access · ${agent.name}`} testid="wb-inspector-access">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 text-[10px]">folder</TableHead>
              <TableHead className="h-7 text-[10px]">r</TableHead>
              <TableHead className="h-7 text-[10px]">w</TableHead>
              <TableHead className="h-7 text-[10px]">by me</TableHead>
              <TableHead className="h-7 text-[10px]">last</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agent.access.map((row: MemoryAccessRow) => (
              <TableRow key={row.folder} data-testid={`wb-access-${row.folder.replace(/[^a-z-]+/gi, "-").toLowerCase()}`}>
                <TableCell className="py-1 text-xs">{row.folder}</TableCell>
                <TableCell className="py-1"><Dot on={row.read} /></TableCell>
                <TableCell className="py-1"><Dot on={row.write} /></TableCell>
                <TableCell className="py-1 tabular-nums text-xs">{row.authored}</TableCell>
                <TableCell className="py-1 tabular-nums text-xs text-muted-foreground">{row.last}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title={`Reads · 7d`} testid="wb-inspector-reads">
        {Object.entries(MOCK_READS).map(([who, n]) => (
          <Row key={who} k={who} v={<span className="tabular-nums">{n}</span>} />
        ))}
      </Section>

      <p className="px-3 py-2 text-[10px] text-muted-foreground">
        Access from each agent's [memory] table, defaulting to the workflow's policy. <span className="opacity-40">MOCK</span>
      </p>
      {/* keep MOCK_FILES referenced so the auditable map stays the single source */}
      <span className="hidden">{Object.keys(MOCK_FILES).length}</span>
    </div>
  );
}
