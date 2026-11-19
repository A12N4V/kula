// Paints the code canvas with Canvas 2D: hollow folder boxes named from above, file
// bars with their symbols as bands, and links as curves between the lines they leave and land on.
// Far out, links between the same two blocks merge into one stroke; close in they split.

import { cssVar } from "../../graphfx";
import { DIR_LABEL, dirLabelW, FLABEL, holder, lineY, type Box, type Placed } from "./layout";
import { kindOf, KINDS, type DirN, type FileN, type KindId, type Model, type Selection, type Sym } from "./model";

export type View = { k: number; x: number; y: number };
export type Paint = {
  m: Model; p: Placed; view: View; sel: Selection; hover: FileN | Sym | null;
  on: Set<KindId>; strength: Record<KindId, number>; bodies: boolean; dim: Set<FileN> | null;
  /** kinds that split per symbol when zoomed in, and the strength of those split links */
  bodyOn: Set<KindId>; bodyStrength: Record<KindId, number>;
};

const SPLIT_AT = 1.4; // zoom where merged links split into one per symbol
const PATH_AT = 2.2; // zoom where each file shows its whole path

type Colors = Record<"bg" | "line" | "line2" | "panel" | "text" | "text2" | "text3" | "accent", string> & Record<KindId, string> & { hues: string[] };
let colors: Colors | null = null;
/** One hue per top level folder, so a part of the repo keeps its colour wherever it is drawn. */
const HUES = ["--map-orange", "--map-blue", "--map-green", "--map-violet", "--map-yellow", "--map-cyan", "--map-pink", "--map-red"];
export function readColors() {
  const c = {
    bg: cssVar("--bg"), line: cssVar("--line"), line2: cssVar("--line-2"), panel: cssVar("--panel-2"),
    text: cssVar("--text"), text2: cssVar("--text-2"), text3: cssVar("--text-3"), accent: cssVar("--accent"),
    hues: HUES.map(cssVar),
  } as Colors;
  for (const k of KINDS) c[k.id] = cssVar(k.color);
  colors = c;
  return c;
}

const hueOf = new WeakMap<DirN, number>();
function hue(c: Colors, d: DirN) {
  let top = d;
  while (top.parent && top.parent.parent) top = top.parent;
  if (!top.parent) return c.text2;
  let i = hueOf.get(top);
  if (i == null) { i = top.parent.dirs.indexOf(top) % c.hues.length; hueOf.set(top, i); }
  return c.hues[i];
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
  // Text grows with zoom up to a screen size, then holds.
  const cap = (world: number, screen: number) => Math.min(world, screen * px);
  // only what is on screen is drawn
  const vx0 = -s.view.x / k, vy0 = -s.view.y / k, vx1 = vx0 + w / k, vy1 = vy0 + h / k;
  const seen = (b: Box) => b.x < vx1 && b.x + b.w > vx0 && b.y < vy1 && b.y + b.h > vy0;
  const selDir = s.sel?.type === "dir" ? s.sel.dir : null;
  const selFile = s.sel?.type === "file" ? s.sel.file : s.sel?.type === "sym" ? s.sel.sym.file : null;
  const selSym = s.sel?.type === "sym" ? s.sel.sym : null;
  // a hover with nothing picked lights its links for as long as it lasts
  const focus: Selection = s.sel ?? (!s.hover ? null : "syms" in s.hover ? { type: "file", file: s.hover } : { type: "sym", sym: s.hover });
  const picked = !!focus;

  // links first: which run, and which files they reach in what colour
  const zoomed = k >= SPLIT_AT;
  const where = new Map<FileN, ReturnType<typeof holder>>();
  const hold = (f: FileN) => { if (!where.has(f)) where.set(f, holder(s.p, f)); return where.get(f)!; };
  type Agg = { a: Box; b: Box; ya: number; yb: number; kind: KindId; n: number; body: boolean };
  const agg = new Map<string, Agg>();
  const reach = new Map<FileN, KindId>();
  for (const l of s.m.links) {
    if (l.sf === l.df) continue;
    const kind = kindOf(l, focus);
    if (!kind || !s.on.has(kind)) continue;
    if (picked) { const far = kind === "in" || kind === "importers" ? l.sf : l.df; if (!reach.has(far)) reach.set(far, kind); }
    const A = hold(l.sf), B = hold(l.df);
    if (!A || !B || A.box === B.box) continue;
    const split = zoomed && s.bodyOn.has(kind);
    const ya = split && A.open ? lineY(A.box, l.sl, l.sf.loc) : A.box.y + A.box.h / 2;
    const yb = split && B.open ? lineY(B.box, l.dl, l.df.loc) : B.box.y + B.box.h / 2;
    const key = split ? `${l.src}>${l.dst}|${kind}` : `${A.box.x},${A.box.y}>${B.box.x},${B.box.y}|${kind}`;
    const g = agg.get(key);
    if (g) g.n++;
    else agg.set(key, { a: A.box, b: B.box, ya, yb, kind, n: 1, body: split });
  }
  const dim = s.dim ?? (picked && !s.sel ? new Set<FileN>([...reach.keys(), ...(focus?.type === "file" ? [focus.file] : focus?.type === "sym" ? [focus.sym.file] : [])]) : null);

  // folders: an outline in the hue of their part of the repo, the name above its top left corner
  for (const [d, b] of s.p.dirs) {
    if (!seen({ x: b.x, y: b.y - DIR_LABEL, w: b.w, h: b.h + DIR_LABEL })) continue;
    const on = d === selDir, tint = hue(c, d), top = !!d.parent && !d.parent.parent;
    rr(ctx, b, 6);
    ctx.fillStyle = rgba(tint, b.shut ? 0.2 : top ? 0.06 : 0.035);
    ctx.fill();
    ctx.strokeStyle = on ? c.accent : rgba(tint, top ? 0.8 : 0.5);
    ctx.lineWidth = on ? 1.5 * px : px;
    ctx.stroke();
    if (11 * k < 4.5) continue;
    ctx.font = `${top ? 600 : 500} ${cap(11, 13)}px ${MONO}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = on ? c.accent : rgba(tint, top ? 1 : 0.8);
    const label = `${d.name || "."}/`;
    ctx.fillText(label, b.x + 1, b.y - 7);
    if (d.parent) {
      ctx.fillStyle = on ? c.accent : c.text3;
      ctx.fillText(b.shut ? "+" : "−", b.x + 1 + dirLabelW(d.name || ".") + 2, b.y - 7);
    }
    if (b.shut) {
      ctx.font = `400 ${cap(10, 12)}px ${MONO}`;
      ctx.fillStyle = c.text2;
      ctx.textBaseline = "middle";
      ctx.fillText(`${d.count} files`, b.x + 10, b.y + b.h / 2);
    }
  }

  // files: a bar in its folder's hue, its name in the column to its left
  const near = k >= PATH_AT;
  for (const [f, b] of s.p.files) {
    if (!seen({ x: b.x - FLABEL, y: b.y - 16, w: b.w + FLABEL, h: b.h + 16 })) continue;
    const faint = dim && !dim.has(f);
    ctx.globalAlpha = faint ? 0.14 : 1;
    const tint = hue(c, f.dir);
    const isSel = f === selFile && !selSym;
    const lit = f === selFile || f === s.hover;
    const linked = reach.get(f);
    rr(ctx, b, 3);
    ctx.fillStyle = isSel ? rgba(c.accent, 0.34) : rgba(tint, lit ? 0.55 : linked ? 0.46 : 0.32);
    ctx.fill();
    ctx.lineWidth = (isSel ? 1.5 : linked && !lit ? 1.25 : 1) * px;
    ctx.strokeStyle = isSel ? c.accent : linked && !lit ? c[linked] : rgba(tint, lit ? 1 : 0.72);
    ctx.stroke();
    if (s.bodies && b.h * k > 14 && b.w * k > 18) {
      for (const sy of f.syms) {
        if (sy.kind === "method" && f.syms.length > 40) continue;
        const y0 = lineY(b, sy.line, f.loc), y1 = Math.max(y0 + px * 2, lineY(b, sy.end, f.loc));
        const on = sy === selSym || sy === s.hover;
        ctx.fillStyle = on ? rgba(c.accent, 0.6) : rgba(tint, sy.kind === "class" || sy.kind === "interface" ? 0.22 : 0.14);
        ctx.fillRect(b.x + 2, y0, b.w - 4, y1 - y0);
        if (on) { ctx.lineWidth = px; ctx.strokeStyle = c.accent; ctx.strokeRect(b.x + 2, y0, b.w - 4, y1 - y0); }
        if ((y1 - y0) * k > 11 && b.w * k > 60) {
          ctx.font = `${on ? 600 : 400} ${cap(8, 11)}px ${MONO}`;
          ctx.textBaseline = "top";
          ctx.fillStyle = on ? c.text : c.text2;
          ctx.fillText(fitText(ctx, sy.name, b.w - 8), b.x + 4, y0 + 1.5);
        }
      }
    }
    if (9 * k >= 4.5) {
      ctx.font = `${isSel ? 600 : 400} ${cap(9, 12)}px ${MONO}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.fillStyle = isSel ? c.accent : lit ? c.text : linked ? c[linked] : c.text3;
      ctx.fillText(fitText(ctx, f.name, FLABEL - 10), b.x - 6, b.y + 1);
      ctx.textAlign = "left";
    }
    // close in, the whole path sits above the bar so a file reads without its folders in view
    if (near) {
      ctx.font = `500 ${cap(5, 11)}px ${MONO}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = isSel ? c.accent : rgba(tint, 0.95);
      ctx.fillText(f.path, b.x, b.y - 2.5 * px);
    }
    ctx.globalAlpha = 1;
  }

  ctx.lineCap = "round";
  for (const g of agg.values()) {
    const ax = g.b.x >= g.a.x + g.a.w ? g.a.x + g.a.w : g.b.x + g.b.w <= g.a.x ? g.a.x : g.a.x + g.a.w;
    const bx = g.b.x >= g.a.x + g.a.w ? g.b.x : g.b.x + g.b.w <= g.a.x ? g.b.x + g.b.w : g.b.x;
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(g.ya, g.yb), maxY = Math.max(g.ya, g.yb);
    if (maxX < vx0 - 200 || minX > vx1 + 200 || maxY < vy0 - 200 || minY > vy1 + 200) continue;
    const dir = bx >= ax ? 1 : -1;
    const bend = Math.max(30, Math.abs(bx - ax) * 0.45, Math.abs(g.yb - g.ya) * 0.2);
    const sameSide = ax === bx || (ax === g.a.x + g.a.w && bx === g.b.x + g.b.w);
    const st = (g.body ? s.bodyStrength[g.kind] : s.strength[g.kind]) ?? 0.6;
    ctx.strokeStyle = rgba(c[g.kind], Math.min(1, (picked ? 1.4 : 0.3) * st * (g.n > 1 ? 1.15 : 1)));
    ctx.lineWidth = (picked ? 1.6 : 0.9) * Math.min(picked ? 4 : 2.5, 1 + Math.log2(g.n)) * px;
    ctx.beginPath();
    ctx.moveTo(ax, g.ya);
    if (sameSide) ctx.bezierCurveTo(ax + bend, g.ya, bx + bend, g.yb, bx, g.yb);
    else ctx.bezierCurveTo(ax + dir * bend, g.ya, bx - dir * bend, g.yb, bx, g.yb);
    ctx.stroke();
    if (picked || k > 0.8) {
      ctx.fillStyle = rgba(c[g.kind], Math.min(1, (picked ? 1 : 0.55) * Math.max(st, 0.5)));
      ctx.beginPath();
      ctx.arc(bx, g.yb, (picked ? 2.4 : 1.6) * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** What sits under a world point: a folder's toggle, a folder's name, a symbol band or a file bar. */
export type Hit = { type: "toggle" | "dir"; dir: DirN } | { type: "file"; file: FileN } | { type: "sym"; sym: Sym } | null;

export function hitTest(s: Pick<Paint, "p" | "bodies" | "view">, wx: number, wy: number): Hit {
  const k = s.view.k;
  for (const [f, b] of s.p.files) {
    const onName = wx >= b.x - FLABEL + 6 && wx < b.x && wy >= b.y && wy <= b.y + 12;
    if (!onName && (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h)) continue;
    if (!onName && s.bodies && b.h * k > 14 && b.w * k > 18) {
      let best: Sym | null = null;
      for (const sy of f.syms) {
        const y0 = lineY(b, sy.line, f.loc), y1 = Math.max(y0 + 3 / k, lineY(b, sy.end, f.loc));
        if (wy >= y0 && wy <= y1 && (!best || sy.end - sy.line < best.end - best.line)) best = sy;
      }
      if (best) return { type: "sym", sym: best };
    }
    return { type: "file", file: f };
  }
  // a folder's name above its box picks it; the + or − after the name folds it
  for (const [d, b] of s.p.dirs) {
    const tw = dirLabelW(d.name || ".");
    if (wy < b.y - DIR_LABEL || wy > b.y || wx < b.x || wx > b.x + tw + 16) continue;
    return { type: d.parent && wx > b.x + tw ? "toggle" : "dir", dir: d };
  }
  let found: Hit = null, area = Infinity;
  for (const [d, b] of s.p.dirs) {
    if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) continue;
    const a = b.w * b.h;
    if (a >= area) continue;
    area = a;
    found = { type: b.shut ? "toggle" : "dir", dir: d };
  }
  return found;
}
