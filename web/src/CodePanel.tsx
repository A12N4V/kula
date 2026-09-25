// The code side panel: anything that names a symbol or file (inspector lists,
// hotspots, search hits) opens its source here, docked to the right of the
// view and beside the inspector, with the definition's lines lit.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type Node } from "./api";
import { Icon, Kind } from "./ui";

export type CodeTarget = { path: string; line?: number; end?: number; name?: string; kind?: Node["kind"]; id?: number };

const Ctx = createContext<{ open: (t: CodeTarget) => void; close: () => void; target: CodeTarget | null }>({ open: () => {}, close: () => {}, target: null });
export const useCode = () => useContext(Ctx);

/** Open a node's source: symbols at their definition, files from the top, packages nowhere. */
export const nodeTarget = (n: Node): CodeTarget | null =>
  n.kind === "package" ? null : { path: n.path, line: n.kind === "file" ? undefined : n.start_line, end: n.kind === "file" ? undefined : n.end_line, name: n.name, kind: n.kind, id: n.id };

export function CodeProvider({ children, onLocate }: { children: ReactNode; onLocate?: (id: number) => void }) {
  const [target, setTarget] = useState<CodeTarget | null>(null);
  const open = useCallback((t: CodeTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ open, close, target }), [open, close, target]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {target && <CodePanel t={target} onClose={close} onLocate={onLocate} />}
    </Ctx.Provider>
  );
}

// Just enough colour to read by: comments, strings, keywords, numbers. One pass
// per line, no grammar – it's a reading aid beside the graph, not an editor.
const KW = new Set(("fn pub let mut const static struct enum impl trait use mod match if else for while loop return break continue async await move ref self Self crate super where type as in " +
  "function class extends new this import export from default var interface implements private public protected readonly yield of typeof instanceof try catch finally throw " +
  "def lambda pass with elif None True False and or not is func package go defer chan select range map struct").split(" "));
const TOKEN = /(\/\/.*$|#(?![[!]).*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d_.]*\b|\b[A-Za-z_]\w*\b)/g;
function paint(line: string, lang: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of line.matchAll(TOKEN)) {
    const t = m[0], i = m.index!;
    if (i > last) out.push(line.slice(last, i));
    const cls = t.startsWith("//") || (t.startsWith("#") && lang === "python") ? "c-cm"
      : /^["'`]/.test(t) ? "c-str" : /^\d/.test(t) ? "c-num" : KW.has(t) ? "c-kw" : /^[A-Z]/.test(t) ? "c-ty" : null;
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : t);
    last = i + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const LANG: Record<string, string> = { rs: "rust", py: "python", ts: "ts", tsx: "ts", js: "js", jsx: "js", mjs: "js", go: "go" };

function CodePanel({ t, onClose, onLocate }: { t: CodeTarget; onClose: () => void; onLocate?: (id: number) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSrc(null); setErr(null);
    api.file(t.path).then((f) => setSrc(f.content)).catch((e) => setErr(e.message));
  }, [t.path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // Bring the definition into view, a few lines below the top edge.
  useEffect(() => {
    if (src == null || !t.line) { body.current?.scrollTo({ top: 0 }); return; }
    body.current?.querySelector(`[data-ln="${Math.max(1, t.line - 4)}"]`)?.scrollIntoView({ block: "start" });
  }, [src, t.line]);

  const lang = LANG[t.path.split(".").pop() ?? ""] ?? "";
  const lines = useMemo(() => (src ?? "").split("\n"), [src]);
  const lit = (n: number) => !!t.line && n >= t.line && n <= (t.end ?? t.line);
  const [dir, file] = [t.path.slice(0, t.path.lastIndexOf("/") + 1), t.path.slice(t.path.lastIndexOf("/") + 1)];

  return (
    <aside className="code-panel" aria-label={`Source of ${t.name ?? t.path}`}>
      <header>
        <div className="cp-kind">{t.kind && <Kind kind={t.kind} size={14} />}<span>{t.kind ?? "file"}</span>{t.line ? <span className="muted">· lines {t.line}–{t.end ?? t.line}</span> : <span className="muted">· {lines.length} lines</span>}</div>
        <h2>{t.name ?? file}</h2>
        <div className="cp-path"><span className="muted">{dir}</span>{file}</div>
        <div className="cp-actions">
          {t.id != null && onLocate && <button className="btn sm" onClick={() => onLocate(t.id!)} title="Focus it in the graph"><Icon.target /> Locate</button>}
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(t.line ? `${t.path}:${t.line}` : t.path)} title="Copy path">Copy path</button>
          <span className="spacer" />
          <button className="btn sm ghost icon-only" onClick={onClose} aria-label="Close source" title="Close  esc"><Icon.close /></button>
        </div>
      </header>
      <div className="cp-body" ref={body}>
        {err && <div className="card-empty">{err}</div>}
        {src == null && !err && <div className="cp-skel">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ width: `${30 + ((i * 37) % 60)}%` }} />)}</div>}
        {src != null && (
          <pre className="cp-code">
            {lines.map((l, i) => (
              <div key={i} data-ln={i + 1} className={lit(i + 1) ? "lit" : undefined}>
                <span className="ln">{i + 1}</span>
                <code>{l ? paint(l, lang) : " "}</code>
              </div>
            ))}
          </pre>
        )}
      </div>
    </aside>
  );
}
