// The agent half of the film, replayed from a real session (promo/session.py,
// promo/init.sh): every tool result, hook verdict and memory on screen is what
// kula actually answered. The windows are drawn here – a terminal running
// Claude Code, Cursor's editor with its agent panel – and a camera moves
// between the moments that matter, the way the app shots do.
import type React from "react";
import { AbsoluteFill } from "remotion";
import init from "../public/init.json";
import session from "../public/session.json";
import { World, type Pose } from "./Iso";
import { Cursor, Dither, typed, useF } from "./Kit";
import { BAR, C, FONT, H, W, clamp, easeInOut, easeOut } from "./theme";

// ------------------------------------------------------------------ the session

type Entry = { agent: string; kind: string; tool?: string; result?: any; stdout?: string; stderr?: string; code?: number; files?: any; from?: string; to?: string };
const LOG = session.log as Entry[];
const get = (agent: string, what: string, nth = 0) => LOG.filter((e) => e.agent === agent && (e.tool ?? e.kind) === what)[nth];

const WF = get("claude-code", "workflows").result.workflows.map((w: { name: string }) => w.name) as string[];
const SUGG = get("claude-code", "suggest").result;
const MEM = get("claude-code", "remember").result;
const RECALL = (get("cursor", "recall").result as { author: string; body: string; stale: boolean }[])[0];
const BLOCK = get("cursor", "hook", 0);
const PASS = get("cursor", "hook", 1);
const EDIT = get("cursor", "edit");
const TASK = get("cursor", "start_task").result;
const FILES = get("cursor", "files").files as { "Cargo.toml": string[]; "src/store.rs": { from: number; lines: string[] } };
const CU_VERIFY = get("cursor", "verify_edit").result;
const CC_VERIFY = get("claude-code", "verify_edit").result;
/** The hook's reason, as Cursor shows it (its JSON reply), up to the workflow. */
const REASON = (JSON.parse(BLOCK.stdout || "{}").user_message ?? BLOCK.stderr ?? "").replace(/^kula guard: /, "").split(" – Cut a release")[0];

const verdict = (v: any) => `${v.ok ? "ok" : "not ok"} · ${v.guard_violations.length} fenced · ${v.dangling.length} dangling · ${v.summary.same} symbols unchanged`;

// ------------------------------------------------------------------ camera and framing

export type Key = { f: number; x: number; y: number; z: number };

/** Ease between camera keys: where to look and how close. */
function lens(keys: Key[], f: number) {
  if (f <= keys[0].f) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (f <= b.f) {
      const t = easeInOut((f - a.f) / Math.max(1, b.f - a.f));
      return { f, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return keys[keys.length - 1];
}

export function Cam({ keys, children }: { keys: Key[]; children: React.ReactNode }) {
  const f = useF();
  const { x, y, z } = lens(keys, f);
  const hx = W / 2 / z, hy = H / 2 / z;
  const cx = clamp(x, hx, W - hx), cy = clamp(y, hy, H - hy);
  return (
    <AbsoluteFill style={{ transform: `translate(${W / 2}px, ${H / 2}px) scale(${z}) translate(${-cx}px, ${-cy}px)`, transformOrigin: "0 0" }}>
      {children}
    </AbsoluteFill>
  );
}

/** A window that swings in from an angle and settles flat – and leans away as the shot ends. */
export function Float({ frames, children, from = { rx: 12, ry: -16, s: 0.9 } }: { frames: number; children: React.ReactNode; from?: { rx: number; ry: number; s: number } }) {
  const f = useF();
  const t = easeOut((f + 14) / 40);
  const out = easeInOut((f - (frames - 16)) / 16);
  const rx = from.rx * (1 - t) - 5 * out, ry = from.ry * (1 - t) + 7 * out, s = (from.s + (1 - from.s) * t) * (1 - 0.03 * out);
  return (
    <AbsoluteFill style={{ perspective: 2400 }}>
      <AbsoluteFill style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}

const glow = (cx: number, cy: number, rx: number, ry: number, k: number) => (x: number, y: number) => k * Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));

export function Stage({ children, k = 0.42 }: { children: React.ReactNode; k?: number }) {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Dither value={glow(W / 2, H / 2, 900, 560, k)} cell={12} />
      {children}
    </AbsoluteFill>
  );
}

/** A desktop window: a title bar and a body. */
function Win({ x, y, w, h, title, children, bg = "#0a0908" }: { x: number; y: number; w: number; h: number; title: string; children: React.ReactNode; bg?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: bg, border: `1px solid ${C.line2}`, borderRadius: 10, overflow: "hidden", fontFamily: FONT, color: C.cream }}>
      <div style={{ height: 40, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 8, position: "relative" }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#2c2622" }} />)}
        <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontSize: 15, color: C.dim, letterSpacing: ".04em" }}>{title}</span>
      </div>
      <div style={{ position: "relative", height: h - 41 }}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ install: brew, then kula init, for real

const ROW = 31;

export function Install() {
  const f = useF();
  const lines = init.init.filter((l) => !l.includes("indexing …"));
  const at0 = 76;
  const prompt = (cmd: string, from: number, cps = 40) => (
    <><span style={{ color: C.accent }}>~/kula $ </span>{typed(cmd, f, from, cps)}</>
  );
  const rows: React.ReactNode[] = [
    f >= 2 && <>{prompt("brew install A12N4V/tap/kula", 4, 46)}</>,
    f >= 34 && <>{prompt("kula --version", 34, 46)}</>,
    f >= 48 && <span style={{ color: C.dim }}>{init.version}</span>,
    f >= 52 && <>{prompt("kula init", 54, 36)}</>,
    ...lines.map((l, i) => f >= at0 + i * 4 && <InitLine key={i} l={l} />),
  ];
  const caret = f < at0 + lines.length * 4 + 20;
  // the camera finds the two agents being wired up
  const yAgents = 150 + (4 + lines.findIndex((l) => l.includes("Claude Code"))) * ROW;
  return (
    <Stage>
      <Cam keys={[{ f: 0, x: W / 2, y: H / 2, z: 1 }, { f: 92, x: W / 2, y: H / 2, z: 1.04 }, { f: 118, x: 900, y: yAgents + 20, z: 1.42 }, { f: 160, x: 960, y: yAgents + 30, z: 1.48 }]}>
        <Float frames={9999}>
          <Win x={190} y={90} w={1540} h={900} title="zsh – ~/kula">
            <div style={{ padding: "26px 30px", fontSize: 21, lineHeight: `${ROW}px`, whiteSpace: "pre" }}>
              {rows.filter(Boolean).map((r, i, all) => <div key={i} style={{ height: ROW }}>{r}{caret && i === all.length - 1 && <Cursor />}</div>)}
            </div>
          </Win>
        </Float>
      </Cam>
    </Stage>
  );
}

function InitLine({ l }: { l: string }) {
  if (/[○◯╱╲]/.test(l)) {
    const [art, word] = [l.slice(0, 16), l.slice(16)];
    return <><span style={{ color: C.signal }}>{art}</span><span style={{ color: word.includes("k u l a") ? C.cream : C.dim, fontWeight: word.includes("k u l a") ? 700 : 400 }}>{word}</span></>;
  }
  const m = l.match(/^(\s*)✓ (Claude Code|Cursor|kula\.toml|git hooks|AGENTS\.md|\.github\/workflows\/kula\.yml|graph built)(.*)$/);
  if (m) {
    const agent = m[2] === "Claude Code" || m[2] === "Cursor";
    return <>{m[1]}<span style={{ color: C.green }}>✓ </span><span style={{ fontWeight: 700, color: agent ? C.accent : C.cream }}>{m[2]}</span><span style={{ color: C.dim }}>{m[3]}</span></>;
  }
  return <span style={{ color: C.dim }}>{l}</span>;
}

// ------------------------------------------------------------------ Claude Code

type Row = { at: number; el: (f: number) => React.ReactNode };

const tool = (name: string, args: string, done: number) => (f: number) => (
  <><Dot on={f >= done} />
    <span style={{ fontWeight: 700 }}>kula - {name} </span><span style={{ color: C.dim }}>(MCP){args && `(${args})`}</span></>
);
const out = (text: React.ReactNode, first = true) => () => (
  <span style={{ color: C.dim }}>{first ? "  ⎿  " : "     "}{text}</span>
);
const say = (text: string, from: number, cps = 46) => (f: number) => (
  <><span style={{ color: C.cream }}>● </span>{typed(text, f, from, cps)}</>
);

/** Claude Code's bullet: white and blinking while a tool runs, green when it's back. */
function Dot({ on }: { on: boolean }) {
  const f = useF();
  return <span style={{ color: on ? C.green : Math.floor(f / 8) % 2 ? C.cream : C.dim }}>● </span>;
}

const KV = (k: string, v: string, color: string) => (
  <><span style={{ display: "inline-block", width: 92, color, fontWeight: 700 }}>{k}</span><span style={{ color: C.cream }}>{v}</span></>
);

const W1 = SUGG.workflow;
/** Part 1: Claude Code finds no release workflow, proposes one and remembers why. Part 2: it verifies Cursor's release. */
const CC_ROWS: Row[] = [
  { at: 4, el: (f) => <><span style={{ color: C.dim }}>&gt; </span>{typed("releases keep breaking – set up a release mode for agents", f, 4, 62)}</> },
  { at: 34, el: () => "" },
  { at: 36, el: tool("workflows", "", 48) },
  { at: 48, el: out(<>{WF.length} workflows: {WF.join(" · ")}</>) },
  { at: 54, el: () => "" },
  { at: 56, el: say("There's no workflow for releases. I'll propose one.", 56) },
  { at: 98, el: () => "" },
  { at: 100, el: tool("suggest", `kind: "workflow", name: "${W1.name}"`, 120) },
  { at: 120, el: out(<>suggestion #{SUGG.id} · {SUGG.by} · <span style={{ color: C.yellow }}>waiting for a person</span></>) },
  { at: 126, el: out(KV(W1.name, W1.about, C.accent), false) },
  { at: 132, el: out(KV("scope", W1.scope.join(" · "), C.green), false) },
  { at: 138, el: out(KV("lock", W1.lock.join(" · "), C.red), false) },
  { at: 144, el: out(KV("review", W1.review.join(" · "), C.yellow), false) },
  { at: 150, el: out(KV("memory", W1.memory, C.violet), false) },
  { at: 290, el: () => "" },
  { at: 292, el: tool("remember", `target: "${MEM.target}"`, 304) },
  { at: 304, el: out(<>memory #{MEM.id} · {MEM.author} · pinned to {MEM.target}</>) },
  { at: 310, el: out(<span style={{ color: C.cream, fontStyle: "italic" }}>“{MEM.body}”</span>, false) },
  { at: 336, el: () => "" },
  { at: 338, el: say("Proposed. Accept it under Agents → Workflows and every agent gets it.", 338, 52) },
];
const PART2 = 400; // part 2's rows, in part-1 frames
const CC_ROWS_2: Row[] = [
  { at: PART2 - 2, el: () => "" },
  { at: PART2, el: (f) => <><span style={{ color: C.dim }}>&gt; </span>{typed("cursor shipped 1.0.1 – check it", f, PART2, 64)}</> },
  { at: PART2 + 16, el: () => "" },
  { at: PART2 + 18, el: tool("verify_edit", "", PART2 + 28) },
  { at: PART2 + 28, el: out(<span style={{ color: CC_VERIFY.ok ? C.green : C.red }}>{verdict(CC_VERIFY)}</span>) },
  { at: PART2 + 32, el: () => "" },
  { at: PART2 + 34, el: say("Verified. Nothing fenced was touched.", PART2 + 34, 40) },
];

const LINE = 34, TOP = 196; // first row's y on screen

export function ClaudeCode({ part, frames }: { part: 1 | 2; frames: number }) {
  const f = useF() + (part === 2 ? PART2 : 0);
  const rows = part === 1 ? CC_ROWS : [...CC_ROWS, ...CC_ROWS_2];
  const shown = rows.filter((r) => f >= r.at);
  // in part 2 the history scrolls up to make room
  const scroll = part === 2 ? Math.max(0, rows.length + 5 - 22) * LINE : 0;
  const rowY = (i: number) => TOP + (5 + i) * LINE - scroll;
  const keys: Key[] = part === 1
    ? [{ f: 0, x: W / 2, y: H / 2, z: 1 }, { f: 40, x: W / 2, y: H / 2, z: 1.02 }, { f: 66, x: 760, y: rowY(4), z: 1.3 },
       { f: 112, x: 760, y: rowY(4) + 20, z: 1.3 }, { f: 150, x: 880, y: rowY(11), z: 1.42 }, { f: 270, x: 900, y: rowY(11) + 10, z: 1.46 },
       { f: 312, x: 900, y: rowY(16), z: 1.3 }, { f: 380, x: 900, y: rowY(17), z: 1.24 }, { f: 400, x: 900, y: rowY(17), z: 1.24 }]
    : [{ f: PART2 - 14, x: 860, y: rowY(rows.length - 4), z: 1.18 }, { f: PART2 + 40, x: 820, y: rowY(rows.length - 3), z: 1.38 }, { f: PART2 + 80, x: 820, y: rowY(rows.length - 3), z: 1.42 }];
  return (
    <Stage>
      <Cam keys={keys.map((k) => ({ ...k, f: k.f - (part === 2 ? PART2 : 0), x: Math.min(k.x, 150 + W / 2 / k.z) }))}>
        <Float frames={frames} from={part === 1 ? { rx: 12, ry: 16, s: 0.9 } : { rx: 0, ry: -10, s: 0.96 }}>
          <Win x={170} y={60} w={1580} h={960} title="claude – ~/kula">
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${-scroll}px)`, padding: "22px 30px", fontSize: 21, lineHeight: `${LINE}px`, whiteSpace: "pre" }}>
              <div style={{ border: `1px solid ${C.accent}`, borderRadius: 8, padding: "12px 20px", width: 640, lineHeight: "30px", marginBottom: LINE - 4 }}>
                <div><span style={{ color: C.accent }}>✻ </span><b>Welcome to Claude Code!</b></div>
                <div style={{ color: C.dim }}>  /help for help, /status for your current setup</div>
                <div style={{ color: C.dim }}>  cwd: ~/kula   ·   mcp: kula ✓   ·   hooks: kula guard ✓</div>
              </div>
              {shown.map((r, i) => <div key={i} style={{ height: LINE }}>{r.el(f)}</div>)}
              <div style={{ height: LINE }} />
              <div style={{ border: `1px solid ${C.line2}`, borderRadius: 8, padding: "6px 16px", color: C.dim }}>&gt; <Cursor color={C.dim} /></div>
              <div style={{ color: C.dim, fontSize: 16, marginTop: 6 }}>  ⏵⏵ kula: {part === 2 ? "task done · release workflow in kula.toml" : "no task · 5 workflows"}</div>
            </div>
          </Win>
        </Float>
      </Cam>
    </Stage>
  );
}

// ------------------------------------------------------------------ Cursor

const ED_X = 52 + 290, ED_W = 1800 - 52 - 290 - 600, CHAT_X = 1800 - 600;

type Item = { at: number; h: number; el: (f: number) => React.ReactNode };

function Step({ f, at, done, name, detail, bad }: { f: number; at: number; done: number; name: React.ReactNode; detail?: React.ReactNode; bad?: boolean }) {
  const ok = f >= done;
  const spin = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor((f - at) / 2) % 10];
  return (
    <div style={{ border: `1px solid ${bad && ok ? C.red : C.line2}`, borderRadius: 6, padding: "9px 14px", background: bad && ok ? "rgba(240,130,122,.07)" : "#0e0c0b" }}>
      <div style={{ display: "flex", gap: 10, fontSize: 17 }}>
        <span style={{ color: ok ? (bad ? C.red : C.green) : C.dim, width: 14 }}>{ok ? (bad ? "✕" : "✓") : spin}</span>
        <span>{name}</span>
      </div>
      {ok && detail && <div style={{ fontSize: 15, color: C.dim, marginTop: 6, marginLeft: 24, lineHeight: 1.45, whiteSpace: "normal" }}>{detail}</div>}
    </div>
  );
}

const CU_ITEMS: Item[] = [
  { at: 4, h: 64, el: (f) => <div style={{ background: "#171412", border: `1px solid ${C.line2}`, borderRadius: 6, padding: "10px 14px", fontSize: 18 }}>{typed("ship 1.0.1", f, 6, 30)}</div> },
  { at: 30, h: 76, el: (f) => <Step f={f} at={30} done={40} name={<><b>kula</b> · workflows</>} detail={<>{get("cursor", "workflows").result.workflows.length} workflows · <span style={{ color: C.accent }}>release</span> by agent:claude-code</>} /> },
  { at: 54, h: 98, el: (f) => <Step f={f} at={54} done={64} name={<><b>kula</b> · start_task</>} detail={<>“{TASK.task.title}” · workflow <span style={{ color: C.accent }}>{TASK.task.workflow}</span><br />scope {TASK.task.scope.slice(0, 3).join(", ")} …</>} /> },
  { at: 118, h: 150, el: (f) => <Step f={f} at={118} done={132} name={<><b>kula</b> · recall “release”</>} detail={<><span style={{ color: C.accent }}>{RECALL.author}</span> · {RECALL.stale ? "stale" : "fresh"}<br /><span style={{ color: C.cream }}>“{RECALL.body}”</span></>} /> },
  { at: 282, h: 128, el: (f) => <Step f={f} at={282} done={298} bad name={<>Edit <b>src/store.rs</b> · <span style={{ color: f >= 298 ? C.red : C.dim }}>{f >= 298 ? "blocked by kula hook" : "running hook"}</span></>} detail={<span style={{ color: C.cream }}>{REASON}.</span>} /> },
  { at: 426, h: 76, el: (f) => <Step f={f} at={426} done={434} name={<>Edit <b>Cargo.toml</b> · hook <span style={{ color: C.green }}>{PASS.code === 0 ? "allowed" : "blocked"}</span></>} detail={<><span style={{ color: C.green }}>+1</span> <span style={{ color: C.red }}>−1</span> · version {EDIT.from} → {EDIT.to}</>} /> },
  { at: 462, h: 76, el: (f) => <Step f={f} at={462} done={472} name={<><b>kula</b> · verify_edit</>} detail={<span style={{ color: CU_VERIFY.ok ? C.green : C.red }}>{verdict(CU_VERIFY)}</span>} /> },
  { at: 490, h: 70, el: (f) => <div style={{ fontSize: 17, lineHeight: 1.5, whiteSpace: "normal" }}>{typed(`Bumped to ${EDIT.to}. src/store.rs is untouched – it's locked in release mode.`, f, 490, 44)}</div> },
];

function Code({ lines, from, f, diff }: { lines: string[]; from: number; f: number; diff?: number }) {
  const rows: React.ReactNode[] = [];
  lines.forEach((l, i) => {
    const n = from + i;
    const isVersion = diff !== undefined && /^version = /.test(l);
    if (isVersion && f >= diff) {
      rows.push(<CodeRow key={`${i}-`} n={n} l={l} bg="rgba(240,130,122,.12)" mark="−" color={C.red} />);
      rows.push(<CodeRow key={`${i}+`} n={n} l={l.replace(EDIT.from ?? "", EDIT.to ?? "")} bg="rgba(143,214,148,.12)" mark="+" color={C.green} />);
    } else rows.push(<CodeRow key={i} n={n} l={l} />);
  });
  return <div style={{ paddingTop: 12 }}>{rows}</div>;
}

function CodeRow({ n, l, bg, mark, color }: { n: number; l: string; bg?: string; mark?: string; color?: string }) {
  const hl = (s: string) => {
    if (/^\s*(\/\/|#)/.test(s)) return <span style={{ color: C.dim }}>{s}</span>;
    const parts = s.split(/(".*?"|\b(?:pub|fn|let|for|in|return|else|self|Ok)\b)/g);
    return parts.map((p, i) => <span key={i} style={{ color: p.startsWith('"') ? C.green : /^(pub|fn|let|for|in|return|else|self|Ok)$/.test(p) ? C.accent : C.cream }}>{p}</span>);
  };
  return (
    <div style={{ display: "flex", height: 28, lineHeight: "28px", fontSize: 17, background: bg, whiteSpace: "pre" }}>
      <span style={{ width: 56, flexShrink: 0, textAlign: "right", paddingRight: 14, color: "#4a423b" }}>{n}</span>
      <span style={{ width: 18, flexShrink: 0, color }}>{mark}</span>
      <span style={{ color: color ?? undefined }}>{color ? l : hl(l)}</span>
    </div>
  );
}

const TREE = [".cursor/", "  hooks.json", "  mcp.json", "packaging/", "src/", "  graph.rs", "  guard.rs", "  store.rs", "  workflow.rs", "web/", "AGENTS.md", "Cargo.toml", "CHANGELOG.md", "kula.toml", "README.md"];

export function CursorApp({ frames }: { frames: number }) {
  const f = useF();
  const file = f >= 268 && f < 418 ? "src/store.rs" : "Cargo.toml";
  const locked = file === "src/store.rs" && f >= 298;
  const store = FILES["src/store.rs"];
  // the chat panel: items stack from the top
  let y = 0;
  const placed = CU_ITEMS.map((it) => { const at = y; y += it.h + 12; return { ...it, y: at }; });
  const chatTop = 60 + 41 + 58;
  const itemY = (k: number) => chatTop + placed[k].y + placed[k].h / 2;
  const edY = 60 + 41 + 40;
  const keys: Key[] = [
    { f: -14, x: W / 2, y: H / 2, z: 1 }, { f: 70, x: W / 2, y: H / 2, z: 1.03 },
    { f: 128, x: 60 + CHAT_X + 300, y: itemY(3), z: 1.5 }, { f: 252, x: 60 + CHAT_X + 300, y: itemY(3), z: 1.52 },
    { f: 300, x: 60 + ED_X + 560, y: edY + 260, z: 1.22 }, { f: 400, x: 60 + ED_X + 620, y: edY + 270, z: 1.26 },
    { f: 440, x: 60 + ED_X + 320, y: edY + 110, z: 1.55 }, { f: 520, x: 60 + ED_X + 340, y: edY + 110, z: 1.55 },
    { f: 560, x: W / 2 + 200, y: H / 2, z: 1.12 },
  ];
  return (
    <Stage>
      <Cam keys={keys}>
        <Float frames={frames} from={{ rx: 10, ry: -14, s: 0.9 }}>
          <Win x={60} y={60} w={1800} h={960} title="kula – Cursor" bg="#0b0a09">
            {/* activity bar */}
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 52, borderRight: `1px solid ${C.line}`, display: "grid", alignContent: "start", justifyItems: "center", gap: 22, paddingTop: 18 }}>
              {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 20, height: 20, border: `1.5px solid ${i === 0 ? C.cream : "#3a332d"}`, borderRadius: 4 }} />)}
            </div>
            {/* explorer */}
            <div style={{ position: "absolute", left: 52, top: 0, bottom: 0, width: 290, borderRight: `1px solid ${C.line}`, padding: "14px 0", fontSize: 16 }}>
              <div style={{ padding: "0 18px 10px", fontSize: 13, letterSpacing: ".16em", color: C.dim }}>EXPLORER · KULA</div>
              {TREE.map((t) => {
                const name = t.trim(), open = (file === "src/store.rs" && name === "store.rs") || (file === "Cargo.toml" && name === "Cargo.toml");
                const lockedFile = locked && name === "store.rs";
                return (
                  <div key={t} style={{ padding: "4px 18px", whiteSpace: "pre", color: open ? C.cream : t.endsWith("/") ? C.dim : "#b3aa9f", background: open ? "#1a1614" : undefined, display: "flex", justifyContent: "space-between" }}>
                    <span>{t}</span>{lockedFile && <span style={{ color: C.red, fontSize: 12, letterSpacing: ".1em" }}>LOCKED</span>}
                  </div>
                );
              })}
            </div>
            {/* editor */}
            <div style={{ position: "absolute", left: ED_X, top: 0, bottom: 0, width: ED_W, borderRight: `1px solid ${C.line}`, overflow: "hidden" }}>
              <div style={{ height: 40, borderBottom: `1px solid ${C.line}`, display: "flex", fontSize: 15 }}>
                {["Cargo.toml", ...(f >= 268 ? ["src/store.rs"] : [])].map((t) => (
                  <div key={t} style={{ padding: "0 18px", display: "flex", alignItems: "center", borderRight: `1px solid ${C.line}`, color: t === file ? C.cream : C.dim, background: t === file ? "#141210" : undefined, borderTop: t === file ? `1px solid ${C.accent}` : undefined }}>{t}</div>
                ))}
              </div>
              <div style={{ position: "relative", opacity: locked ? 0.55 : 1 }}>
                {file === "Cargo.toml"
                  ? <Code lines={FILES["Cargo.toml"]} from={1} f={f} diff={436} />
                  : <Code lines={store.lines} from={store.from} f={f} />}
              </div>
              {locked && (
                <div style={{ position: "absolute", left: 0, right: 0, top: 40, borderTop: `2px solid ${C.red}`, borderBottom: `1px solid ${C.red}`, background: "#140b0a", padding: "10px 20px", fontSize: 16, color: C.red, opacity: easeOut((f - 298) / 8) }}>
                  ✕ kula guard · locked for agents · release workflow – edit turned back
                </div>
              )}
            </div>
            {/* agent panel */}
            <div style={{ position: "absolute", left: CHAT_X, top: 0, bottom: 0, width: 600, padding: "0 18px" }}>
              <div style={{ height: 46, display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${C.line}`, marginBottom: 12 }}>
                <span style={{ fontSize: 13, letterSpacing: ".16em", color: C.dim }}>AGENT</span>
                {f >= 64 && <span style={{ fontSize: 13, letterSpacing: ".1em", color: C.accent, border: `1px solid ${C.accent}`, padding: "1px 8px", borderRadius: 4 }}>RELEASE</span>}
                <span style={{ marginLeft: "auto", fontSize: 13, color: C.dim }}>kula mcp ✓ · hooks ✓</span>
              </div>
              {placed.filter((it) => f >= it.at).map((it, k) => (
                <div key={k} style={{ position: "absolute", left: 18, right: 18, top: 58 + it.y, opacity: easeOut((f - it.at) / 6), transform: `translateY(${(1 - easeOut((f - it.at) / 8)) * 10}px)` }}>{it.el(f)}</div>
              ))}
            </div>
          </Win>
        </Float>
      </Cam>
    </Stage>
  );
}

// ------------------------------------------------------------------ connected: two agents, one map

export function Connected({ frames }: { frames: number }) {
  const f = useF();
  const pose: Pose = { flat: 0, spin: -0.4 + f * 0.004, unit: 40, cx: W / 2, cy: 560 };
  const win = (side: -1 | 1) => {
    const t = easeOut((f + 6 - (side < 0 ? 0 : 10)) / 22);
    return { x: side < 0 ? 120 - 260 * (1 - t) : W - 120 - 500 + 260 * (1 - t), o: t };
  };
  const L = win(-1), R = win(1);
  const wire = (x0: number, label: string, sub: string, side: -1 | 1, from: number) => {
    const t = easeInOut((f - from) / 26);
    const x1 = W / 2 + side * 170, y = 560;
    const xe = x0 + (x1 - x0) * t;
    const dash = -((f * 3) % 40);
    return (
      <g key={label}>
        <line x1={x0} y1={y} x2={xe} y2={y} stroke={C.accent} strokeWidth={2} strokeDasharray="10 10" strokeDashoffset={dash} />
        {t > 0.98 && <rect x={x1 - 6} y={y - 6} width={12} height={12} fill={C.accent} />}
        <text x={(x0 + x1) / 2} y={y - 22} textAnchor="middle" fill={C.cream} fontSize={18} fontFamily={FONT} opacity={t}>{label}</text>
        <text x={(x0 + x1) / 2} y={y + 36} textAnchor="middle" fill={C.dim} fontSize={15} fontFamily={FONT} opacity={t}>{sub}</text>
      </g>
    );
  };
  const glowLine = (k: number) => clamp((f - 40 - k * 20) / 10);
  return (
    <Stage k={0.36}>
      <World pose={pose} grid={0.6} calls={1} look={() => ({ grow: 1, top: C.signal, edge: C.signal, fill: "#1a0c05" })} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {wire(L.x + 500, "MCP · 21 tools", ".mcp.json · PreToolUse hook", -1, 22)}
        {wire(R.x, "MCP · 21 tools", ".cursor/mcp.json · hooks.json", 1, 32)}
      </svg>
      <div style={{ position: "absolute", left: L.x, top: 400, opacity: L.o }}>
        <MiniWin title="Claude Code" lines={["● kula - workflows (MCP)", "● kula - suggest (MCP)", "● kula - remember (MCP)"]} lit={glowLine(0)} />
      </div>
      <div style={{ position: "absolute", left: R.x, top: 400, opacity: R.o }}>
        <MiniWin title="Cursor" lines={["✓ kula · recall", "✕ Edit src/store.rs", "✓ kula · verify_edit"]} lit={glowLine(1)} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: FONT }}>
        <div style={{ fontSize: 18, letterSpacing: ".18em", color: C.accent, fontWeight: 600 }}>KULA INIT · 2 AGENTS CONNECTED</div>
        <div style={{ height: 14 }} />
        <div style={{ fontSize: 46, fontWeight: 700, color: C.cream }}>{typed("One map. One set of rules.", f, 30, 30)}</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, textAlign: "center", fontFamily: FONT, fontSize: 17, color: C.dim, opacity: clamp((f - 70) / 12) }}>
        and AGENTS.md for Codex, Gemini, Copilot and the rest
      </div>
    </Stage>
  );
}

function MiniWin({ title, lines, lit }: { title: string; lines: string[]; lit: number }) {
  return (
    <div style={{ width: 500, background: "#0a0908", border: `1px solid ${C.line2}`, borderRadius: 10, fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ height: 36, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 14px", gap: 7 }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 5, background: "#2c2622" }} />)}
        <span style={{ marginLeft: 12, fontSize: 16, color: C.cream, fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ padding: "16px 20px", fontSize: 18, lineHeight: "32px" }}>
        {lines.map((l, i) => <div key={i} style={{ color: l.startsWith("✕") ? C.red : i < Math.round(lit * lines.length) ? C.cream : C.dim }}>{l}</div>)}
      </div>
    </div>
  );
}

export const SCENE_BARS = { install: 2, claude: 5, cursor: 7, verify: 1, connected: 2 } as const;
export { BAR };
