#!/usr/bin/env python3
"""Generates site/wireframe.html for the kula merged Map + Agents workspace deck."""
import sys, os
W = os.path.dirname(os.path.abspath(__file__)) + "/site"
style = open(W + "/style.part").read()
tail = open(W + "/tail.part").read()
TOTAL = 10

EXTRA = """
<style>
  .screen { grid-template-columns: 700px 1fr; gap: 26px; }
  .notes li { font-size: 10.5px; margin-bottom: 9px; line-height: 1.45; }
  .ncontext { font-size: 10px; margin-bottom: 10px; padding-bottom: 8px; }
  .priorart { margin-top: 8px; padding-top: 7px; }
  .app { position: relative; width: 700px; height: 540px; }
  .app > wired-card.frame { position: absolute; inset: 0; width: 700px; height: 540px; display: block; }
  .appin { position: absolute; inset: 8px; display: flex; flex-direction: column; z-index: 1; }
  .tb { display: flex; align-items: center; gap: 8px; height: 30px; border-bottom: 1.4px solid var(--ink); padding: 0 6px; font-size: 9px; }
  .tb .logo { font-weight: 700; letter-spacing: 2px; }
  .tb .crumb { color: var(--ink2); }
  .tb .sp { flex: 1; }
  .seg.sm { font-size: 8.5px; border-radius: 6px; }
  .seg.sm span { padding: 3px 9px; }
  .btn { font-size: 8.5px; border: 1.4px solid var(--ink); border-radius: 5px; padding: 3px 8px; white-space: nowrap; }
  .btn.pri { background: var(--ink); color: #fff; }
  .btn.prop { border: 1.4px dashed var(--propose); color: var(--propose); background: var(--wash); }
  .body3 { flex: 1; display: flex; min-height: 0; }
  .rail { width: 30px; border-right: 1.2px solid #ccc; display: flex; flex-direction: column; align-items: center; gap: 9px; padding-top: 9px; color: var(--muted); }
  .rail .ic.on { color: var(--ink); }
  .canvas { flex: 1; position: relative; overflow: hidden;
    background-image: radial-gradient(#d0d0d0 0.8px, transparent 0.9px); background-size: 12px 12px; }
  .insp { width: 190px; border-left: 1.4px solid var(--ink); padding: 8px; display: flex; flex-direction: column; gap: 6px; font-size: 8.5px; overflow: hidden; }
  .insp h5 { margin: 0; font-size: 7.5px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--ink2); }
  .insp .t { font-size: 11px; font-weight: 700; }
  .kv { display: flex; justify-content: space-between; border-top: 1px solid #eee; padding: 2px 0; }
  .kv span:last-child { font-weight: 700; }
  .nd { position: absolute; border: 1.5px solid var(--ink); border-left-width: 4px; border-radius: 5px; background: #fff; font-size: 8px; padding: 4px 6px; line-height: 1.25; }
  .nd b { display: block; font-size: 8.5px; }
  .nd i { font-style: normal; color: var(--ink2); font-size: 7px; }
  .nd.entry { border-left-color: #000; background: #f2f2f2; }
  .nd.util { border-left-style: double; }
  .nd.sel { box-shadow: 0 0 0 2px var(--note); }
  .nd.dim { opacity: .35; }
  .nd.hot { background: repeating-linear-gradient(135deg,#fff,#fff 4px,#f1e2da 4px,#f1e2da 8px); }
  .colh { position: absolute; top: 6px; font-size: 7px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ink2); }
  .fence { position: absolute; border: 1.8px dashed var(--propose); border-radius: 9px; background: rgba(53,101,159,.06); }
  .fence .fl { position: absolute; top: -9px; left: 8px; background: #fff; color: var(--propose); font-size: 7px; letter-spacing: 1px; padding: 0 3px; }
  .ag { position: absolute; width: 22px; height: 22px; border-radius: 50%; border: 1.6px solid var(--propose); background: var(--wash); color: var(--propose); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .ag.run::after { content: ''; position: absolute; inset: -5px; border: 1.2px dashed var(--propose); border-radius: 50%; }
  .ag.err { border-color: var(--note); color: var(--note); background: #fbeee8; }
  .ag.ok { border-style: double; border-width: 3px; }
  .pill { position: absolute; font-size: 7px; border: 1.2px solid var(--propose); color: var(--propose); background: #fff; border-radius: 8px; padding: 1px 5px; white-space: nowrap; }
  .pal { position: absolute; background: #fff; border: 1.6px solid var(--ink); border-radius: 7px; padding: 8px; font-size: 8.5px; z-index: 3; }
  .pal.prop { border: 1.6px dashed var(--propose); background: #fbfdff; }
  .pal h6 { margin: 0 0 4px; font-size: 7px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ink2); }
  .tpl { border: 1.2px solid var(--ink); border-radius: 5px; padding: 4px 6px; margin-bottom: 4px; }
  .tpl b { display: block; font-size: 8.5px; }
  .tpl i { font-style: normal; font-size: 7px; color: var(--ink2); }
  .tpl.on { background: #f0f0f0; border-width: 2px; }
  .ghost { position: absolute; border: 1.6px dashed var(--ink); border-radius: 5px; background: rgba(255,255,255,.85); font-size: 8px; padding: 4px 6px; transform: rotate(-3deg); z-index: 4; }
  .feed div { border-top: 1px solid #eee; padding: 2px 0; font-size: 7.5px; }
  .feed .tm { color: var(--ink2); margin-right: 4px; }
  .meter { height: 7px; border: 1.2px solid var(--ink); border-radius: 4px; position: relative; overflow: hidden; }
  .meter i { position: absolute; left: 0; top: 0; bottom: 0; background: #bbb; }
  .strip { height: 46px; border-top: 1.4px solid var(--ink); display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 8px; }
  .lane { flex: 1; height: 10px; position: relative; border-bottom: 1px solid #ddd; }
  .lane span { position: absolute; top: 1px; height: 8px; border-radius: 3px; background: #ccc; }
  svg.edges { position: absolute; inset: 0; pointer-events: none; }
  .abcap { font-size: 8.5px; }
  .motion { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .motion wired-card .kt { font-size: 10.5px; font-weight: 700; margin-bottom: 3px; }
  .motion .rowline { font-size: 8.5px; }
</style>
"""

def page(n, title, inner, fill=False):
    return f"""
<section class="page{' fill' if fill else ''}">
  <div class="phead"><span>kula · one workspace for code and agents</span><span class="mid">{title}</span><span>p.{n} / {TOTAL}</span></div>
  <div class="pbody">{inner}</div>
</section>"""

def app(top, canvas, insp, bottom="", rail_on=1):
    rail = "".join(f'<span class="ic{" on" if i == rail_on else ""}"></span>' for i in range(5))
    return f"""<div class="app"><wired-card class="frame" elevation="2"></wired-card><div class="appin">
  <div class="tb">{top}</div>
  <div class="body3"><div class="rail">{rail}</div><div class="canvas">{canvas}</div><div class="insp">{insp}</div></div>
  {bottom}
</div></div>"""

def screen(n, title, cap, top, canvas, insp, notes_ctx, notes, prior, bottom=""):
    lis = "".join(f'<li{" class=warn" if w else ""}><span class="lead">{h}</span> <span class="tagword {tc}">{tw}</span> {b}</li>'
                  for (w, h, tc, tw, b) in notes)
    inner = f"""<div class="screen">
  <div class="abcol">{app(top, canvas, insp, bottom)}<div class="abcap">{cap}</div></div>
  <div class="notes"><h3>Notes &amp; decisions</h3><p class="ncontext">{notes_ctx}</p><ol>{lis}</ol>
  <div class="priorart"><b>Prior art</b><br/>{prior}</div></div></div>"""
    return page(n, title, inner)

P, O, N = ("t-prop", "PROPOSED"), ("t-open", "OPEN Q"), ("t-now", "NOW")
def note(warn, head, tag, body): return (warn, head, tag[0], tag[1], body)

def topbar(mode, extra=""):
    modes = ["Explore", "Build", "Run", "Review"]
    seg = "".join(f'<span class="{"on" if m == mode else ""}">{m}</span>' for m in modes)
    return f'<span class="logo">KULA</span><span class="crumb">/ hs / workspace</span><span class="seg sm">{seg}</span><span class="sp"></span>{extra}<span class="btn">⌕ Search ⌘K</span><span class="btn">Layers ▾</span><span class="btn pri">+ Agent</span>'

# The shared map canvas: pipeline columns, collapsed sections.
COLS = [("entry", 8, [("benchmarks", "gen layered DAG", "entry")]),
        ("step 1", 100, [("Load & share", "_shared · by_reason", ""), ("Score variants", "germline_variation", ""), ("Model hearts", "cardiac_electrophys", ""), ("Single-cell", "single_cell_spatial", "")]),
        ("step 2", 192, [("Decode pedigrees", "pedigree · decode", ""), ("Validate signals", "qc · validate_signal", "")]),
        ("step 3", 284, [("Convert formats", "converters · evaluate", ""), ("Agent memory", "agent-memory · getdb", ""), ("Parse sys", "pkg-sys · sys", "")]),
        ("shared", 376, [("Shared records", "_shared · record", "util"), ("Examples", "examples · main", "util")])]

def map_nodes(sel=None, dim=(), hot=(), w=80):
    out = []
    pos = {}
    for label, x, items in COLS:
        out.append(f'<div class="colh" style="left:{x}px">{label}</div>')
        for i, (t, sub, kind) in enumerate(items):
            y = 26 + i * 58
            cls = "nd" + (" entry" if kind == "entry" else "") + (" util" if kind == "util" else "") + (" sel" if t == sel else "") + (" dim" if t in dim else "") + (" hot" if t in hot else "")
            out.append(f'<div class="{cls}" style="left:{x}px;top:{y}px;width:{w}px"><b>{t}</b><i>{sub}</i></div>')
            pos[t] = (x, y)
    return "".join(out), pos

def edges(pairs, pos, w=80, dash=False, cls=""):
    segs = []
    for a, b in pairs:
        (x1, y1), (x2, y2) = pos[a], pos[b]
        segs.append(f"{x1 + w},{y1 + 14},{x2},{y2 + 14}")
    return f'<svg class="edges {cls}" width="470" height="470" data-e="{";".join(segs)}" data-dash="{1 if dash else 0}"></svg>'


def fence(pos, name, label=""):
    x, y = pos[name]
    return f'<div class="fence" style="left:{x-5}px;top:{y-5}px;width:92px;height:40px">' + (f'<span class="fl">{label}</span>' if label else '') + '</div>'
def agent(pos, name, letter, cls="run"):
    x, y = pos[name]
    return f'<div class="ag {cls}" style="left:{x+68}px;top:{y-12}px">{letter}</div>'
def cx(pos, name, n, dx=74, dy=18):
    x, y = pos[name]
    return f'<span class="cx" style="position:absolute;left:{x+dx}px;top:{y+dy}px">{n}</span>'

FLOWS = [("benchmarks", "Load & share"), ("benchmarks", "Score variants"), ("Load & share", "Decode pedigrees"), ("Score variants", "Validate signals"),
         ("Model hearts", "Validate signals"), ("Decode pedigrees", "Convert formats"), ("Validate signals", "Convert formats"), ("Convert formats", "Shared records"), ("Agent memory", "Examples")]

pages = []

# ---------------- p1 cover ----------------
pages.append(page(1, "UI Overhaul – Low-Fidelity Wireframes", """
<div class="cover"><div class="l">
  <h1 class="doc">One workspace</h1>
  <div class="tag">The map is the territory, agents are actors on it. Deploy, orchestrate and review AI agents directly on the map of your code.</div>
  <div class="tag" style="font-size:11px;margin-top:14px;max-width:46ch;color:var(--ink2)">Replaces the separate Map and Agents tabs. Sketch-solid is the current build; <span class="tagword t-prop">PROPOSED</span> is new; <span class="tagword t-open">OPEN&nbsp;Q</span> is undecided.</div>
  <div class="toc" style="grid-template-columns:repeat(4,62px)">
    <div class="t"><div class="tm"></div><div class="tl">p.2 Explore</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.3 Inspect</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.4 + Agent</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.5 Drop</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.6 Crew</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.7 Run</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.8 Pipeline</div></div>
    <div class="t"><div class="tm"></div><div class="tl">p.9 Review</div></div>
  </div>
  <div class="box"><h4>Built today</h4><p>Pipeline-column map on the flow canvas (sections collapsed, open on click, role colours, drag). Separate Agents tab with 10 sub-tabs of config. Orchestrator (waves, critics, gates, hand-offs, spend caps) runs from the CLI only. <b>Not yet:</b> agents on the map, deploy from the map, a live run view, review on the map.</p></div>
</div><div class="l">
  <wired-card elevation="2" style="padding:20px">
    <div style="font-size:10px;letter-spacing:2.2px;text-transform:uppercase;color:var(--ink2);margin-bottom:16px">What every screen has to earn</div>
    <ol class="pillars">
      <li><span class="pn">1</span><b>Start from a question</b>"What does this repo do?" and "What are my agents doing?" are answered on arrival, before any click.</li>
      <li><span class="pn">2</span><b>Complexity one click away</b>One primary action per mode. Detail opens on selection; menus hold the rest. Nothing is removed, everything is folded.</li>
      <li><span class="pn">3</span><b>Two graphs, never confused</b>The code graph (calls) is the ground. Agents are pinned widgets, hand-offs a separate layer, and the work pipeline its own mode.</li>
      <li><span class="pn">4</span><b>Trust is visible</b>Fences are regions on the map, spend is a meter, every change is reviewable where it happened.</li>
    </ol>
  </wired-card>
</div></div>
<div class="legend" style="position:absolute;left:13mm;right:13mm;bottom:8mm">
  <span class="li"><span class="sw box"></span> current build</span><span class="li"><span class="sw dash"></span> proposed</span>
  <span class="li"><span class="sw grk"></span> greeked copy</span><span class="li"><span class="sw note">1</span> callout</span>
  <span class="li">tags: <span class="tagword t-now">NOW</span> <span class="tagword t-prop">PROPOSED</span> <span class="tagword t-open">OPEN Q</span></span>
</div>""", fill=True))

# ---------------- p2 explore ----------------
nodes, pos = map_nodes()
insp = """<h5>Repo</h5><div class="t">hs <span class="cx">4</span></div>
<div style="font-size:8.5px">Runs benchmark DAGs, decodes pedigrees and validates signals across 6 domains.</div>
<div class="kv"><span>sections</span><span>18</span></div><div class="kv"><span>changed this week</span><span>4</span></div><div class="kv"><span>agents running</span><span>0</span></div>
<h5 style="margin-top:6px">Start here</h5><div class="btn">Trace an entry point →</div><div class="btn">What changed →</div><div class="btn prop">Deploy a review crew →</div>
<h5 style="margin-top:6px">Browse <span class="cx">5</span></h5><div style="color:var(--ink2)">▸ 255 blocks · 4 205 functions (collapsed)</div>"""
canvas = nodes + edges(FLOWS, pos) + cx(pos, "Single-cell", 2) + cx(pos, "Examples", 3)
pages.append(screen(2, "01 – Explore (arrival)", "desktop 1440 · Explore mode · <code>Workspace.tsx</code> (replaces MapView + Agents)",
  topbar("Explore") + '<span class="cx">1</span>', canvas, insp,
  "<b>Built:</b> pipeline columns, collapsed sections, role tint. <b>Proposes:</b> one workspace, four modes, capability names, repo answer in the inspector.",
  [note(True, "Four modes, one canvas.", P, "Explore · Build · Run · Review replace the Map tab, the Agents tab and its 10 sub-tabs. Mode changes the inspector and the overlays, never the ground."),
   note(False, "Capability names.", P, "Each section is titled with a verb phrase (\"Decode pedigrees\") generated from its summary; the cluster name is the subtitle."),
   note(False, "Shared column.", N, "Utilities, models and config sit in the last column, tinted, so the main flow reads left to right."),
   note(False, "The inspector answers first.", P, "Nothing selected = the repo in one sentence, three numbers and three starting actions. No empty middle."),
   note(False, "Browse is folded.", P, "The 4 205-function tree lives behind Browse and ⌘K, not open by default."),
   note(False, "Layers ▾.", P, "Code · Changes · Fences · Agents · Hand-offs as toggles (p.10), so the ground never gets crowded.")],
  "n8n opens on a clean canvas with one '+' and a side panel; we open on a populated map, so the inspector must explain it instead of asking for input."))

# ---------------- p3 inspect section ----------------
nodes, pos = map_nodes(sel="Decode pedigrees", dim=("Model hearts", "Single-cell", "Parse sys", "Agent memory", "Examples"))
insp = """<h5>Section</h5><div class="t">Decode pedigrees</div><div style="color:var(--ink2)">pedigree · decode – 9 blocks</div>
<div class="greek"><i style="width:95%"></i><i style="width:70%"></i></div>
<h5>Flow <span class="cx">2</span></h5><div class="kv"><span>in ← Load &amp; share</span><span>42 calls</span></div><div class="kv"><span>out → Convert formats</span><span>17</span></div>
<h5>Risk <span class="cx">3</span></h5><div class="kv"><span>riskiest fn</span><span>parse_ped</span></div><div class="kv"><span>churn 30d</span><span>12 commits</span></div>
<h5>Agents <span class="cx">4</span></h5><div class="kv"><span>fenced to</span><span>fixer, tests</span></div><div class="kv"><span>last run</span><span>2d ago ✓</span></div>
<div class="btn pri" style="text-align:center;margin-top:4px">Deploy agent here <span class="cx">5</span></div><div class="btn" style="text-align:center">Open 9 blocks</div>"""
canvas = nodes + edges(FLOWS, pos) + cx(pos, "Decode pedigrees", 1)
pages.append(screen(3, "02 – Inspect a section", "Explore · section selected · neighbours lit, rest dimmed",
  topbar("Explore"), canvas, insp,
  "<b>Built:</b> selection fills a key/value table. <b>Proposes:</b> the inspector explains the section and offers to act on it.",
  [note(False, "Hover and select light the neighbourhood.", P, "Incoming and outgoing sections stay lit, the rest dims to 35 %. Edge labels show call counts on hover."),
   note(False, "Flow in and out.", P, "What feeds this section and what it feeds, with counts, replaces the meaningless chain weight."),
   note(False, "Risk.", P, "Riskiest function = churn × degree, from git. kula owns the git layer; no other map can say this."),
   note(False, "Agents on this ground.", P, "Which agents are fenced here and what they last did. The bridge between the two old tabs."),
   note(True, "Deploy agent here.", P, "The primary action of a selected section. Opens the drop flow (p.5) with scope pre-filled."),
   note(False, "Double-click opens blocks.", N, "Section → frame of blocks → functions → code panel. Semantic zoom replaces depth toggles.")],
  "n8n's focus panel shows a node's parameters on selection; ours shows meaning (flow, risk, agents) because map nodes are code, not steps."))

# ---------------- p4 agent palette megamenu ----------------
nodes, pos = map_nodes()
pal = """<div class="pal prop" style="left:96px;top:150px;width:330px"><div style="display:flex;gap:10px">
<div style="width:92px"><h6>Kinds <span class="cx">1</span></h6><div class="tpl on"><b>Single agent</b></div><div class="tpl"><b>Crew</b><i>several, with a pipeline</i></div><div class="tpl"><b>Loop</b><i>measure &amp; keep</i></div><div class="tpl"><b>Saved</b><i>your templates</i></div></div>
<div style="flex:1"><h6>Single agent templates <span class="cx">2</span></h6>
<div class="tpl"><b>Explorer</b><i>reads, explains, writes memory · no edits · $0.10</i></div>
<div class="tpl on"><b>Fixer</b><i>edits inside its fence · tests must pass · $0.50</i></div>
<div class="tpl"><b>Test writer</b><i>adds tests only · $0.40</i></div>
<div class="tpl"><b>Critic</b><i>reviews a diff, ranks findings · $0.20</i></div>
<div style="font-size:7.5px;color:var(--ink2);margin-top:3px">Click = deploy on selected section · drag = drop anywhere <span class="cx">3</span></div></div></div></div>"""
ghost = '<div class="ghost" style="left:250px;top:84px;width:104px"><b>Fixer</b> ↘ drop on a section</div>'
canvas = nodes + edges(FLOWS, pos) + pal + ghost + fence(pos, "Decode pedigrees", "DROP TARGET") + cx(pos, "Decode pedigrees", 4)
insp = """<h5>Drop target</h5><div class="t">Decode pedigrees</div><div style="color:var(--ink2)">Fence will be this section: 9 blocks, 23 files <span class="cx">5</span></div>
<div class="greek"><i style="width:90%"></i><i style="width:60%"></i></div>"""
pages.append(screen(4, "03 – + Agent: the template megamenu", "Build · '+ Agent' open · dragging 'Fixer' over a section",
  topbar("Build"), canvas, insp,
  "<b>Built:</b> nothing – agents are configured in forms on another tab. <b>Proposes:</b> a two-pane megamenu of agent templates, click or drag onto the map.",
  [note(False, "Kinds on the left, templates on the right.", P, "One container that morphs between kinds (Stripe-style), not four separate dropdowns. Opens on click or Tab, 200 ms ease-out."),
   note(True, "Templates carry their contract.", P, "Each card states what it may do, what must pass and its cost cap, so a user knows what they are deploying before they drop it."),
   note(False, "Click is the safe path.", P, "Click deploys on the selected section (auto-scoped); drag is for placing elsewhere. Mirrors n8n's click-to-auto-connect default."),
   note(False, "Drop targets glow as you drag.", P, "Sections under the cursor show a dashed fence preview; invalid targets (generated code, vendored) refuse with a reason."),
   note(False, "The inspector previews the fence.", P, "Files and blocks the agent will be allowed to touch, before it exists.")],
  "n8n's nodes panel lacks connector-type cues, so users drag by trial and error. Ours shows each template's contract and fence before the drop."))

# ---------------- p5 drop & configure ----------------
nodes, pos = map_nodes(sel="Decode pedigrees")
canvas = nodes + edges(FLOWS, pos) + fence(pos, "Decode pedigrees", "FENCE · FIXER") + agent(pos, "Decode pedigrees", "F", "") + cx(pos, "Decode pedigrees", 1, dx=-14, dy=-14)
insp = """<h5>New agent</h5><div class="t">Fixer on Decode pedigrees</div>
<h5>Task <span class="cx">2</span></h5><div style="border:1.2px solid var(--ink);border-radius:4px;padding:4px;height:34px;color:var(--ink2)">Make parse_ped handle missing parents…</div>
<div class="kv"><span>workflow</span><span>fix ▾</span></div><div class="kv"><span>model</span><span>glm-5.3-flash ▾</span></div>
<div class="kv"><span>cap</span><span>$0.50</span></div><div class="kv"><span>gate</span><span>tests + critic</span></div>
<h5>Fence <span class="cx">3</span></h5><div class="kv"><span>may edit</span><span>23 files</span></div><div class="kv"><span>may read</span><span>whole repo</span></div><div style="color:var(--propose)">+ widen to neighbours</div>
<div class="btn pri" style="text-align:center;margin-top:4px">Start · $0.50 cap <span class="cx">4</span></div><div style="color:var(--ink2);text-align:center">Advanced ▸ <span class="cx">5</span></div>"""
pages.append(screen(5, "04 – Drop and configure", "Build · agent dropped · inspector is the config form",
  topbar("Build"), canvas, insp,
  "<b>Built:</b> task start lives in Workflows as a long form. <b>Proposes:</b> the dropped widget is the agent; the inspector holds four fields and a Start.",
  [note(False, "The widget sits on its ground.", P, "A small circle pinned to the section's corner, not a node in the call flow. Its fence is drawn around the section."),
   note(True, "Four fields, then Start.", P, "Task, workflow, model, cap. Defaults come from the template; the gate (tests + critic) is shown, not hidden."),
   note(False, "The fence is visible and adjustable.", P, "Edit scope = the section; read scope = the repo. Widen to neighbours with one click; the map redraws the region."),
   note(False, "Spend is part of the button.", P, "The cap is on the primary action, so starting is an explicit spending decision."),
   note(False, "Advanced folds the rest.", N, "Prompt, skills, memory policy, hooks – the existing Workflows form, one click away, not the default.")],
  "CrewAI defines agents in code; Langflow wires components port to port. Neither knows where in a codebase an agent works – here, location is the config."))

# ---------------- p6 crew ----------------
nodes, pos = map_nodes(sel=None)
sel_secs = ["Decode pedigrees", "Validate signals", "Convert formats"]
fences = "".join(fence(pos, n) for n in sel_secs)
pipe = """<div class="pal prop" style="left:8px;top:270px;width:440px"><h6>Crew pipeline preview <span class="cx">2</span></h6><div style="display:flex;gap:6px;align-items:center;font-size:7.5px">
<div class="tpl" style="margin:0"><b>Plan</b><i>manager</i></div>→<div class="tpl" style="margin:0"><b>Wave 1</b><i>Decode · Validate</i></div>→<div class="tpl" style="margin:0"><b>Wave 2</b><i>Convert</i></div>→<div class="tpl" style="margin:0"><b>Critic</b></div>→<div class="tpl" style="margin:0"><b>Gate</b><i>tests</i></div>→<div class="tpl" style="margin:0"><b>Merge</b></div></div>
<div style="font-size:7.5px;color:var(--ink2);margin-top:4px">Waves inferred from the flow: Convert depends on both, so it runs second <span class="cx">3</span></div></div>"""
canvas = nodes + edges(FLOWS, pos) + fences + pipe + cx(pos, "Validate signals", 1)
insp = """<h5>3 sections selected</h5><div class="t">Deploy a crew</div>
<h5>Goal</h5><div style="border:1.2px solid var(--ink);border-radius:4px;padding:4px;height:30px;color:var(--ink2)">Support VCF 4.4 end to end…</div>
<div class="kv"><span>template</span><span>Build crew ▾</span></div><div class="kv"><span>modules</span><span>3 (one per section)</span></div>
<div class="kv"><span>critic</span><span>on</span></div><div class="kv"><span>cap</span><span>$3.00 <span class="cx">4</span></span></div>
<div class="btn pri" style="text-align:center;margin-top:4px">Start crew · $3.00</div><div style="color:var(--ink2);text-align:center">Edit pipeline ▸ <span class="cx">5</span></div>"""
pages.append(screen(6, "05 – Select sections, deploy a crew", "Build · shift-select 3 sections · crew preview",
  topbar("Build"), canvas, insp,
  "<b>Built:</b> the orchestrator (waves, critic, gate, merge) exists, CLI only, briefs in markdown. <b>Proposes:</b> a crew is a selection on the map.",
  [note(False, "Selection is the brief.", P, "Shift-click or marquee sections; each becomes a module with that section as its fence."),
   note(True, "Pipeline preview before start.", P, "The orchestrator's model made visible: plan → waves → critic → gate → merge."),
   note(False, "Waves from the map's flow.", P, "Dependencies between selected sections order the waves automatically; the user can override."),
   note(False, "One cap for the crew.", P, "Split per module by the orchestrator; the meter in Run (p.7) shows each share."),
   note(False, "Edit pipeline.", O, "Opens Pipeline mode (p.8) for custom stages – how much of the brief stays prose vs fields?")],
  "Today this takes a hand-written BRIEF.md, waves lines and a launch script. The same run should be three clicks and a goal sentence."))

# ---------------- p7 run ----------------
nodes, pos = map_nodes(hot=("Decode pedigrees",))
ags = (fence(pos, "Decode pedigrees") + fence(pos, "Validate signals") + fence(pos, "Convert formats")
       + agent(pos, "Decode pedigrees", "D") + agent(pos, "Validate signals", "V", "ok") + agent(pos, "Convert formats", "C")
       + f'<div class="pill" style="left:{pos["Decode pedigrees"][0]}px;top:{pos["Decode pedigrees"][1]-16}px">editing parse_ped.py</div>')
vx, vy = pos["Validate signals"]; kx, ky = pos["Convert formats"]
hand = f'<svg class="edges" width="470" height="470" data-e="{vx+80},{vy-1},{kx+79},{ky-1}" data-dash="1" data-c="#35659f"></svg>'
canvas = nodes + edges(FLOWS, pos) + ags + hand + cx(pos, "Decode pedigrees", 1, dx=-14, dy=-14) + cx(pos, "Validate signals", 2, dx=30, dy=36)
insp = """<h5>Run · VCF 4.4 crew</h5><div class="t">2 working · 1 done</div>
<div class="meter"><i style="width:38%"></i></div><div class="kv"><span>spend <span class="cx">3</span></span><span>$1.14 / $3.00</span></div>
<h5>Decoder agent</h5><div class="feed"><div><span class="tm">12:41</span>read pedigree/decode.py</div><div><span class="tm">12:42</span>edit parse_ped.py +14 −3</div><div><span class="tm">12:43</span>run pytest -k ped … 2 failed</div><div><span class="tm">12:44</span>edit parse_ped.py +4</div></div>
<div style="display:flex;gap:4px;flex-wrap:wrap"><span class="btn">Pause</span><span class="btn">Message</span><span class="btn">+$0.50</span><span class="btn">Retry</span> <span class="cx">4</span></div>"""
bottom = """<div class="strip"><span>timeline <span class="cx">5</span></span><div class="lane"><span style="left:0;width:30%"></span><span style="left:32%;width:22%;background:#999"></span><span style="left:56%;width:8%;background:var(--note)"></span></div><span>12:44</span></div>"""
pages.append(screen(7, "06 – Run: agents working on the map", "Run mode · crew in progress · widgets pulse on their ground",
  topbar("Run", '<span class="btn">⏸ Pause all</span>'), canvas, insp,
  "<b>Built:</b> nothing in the UI – runs are watched through a terminal tail and PROGRESS.md. <b>Proposes:</b> Run mode is the home screen while anything runs.",
  [note(True, "Widgets show state where the work is.", P, "Running pulses, done is a double ring, failed is rust. The file being edited shows as a pill; the section stripes while files change."),
   note(False, "Hand-offs are a separate layer.", P, "Dashed blue arcs between widgets (Validate → Convert), never mistaken for call edges. Toggle in Layers."),
   note(False, "Spend is always visible.", P, "Crew meter plus each agent's share; a stall (no output for 15 min) turns the widget rust with a reason."),
   note(False, "Intervene from the inspector.", P, "Pause, message, raise cap, retry – what we do by hand in the terminal today."),
   note(False, "Timeline strip.", P, "Each agent a lane; critic and gate events marked; scrub to replay the map at that time.")],
  "No agent builder we found shows agents in the place they work. This is the screen that justifies merging the tabs.", bottom))

# ---------------- p8 pipeline ----------------
stages = [("Plan", "manager", 8, "ok"), ("Wave 1", "Decode · Validate", 98, "run"), ("Wave 2", "Convert", 188, ""), ("Critic", "per module", 278, ""), ("Gate", "tests · ui", 368, "")]
st = ""
for t, sub, x, s in stages:
    st += f'<div class="nd" style="left:{x}px;top:110px;width:76px;height:54px"><b>{t}</b><i>{sub}</i></div>'
    if s: st += f'<div class="ag {s}" style="left:{x+62}px;top:100px">{"✓" if s=="ok" else "·"}</div>'
mods = '<div class="nd" style="left:98px;top:190px;width:76px"><b>Decode</b><i>→ map ↗</i></div><div class="nd" style="left:98px;top:230px;width:76px"><b>Validate</b><i>✓ merged</i></div><div class="nd" style="left:188px;top:190px;width:76px"><b>Convert</b><i>queued</i></div>'
seg = "84,137,98,137;174,137,188,137;264,137,278,137;354,137,368,137;136,164,136,190"
canvas = st + mods + f'<svg class="edges" width="520" height="470" data-e="{seg}" data-dash="0"></svg>' + '<div class="nd prop" style="left:368px;top:190px;width:76px;border-style:dashed;border-color:var(--propose);color:var(--propose)"><b>+ stage</b><i>human approval</i></div>' + '<span class="cx" style="position:absolute;left:8px;top:80px">1</span><span class="cx" style="position:absolute;left:180px;top:240px">2</span><span class="cx" style="position:absolute;left:440px;top:176px">3</span>'
insp = """<h5>Stage</h5><div class="t">Wave 1</div><div class="kv"><span>modules</span><span>2</span></div><div class="kv"><span>between waves</span><span>manager guidance</span></div>
<h5>Hand-offs <span class="cx">4</span></h5><div class="feed"><div>Validate → Convert: handoff-validate.md</div><div>manager → Wave 2: guidance-convert.md</div></div>
<h5>Rules <span class="cx">5</span></h5><div class="kv"><span>stall watchdog</span><span>15 min</span></div><div class="kv"><span>wave must merge</span><span>yes</span></div>"""
pages.append(screen(8, "07 – Pipeline mode (the work graph)", "Run · 'Pipeline' layer · n8n-style, left to right",
  topbar("Run", '<span class="seg sm"><span>Map</span><span class="on">Pipeline</span></span>'), canvas, insp,
  "<b>Built:</b> orchestrate.py stages, waves from BRIEF.md, hand-off files. <b>Proposes:</b> the work graph drawn with the same kit, linked back to the map.",
  [note(True, "A different graph, a different view.", P, "Stages as n8n-style nodes, left to right. Never overlaid on the code map, so arrows always mean one thing per view."),
   note(False, "Modules hang under their wave.", P, "Each module links back to its section on the map (↗)."),
   note(False, "Add stages.", P, "Human approval, extra critic, benchmark gate – the n8n '+' between nodes, scoped to orchestration stages only."),
   note(False, "Hand-offs are first-class.", P, "The handoff and guidance files the orchestrator already writes, readable inline."),
   note(False, "The rules we learned.", N, "Watchdog, wave gating and caps exist today in orchestrate.py; here they become visible settings.")],
  "This is where n8n's model fits exactly: a sequence of steps with a + between them. Using it for orchestration, not for code, keeps the metaphor honest."))

# ---------------- p9 review ----------------
nodes, pos = map_nodes(hot=("Decode pedigrees", "Convert formats", "Validate signals"), dim=("Model hearts", "Single-cell", "Parse sys", "Agent memory", "Examples", "Score variants"))
canvas = (nodes + edges(FLOWS, pos) + agent(pos, "Decode pedigrees", "D", "ok") + agent(pos, "Validate signals", "V", "ok") + agent(pos, "Convert formats", "C", "err")
    + fence(pos, "Shared records", "BLAST RADIUS") + cx(pos, "Decode pedigrees", 1, dx=-14, dy=-14) + cx(pos, "Shared records", 2, dx=-14, dy=-14))
insp = """<h5>Review · VCF 4.4 crew</h5><div class="t">3 modules · 2 green</div>
<div class="kv"><span>Decode</span><span>+18 −3 ✓</span></div><div class="kv"><span>Validate</span><span>+42 −10 ✓</span></div><div class="kv"><span style="color:var(--note)">Convert</span><span style="color:var(--note)">gate failed</span></div>
<h5>Critic <span class="cx">3</span></h5><div class="feed"><div>blocking: Convert drops INFO fields</div><div>minor: duplicate parser in Validate</div></div>
<div style="display:flex;gap:4px"><span class="btn pri">Approve 2</span><span class="btn">Send back</span><span class="btn">Open diff</span> <span class="cx">4</span></div>
<h5>Outcome <span class="cx">5</span></h5><div class="kv"><span>cost</span><span>$2.41</span></div><div class="kv"><span>rework rate</span><span>1 / 3</span></div>"""
pages.append(screen(9, "08 – Review: changes on the map", "Review mode · Changes layer · after the crew finishes",
  topbar("Review"), canvas, insp,
  "<b>Built:</b> critic JSON files and PR text, read by hand. <b>Proposes:</b> review where the change happened, approve per module.",
  [note(True, "The change overlay.", P, "Touched sections stripe; untouched dim. The same overlay shows uncommitted work or any branch/PR when no run is selected."),
   note(False, "Blast radius.", P, "Downstream sections of a changed one are outlined: what this change could break."),
   note(False, "Critic findings in place.", P, "Ranked findings per module, each linking to the line in the editable code panel."),
   note(False, "Approve per module.", P, "Approve the green ones, send the failed one back with the critic's finding as its next task."),
   note(False, "Outcome metrics.", P, "Cost, rework rate, time to green – per run and rolled up per template in Explore.")],
  "GitHub reviews a file list; kula reviews a region of the system, with the agent who changed it and why."))

# ---------------- p10 IA + motion ----------------
pages.append(page(10, "Information architecture, layers &amp; motion", """
<div class="map" style="gap:18px">
  <div class="mapgroup"><div class="maprow">One workspace, four modes (replaces Map tab + Agents tab + 10 sub-tabs)</div>
  <div class="flows" style="grid-template-columns:repeat(4,1fr)">
    <div class="f"><span class="a">①</span><span><b>Explore.</b> Map, inspect, trace, browse (⌘K). Old: Map tab, lenses, sidebar tree.</span></div>
    <div class="f"><span class="a">②</span><span><b>Build.</b> + Agent megamenu, drop, crews, templates, fences. Old: Workflows, Teams, Skills, Fences.</span></div>
    <div class="f"><span class="a">③</span><span><b>Run.</b> Live widgets, feed, spend, Pipeline view. Old: Research loops, CLI orchestrator.</span></div>
    <div class="f"><span class="a">④</span><span><b>Review.</b> Changes overlay, critic, approve, outcomes. Old: critic files, PR text.</span></div>
  </div></div>
  <div class="mapgroup"><div class="maprow">Layers ▾ (toggles over the same ground)</div>
  <div class="chiprow"><span class="chip on">Code (always)</span><span class="chip on">Agents</span><span class="chip">Fences</span><span class="chip">Hand-offs</span><span class="chip">Changes</span><span class="chip">Risk</span><span class="chip hint">Memory, Docs, Connect → Settings and the agent's Advanced panel</span></div></div>
  <div class="mapgroup"><div class="maprow">Motion spec (from megamenu and canvas research)</div>
  <div class="motion">
    <wired-card><div class="k"><div class="kt">Megamenu (+ Agent, Layers)</div>
      <div class="rowline"><span>open on click / Tab; hover only after</span><span>250 ms intent</span></div>
      <div class="rowline"><span>open / close</span><span>200 ms ease-out / 150 ms ease-in</span></div>
      <div class="rowline"><span>switch kind: morph one container</span><span>size + position, 220 ms</span></div>
      <div class="rowline"><span>leave grace (diagonal problem)</span><span>300 ms, cancelled on entry</span></div>
      <div class="rowline"><span>item stagger</span><span>25 ms</span></div></div></wired-card>
    <wired-card><div class="k"><div class="kt">Canvas</div>
      <div class="rowline"><span>section open / close (frame grows)</span><span>220 ms, columns reflow</span></div>
      <div class="rowline"><span>hover neighbourhood dim</span><span>120 ms</span></div>
      <div class="rowline"><span>drag ghost + drop-target fence</span><span>follows pointer, 80 ms fade</span></div>
      <div class="rowline"><span>running widget pulse</span><span>1.2 s loop</span></div>
      <div class="rowline"><span>fit / focus pan</span><span>240 ms ease-in-out</span></div></div></wired-card>
    <wired-card><div class="k"><div class="kt">Rules</div>
      <div class="rowline"><span>prefers-reduced-motion</span><span>all motion off, instant</span></div>
      <div class="rowline"><span>no glow, scale or decorative shadow</span><span>design language</span></div>
      <div class="rowline"><span>keyboard parity</span><span>every menu + drop has a key path</span></div>
      <div class="rowline"><span>click-to-deploy before drag</span><span>n8n lesson</span></div>
      <div class="rowline"><span>one primary action per mode</span><span>top right</span></div></div></wired-card>
  </div></div>
  <div class="foot">Open questions: how much of a crew brief stays prose · whether Explore shows agent history by default · phone: Run as a list, map read-only</div>
</div>""", fill=True))

edge_js = """
<script>
window.addEventListener('load', () => {
  const R = window.rough; if (!R) return;
  document.querySelectorAll('svg.edges').forEach((svg) => {
    const rc = R.svg(svg), dash = svg.dataset.dash === '1', col = svg.dataset.c || '#555';
    (svg.dataset.e || '').split(';').filter(Boolean).forEach((s) => {
      const [x1, y1, x2, y2] = s.split(',').map(Number), mx = (x1 + x2) / 2;
      const o = { roughness: 0.9, stroke: col, strokeWidth: 1.1, bowing: 0.5 };
      if (dash) o.strokeLineDash = [4, 3];
      svg.appendChild(rc.curve([[x1, y1], [mx, y1], [mx, y2], [x2, y2]], o));
    });
  });
});
</script>"""

head = '<!doctype html><html lang="en"><head><meta charset="utf-8"/><link rel="icon" href="data:,"/><link rel="stylesheet" href="fonts.css"/><title>kula workspace wireframes</title>'
html = head + style + EXTRA + "</head><body>" + "".join(pages) + tail.replace("</body>", edge_js + "</body>")
open(W + "/wireframe.html", "w").write(html)
print("pages", len(pages))
