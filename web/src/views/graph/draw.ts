// Paints the code canvas with Canvas 2D: folder boxes, file blocks with their
// symbols as bands, and links as curves between the lines they leave and land on.
// Far out, links between the same two blocks merge into one stroke; close in they split.

import { cssVar } from "../../graphfx";
import { holder, lineY, type Box, type Placed } from "./layout";
import { kindOf, KINDS, type DirN, type FileN, type KindId, type Model, type Selection, type Sym } from "./model";

export type View = { k: number; x: number; y: number };
export type Paint = {
  m: Model; p: Placed; view: View; sel: Selection; hover: FileN | Sym | null;
  on: Set<KindId>; strength: Record<KindId, number>; bodies: boolean; dim: Set<FileN> | null;
};

const SPLIT_AT = 1.4; // zoom where merged links split into one per symbol

type Colors = Record<"bg" | "line" | "line2" | "panel" | "text" | "text2" | "text3" | "accent", string> & Record<KindId, string>;
let colors: Colors | null = null;
export function readColors() {
  const c = {
    bg: cssVar("--bg"), line: cssVar("--line"), line2: cssVar("--line-2"), panel: cssVar("--panel-2"),
    text: cssVar("--text"), text2: cssVar("--text-2"), text3: cssVar("--text-3"), accent: cssVar("--accent"),
  } as Colors;
  for (const k of KINDS) c[k.id] = cssVar(k.color);
  colors = c;
  return c;
}

const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  if (h.length < 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

function rr(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

const MONO = "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace";

function fitText(ctx: CanvasRenderingContext2D, s: string, w: number) {
  if (ctx.measureText(s).width <= w) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(`${s.slice(0, mid)}…`).width <= w) lo = mid; else hi = mid - 1; }
  return lo ? `${s.slice(0, lo)}…` : "";
}

export function paint(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, s: Paint) {
  const c = colors ?? readColors();
  const { k } = s.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * s.view.x, dpr * s.view.y);
  const px = 1 / k; // one screen pixel in world units
  // only what is on screen is drawn
  const vx0 = -s.view.x / k, vy0 = -s.view.y / k, vx1 = vx0 + w / k, vy1 = vy0 + h / k;
  const seen = (b: Box) => b.x < vx1 && b.x + b.w > vx0 && b.y < vy1 && b.y + b.h > vy0;
  const selDir = s.sel?.type === "dir" ? s.sel.dir : null;
  const selFile = s.sel?.type === "file" ? s.sel.file : s.sel?.type === "sym" ? s.sel.sym.file : null;
  const selSym = s.sel?.type === "sym" ? s.sel.sym : null;

  // folders
  ctx.lineWidth = px;
  for (const [d, b] of s.p.dirs) {
    if (!seen(b)) continue;
    const picked = d === selDir;
    rr(ctx, b, 6);
    if (b.shut) { ctx.fillStyle = c.panel; ctx.fill(); }
    ctx.strokeStyle = picked ? c.accent : b.shut ? c.line2 : c.line;
    ctx.lineWidth = picked ? 1.5 * px : px;
    ctx.stroke();
    const fs = 11;
    if (fs * k < 4.5) continue;
    ctx.font = `500 ${fs}px ${MONO}`;
    ctx.fillStyle = picked ? c.accent : c.text2;
    ctx.textBaseline = "middle";
    const label = fitText(ctx, `${d.name || "."}/`, b.w - 34);
    ctx.fillText(label, b.x + 10, b.y + (b.shut ? 15 : 12));
    ctx.fillStyle = c.text3;
    ctx.fillText(b.shut ? "+" : d.parent ? "−" : "", b.x + 14 + ctx.measureText(label).width, b.y + (b.shut ? 15 : 12));
    if (b.shut) { ctx.font = `400 10px ${MONO}`; ctx.fillText(`${d.count} files`, b.x + 10, b.y + 32); }
  }

  // files
  for (const [f, b] of s.p.files) {
    if (!seen({ x: b.x, y: b.y - 14, w: b.w, h: b.h + 14 })) continue;
    const faint = s.dim && !s.dim.has(f);
    ctx.globalAlpha = faint ? 0.18 : 1;
    const picked = f === selFile && !selSym;
    rr(ctx, b, 4);
    ctx.fillStyle = c.panel;
    ctx.fill();
    ctx.lineWidth = picked ? 1.5 * px : px;
    ctx.strokeStyle = picked ? c.accent : f === s.hover ? c.text3 : c.line2;
    ctx.stroke();
    if (s.bodies && b.h * k > 14) {
      for (const sy of f.syms) {
        if (sy.kind === "method" && f.syms.length > 40) continue;
        const y0 = lineY(b, sy.line, f.loc), y1 = Math.max(y0 + px * 2, lineY(b, sy.end, f.loc));
        const lit = sy === selSym || sy === s.hover;
        ctx.fillStyle = lit ? rgba(c.accent, 0.35) : rgba(c.text, sy.kind === "class" || sy.kind === "interface" ? 0.07 : 0.045);
        ctx.fillRect(b.x + 3, y0, b.w - 6, y1 - y0);
        ctx.fillStyle = lit ? c.accent : c.text3;
        ctx.fillRect(b.x + 3, y0, 2 * px > 1.5 ? 1.5 : 2 * px, y1 - y0);
        if ((y1 - y0) * k > 11 && k > 1.1) {
          ctx.font = `400 8px ${MONO}`;
          ctx.textBaseline = "top";
          ctx.fillStyle = lit ? c.text : c.text2;
          ctx.fillText(fitText(ctx, sy.name, b.w - 12), b.x + 7, y0 + 1.5);
        }
      }
    }
    if (9 * k >= 4.5) {
      ctx.font = `${picked ? 600 : 400} 9px ${MONO}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = picked ? c.accent : c.text2;
      ctx.fillText(fitText(ctx, f.name, b.w), b.x, b.y - 4);
    }
    ctx.globalAlpha = 1;
  }

  // links
  const split = k >= SPLIT_AT;
  const where = new Map<FileN, ReturnType<typeof holder>>();
  const hold = (f: FileN) => { if (!where.has(f)) where.set(f, holder(s.p, f)); return where.get(f)!; };
  type Agg = { a: Box; b: Box; ya: number; yb: number; kind: KindId; n: number };
  const agg = new Map<string, Agg>();
  for (const l of s.m.links) {
    if (l.sf === l.df) continue;
    const kind = kindOf(l, s.sel);
    if (!kind || !s.on.has(kind)) continue;
    const A = hold(l.sf), B = hold(l.df);
    if (!A || !B || A.box === B.box) continue;
    const ya = split && A.open ? lineY(A.box, l.sl, l.sf.loc) : A.box.y + A.box.h / 2;
    const yb = split && B.open ? lineY(B.box, l.dl, l.df.loc) : B.box.y + B.box.h / 2;
    const key = split ? `${l.src}>${l.dst}|${kind}` : `${A.box.x},${A.box.y}>${B.box.x},${B.box.y}|${kind}`;
    const g = agg.get(key);
    if (g) g.n++;
    else agg.set(key, { a: A.box, b: B.box, ya, yb, kind, n: 1 });
  }
  const picked = !!s.sel;
  ctx.lineCap = "round";
  for (const g of agg.values()) {
    const ax = g.b.x >= g.a.x + g.a.w ? g.a.x + g.a.w : g.b.x + g.b.w <= g.a.x ? g.a.x : g.a.x + g.a.w;
    const bx = g.b.x >= g.a.x + g.a.w ? g.b.x : g.b.x + g.b.w <= g.a.x ? g.b.x + g.b.w : g.b.x;
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(g.ya, g.yb), maxY = Math.max(g.ya, g.yb);
    if (maxX < vx0 - 200 || minX > vx1 + 200 || maxY < vy0 - 200 || minY > vy1 + 200) continue;
    const dir = bx >= ax ? 1 : -1;
    const bend = Math.max(30, Math.abs(bx - ax) * 0.45, Math.abs(g.yb - g.ya) * 0.2);
    const sameSide = ax === bx || (ax === g.a.x + g.a.w && bx === g.b.x + g.b.w);
    const st = s.strength[g.kind] ?? 0.6;
    ctx.strokeStyle = rgba(c[g.kind], Math.min(1, (picked ? 0.85 : 0.13) * st * (g.n > 1 ? 1.2 : 1)));
    ctx.lineWidth = (picked ? 1.3 : 0.9) * Math.min(picked ? 5 : 3, 1 + Math.log2(g.n)) * px;
    ctx.beginPath();
    ctx.moveTo(ax, g.ya);
    if (sameSide) ctx.bezierCurveTo(ax + bend, g.ya, bx + bend, g.yb, bx, g.yb);
    else ctx.bezierCurveTo(ax + dir * bend, g.ya, bx - dir * bend, g.yb, bx, g.yb);
    ctx.stroke();
    if (picked || k > 0.8) {
      ctx.fillStyle = rgba(c[g.kind], Math.min(1, (picked ? 0.95 : 0.4) * st));
      ctx.beginPath();
      ctx.arc(bx, g.yb, 2 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** What sits under a world point: a folder's toggle, a folder's head, a symbol band or a file block. */
export type Hit = { type: "toggle" | "dir"; dir: DirN } | { type: "file"; file: FileN } | { type: "sym"; sym: Sym } | null;

export function hitTest(s: Pick<Paint, "p" | "bodies" | "view">, wx: number, wy: number): Hit {
  for (const [f, b] of s.p.files) {
    if (wx < b.x || wx > b.x + b.w || wy < b.y - 13 || wy > b.y + b.h) continue;
    if (s.bodies && wy >= b.y && b.h * s.view.k > 14) {
      let best: Sym | null = null;
      for (const sy of f.syms) {
        const y0 = lineY(b, sy.line, f.loc), y1 = Math.max(y0 + 3 / s.view.k, lineY(b, sy.end, f.loc));
        if (wy >= y0 && wy <= y1 && (!best || sy.end - sy.line < best.end - best.line)) best = sy;
      }
      if (best) return { type: "sym", sym: best };
    }
    return { type: "file", file: f };
  }
  let found: Hit = null, area = Infinity;
  for (const [d, b] of s.p.dirs) {
    if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) continue;
    const a = b.w * b.h;
    if (a >= area) continue;
    area = a;
    const head = wy <= b.y + (b.shut ? b.h : 24);
    found = head ? { type: b.shut || (d.parent && wx >= b.x + b.w - 40) ? "toggle" : "dir", dir: d } : { type: "dir", dir: d };
    if (!head) found = { type: "dir", dir: d };
  }
  return found;
}
