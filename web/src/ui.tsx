import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Node } from "./api";
import { GLYPH, kindColor } from "./colors";
import { nodeTarget, useCode } from "./CodePanel";
import { markPath, N } from "./mark";

// ---------- icons ----------
// One grammar on a 24 grid, 1.5 stroke: rounded squares are structure (files,
// hubs, heads), circles are points in time or graph nodes, a filled mark is
// "you are here". Mirrors the graph, where hubs are square tiles.
const P = { className: "ico", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  box: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="7" width="17" height="10" /><path d="M7 7v10" /></svg>),
  home: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="7" height="7" fill="currentColor" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg>),
  graph: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" /><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="20" r="2" /></svg>),
  changes: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="16" height="16" /><path d="M12 7.5v6M9 10.5h6M9 16.5h6" /></svg>),
  history: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 3v5.5M12 10.5v3M12 15.5V21" /><circle cx="12" cy="9.5" r="1.1" fill="currentColor" /><circle cx="12" cy="14.5" r="1.1" fill="currentColor" /><circle cx="12" cy="9.5" r="2.5" /><circle cx="12" cy="14.5" r="2.5" /></svg>),
  branches: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="7" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><rect x="15" y="6" width="4" height="4" /><path d="M7 7v10M17 10c0 4-3 5-10 7" /></svg>),
  compare: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="3.5" width="11" height="11" /><rect x="9.5" y="9.5" width="11" height="11" stroke-dasharray="2.2 2.2" /><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" stroke="none" /></svg>),
  issues: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="8.5" /><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor" /></svg>),
  pr: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><rect x="16" y="16.5" width="4" height="4" /><path d="M6 7.5v9M18 16.5V9a3 3 0 0 0-3-3h-4" /><path d="m13 3.5-2.5 2.5L13 8.5" /></svg>),
  notes: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4" /><path d="M8.5 12h7M8.5 15.5h4" /></svg>),
  flows: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="5" cy="6" r="2" /><path d="M7 6h7.5a3.5 3.5 0 0 1 0 7h-5a3.5 3.5 0 0 0 0 7H19" /><path d="m16.5 17.5 2.5 2.5-2.5 2.5" /></svg>),
  console: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3" y="4" width="18" height="16" /><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" /></svg>),
  search: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>),
  close: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 6l12 12M18 6 6 18" /></svg>),
  refresh: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>),
  minus: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 12h14" /></svg>),
  target: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></svg>),
  gear: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M18.88 9.87L21.36 10.39L21.36 13.61L18.88 14.13L18.37 15.36L19.76 17.48L17.48 19.76L15.36 18.37L14.13 18.88L13.61 21.36L10.39 21.36L9.87 18.88L8.64 18.37L6.52 19.76L4.24 17.48L5.63 15.36L5.12 14.13L2.64 13.61L2.64 10.39L5.12 9.87L5.63 8.64L4.24 6.52L6.52 4.24L8.64 5.63L9.87 5.12L10.39 2.64L13.61 2.64L14.13 5.12L15.36 5.63L17.48 4.24L19.76 6.52L18.37 8.64Z" /><circle cx="12" cy="12" r="3" /></svg>),
  // An agent: a head (structure) wired to the graph by its antenna (a node), eyes as "you are here" marks.
  agents: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="5" y="8.5" width="14" height="11" /><path d="M12 8.5V5.5M3 12.5v3.5M21 12.5v3.5M9.5 16.5h5" /><circle cx="12" cy="4" r="1.6" /><rect x="8.5" y="11.5" width="2" height="2" fill="currentColor" /><rect x="13.5" y="11.5" width="2" height="2" fill="currentColor" /></svg>),
  workflow: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4" width="5" height="5" /><rect x="15.5" y="4" width="5" height="5" fill="currentColor" /><rect x="9.5" y="15" width="5" height="5" /><path d="M8.5 6.5h7M18 9v3.5H12V15" /></svg>),
  memory: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 4h12v16l-6-4-6 4z" /><circle cx="12" cy="10" r="1.6" fill="currentColor" /></svg>),
  doc: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" /></svg>),
  team: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4" width="6" height="6" /><rect x="14.5" y="4" width="6" height="6" fill="currentColor" /><rect x="9" y="14" width="6" height="6" /><path d="M6.5 10v2h11v-2M12 12v2" /></svg>),
  flask: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.2 1.2 0 0 0 1 1.5h12a1.2 1.2 0 0 0 1-1.5l-5.5-9.5v-6" /><path d="M7.5 15h9" /></svg>),
  shield: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>),
  plug: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v4a5.5 5.5 0 0 1-11 0zM12 17v3.5" /></svg>),
  fence: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 20V7l2-2.5L9 7v13M15 20V7l2-2.5L19 7v13M3 11h18M3 16h18" /></svg>),
  edit: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 20h4L19.5 8.5l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>),
  up: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 15 6-6 6 6" /></svg>),
  down: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>),
  back: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>),
  arrow: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" /></svg>),
  query: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M8 4H6.5A1.5 1.5 0 0 0 5 5.5v4L3.5 12 5 14.5v4A1.5 1.5 0 0 0 6.5 20H8M16 4h1.5A1.5 1.5 0 0 1 19 5.5v4l1.5 2.5-1.5 2.5v4a1.5 1.5 0 0 1-1.5 1.5H16" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>),
  copy: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="8.5" y="8.5" width="11" height="11" /><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></svg>),
  play: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M7 5v14l11-7z" fill="currentColor" /></svg>),
  lock: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>),
  sidebar: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4.5" width="17" height="15" /><path d="M9.5 4.5v15" /><path d="M5.8 8.5h1.6M5.8 11h1.6M5.8 13.5h1.6" /></svg>),
  chevron: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>),
  sun: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>),
  check: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>),
};
/**
 * The mark: the kula ring drawn with kula rings (src/mark.ts). Small sizes show
 * one level, where two would blur; from 28px up every cell is the ring again.
 */
const MARK_1 = markPath(1), MARK_2 = markPath(2);
export function Logo({ size = 18 }: { size?: number }) {
  const deep = size >= 28;
  const S = deep ? N * N : N;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} className="logo" shapeRendering="crispEdges" aria-hidden="true">
      <path className="logo-k" d={deep ? MARK_2 : MARK_1} fill="var(--accent)" />
    </svg>
  );
}


/** Square glyph for a symbol kind – the same tile the graph draws for hubs. */export function Kind({ kind, size = 16 }: { kind: string; community?: number; size?: number }) {
  const letter = GLYPH[kind] ?? "·";
  const c = kindColor(kind);
  return (
    <span className="kind-badge" title={kind} style={{ width: size, height: size, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)`, fontSize: size * 0.62 }}>
      {kind === "file" ? <svg viewBox="0 0 16 16" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg> : letter}
    </span>
  );
}

/**
 * A symbol or file row. Clicking opens its source in the code panel; the
 * locate button (when given) moves the graph's focus to it instead.
 */
export function Sym({ n, onClick, right }: { n: Node; onClick?: (n: Node) => void; right?: ReactNode }) {
  const code = useCode();
  const t = nodeTarget(n);
  const on = !!t && code.target?.id === n.id;
  return (
    <div className={`sym ${on ? "on" : ""}`} onClick={() => (t ? code.open(t) : onClick?.(n))} title={`${n.path}:${n.start_line}`}>
      <Kind kind={n.kind} community={n.community} />
      <span className="nm">{n.name}</span>
      <span className="p">{right ?? (n.kind === "package" ? "package" : `${n.path}:${n.start_line}`)}</span>
      {onClick && t && (
        <button className="sym-locate" aria-label={`Locate ${n.name} in the graph`} title="Locate in graph" onClick={(e) => { e.stopPropagation(); onClick(n); }}><Icon.target /></button>
      )}
    </div>
  );
}

// ---------- tooltips ----------
/**
 * The one tooltip: appears after a short delay, carries real information
 * (full path, exact value, shortcut) and never repeats the visible label.
 * Styling and delay live in styles/system.css.
 */
export function Tip({ tip, place, children }: { tip: ReactNode; place?: "top" | "bottom"; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const enter = () => { t.current = setTimeout(() => setShow(true), 450); };
  const leave = () => { if (t.current) clearTimeout(t.current); setShow(false); };
  return (
    <span className="tip-host" data-place={place} onPointerEnter={enter} onPointerLeave={leave} onPointerDown={leave}>
      {children}
      {show && <span className="tip-box" role="tooltip">{tip}</span>}
    </span>
  );
}

// ---------- diff renderer ----------
export function Diff({ text }: { text: string }) {
  if (!text.trim()) return <div className="empty"><h3>No changes</h3></div>;
  const out: ReactNode[] = [];
  let a = 0, b = 0, k = 0;
  for (const line of text.split("\n")) {
    k++;
    if (line.startsWith("diff --git")) {
      const m = line.match(/ b\/(.+)$/);
      out.push(<div key={k} className="file">{m?.[1] ?? line}</div>);
    } else if (line.startsWith("@@")) {
      const m = line.match(/-(\d+)(?:,\d+)? \+(\d+)/);
      if (m) { a = +m[1]; b = +m[2]; }
      out.push(<div key={k} className="hunk">{line}</div>);
    } else if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary)/.test(line)) {
      continue;
    } else if (line.startsWith("+")) {
      out.push(<div key={k} className="ln add"><span className="n" /><span className="n">{b++}</span><span className="c">{line}</span></div>);
    } else if (line.startsWith("-")) {
      out.push(<div key={k} className="ln del"><span className="n">{a++}</span><span className="n" /><span className="c">{line}</span></div>);
    } else if (line.startsWith(" ")) {
      out.push(<div key={k} className="ln"><span className="n">{a++}</span><span className="n">{b++}</span><span className="c">{line}</span></div>);
    } else if (line) {
      out.push(<div key={k} className="meta">{line}</div>);
    }
  }
  return <div className="diff">{out}</div>;
}

/** `git show` output: header lines, then the patch. */
export function ShowOutput({ text }: { text: string }) {
  const i = text.indexOf("\ndiff --git");
  const head = i >= 0 ? text.slice(0, i) : text;
  const patch = i >= 0 ? text.slice(i + 1) : "";
  return (
    <div className="stack">
      <pre className="code" style={{ maxHeight: "none", whiteSpace: "pre-wrap" }}>{head.trim()}</pre>
      {patch && <Diff text={patch} />}
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; msg: string; kind: "ok" | "err" };
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "err" ? 6500 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

/** Tiny markdown: paragraphs, `code`, **bold**, [[symbol]] links. */
export function Md({ text, onSymbol }: { text: string; onSymbol?: (name: string) => void }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g);
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) =>
        p.startsWith("`") ? <code key={i} style={{ background: "var(--panel-2)", padding: "1px 5px", borderRadius: 4 }}>{p.slice(1, -1)}</code>
        : p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
        : p.startsWith("[[") ? <a key={i} style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => onSymbol?.(p.slice(2, -2))}>{p.slice(2, -2)}</a>
        : <span key={i}>{p}</span>
      )}
    </div>
  );
}

/** A number per row: the name on the left, the figure on the right (replaces the old tile strips). */
export type Stat = { label: string; value: ReactNode; note?: ReactNode; tone?: string; onClick?: () => void; title?: string };
export function StatTable({ rows, label, className = "" }: { rows: Stat[]; label?: string; className?: string }) {
  return (
    <table className={`stat-table ${className}`} aria-label={label}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={`${r.onClick ? "go" : ""} ${r.tone ? `tone-${r.tone}` : ""}`} title={r.title}
            onClick={r.onClick} tabIndex={r.onClick ? 0 : undefined} onKeyDown={r.onClick ? (e) => { if (e.key === "Enter") r.onClick!(); } : undefined}>
            <th scope="row">{r.label}{r.note !== undefined && <span className="st-note">{r.note}</span>}</th>
            <td>{typeof r.value === "number" ? r.value.toLocaleString() : r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
