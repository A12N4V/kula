import * as React from "react";
import { cn } from "cn";

export type CodeLine = {
  /** Stable line identifier used as React key and in test ids. */
  id: string;
  text: string;
  /** Change class for the diff gutter: add | del | mod | undefined. */
  kind?: "add" | "del" | "mod";
};

export type BlameLine = {
  lineId: string;
  author: string;
  /** Short revision id, e.g. an abbreviated commit hash. */
  rev: string;
  /** ISO date string, rendered as its date part. */
  date: string;
  /** Optional accent styling (deck p.10: agent-authored memory lines in the accent). */
  accent?: boolean;
};

export type CodeViewProps = {
  lines: CodeLine[];
  blame?: BlameLine[];
  /** Show the blame gutter (author · rev · date per line). */
  showBlame?: boolean;
  path?: string;
  className?: string;
};

const kindClass: Record<NonNullable<CodeLine["kind"]>, string> = {
  add: "text-[#8fce8f] bg-[#08150a]",
  del: "text-[#f0827a] bg-[#1a0a08]",
  mod: "text-primary bg-[#1a0e05]",
};

/* kula variant of the bigbullui code block (21st.dev, MIT) with a blame
   gutter added. Radius 0, JetBrains Mono, hairline separators, no
   shadows. Blame runs left of the line numbers, toggled per view. */
export function CodeView({
  lines,
  blame,
  showBlame = false,
  path,
  className,
}: CodeViewProps) {
  const blameByLine = React.useMemo(() => {
    if (!blame) return undefined;
    const map = new Map<string, BlameLine>();
    for (const b of blame) map.set(b.lineId, b);
    return map;
  }, [blame]);

  return (
    <div
      data-testid="kwb-code-view"
      data-kwb-path={path}
      className={cn(
        "kwb-code-view overflow-auto border border-border bg-card text-[13px] leading-5",
        className,
      )}
    >
      <div className="flex border-b border-border bg-secondary px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {path ?? "source"}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const b = blameByLine?.get(line.id);
            return (
              <tr
                key={line.id}
                data-testid={`code-line-${line.id}`}
                className={cn(
                  "align-top hover:bg-secondary",
                  line.kind && kindClass[line.kind],
                )}
              >
                {showBlame && (
                  <td
                    data-testid={`code-blame-${line.id}`}
                    className={cn(
                      "select-none border-r border-border px-2 py-0 whitespace-nowrap text-[11px] text-muted-foreground",
                      b?.accent && "text-primary",
                    )}
                  >
                    {b ? `${b.author} · ${b.rev} · ${b.date}` : " "}
                  </td>
                )}
                <td className="w-10 select-none border-r border-border px-2 py-0 text-right text-muted-foreground">
                  {i + 1}
                </td>
                <td className="px-3 py-0 whitespace-pre text-foreground/90">
                  {line.text || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
