import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Node } from "./api";
import { GLYPH, kindColor } from "./colors";
import { nodeTarget, useCode } from "./CodePanel";

// ---------- icons ----------
// Homonin's instrument grammar (the orrery plates on homonin-landing): a 24 grid,
// hairline 1.3 strokes with square ends, orbits drawn whole and trajectories
// dotted, filled discs for bodies (nodes, commits), crop marks for frames and a
// four-point star for "you are here". Nothing rounded; nothing decorative.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "square", strokeLinejoin: "miter" } as const;
const DOT = { strokeDasharray: "0 2.4", strokeLinecap: "round", strokeWidth: 1.5 } as const;
const F = { fill: "currentColor", stroke: "none" } as const;
/** Four-point star centred on (x, y) with radius r. */
const star = (x: number, y: number, r: number) => {
  const k = r * 0.2;
  return `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`;
};
const I = (size = 18, ...kids: ReactNode[]) => <svg viewBox="0 0 24 24" width={size} height={size} {...P} aria-hidden="true">{kids}</svg>;

export const Icon = {
  /** Overview: an astrolabe – limb, dotted inner circle, crosshair ticks, the star at centre. */
  home: () => I(18, <circle key="a" cx="12" cy="12" r="8.5" />, <circle key="b" cx="12" cy="12" r="5" {...DOT} />, <path key="c" d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />, <path key="d" d={star(12, 12, 2.8)} {...F} />),
  /** Graph: an orrery – a body with two tilted orbits and their planets. */
  graph: () => I(18, <ellipse key="a" cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-24 12 12)" />, <ellipse key="b" cx="12" cy="12" rx="10" ry="4.2" transform="rotate(38 12 12)" {...DOT} />, <circle key="c" cx="12" cy="12" r="2.1" {...F} />, <circle key="d" cx="20.3" cy="8.2" r="1.6" {...F} />, <circle key="e" cx="5.4" cy="18.2" r="1.3" {...F} />),
  /** Flows: a dotted trajectory from a launch point to a heading. */
  flows: () => I(18, <path key="a" d="M4 19.5C9 19.5 10 6 19.5 5" {...DOT} />, <circle key="b" cx="4" cy="19.5" r="1.8" {...F} />, <path key="c" d="M16.5 3.2 20 5l-2.3 3.1" />, <path key="d" d={star(19, 16.5, 2.2)} {...F} />),
  /** Changes: crop marks around a ± reading. */
  changes: () => I(18, <path key="a" d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />, <path key="b" d="M12 7.5v6M9 10.5h6M9 16.5h6" />),
  /** History: a meridian with three bodies, the present ringed. */
  history: () => I(18, <path key="a" d="M12 2v20" />, <circle key="b" cx="12" cy="5.5" r="1.5" {...F} />, <circle key="c" cx="12" cy="12" r="1.8" {...F} />, <circle key="d" cx="12" cy="12" r="4.2" />, <circle key="e" cx="12" cy="18.5" r="1.5" {...F} />, <path key="f" d="M16.2 12H21" {...DOT} />),
  /** Branches: a line that forks, the new head a star. */
  branches: () => I(18, <path key="a" d="M6 3v18" />, <path key="b" d="M6 15c0-6 12-4 12-10" />, <circle key="c" cx="6" cy="21" r="1.7" {...F} />, <circle key="d" cx="6" cy="3" r="1.7" {...F} />, <path key="e" d={star(18, 4.5, 3)} {...F} />),
  /** Compare: two overlapping orbits, one of them the other's shadow. */
  compare: () => I(16, <circle key="a" cx="9" cy="12" r="6.5" />, <circle key="b" cx="15" cy="12" r="6.5" {...DOT} />, <circle key="c" cx="12" cy="12" r="1.4" {...F} />),
  /** Proposals: a head arcing back to the line it came from. */
  pr: () => I(18, <path key="a" d="M6 7v10" />, <path key="b" d="M18 17v-6.5C18 8 16 6 13 6H9" />, <path key="c" d="m11.5 3.5-2.5 2.5 2.5 2.5" />, <circle key="d" cx="6" cy="5" r="1.7" {...F} />, <circle key="e" cx="6" cy="19" r="1.7" {...F} />, <circle key="f" cx="18" cy="19" r="2" />),
  /** Issues: a reticle with its mark. */
  issues: () => I(18, <circle key="a" cx="12" cy="12" r="7.5" />, <path key="b" d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" />, <circle key="c" cx="12" cy="12" r="1.8" {...F} />),
  /** Notes: a plate with a ruler along its edge. */
  notes: () => I(18, <path key="a" d="M5 3h10.5L19 6.5V21H5z" />, <path key="b" d="M8 8h2M8 11h4M8 14h2M8 17h4" />, <path key="c" d="M15 3v4h4" />),
  /** Console: a frame and a prompt. */
  console: () => I(18, <path key="a" d="M3 4.5h18v15H3z" />, <path key="b" d="m7 9.5 3 2.5-3 2.5M12.5 15H17" />),
  /** Package: a crate with its label edge, like the rim nodes. */
  box: () => I(15, <path key="a" d="M3.5 7h17v10h-17z" />, <path key="b" d="M7 7v10" />, <path key="c" d="M10 12h7" {...DOT} />),
  search: () => I(15, <circle key="a" cx="10.5" cy="10.5" r="6.5" />, <path key="b" d="m15.5 15.5 5 5" />, <circle key="c" cx="10.5" cy="10.5" r="1.2" {...F} />),
  close: () => I(16, <path key="a" d="M6 6l12 12M18 6 6 18" />),
  refresh: () => I(14, <path key="a" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />, <path key="b" d="M19.5 3.5v4h-4" />, <circle key="c" cx="12" cy="12" r="1.6" {...F} />),
  plus: () => I(14, <path key="a" d="M12 5v14M5 12h14" />),
  minus: () => I(14, <path key="a" d="M5 12h14" />),
  /** Fit: crop marks around a body. */
  target: () => I(14, <path key="a" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />, <circle key="b" cx="12" cy="12" r="2" {...F} />),
  /** Settings: two scales, each with its slider body. */
  sliders: () => I(15, <path key="a" d="M3 8h18M3 16h18" />, <path key="b" d="M9 5.5v5M15 13.5v5" strokeWidth="2.6" />),
  chevron: () => I(13, <path key="a" d="m6 9 6 6 6-6" />),
  sun: () => I(15, <path key="a" d={star(12, 12, 9)} />, <circle key="b" cx="12" cy="12" r="2.2" {...F} />),
};

/**
 * The mark: a K drawn inside the kula ring. Every stroke lies on the
 * hexagon's own geometry – the stem is a chord, the arms are two radii,
 * and the junction is the centre node.
 */
// The opening's dithered graph-sphere, frozen – generated by scripts/logo.mjs.
const MARK = "M23 1h1v1h-1zM22 2h1v1h-1zM23 2h1v1h-1zM24 2h1v1h-1zM22 3h1v1h-1zM23 3h1v1h-1zM24 3h1v1h-1zM25 3h1v1h-1zM4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM21 4h1v1h-1zM22 4h1v1h-1zM23 4h1v1h-1zM24 4h1v1h-1zM25 4h1v1h-1zM26 4h1v1h-1zM4 5h1v1h-1zM5 5h1v1h-1zM6 5h1v1h-1zM7 5h1v1h-1zM21 5h1v1h-1zM22 5h1v1h-1zM23 5h1v1h-1zM24 5h1v1h-1zM25 5h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM21 6h1v1h-1zM22 6h1v1h-1zM23 6h1v1h-1zM24 6h1v1h-1zM25 6h1v1h-1zM26 6h1v1h-1zM3 7h1v1h-1zM4 7h1v1h-1zM5 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM19 7h1v1h-1zM20 7h1v1h-1zM21 7h1v1h-1zM22 7h1v1h-1zM23 7h1v1h-1zM24 7h1v1h-1zM25 7h1v1h-1zM2 8h1v1h-1zM3 8h1v1h-1zM4 8h1v1h-1zM5 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM9 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM14 8h1v1h-1zM16 8h1v1h-1zM17 8h1v1h-1zM18 8h1v1h-1zM19 8h1v1h-1zM20 8h1v1h-1zM22 8h1v1h-1zM23 8h1v1h-1zM24 8h1v1h-1zM3 9h1v1h-1zM4 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM8 9h1v1h-1zM9 9h1v1h-1zM17 9h1v1h-1zM18 9h1v1h-1zM19 9h1v1h-1zM20 9h1v1h-1zM21 9h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM17 10h1v1h-1zM18 10h1v1h-1zM19 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM5 11h1v1h-1zM6 11h1v1h-1zM7 11h1v1h-1zM9 11h1v1h-1zM18 11h1v1h-1zM19 11h1v1h-1zM6 12h1v1h-1zM7 12h1v1h-1zM8 12h1v1h-1zM20 12h1v1h-1zM22 12h1v1h-1zM5 13h1v1h-1zM6 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM21 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM8 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM11 14h1v1h-1zM21 14h1v1h-1zM24 14h1v1h-1zM26 14h1v1h-1zM5 15h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM11 15h1v1h-1zM13 15h1v1h-1zM17 15h1v1h-1zM19 15h1v1h-1zM21 15h1v1h-1zM22 15h1v1h-1zM23 15h1v1h-1zM24 15h1v1h-1zM25 15h1v1h-1zM26 15h1v1h-1zM27 15h1v1h-1zM5 16h1v1h-1zM6 16h1v1h-1zM7 16h1v1h-1zM8 16h1v1h-1zM12 16h1v1h-1zM16 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM20 16h1v1h-1zM21 16h1v1h-1zM22 16h1v1h-1zM23 16h1v1h-1zM24 16h1v1h-1zM25 16h1v1h-1zM26 16h1v1h-1zM27 16h1v1h-1zM28 16h1v1h-1zM7 17h1v1h-1zM8 17h1v1h-1zM9 17h1v1h-1zM17 17h1v1h-1zM18 17h1v1h-1zM19 17h1v1h-1zM20 17h1v1h-1zM21 17h1v1h-1zM22 17h1v1h-1zM23 17h1v1h-1zM24 17h1v1h-1zM25 17h1v1h-1zM26 17h1v1h-1zM27 17h1v1h-1zM10 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM20 18h1v1h-1zM21 18h1v1h-1zM22 18h1v1h-1zM23 18h1v1h-1zM24 18h1v1h-1zM25 18h1v1h-1zM26 18h1v1h-1zM27 18h1v1h-1zM11 19h1v1h-1zM13 19h1v1h-1zM14 19h1v1h-1zM15 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1zM18 19h1v1h-1zM19 19h1v1h-1zM20 19h1v1h-1zM21 19h1v1h-1zM22 19h1v1h-1zM23 19h1v1h-1zM24 19h1v1h-1zM25 19h1v1h-1zM26 19h1v1h-1zM27 19h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM18 20h1v1h-1zM19 20h1v1h-1zM20 20h1v1h-1zM21 20h1v1h-1zM22 20h1v1h-1zM23 20h1v1h-1zM24 20h1v1h-1zM25 20h1v1h-1zM26 20h1v1h-1zM27 20h1v1h-1zM13 21h1v1h-1zM15 21h1v1h-1zM19 21h1v1h-1zM21 21h1v1h-1zM23 21h1v1h-1zM24 21h1v1h-1zM25 21h1v1h-1zM26 21h1v1h-1zM27 21h1v1h-1zM14 22h1v1h-1zM16 22h1v1h-1zM18 22h1v1h-1zM19 22h1v1h-1zM20 22h1v1h-1zM22 22h1v1h-1zM23 22h1v1h-1zM24 22h1v1h-1zM25 22h1v1h-1zM26 22h1v1h-1zM15 23h1v1h-1zM16 23h1v1h-1zM17 23h1v1h-1zM18 23h1v1h-1zM19 23h1v1h-1zM10 24h1v1h-1zM11 24h1v1h-1zM12 24h1v1h-1zM14 24h1v1h-1zM16 24h1v1h-1zM17 24h1v1h-1zM18 24h1v1h-1zM20 24h1v1h-1zM7 25h1v1h-1zM8 25h1v1h-1zM9 25h1v1h-1zM10 25h1v1h-1zM11 25h1v1h-1zM12 25h1v1h-1zM13 25h1v1h-1zM16 25h1v1h-1zM17 25h1v1h-1zM18 25h1v1h-1zM19 25h1v1h-1zM21 25h1v1h-1zM6 26h1v1h-1zM7 26h1v1h-1zM8 26h1v1h-1zM9 26h1v1h-1zM10 26h1v1h-1zM11 26h1v1h-1zM12 26h1v1h-1zM14 26h1v1h-1zM15 26h1v1h-1zM16 26h1v1h-1zM18 26h1v1h-1zM19 26h1v1h-1zM20 26h1v1h-1zM21 26h1v1h-1zM22 26h1v1h-1zM6 27h1v1h-1zM7 27h1v1h-1zM8 27h1v1h-1zM9 27h1v1h-1zM10 27h1v1h-1zM11 27h1v1h-1zM12 27h1v1h-1zM20 27h1v1h-1zM21 27h1v1h-1zM22 27h1v1h-1zM23 27h1v1h-1zM6 28h1v1h-1zM7 28h1v1h-1zM8 28h1v1h-1zM9 28h1v1h-1zM10 28h1v1h-1zM11 28h1v1h-1zM20 28h1v1h-1zM21 28h1v1h-1zM22 28h1v1h-1zM5 29h1v1h-1zM6 29h1v1h-1zM7 29h1v1h-1zM8 29h1v1h-1zM9 29h1v1h-1zM10 29h1v1h-1zM21 29h1v1h-1zM6 30h1v1h-1zM7 30h1v1h-1zM8 30h1v1h-1zM9 30h1v1h-1zM10 30h1v1h-1zM7 31h1v1h-1zM9 31h1v1h-1z";

/** The mark's lit pixels as [x, y], for animating it pixel by pixel. */
const MARK_PX: [number, number][] = [...MARK.matchAll(/M(\d+) (\d+)/g)].map((m) => [+m[1], +m[2]]);

/**
 * Loading state for the graph: the mark assembles out of noise pixel by pixel,
 * nearest the centre first (as the opening's sphere does), then a scanline
 * sweeps it like a plotter until the layout lands.
 */
export function LogoLoader({ label, leaving = false }: { label: string; leaving?: boolean }) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return (
    <div className={`logo-loader ${leaving ? "leaving" : ""}`} role="status" aria-live="polite">
      <svg viewBox="-2 -2 36 36" className="ll-mark" shapeRendering="crispEdges" aria-hidden="true">
        {MARK_PX.map(([x, y]) => {
          const d = Math.hypot(x - 16, y - 16);
          const style = { "--dx": `${((rnd() - 0.5) * 40).toFixed(1)}px`, "--dy": `${((rnd() - 0.5) * 40).toFixed(1)}px`, animationDelay: `${(d * 34 + rnd() * 120).toFixed(0)}ms, ${(900 + d * 34).toFixed(0)}ms` } as React.CSSProperties;
          return <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" style={style} />;
        })}
        <rect className="ll-scan" x="-2" y="-2" width="36" height="1.2" />
      </svg>
      <div className="ll-label"><span>{label}</span><i /></div>
    </div>
  );
}

export function Logo({ spin = false }: { spin?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={spin ? "logo logo-draw" : "logo"} shapeRendering="crispEdges" aria-hidden="true">
      <path className="logo-k" d={MARK} fill="var(--accent)" />
    </svg>
  );
}


/** Square glyph for a symbol kind – the same tile the graph draws for hubs. */
export function Kind({ kind, size = 16 }: { kind: string; community?: number; size?: number }) {
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
