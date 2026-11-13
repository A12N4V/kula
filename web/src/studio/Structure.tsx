// The Structure tool window: the symbols of the open file, in source order;
// a click jumps the editor to the definition.

import { useEffect, useState } from "react";
import { api, type Node } from "../api";
import { Kind } from "../ui";

export default function Structure({ path, line, onJump }: { path: string | null; line?: number; onJump: (line: number) => void }) {
  const [syms, setSyms] = useState<Node[] | null>(null);
  useEffect(() => {
    if (!path) { setSyms(null); return; }
    setSyms(null);
    api.near(path).then((n) => setSyms([...n.symbols].sort((a, b) => a.start_line - b.start_line))).catch(() => setSyms([]));
  }, [path]);

  if (!path) return <div className="tw-body"><div className="tw-empty">Open a file to see its symbols</div></div>;
  const here = syms?.filter((s) => line && s.start_line <= line && line <= s.end_line).pop();
  return (
    <div className="tw-body structure" data-testid="structure">
      <div className="pt-root"><b>{path.slice(path.lastIndexOf("/") + 1)}</b><span className="muted">{syms ? `${syms.length} symbols` : ""}</span></div>
      <div className="pt-rows">
        {syms == null && <div className="tw-empty">loading…</div>}
        {syms?.length === 0 && <div className="tw-empty">No symbols</div>}
        {syms?.map((s) => (
          <button key={s.id} className={`pt-row ${here?.id === s.id ? "on" : ""}`} style={{ paddingLeft: s.kind === "method" ? 24 : 8 }} onClick={() => onJump(s.start_line)} title={`${s.name}  line ${s.start_line}`}>
            <Kind kind={s.kind} size={12} /><span className="pt-name">{s.name}</span><span className="pt-ln">{s.start_line}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
