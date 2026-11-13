// A file opened as an editor tab: gutter numbers, the same light colouring as
// the code panel, the asked for line brought into view and lit.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { LANG, paint } from "../CodePanel";

export default function FileEditor({ path, line, onLine }: { path: string; line?: number; onLine?: (n: number) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState<number | undefined>(line);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSrc(null); setErr(null);
    api.file(path).then((f) => setSrc(f.content)).catch((e) => setErr(e.message));
  }, [path]);
  useEffect(() => { setCur(line); }, [path, line]);
  useEffect(() => {
    if (src == null) return;
    if (!line) { body.current?.scrollTo({ top: 0 }); return; }
    body.current?.querySelector(`[data-ln="${Math.max(1, line - 6)}"]`)?.scrollIntoView({ block: "start" });
  }, [src, line, path]);

  const lang = LANG[path.split(".").pop() ?? ""] ?? "";
  const lines = useMemo(() => (src ?? "").split("\n"), [src]);
  const pick = (n: number) => { setCur(n); onLine?.(n); };

  return (
    <div className="file-editor" data-testid="file-editor" ref={body}>
      {err && <div className="tw-empty">{err}</div>}
      {src == null && !err && <div className="tw-empty">loading…</div>}
      {src != null && (
        <pre className="fe-code">
          {lines.map((l, i) => (
            <div key={i} data-ln={i + 1} className={cur === i + 1 ? "cur" : undefined} onClick={() => pick(i + 1)}>
              <span className="ln">{i + 1}</span>
              <code>{l ? paint(l, lang) : " "}</code>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
