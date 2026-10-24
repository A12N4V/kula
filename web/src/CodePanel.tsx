// The code side panel: anything that names a symbol or file (inspector lists,
// hotspots, search hits) opens its source here, docked to the right of the
// view and beside the inspector, with the definition's lines lit.
//
// E1: the panel is editable in place. A transparent textarea is laid exactly
// over the painted <pre>, so line numbers and colouring stay untouched. The
// moment the text differs from what was loaded, the header shows Revert and
// Save (and a modified dot on the file name); writing goes through
// PUT /api/file with the load-time hash, guarded, atomic and re-indexed.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Grip, PaneControls } from "./resize";
import { api, get, type Node, type Verdict } from "./api";
import { Icon, Kind } from "./ui";
import { visit } from "./near";

export type CodeTarget = {
  /** A file path – absent for notes, which carry `note` instead. */
  path?: string; line?: number; end?: number; name?: string; kind?: Node["kind"]; id?: number;
  // A note (or a sticky note on the map) opens in the same panel: the body is
  // markdown, Save goes through the notes API – or through `save` when the
  // caller owns the write (stickies patch their pipeline step). `id` null =
  // a new note; `target` is where it anchors ("repo", "file:…", "symbol:…").
  // `lock` keeps the target read-only for callers that own the anchor.
  note?: { id?: number; target: string; body: string; name?: string; lock?: boolean };
  save?: (body: string, target: string) => Promise<unknown>;
};

const Ctx = createContext<{ open: (t: CodeTarget) => void; close: () => void; target: CodeTarget | null }>({ open: () => {}, close: () => {}, target: null });
export const useCode = () => useContext(Ctx);

/** Open a node's source: symbols at their definition, files from the top, packages nowhere. */
export const nodeTarget = (n: Node): CodeTarget | null =>
  n.kind === "package" ? null : { path: n.path, line: n.kind === "file" ? undefined : n.start_line, end: n.kind === "file" ? undefined : n.end_line, name: n.name, kind: n.kind, id: n.id };

// The token rides along on every write, exactly as api.ts's req() does for
// the rest of the app; putFile is here because only the code panel writes
// files.
const pageToken = () => document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "dev";
type SendOutcome = { kind: "ok"; hash: string } | { kind: "conflict"; current: string; hash: string };
async function putFile(path: string, content: string, base_hash: string): Promise<SendOutcome> {
  const res = await fetch("/api/file", {
    method: "PUT",
    headers: { "x-kula-token": pageToken(), "content-type": "application/json" },
    body: JSON.stringify({ path, content, base_hash }),
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (res.ok) return { kind: "ok", hash: data.hash };
  if (res.status === 409) return { kind: "conflict", current: data.current, hash: data.hash };
  throw new Error(data.error ?? res.statusText);
}
const sha256hex = async (s: string) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

// A line's own indent (spaces or tabs), so Tab follows the file, not us.
const indentOf = (text: string) => {
  const m = text.split("\n").find((l) => /^([ \t]+)\S/.test(l));
  return m ? (m.match(/^([ \t]+)/) ?? ["  "])[1] : "  ";
};

type Note =
  | { kind: "conflict"; current: string; hash: string }
  | { kind: "fence"; verdict: Verdict }
  | { kind: "discard" };

export function CodeProvider({ children, onLocate }: { children: ReactNode; onLocate?: (id: number) => void }) {
  const [target, setTarget] = useState<CodeTarget | null>(null);
  const open = useCallback((t: CodeTarget) => { if (t.path) visit({ path: t.path, name: t.name, kind: t.kind, id: t.id }); setTarget(t); }, []);
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

const LANG: Record<string, string> = { rs: "rust", py: "python", ts: "ts", tsx: "ts", js: "js", jsx: "js", mjs: "js", go: "go", md: "md", markdown: "md" };

// Markdown shares the code panel's palette: headings and list markers read as
// structure (c-kw), code spans and blocks as strings (c-str), bold as a type
// accent (c-ty), [[wiki links]] as numbers – enough to scan a note, not a
// render. One pass per line, same discipline as `paint`.
const MD = /(^#{1,6} .*$|^\s*[-*+] |^\s*> |^```|`[^`\n]+`|\*\*[^*\n]+\*\*|\[\[[^\]\n]+\]\]|https?:\/\/[^\s)]+)/g;
function paintMd(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of line.matchAll(MD)) {
    const t = m[0], i = m.index!;
    if (i > last) out.push(line.slice(last, i));
    const cls = m[0].startsWith("```") || /^\s*[-*+] /.test(t) || /^\s*> /.test(t) ? "c-cm"
      : /^#{1,6} /.test(t) ? "c-kw" : /^\*\*/.test(t) ? "c-ty"
      : /^`/.test(t) ? "c-str" : /^\[\[/i.test(t) || /^https?:/.test(t) ? "c-num" : null;
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : t);
    last = i + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodePanel({ t, onClose, onLocate }: { t: CodeTarget; onClose: () => void; onLocate?: (id: number) => void }) {
  const [src, setSrc] = useState<string | null>(null);   // what was loaded
  const [hash, setHash] = useState("");                  // the load's base_hash
  const [text, setText] = useState("");                  // what is on screen
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [fenced, setFenced] = useState(false);           // "I know this is fenced"
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // The load session's guard verdict: undefined = not asked yet, null = asked
  // and open, otherwise the fence. The row is only ever a display – the gate
  // lives here, so dismissing it (Esc, Cancel) cannot sneak a save through.
  const guard = useRef<Verdict | null | undefined>(undefined);
  const isNote = !!t.note;
  const [noteTarget, setNoteTarget] = useState(t.note?.target ?? "repo");
  const load = useCallback((path: string) => {
    setSrc(null); setErr(null); setNote(null); setFenced(false); setBusy(false);
    guard.current = undefined;
    get<{ path: string; content: string; base_hash: string }>(`/api/file?path=${encodeURIComponent(path)}`)
      .then((f) => { setSrc(f.content); setText(f.content); setHash(f.base_hash); })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (isNote && t.note) {
      // A note arrives with its body – no file to fetch. The target is only
      // editable for a brand-new note; an existing one keeps its anchor.
      setSrc(t.note.body); setText(t.note.body); setHash(""); setErr(null);
      setNote(null); setFenced(false); setBusy(false); guard.current = undefined;
      setNoteTarget(t.note.target);
      return;
    }
    load(t.path ?? "");
  }, [t.path, t.note?.id, t.note?.body, isNote, load]);
  const dirty = src != null && text !== src;

  const doSave = useCallback(async () => {
    setBusy(true);
    try {
      if (isNote) {
        // Notes never touch the filesystem: they version in git through the
        // notes API – or through the caller's own write (a sticky patches
        // its pipeline step). Either way the note is the new base afterwards.
        if (t.save) await t.save(text, noteTarget);
        else if (t.note?.id != null) await api.metaAction("notes", t.note.id, { body: text });
        else await api.metaAction("notes", "new", { target: noteTarget, body: text });
        setSrc(text); setNote(null); setFenced(false); guard.current = undefined;
      } else {
        const r = await putFile(t.path ?? "", text, hash);
        if (r.kind === "ok") {
          setSrc(text); setHash(r.hash); setNote(null); setFenced(false);
          guard.current = undefined;
        } else {
          setNote({ kind: "conflict", current: r.current, hash: r.hash });
        }
      }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }, [isNote, t.note?.id, t.save, t.path, noteTarget, text, hash]);

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    if (isNote) { doSave(); return; }  // notes carry no fence on a path
    // Fences first: a locked file may still be saved by a person, but only
    // once they own the choice ("I know this is fenced"). The verdict is
    // cached for the load session, so re-showing the row costs nothing and a
    // dismissed row comes straight back on the next save attempt.
    if (guard.current === undefined) {
      try {
        const v = await get<{ path: string; task: Verdict | null }>(`/api/agent/guard_path?path=${encodeURIComponent(t.path ?? "")}`);
        guard.current = v.task ?? null;
      } catch { /* a dead guard endpoint must not block a save */ }
    }
    const f = guard.current;
    if (f && f.level !== "open" && !fenced) { setNote({ kind: "fence", verdict: f }); return; }
    doSave();
  }, [dirty, busy, fenced, t.path, isNote, doSave]);

  const revert = useCallback(() => { if (src != null) { setText(src); setNote(null); setFenced(false); guard.current = undefined; } }, [src]);

  // Reload (after a conflict): take what is on disk now.
  const reload = useCallback(() => { load(t.path ?? ""); }, [load, t.path]);
  // Overwrite (after a conflict): adopt the server's current text as the new
  // base, then write our draft over it.
  const overwrite = useCallback(async () => {
    const n = note;
    if (n?.kind !== "conflict") return;
    setNote(null); setFenced(false); guard.current = undefined;
    const r = await putFile(t.path ?? "", text, n.hash);
    if (r.kind === "ok") { setSrc(text); setHash(r.hash); }
    else setNote({ kind: "conflict", current: r.current, hash: r.hash });
  }, [note, t.path, text]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (e.key === "Escape") {
        if (note) { setNote(null); return; }
        if (dirty) { setNote({ kind: "discard" }); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, dirty, note, save]);

  // Bring the definition into view, a few lines below the top edge.
  useEffect(() => {
    if (src == null || !t.line) { body.current?.scrollTo({ top: 0 }); return; }
    body.current?.querySelector(`[data-ln="${Math.max(1, t.line - 4)}"]`)?.scrollIntoView({ block: "start" });
  }, [src, t.line]);

  const onTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget, tab = indentOf(text);
    e.preventDefault();
    const s = ta.selectionStart, end = ta.selectionEnd;
    setText(text.slice(0, s) + tab + text.slice(end));
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + tab.length; });
  };

  const lang = isNote ? "md" : LANG[t.path?.split(".").pop() ?? ""] ?? "";
  const lines = useMemo(() => text.split("\n"), [text]);
  const lit = (n: number) => !!t.line && n >= t.line && n <= (t.end ?? t.line);
  const [dir, file] = t.path ? [t.path.slice(0, t.path.lastIndexOf("/") + 1), t.path.slice(t.path.lastIndexOf("/") + 1)] : ["", ""];
  const noteName = t.note ? (t.note.name ?? (t.note.id != null ? `Note #${t.note.id}` : "New note")) : "";

  return (
    <aside className="code-panel" aria-label={isNote ? `Note ${t.note?.name ?? noteName}` : `Source of ${t.name ?? t.path}`} data-pane>      <Grip id="code" edge="left" min={320} max={1600} label="Resize source panel" />
      <header>
        <div className="cp-kind">{isNote ? <Icon.doc /> : t.kind && <Kind kind={t.kind} size={14} />}<span>{isNote ? "note" : t.kind ?? "file"}</span>{!isNote && (t.line ? <span className="muted">· lines {t.line}–{t.end ?? t.line}</span> : <span className="muted">· {lines.length} lines</span>)}</div>
        <h2>{isNote ? noteName : t.name ?? file}{dirty && <span className="cp-dot" data-testid="cp-modified" title="unsaved changes" />}</h2>
        {isNote ? (
          <div className="cp-path">
            {t.note?.id != null || t.note?.lock ? <span className="muted">{t.note?.target ?? ""}</span> : (
              <input className="input cp-note-target" data-testid="cp-note-target" value={noteTarget} placeholder="repo · file:path · symbol:name · commit:sha"
                onChange={(e) => setNoteTarget(e.target.value)} aria-label="Note target" />
            )}
          </div>
        ) : <div className="cp-path"><span className="muted">{dir}</span>{file}</div>}
        <div className="cp-actions">
          {!isNote && t.id != null && onLocate && <button className="btn sm" onClick={() => onLocate(t.id!)} title="Focus it in the graph"><Icon.target /> Locate</button>}
          {!isNote && <button className="btn sm" onClick={() => navigator.clipboard?.writeText(t.line ? `${t.path}:${t.line}` : t.path ?? "")} title={t.line ? `Copy ${t.path}:${t.line}` : `Copy ${t.path}`}>Copy path:line</button>}
          {!isNote && t.id != null && t.name && (
            <button className="btn sm ghost" title={`Copy ${t.kind === "file" ? `urn:kula:file:${t.path}` : `urn:kula:sym:${t.path}#${t.name}`}`}
              onClick={() => navigator.clipboard?.writeText(t.kind === "file" ? `urn:kula:file:${t.path}` : `urn:kula:sym:${t.path}#${t.name}`)}>Copy id</button>
          )}
          {dirty && (
            <>
              <button className="btn sm ghost" data-testid="cp-revert" onClick={revert} title="Back to what was loaded">Revert</button>
              <button className="btn sm" data-testid="cp-save" onClick={save} disabled={busy} title="Write to disk  ⌘S">Save</button>
            </>
          )}
          <span className="spacer" />
          <PaneControls onClose={onClose} closeLabel="Close source" testId="cp" />
        </div>
      </header>
      {note && (
        <div className={`cp-note cp-${note.kind}`} data-testid={`cp-note-${note.kind}`}>
          {note.kind === "conflict" && (
            <>
              <span>File changed on disk since it was loaded.</span>
              <span className="spacer" />
              <button className="btn sm" data-testid="cp-reload" onClick={reload}>Reload</button>
              <button className="btn sm" data-testid="cp-overwrite" onClick={overwrite}>Overwrite</button>
            </>
          )}
          {note.kind === "fence" && (
            <>
              <span>Fenced: {note.verdict.level}{note.verdict.reason ? ` – ${note.verdict.reason}` : ""}</span>
              <label className="cp-tick"><input type="checkbox" data-testid="cp-fence-tick" checked={fenced} onChange={(e) => setFenced(e.target.checked)} /> I know this is fenced</label>
              <span className="spacer" />
              <button className="btn sm" data-testid="cp-save-anyway" onClick={doSave} disabled={!fenced || busy}>Save anyway</button>
              <button className="btn sm ghost" onClick={() => setNote(null)}>Cancel</button>
            </>
          )}
          {note.kind === "discard" && (
            <>
              <span>Discard unsaved changes?</span>
              <span className="spacer" />
              <button className="btn sm" data-testid="cp-keep" onClick={() => setNote(null)}>Keep editing</button>
              <button className="btn sm ghost" data-testid="cp-discard" onClick={onClose}>Discard and close</button>
            </>
          )}
        </div>
      )}
      <div className={`cp-body cp-scroll${dirty ? " cp-editing" : ""}`} ref={body}>
        {err && <div className="card-empty">{err}</div>}
        {src == null && !err && <div className="cp-skel">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ width: `${30 + ((i * 37) % 60)}%` }} />)}</div>}
        {src != null && (
          <div className="cp-edit">
            <pre className="cp-code" data-testid="cp-code" aria-hidden="true">
              {lines.map((l, i) => (
                <div key={i} data-ln={i + 1} className={lit(i + 1) ? "lit" : undefined}>
                  <span className="ln">{i + 1}</span>
                  <code>{l ? (lang === "md" ? paintMd(l) : paint(l, lang)) : " "}</code>
                </div>
              ))}
            </pre>
            <textarea
              ref={area}
              className="cp-area"
              data-testid="cp-area"
              value={text}
              spellCheck={false}
              wrap="off"
              aria-label={isNote ? `Edit ${noteName}` : `Edit source of ${t.name ?? t.path}`}
              onChange={(e) => { setText(e.target.value); if (note) setNote(null); }}
              onKeyDown={(e) => { if (e.key === "Tab") onTab(e); }}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
