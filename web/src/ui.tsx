import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { colorFor, type Node } from "./api";

// ---------- icons (1.6px stroke, 24 grid) ----------
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  home: () => (<svg viewBox="0 0 24 24" {...P}><path d="M12 3.5 20 8.5v7l-8 5-8-5v-7z" /><path d="M12 8.5v7M8.5 10.5l7 3M15.5 10.5l-7 3" /></svg>),
  graph: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><circle cx="12" cy="10" r="1.6" /><path d="M6.7 7.1 10.6 9.2M17.3 7.1l-3.9 2.1M12 11.6v4.4" /></svg>),
  changes: () => (<svg viewBox="0 0 24 24" {...P}><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M12 8v6M9 11h6M9 17h6" /></svg>),
  history: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" /></svg>),
  branches: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9c0 5-12 3-12 8" /></svg>),
  compare: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v5a4 4 0 0 0 4 4h6M18 16v-5a4 4 0 0 0-4-4H8" /><path d="m14 15 2 2-2 2M10 5 8 7l2 2" /></svg>),
  issues: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>),
  pr: () => (<svg viewBox="0 0 24 24" {...P}><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="18.5" r="2" /><path d="M6 7.5v9M18 16.5V9a3 3 0 0 0-3-3h-4m0 0 2.5-2.5M11 6l2.5 2.5" /></svg>),
  notes: () => (<svg viewBox="0 0 24 24" {...P}><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8.5 12h7M8.5 15.5h5" /></svg>),
  flows: () => (<svg viewBox="0 0 24 24" {...P}><path d="M4 7h9a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h11" /><path d="m17 16 3 3-3 3" /></svg>),
  console: () => (<svg viewBox="0 0 24 24" {...P}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="m7 10 3 2.5L7 15M12.5 15H17" /></svg>),
  search: () => (<svg viewBox="0 0 24 24" {...P} width="15" height="15"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>),
  close: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 6l12 12M18 6 6 18" /></svg>),
  refresh: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M12 5v14M5 12h14" /></svg>),
  minus: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M5 12h14" /></svg>),
  target: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></svg>),
  sun: () => (<svg viewBox="0 0 24 24" {...P} width="15" height="15"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>),
};

/**
 * The mark: a K drawn inside the kula ring. Every stroke lies on the
 * hexagon's own geometry – the stem is a chord, the arms are two radii,
 * and the junction is the centre node.
 */
export function Logo({ spin = false }: { spin?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={spin ? "logo logo-draw" : "logo"} aria-hidden="true">
      <polygon className="logo-ring" points="28,16 22,26.39 10,26.39 4,16 10,5.61 22,5.61" fill="none" stroke="var(--accent)" strokeOpacity=".38" strokeWidth="1.4" strokeLinejoin="round" />
      <path className="logo-k" d="M10 5.61V26.39M10 16H16M22 5.61 16 16 22 26.39" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" pathLength={100} />
      <g fill="var(--accent)">
        {[[10, 5.61], [10, 26.39], [22, 5.61], [22, 26.39]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.3" />)}
        <circle cx="28" cy="16" r="1.6" fillOpacity=".6" />
        <circle cx="4" cy="16" r="1.6" fillOpacity=".6" />
      </g>
      <circle className="logo-core" cx="16" cy="16" r="3.1" fill="var(--text)" />
    </svg>
  );
}


/** Letter badge for a symbol kind, tinted by its cluster colour. */
export function Kind({ kind, community, size = 16 }: { kind: string; community: number; size?: number }) {
  const letter = ({ file: "", class: "C", interface: "I", method: "M", function: "F" } as Record<string, string>)[kind] ?? "·";
  const c = colorFor(community);
  return (
    <span className="kind-badge" title={kind} style={{ width: size, height: size, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)`, fontSize: size * 0.62 }}>
      {kind === "file" ? <svg viewBox="0 0 16 16" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg> : letter}
    </span>
  );
}

export function Sym({ n, onClick, right }: { n: Node; onClick?: (n: Node) => void; right?: ReactNode }) {
  return (
    <div className="sym" onClick={() => onClick?.(n)} title={`${n.path}:${n.start_line}`}>
      <Kind kind={n.kind} community={n.community} />
      <span className="nm">{n.name}</span>
      <span className="p">{right ?? `${n.path}:${n.start_line}`}</span>
    </div>
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
