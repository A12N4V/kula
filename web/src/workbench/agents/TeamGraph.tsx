// W4 – center: the team graph (deck p.9, PLAN §3). Frames = waves, nodes =
// agents, solid wires = hand-offs, dashed lines = reporting. Each node has a
// file badge (▫); badge or tree row opens the same file in the split tab.
// Pure mock geometry, keyboard accessible (role=button, Enter opens).
import { MOCK_AGENTS, TEAM_ID } from "@/workbench/mock/agents";
import { setAgentsUi, useAgentsUi } from "@/workbench/agents/selection";

const WAVES = [1, 2, 3];

export function TeamGraph() {
  const ui = useAgentsUi();
  const byWave = WAVES.map((w) => MOCK_AGENTS.filter((a) => a.wave === w));

  return (
    <div data-testid="wb-team-graph" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          team: {TEAM_ID} · {MOCK_AGENTS.length} agents · {WAVES.length} waves
        </span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-w-max gap-4">
          {WAVES.map((w, wi) => (
            <div key={w} data-testid={`wb-wave-${w}`} className="flex min-w-40 flex-col gap-3 rounded-none border border-dashed border-border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">wave {w}</div>
              {byWave[wi].map((a) => {
                const selected = ui.agentId === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    data-testid={`wb-node-${a.id}`}
                    onClick={() => setAgentsUi({ agentId: a.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setAgentsUi({ agentId: a.id });
                      }
                    }}
                    className={`group relative min-h-11 w-36 cursor-pointer border px-2 py-2 text-left text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                      selected ? "border-primary bg-accent/10" : "border-border bg-card hover:border-foreground/40"
                    }`}
                  >
                    <span className={`block font-medium ${selected ? "text-primary" : "text-foreground/90"}`}>{a.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {a.harness} · {a.workflow}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${a.file} in the split tab`}
                      title={a.file}
                      data-testid={`wb-badge-${a.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAgentsUi({ agentId: a.id, openFile: a.file, memoryOpen: null });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setAgentsUi({ agentId: a.id, openFile: a.file, memoryOpen: null });
                        }
                      }}
                      className="absolute -right-2 -top-2 flex size-7 items-center justify-center border border-border bg-background text-[10px] text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                      ▫
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Solid wire = hand-off · dashed = reporting. ▫ = config file – opens beside the graph.
        </p>
      </div>
    </div>
  );
}
