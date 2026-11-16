// Close in on the canvas, a card beside the file bar shows the code itself: the picked
// or hovered name, else the name nearest the middle of the screen, with its file and line.
// The canvas calls the registered function after each paint to place the card.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api } from "../../api";
import { LANG, paint as tint } from "../../CodePanel";
import { Kind } from "../../ui";
import type { View } from "./draw";
import { lineY, type Placed } from "./layout";
import type { FileN, Sym } from "./model";

export type PeekFn = (v: View, p: Placed) => void;

export const PEEK_AT = 2.4; // zoom where the code shows
const LINES = 40;
const W = 440, GAP = 14;

const cache = new Map<string, Promise<string[]>>();
const source = (path: string) => {
  let got = cache.get(path);
  if (!got) {
    got = api.file(path).then((f) => f.content.split("\n"));
    got.catch(() => cache.delete(path));
    cache.set(path, got);
  }
  return got;
};

type Props = { reg: MutableRefObject<PeekFn | null>; sym: Sym | null; file: FileN | null; redraw: () => void; open: (s: Sym) => void };

export function CodePeek({ reg, sym, file, redraw, open }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Sym | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const want = useRef({ sym, file });
  want.current = { sym, file };

  useEffect(() => {
    reg.current = (v, p) => {
      const el = card.current, host = el?.parentElement;
      if (!el || !host) return;
      const w = host.clientWidth, h = host.clientHeight;
      const target = v.k >= PEEK_AT ? choose(v, p, w, h, want.current.sym, want.current.file) : null;
      setShown((cur) => (cur === target?.sym ? cur : target?.sym ?? null));
      if (!target) { el.style.visibility = "hidden"; return; }
      const { b, sym: s } = target;
      const right = (b.x + b.w) * v.k + v.x + GAP;
      const left = b.x * v.k + v.x - GAP - W;
      const x = right + W <= w - 8 || left < 8 ? Math.min(right, w - W - 8) : left;
      const y = Math.min(Math.max(8, lineY(b, s.line, s.file.loc) * v.k + v.y - 10), Math.max(8, h - el.offsetHeight - 8));
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.visibility = "visible";
    };
    return () => { reg.current = null; };
  }, [reg]);
  // repaint once so a new pick or hover places the card without waiting for a pan
  useEffect(() => { redraw(); }, [sym, file, redraw]);

  useEffect(() => {
    setLines(null);
    if (!shown) return;
    let live = true;
    source(shown.file.path).then((ls) => live && setLines(ls)).catch(() => live && setLines([]));
    return () => { live = false; };
  }, [shown?.file.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = shown;
  const lang = s ? LANG[s.file.path.split(".").pop() ?? ""] ?? "" : "";
  const end = s ? Math.min(s.end || s.line, s.line + LINES - 1) : 0;
  const body = s && lines ? lines.slice(s.line - 1, end) : [];
  return (
    <div ref={card} className="ct-peek" style={{ width: W, visibility: "hidden" }} aria-hidden={!s}>
      {s && (
        <>
          <button className="ct-peek-head" onClick={() => open(s)} title="Open source">
            <Kind kind={s.kind} size={14} />
            <b>{s.name}</b>
            <span className="ct-at">{s.file.path}:{s.line}</span>
          </button>
          <pre className="ct-peek-code">
            {!lines && <span className="ct-hint">Reading</span>}
            {body.map((l, i) => (
              <div key={i}><span className="ct-peek-n">{s.line + i}</span>{tint(l, lang)}</div>
            ))}
            {s.end > end && <div className="ct-hint">{s.end - end} more lines</div>}
          </pre>
        </>
      )}
    </div>
  );
}

/** The name to show: the one asked for when it is drawn, else the nearest to the middle of the screen. */
function choose(v: View, p: Placed, w: number, h: number, sym: Sym | null, file: FileN | null) {
  const wx = (w / 2 - v.x) / v.k, wy = (h / 2 - v.y) / v.k;
  const vis = (b: { x: number; y: number; w: number; h: number }) => (b.x + b.w) * v.k + v.x > 0 && b.x * v.k + v.x < w && (b.y + b.h) * v.k + v.y > 0 && b.y * v.k + v.y < h;
  if (sym) { const b = p.files.get(sym.file); if (b && vis(b)) return { b, sym }; }
  let f = file && p.files.get(file) && vis(p.files.get(file)!) ? file : null;
  if (!f) {
    let best = Infinity;
    for (const [g, b] of p.files) {
      if (!g.syms.length || !vis(b)) continue;
      const d = Math.hypot(Math.max(b.x - wx, 0, wx - b.x - b.w), Math.max(b.y - wy, 0, wy - b.y - b.h));
      if (d < best) { best = d; f = g; }
    }
  }
  const b = f && p.files.get(f);
  if (!f || !b || !f.syms.length) return null;
  let pickd: Sym | null = null, best = Infinity;
  for (const s of f.syms) {
    if (s.kind === "method" && f.syms.length > 40) continue;
    const y0 = lineY(b, s.line, f.loc), y1 = lineY(b, s.end, f.loc);
    const d = wy < y0 ? y0 - wy : wy > y1 ? wy - y1 : -1 / Math.max(1, s.end - s.line); // inside: the tightest wins
    if (d < best) { best = d; pickd = s; }
  }
  return pickd ? { b, sym: pickd } : null;
}
