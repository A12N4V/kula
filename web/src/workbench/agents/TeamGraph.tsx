// W4 – center: the team graph (deck p.9, PLAN §3). Frames = waves, nodes =
// agents, solid wires = hand-offs, dashed lines = reporting. Each node has a
// file badge (▫); badge or tree row opens the same file in the split tab.
// Pure mock geometry, keyboard accessible (role=button, Enter opens). The
// wire overlay is a fixed-geometry SVG (data-figure="wires"); node heights
// are pinned so the coordinates below match the layout exactly.
import { MOCK_AGENTS, TEAM_ID, type AgentConfig } from "@/workbench/mock/agents";
import { setAgentsUi, useAgentsUi } from "@/workbench/agents/selection";

const WAVES = [1, 2, 3];

// Layout constants shared by the flex layout and the SVG overlay. All px.
const FRAME_W = 160; // w-40
const FRAME_GAP = 16; // gap-4
const FRAME_PAD = 12; // p-3
const HEADER_H = 14; // fixed-height wave label
const NODE_W = 144; // w-36
const NODE_H = 56; // h-14, pinned so the wire math holds
const NODE_GAP = 12;
const NODE_TOP = FRAME_PAD + HEADER_H + NODE_GAP; // first node top inside a frame

function nodeCenter(a: AgentConfig, waveIndex: number, indexInWave: number) {
  return {
    x: waveIndex * (FRAME_W + FRAME_GAP) + FRAME_PAD + NODE_W / 2,
    y: NODE_TOP + indexInWave * (NODE_H + NODE_GAP) + NODE_H / 2,
    waveY: NODE_TOP + indexInWave * (NODE_H + NODE_GAP) + NODE_H / 2,
  };
}

export function TeamGraph() {
  const ui = useAgentsUi();
  const byWave = WAVES.map((w) => MOCK_AGENTS.filter((a) => a.wave === w));
  const maxNodes = Math.max(...byWave.map((w) => w.length));
  const graphH = NODE_TOP + maxNodes * NODE_H + (maxNodes - 1) * NODE_GAP + FRAME_PAD;
  const graphW = WAVES.length * FRAME_W + (WAVES.length - 1) * FRAME_GAP;

  // Edge list straight from the agent records: hand-offs solid, reporting dashed.
  const edges: { from: AgentConfig; to: AgentConfig; dashed: boolean }[] = [];
  for (const a of MOCK_AGENTS) {
    for (const t of a.handoffsTo) {
      const to = MOCK_AGENTS.find((m) => m.id === t);
      if (to) edges.push({ from: a, to, dashed: false });
    }
    if (a.reportsTo) {
      const to = MOCK_AGENTS.find((m) => m.id === a.reportsTo);
      if (to) edges.push({ from: a, to, dashed: true });
    }
  }

  const waveIndexOf = (a: AgentConfig) => WAVES.indexOf(a.wave);
  const indexIn = (a: AgentConfig) => byWave[waveIndexOf(a)].findIndex((m) => m.id === a.id);

  return (
    <div data-testid="wb-team-graph" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          team: {TEAM_ID} · {MOCK_AGENTS.length} agents · {WAVES.length} waves
        </span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="relative min-w-max">
          <svg
            data-figure="wires"
            aria-hidden="true"
            width={graphW}
            height={graphH}
            className="pointer-events-none absolute left-0 top-0"
          >
            {edges.map(({ from, to, dashed }, i) => {
              const a = nodeCenter(from, waveIndexOf(from), indexIn(from));
              const b = nodeCenter(to, waveIndexOf(to), indexIn(to));
              // Clip the wire to the gap between the two wave frames.
              const x1 = waveIndexOf(from) * (FRAME_W + FRAME_GAP) + FRAME_W + FRAME_PAD - 8;
              const x2 = waveIndexOf(to) * (FRAME_W + FRAME_GAP) + FRAME_PAD + 8;
              return (
                <line
                  key={i}
                  data-testid={dashed ? `wb-wire-report-${from.id}-${to.id}` : `wb-wire-handoff-${from.id}-${to.id}`}
                  x1={x1}
                  y1={a.waveY}
                  x2={x2}
                  y2={b.waveY}
                  stroke={dashed ? "var(--color-muted-foreground, #888)" : "var(--color-primary, #ff5a1f)"}
                  strokeWidth={dashed ? 1 : 1.5}
                  strokeDasharray={dashed ? "4 3" : undefined}
                />
              );
            })}
          </svg>
          <div className="flex gap-4">
            {WAVES.map((w, wi) => (
              <div
                key={w}
                data-testid={`wb-wave-${w}`}
                style={{ height: NODE_TOP + byWave[wi].length * NODE_H + (byWave[wi].length - 1) * NODE_GAP + FRAME_PAD }}
                className="relative w-40 shrink-0 rounded-none border border-dashed border-border p-3"
              >
                <div style={{ height: HEADER_H }} className="text-[10px] uppercase leading-[14px] tracking-wider text-muted-foreground">
                  wave {w}
                </div>
                {byWave[wi].map((a, ai) => {
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
                      style={{ top: NODE_TOP + ai * (NODE_H + NODE_GAP), width: NODE_W, height: NODE_H }}
                      className={`absolute left-3 cursor-pointer border px-2 py-1 text-left text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                        selected ? "border-primary bg-accent/10" : "border-border bg-card hover:border-foreground/40"
                      }`}
                    >
                      <span className={`block truncate font-medium ${selected ? "text-primary" : "text-foreground/90"}`}>{a.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
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
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Solid wire = hand-off · dashed = reporting. ▫ = config file – opens beside the graph.
        </p>
      </div>
    </div>
  );
}
