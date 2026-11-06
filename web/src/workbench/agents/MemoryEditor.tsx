// W4 – memory editor (deck p.10): a markdown editor with a blame gutter
// (author · rev · date per line, agent lines in the accent), an anchor line
// with the content hash + freshness, an Authors summary, an Access list,
// Reads · 7d, and a History list. Saving shows the diff in the ledger strip
// first (⌘S writes a new revision; nothing is overwritten) – mock only, no
// real file writes: saveFile returns a diff object (mock/files.ts).
import { useEffect, useMemo, useState } from "react";
import { CodeView, type BlameLine, type CodeLine } from "@/workbench/kit/code-view/code-view";
import { MOCK_MEMORIES, MOCK_READS, type MemoryFile } from "@/workbench/mock/agents";
import { setAgentsUi, useAgentsUi } from "@/workbench/agents/selection";
import { saveFile } from "@/workbench/mock/files";
import { setRunsUi } from "@/workbench/runs/selection";

function blameOf(m: MemoryFile, lines: CodeLine[]): BlameLine[] {
  return lines.map((l, i) => {
    const src = m.lines[i];
    const accent = !!src && src.by !== "AS";
    return {
      lineId: l.id,
      author: src ? (src.by === "AS" ? "AS" : src.by.slice(0, 2)) : "AS",
      rev: `r${src?.rev ?? 1}`,
      date: src?.at ?? "–",
      accent,
    };
  });
}

// dedupeAuthors – one line per author with a line count, derived from the
// record (no hardcoded numbers).
function dedupeAuthors(m: MemoryFile): [string, number][] {
  const counts = new Map<string, number>();
  for (const l of m.lines) {
    if (!l.text) continue;
    const who = l.by === "AS" ? "AS (you)" : l.by;
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export function MemoryEditor() {
  const ui = useAgentsUi();
  const file = ui.memoryOpen;
  const memory = useMemo(() => MOCK_MEMORIES.find((m) => m.id === file) ?? null, [file]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");

  useEffect(() => {
    setEditing(false);
    setAgentsUi({ pendingDiff: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!memory) return null;
  const original = memory.lines.map((l) => l.text);
  const dirty = editing && draft !== original.join("\n");
  const view = editing ? draft.split("\n") : original;

  const lines: CodeLine[] = view.map((text, i) => ({ id: `l${i + 1}`, text }));

  const onSave = () => {
    if (!dirty) return;
    setAgentsUi({ pendingDiff: saveFile(memory.id, draft.split("\n")) });
  };

  const apply = () => {
    // Mock: writing the revision appends r{n} to the view only – no disk.
    setAgentsUi({ pendingDiff: null });
    setEditing(false);
    setDraft("");
  };

  return (
    <div data-testid="wb-memory-editor" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        <span className="uppercase tracking-[0.12em] text-muted-foreground">{memory.title}</span>
        <span data-testid="wb-memory-anchor" className="text-muted-foreground">
          anchor · {memory.anchor} · {memory.fresh ? "✓ fresh" : <span className="text-primary">stale</span>}
        </span>
        <span className="opacity-40">MOCK</span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            {editing ? (
              <textarea
                data-testid="wb-memory-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    onSave();
                  }
                }}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none border border-border bg-card p-2 font-mono text-[13px] leading-5 text-foreground/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <CodeView lines={lines} showBlame blame={blameOf(memory, lines)} path={`${memory.id} → refs/kula/meta`} />
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              {!editing ? (
                <button
                  type="button"
                  data-testid="wb-memory-edit"
                  onClick={() => {
                    setDraft(original.join("\n"));
                    setEditing(true);
                  }}
                  className="border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                  Edit note
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="wb-memory-save"
                  onClick={onSave}
                  disabled={!dirty}
                  className="border border-border px-2 py-1 text-[11px] enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                  Save revision (⌘S)
                </button>
              )}
              <span className="text-[10px] text-muted-foreground">
                {editing ? "⌘S writes a new revision · nothing is overwritten" : "gutter = author · rev · date per line"}
              </span>
            </div>
          </div>
          {/* Ledger strip: the diff the save shows first (deck p.10 bottom left). */}
          {ui.pendingDiff && (
            <div data-testid="wb-memory-diff" className="border-t border-border px-3 py-2 text-[11px]">
              <div className="text-muted-foreground">
                unsaved · {memory.id} → r{memory.history[0].rev + 1} by you
              </div>
              {ui.pendingDiff.hunks.map((h) => (
                <div key={h.line} data-testid={`wb-diff-line-${h.line}`}>
                  <span className="text-destructive">- {h.before || "∅"}</span>
                  <br />
                  <span className="text-[#8fce8f]">+ {h.after || "∅"}</span>
                </div>
              ))}
              <button
                type="button"
                data-testid="wb-memory-apply"
                onClick={apply}
                className="mt-1 border border-border px-2 py-1 text-[11px] hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
              >
                Write revision r{memory.history[0].rev + 1}
              </button>
            </div>
          )}
        </div>

        <aside className="w-56 shrink-0 overflow-y-auto border-l border-border px-3 py-2 text-[11px]">
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">Authors</h3>
          <div className="flex flex-col gap-0.5 py-1">
            {dedupeAuthors(memory).map(([who, n]) => (
              <div key={who} className="flex justify-between gap-2">
                <span className={who !== "AS (you)" ? "text-primary" : "text-foreground/80"}>{who}</span>
                <span className="tabular-nums text-muted-foreground">{n} lines</span>
              </div>
            ))}
          </div>

          <h3 className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Access</h3>
          <div className="py-1 text-muted-foreground">
            <div>
              <span className="text-foreground/70">can read</span> · planner, coder-1, coder-2, critic
            </div>
            <div>
              <span className="text-foreground/70">can write</span> · coder-2, you
            </div>
          </div>

          <h3 className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Reads · 7d</h3>
          <div className="py-1">
            {Object.entries(MOCK_READS).map(([who, n]) => (
              <div key={who} className="flex justify-between gap-2">
                <span className="text-foreground/70">{who}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </div>
            ))}
          </div>

          <h3 className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">History</h3>
          <div className="flex flex-col gap-0.5 py-1" data-testid="wb-memory-history">
            {memory.history.map((h) =>
              h.run ? (
                // Revision rows with a run deep-link the runs ledger (W3
                // contract: setRunsUi({ runId, agentId })); rows without a
                // run stay inert and carry no › affordance.
                <button
                  key={h.rev}
                  type="button"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open run #${h.run} filtered to ${h.by} in the ledger`}
                  data-testid={`wb-history-r${h.rev}`}
                  onClick={() => setRunsUi({ runId: h.run, agentId: h.by })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setRunsUi({ runId: h.run, agentId: h.by });
                    }
                  }}
                  className="flex min-h-7 w-full cursor-pointer items-center justify-between gap-2 border border-transparent px-1 py-0.5 text-left text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                  <span>
                    r{h.rev} · {h.date} · {h.by}
                    {h.run ? ` · run #${h.run}` : ""}
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ) : (
                <div
                  key={h.rev}
                  data-testid={`wb-history-r${h.rev}`}
                  className="flex min-h-7 items-center justify-between gap-2 px-1 py-0.5 text-muted-foreground"
                >
                  <span>
                    r{h.rev} · {h.date} · {h.by}
                  </span>
                </div>
              ),
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
