// Code as a flowchart: one function's body read into steps, branches, loops,
// match arms and exits, then wired as a graph the canvas can lay out. A light
// structural read, not a compiler: braces for C-family and Rust, indentation
// for Python. Plain statements in a row collapse into one step.

export type FKind = "start" | "step" | "cond" | "loop" | "match" | "ret" | "end";
export type FNode = { id: string; kind: FKind; text: string; lines: string[] };
export type FEdge = { from: string; to: string; label?: string; back?: boolean };
export type Chart = { nodes: FNode[]; edges: FEdge[] };

type Item =
  | { t: "stmt"; text: string }
  | { t: "ret"; text: string }
  | { t: "if"; cond: string; then: Item[]; else: Item[] | null }
  | { t: "loop"; head: string; body: Item[] }
  | { t: "match"; head: string; arms: { pat: string; body: Item[] }[] };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n = 56) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Index just past the brace that closes the one at `i`, skipping strings and comments. */
function close(src: string, i: number) {
  let d = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (c === "/" && n === "/") { j = src.indexOf("\n", j); if (j < 0) return src.length; continue; }
    if (c === "/" && n === "*") { j = src.indexOf("*/", j + 2) + 1; if (j <= 0) return src.length; continue; }
    if (c === '"' || c === "'" || c === "`") {
      // a Rust lifetime ('a) is not a char literal: only skip when it closes nearby
      if (c === "'" && src[j + 2] !== "'" && !(src[j + 1] === "\\" && src[j + 3] === "'")) continue;
      for (j++; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++;
      continue;
    }
    if (c === "{") d++;
    else if (c === "}" && --d === 0) return j + 1;
  }
  return src.length;
}

const KW = /^(?:\}\s*)?(else\s+if|if|else|for|while|loop|match|switch)\b/;

function braces(src: string): Item[] {
  const out: Item[] = [];
  let acc = "", i = 0;
  const flush = (end = "") => {
    const s = squash(acc + end); acc = "";
    if (!s || s === ";") return;
    out.push(/^(return|break|continue|throw|panic!|bail!|unreachable!)\b|^\?$/.test(s) ? { t: "ret", text: s } : { t: "stmt", text: s });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      const e = src[i + 1] === "/" ? src.indexOf("\n", i) : src.indexOf("*/", i) + 2;
      i = e <= 0 ? src.length : e; continue;
    }
    if (c === '"' || c === "`") { const s = i; for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; acc += src.slice(s, ++i); continue; }
    if (c === ";") { flush(); i++; continue; }
    if (c === "{") {
      const head = squash(acc), m = head.match(KW), end = close(src, i);
      const inner = src.slice(i + 1, end - 1);
      if (!m) { acc += src.slice(i, end); i = end; continue; } // a closure, struct literal, block expression
      acc = ""; i = end;
      const kw = m[1].replace(/\s+/g, " ");
      if (kw === "if" || kw === "else if") out.push({ t: "if", cond: head.replace(KW, "").trim(), then: braces(inner), else: null });
      else if (kw === "else") {
        const last = out[out.length - 1];
        const tail = (it: Item | undefined): Extract<Item, { t: "if" }> | null => it?.t === "if" ? (it.else && it.else.length === 1 && it.else[0].t === "if" ? tail(it.else[0]) : it) : null;
        const host = tail(last); if (host) host.else = braces(inner); else out.push(...braces(inner));
      } else if (kw === "match" || kw === "switch") out.push({ t: "match", head: head.replace(KW, "").trim(), arms: arms(inner, kw === "switch") });
      else out.push({ t: "loop", head: kw === "loop" ? "loop" : `${kw} ${head.replace(KW, "").trim()}`, body: braces(inner) });
      // `else if` chains nest: an `else if` right after an if becomes its else branch
      if (kw === "else if") {
        const made = out.pop()!; const prev = out[out.length - 1];
        let h = prev?.t === "if" ? prev : null;
        while (h && h.else && h.else.length === 1 && h.else[0].t === "if") h = h.else[0];
        if (h && !h.else) h.else = [made]; else out.push(made);
      }
      continue;
    }
    acc += c; i++;
  }
  flush();
  return out;
}

/** Match arms (`pat => expr,` or `pat => { … }`) or switch cases (`case x:`). */
function arms(src: string, sw: boolean): { pat: string; body: Item[] }[] {
  if (sw) return src.split(/\b(?=case\b|default\b)/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const k = s.indexOf(":"); return { pat: squash(s.slice(0, k)), body: braces(s.slice(k + 1)) };
  });
  const out: { pat: string; body: Item[] }[] = [];
  let i = 0;
  while (i < src.length) {
    const a = src.indexOf("=>", i); if (a < 0) break;
    const pat = squash(src.slice(i, a)).replace(/^,/, "").trim();
    let j = a + 2; while (/\s/.test(src[j] ?? "")) j++;
    let body: string;
    if (src[j] === "{") { const e = close(src, j); body = src.slice(j + 1, e - 1); i = e; }
    else { let d = 0, k = j; for (; k < src.length; k++) { const c = src[k]; if ("([{".includes(c)) d++; else if (")]}".includes(c)) d--; else if (c === "," && d === 0) break; } body = src.slice(j, k) + ";"; i = k + 1; }
    if (pat) out.push({ pat, body: braces(body) });
  }
  return out;
}

function indents(lines: string[]): Item[] {
  const out: Item[] = [];
  const ind = (l: string) => l.length - l.trimStart().length;
  let i = 0;
  const block = (from: number, base: number) => { let j = from; while (j < lines.length && (!lines[j].trim() || ind(lines[j]) > base)) j++; return j; };
  while (i < lines.length) {
    const l = lines[i], t = l.trim();
    if (!t || t.startsWith("#")) { i++; continue; }
    const m = t.match(/^(if|elif|else|for|while|match|case|try|except|finally|with)\b(.*):\s*$/);
    if (!m) { out.push(/^(return|raise|break|continue)\b/.test(t) ? { t: "ret", text: t } : { t: "stmt", text: t }); i++; continue; }
    const end = block(i + 1, ind(l)), body = indents(lines.slice(i + 1, end)); i = end;
    const [, kw, rest] = m;
    if (kw === "if") out.push({ t: "if", cond: rest.trim(), then: body, else: null });
    else if (kw === "elif" || kw === "else") {
      let h = out[out.length - 1]?.t === "if" ? (out[out.length - 1] as Extract<Item, { t: "if" }>) : null;
      while (h && h.else && h.else.length === 1 && h.else[0].t === "if") h = h.else[0];
      const it: Item[] = kw === "elif" ? [{ t: "if", cond: rest.trim(), then: body, else: null }] : body;
      if (h && !h.else) h.else = it; else out.push(...it);
    } else if (kw === "for" || kw === "while") out.push({ t: "loop", head: `${kw}${rest}`, body });
    else if (kw === "match") out.push({ t: "match", head: rest.trim(), arms: [] });
    else if (kw === "case" && out[out.length - 1]?.t === "match") (out[out.length - 1] as Extract<Item, { t: "match" }>).arms.push({ pat: rest.trim(), body });
    else out.push({ t: "stmt", text: `${kw}${rest}:` }, ...body);
  }
  return out;
}

/** The function starting at `line` (1-based) in `src`, read into a chart. */
export function chart(src: string, line: number, name: string): Chart {
  const lines = src.split("\n");
  const head = lines.slice(line - 1).join("\n");
  let items: Item[];
  if (/^\s*(async\s+)?def\s/.test(lines[line - 1] ?? "")) {
    const base = lines[line - 1].length - lines[line - 1].trimStart().length;
    let j = line; while (j < lines.length && (!lines[j].trim() || lines[j].length - lines[j].trimStart().length > base)) j++;
    items = indents(lines.slice(line, j));
  } else {
    const o = head.indexOf("{");
    items = o < 0 ? [] : braces(head.slice(o + 1, close(head, o) - 1));
  }

  const nodes: FNode[] = [], edges: FEdge[] = [];
  let n = 0;
  const add = (kind: FKind, text: string, ls: string[] = []) => { const id = `f${n++}`; nodes.push({ id, kind, text: clip(text), lines: ls }); return id; };
  type Out = { id: string; label?: string };
  const link = (from: Out[], to: string) => from.forEach((f) => edges.push({ from: f.id, to, label: f.label }));
  const loops: { head: string; exits: Out[] }[] = [];

  // Emit a list of items after `from`; returns the dangling exits.
  const emit = (list: Item[], from: Out[]): Out[] => {
    let cur = from, run: string[] = [];
    const spill = () => {
      if (!run.length) return;
      const id = add("step", run.length === 1 ? run[0] : `${run[0]}  +${run.length - 1}`, run);
      link(cur, id); cur = [{ id }]; run = [];
    };
    for (const it of list) {
      if (it.t === "stmt") { run.push(it.text); continue; }
      spill();
      if (it.t === "ret") {
        const id = add("ret", it.text); link(cur, id);
        const verb = it.text.split(/\s/)[0];
        if (verb === "continue" && loops.length) edges.push({ from: id, to: loops[loops.length - 1].head, back: true });
        else if (verb === "break" && loops.length) loops[loops.length - 1].exits.push({ id });
        else edges.push({ from: id, to: "end" });
        cur = []; continue;
      }
      if (it.t === "if") {
        const id = add("cond", it.cond || "if"); link(cur, id);
        const a = emit(it.then, [{ id, label: "yes" }]);
        const b = it.else ? emit(it.else, [{ id, label: "no" }]) : [{ id, label: "no" }];
        cur = [...a, ...b]; continue;
      }
      if (it.t === "loop") {
        const id = add("loop", it.head); link(cur, id);
        loops.push({ head: id, exits: [] });
        const tail = emit(it.body, [{ id, label: "each" }]);
        tail.forEach((t) => edges.push({ from: t.id, to: id, label: t.label, back: true }));
        const l = loops.pop()!;
        cur = [...(it.head === "loop" ? [] : [{ id, label: "done" }]), ...l.exits]; continue;
      }
      const id = add("match", it.head || "match"); link(cur, id);
      const outs: Out[] = [];
      for (const a of it.arms) outs.push(...emit(a.body, [{ id, label: clip(a.pat, 22) }]));
      cur = it.arms.length ? outs : [{ id }];
    }
    spill();
    return cur;
  };

  const start = add("start", name);
  const tail = emit(items, [{ id: start }]);
  nodes.push({ id: "end", kind: "end", text: "end", lines: [] });
  link(tail, "end");
  return { nodes, edges };
}
