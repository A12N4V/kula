// W4 – plain file viewer for non-memory kula:// files (configs, prompts,
// runs): the real source named in the header, read-only files marked.
// Memory files route to MemoryEditor instead (AgentsTab decides).
import { useMemo } from "react";
import { CodeView } from "@/workbench/kit/code-view/code-view";
import { getFile } from "@/workbench/mock/files";

export function FileViewer({ path }: { path: string }) {
  const file = useMemo(() => getFile(path), [path]);
  if (!file) return null;
  return (
    <div data-testid="wb-file-viewer" className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        <span className="uppercase tracking-[0.12em] text-muted-foreground">{path}</span>
        <span className="text-muted-foreground">
          source · {file.source}
          {file.readOnly ? " · read-only" : ""}
        </span>
        <span className="opacity-40">MOCK</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <CodeView lines={file.lines.map((t, i) => ({ id: `f${i + 1}`, text: t }))} path={file.source} />
      </div>
    </div>
  );
}
