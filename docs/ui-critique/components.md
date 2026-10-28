# A1 · Component inventory and stress test

Scope: every recurring interface element in `web/src` (buttons, segmented
controls, tab strips, chips/badges, cards, inspectors, floating windows,
popovers/menus, dropdowns, search inputs, empty states, toasts, breadcrumbs,
rows, modals, keyboard help, and every canvas and node type). No code was
changed; this file is the deliverable.

Method
- Live probe: `.kula-team/tools/probe.mjs` against the two shared servers –
  `http://localhost:8071` (kula's own repo, launch-prep UI) and
  `http://localhost:8072` (swarm fixture) – at **1440x900, 1100x900 and
  390x844, dark and light**. Raw output in `.kula-team/scratch/a1/`.
- Stress harness: `.kula-team/scratch/a1/stress.mjs` measures, per class
  family, the live count, min box, long unbreakable label (overflow), off-screen
  count, hover delta, focus ring and both themes' colours. It was re-run at
  **1100x900 dark** and **1440x900 light** for every route
  (`scratch/a1/out/s1100-dark-*.txt`, `slight-*.txt`,
  driver `scratch/a1/run-all.sh`).
- Focus / 200-item harness: `.kula-team/scratch/a1/focus200.mjs <url> <route>
  <WxH>` presses Tab up to 45 times and records the **focus order** (the empty
  cycle closes when focus returns to the first element), then injects 200 clones
  of the first row-like element in place and measures scroll/overlap/overflow.
  Output `scratch/a1/out/focus-order-*.txt`, `focus-order-agents-teams.txt`.
- Screenshots of the two headline defects:
  `shots/a1-card-help-overlap-1440-dark.png` (card x help, 22x28 px
  intersection measured), `shots/a1-teams-canvas-390-dark.png` (`.tc-canvas`
  400 px wide in a 390 viewport), `shots/a1-agents-full-1440-dark.png` context.
- Every rating cites either a counted `file:line` (grep across `web/src`) or a
  measured value (harness/probe). No rating is "felt".

How to read a family
- **Objective** – the state it represents. **Value function** – what the user
  is maximising when they use it. **Copies** – every divergent implementation
  (`file:line`, class). **Target** – the one component it should become (name,
  props). **Stress** – the measured result. **Rating** – 1-10 on Value,
  Clarity/Density, Consistency, Interaction, Robustness, Polish.

---

## 1 · Buttons

- Objective: an action or a mode entry. Value function: how few decisions stand
  between the user and the action, and how legible the risk is (primary vs
  danger vs disabled).
- Copies: base `.btn` (`web/src/styles/base.css:5-16`: `primary`, `ghost`,
  `danger`, `sm`, `icon-only`) is already one system; the divergence is the
  parallel button grammars that bypass it:
  - `.tab-btn` `web/src/styles/system.css:26-30` (tab-like behaviour)
  - `.chip-btn` `web/src/styles/system.css:32-36`
  - `.pane-btn` `web/src/ui/Window.tsx:157-161` (window chrome)
  - `.ag-mi` `web/src/styles/agents.css:488-491` (mobile menu items)
  - `.team-tab-add` `web/src/styles/agents-teams.css:236`,
    `.crumb-link` `web/src/styles/map.css:50`,
    `.iso-chip` `web/src/styles/graph.css:235`,
    `.strip-menu-btn` `web/src/styles/graph.css:*`,
    `.sb-help` `web/src/styles/shell.css:*`
  - Live counts at 1440 dark: 40 `.btn` on `#agents`, 107 on `#branches`, 8 on
    `#changes`, 9 on `#graph`, 17 on `#overview`, 5 on `#agents/teams`.
- Target: `<Button variant="solid|ghost|danger" size="sm|md" icon={ReactNode}
  iconOnly disabled title>` wrapping `.btn`. The five parallel grammars
  collapse to variants; `.pane-btn` and `.crumb-link` keep their layout class
  but gain `.btn` behaviour.
- Stress (measured, `stress.mjs`): min box 28x28 (icon-only). A long
  unbreakable label **clips** – `.btn` keeps `white-space: nowrap` with
  `overflow: visible/clip`; injected 261px label over a 26px button reported
  `clips (261>26)`. Icons-only buttons are the fine case; labelled buttons
  never ellipsis. Hover dark `bg none -> rgb(20,18,16)`, light
  `none -> rgb(235,228,217)`; focus ring 2px accent (`rgb(249,127,58)` dark,
  `rgb(240,82,1)` light) on every `.btn`. Disabled swaps to `--text-3`
  (`base.css:8`). 200-item behaviour: `.btn` rows lay out without overflow.
  At **1100 dark** the same numbers hold (40 `.btn` on `#agents`, min 28x28,
  `clips (261>26)`) – the family is width-invariant 1440→1100. **Focus order**:
  buttons are reachable in DOM order, but at 1440 the rail duplicates every
  destination (§18).
- Rating: Value 8, Clarity 7, Density 7, Consistency 5 (five parallel
  grammars), Interaction 8 (hover/active/disabled/focus all present),
  Robustness 6 (long labels clip), Polish 7.

## 2 · Segmented controls (`.seg`)

- Objective: a two-to-four-way exclusive mode (Symbols/Files, lower/higher,
  all/stale/agents/people, theme). Value function: switching mode with one
  click and seeing which mode is live.
- Copies: one base `web/src/styles/graph.css:8-10` (`.seg`, `.seg button`,
  `.seg button.on`), then **two rule sets that override each other**:
  `graph.css:10` sets the selected state as `box-shadow`, and
  `graph.css:187-188` removes the `box-shadow` and re-states it as a border.
  Modifiers: `.seg.full` `web/src/styles/settings.css:15-16`,
  `.seg.sm`, `.seg.ico` / `.seg-ico` `web/src/styles/graph.css:277-278`
  (`GraphView.tsx:637`), `.seg.ag-sort` `agents.css:294`,
  `.seg.note-kind`, `.seg.iso-tabs` (`GraphView.tsx:1186:1186`).
  14 files instantiate it: `SettingsPanel.tsx:184,225`, `Contrast.tsx:289,304`,
  `Research.tsx:265,303`, `SkillIndex.tsx:165,170`, `Memory.tsx:101,105`,
  `AgentSidebar.tsx:96,106`, `MetaViews.tsx:56,125`, `Settings.tsx:89`,
  `TeamSidebar.tsx:146`, `Workflows.tsx:100`, `GraphView.tsx:637,1034`,
  `Query.tsx`, `map/chrome.tsx`.
- Target: `<Seg options={{value,label,icon}[]} value onChange size="sm|md"
  block icon ariaLabel>` – one component; `.full` becomes `block`.
- Stress (measured): 2-3 buttons, 28px high at 1440 and **40px at <=760**
  (`graph.css:216`, `settings.css:206`), so touch height is handled but from
  two different files. Focus ring 2px accent on the buttons. Long labels fit
  (buttons size to text). Selected state reads as a filled cell in dark
  (`bg rgb(20,18,16)` on the `.on` button) and light (`bg rgb(235,228,217)`,
  border `rgb(211,205,194)`). Identical at **1100 dark** (`#graph` 96x28,
  `#agents` 45x28). Focus order: each `.seg` button is a separate tab stop, so
  a 3-way seg costs 3 Tabs with no roving `tabindex` and no arrow-key handling
  (`focus-order-overview.txt` steps 26-28: `all`, `built in`, `kula.toml`).
- Rating: Value 8, Clarity 8, Density 8, Consistency 5 (override pair +
  4 modifiers), Interaction 7 (no `:active` defined on `.seg button`),
  Robustness 8, Polish 7.

## 3 · Tab strips

- Objective: which tab of a multi-pane area is showing. Value function:
  reaching any tab in one click, and always seeing which one is active.
- Copies: **seven** separate strips (plus the mobile `.ag-menu` variant), three
  different active-state grammars:
  - `.ag-tabs` `web/src/styles/agents.css:65-71` (`views/Agents.tsx:104`) –
    active = 2px bottom border, 34px tall, horizontal scroll, and a second
    vertical form `.ag-menu .ag-tabs` `agents.css:487-497` for the phone menu.
  - `.team-tabs.tab-strip` `web/src/styles/agents-teams.css:235` +
    `web/src/views/agents/parts.tsx:305`
  - `.tc-tabrow` `agents-teams.css:399-401` (`Teams.tsx:162`) – wraps
    `.team-tabs` and re-pads the buttons.
  - `.at-tabs` `web/src/styles/agents-terrain.css:119-120`
    (`AgentInspector.tsx:114`) – active = **background** fill, not a border.
  - `.tabs` `web/src/styles/graph.css:31-33` + `code.css:27,149-151` +
    `workspace.css:381-382` – the GraphView (`GraphView.tsx:1012`) and MapView
    (`MapView.tsx:852`) inspector strip, 34px, bottom border + accent.
  - `.wf-tabs` `agents.css:341` (`Workflows.tsx:97`) – misnamed: it is a grid
    of suggestion cards, not a tab strip.
  - `.iso-tabs` `GraphView.tsx:1186` – a `.seg` used as a tab strip.
- Target: `<Tabs items={{id,label,icon,count,dot}} value onChange
  orientation="h|v" size="sm|md" ariaLabel>`; the mobile `.ag-menu` becomes
  `orientation="v"`.
- Stress (measured): `#agents` strip 8 buttons, 34px (`89-110px` wide), fits
  desktop. At 390 on 8071 the strip's phone menu has an **off-screen** item
  (`button.ag-mi "Open Workspace"` reported at `x 363-399` on a 390 viewport)
  and every menu row is a small target (36-38px < 40). Hover changes colour
  only in two rule sets (`agents.css:68` and a second hover rule), reported as
  "borderTop + color shift" by the harness. Identical at **1100 dark**
  (8 buttons, 38px) and at 1440 light (8 buttons, `89-110px`).
- **Focus order defect (measured, 1440):** the mobile `.ag-menu` buttons are
  *not hidden at desktop width* – `button.ag-mi` measures 110x38, `display:flex`,
  `visibility:visible` at 1440 and receives focus at Tab steps 18-25 of
  `#agents`. Every destination is therefore in the tab order **twice**: once as
  the left rail (steps 6-17) and again as the phone menu (steps 18-25). A
  keyboard user Tabs through 19 nav stops to reach the page content.
  `focus-order-agents.txt`.
- Rating: Value 8, Clarity 7, Density 7, Consistency 3 (seven copies + the mobile variant, three
  active grammars), Interaction 7, Robustness 5 (off-screen phone menu),
  Polish 6.

## 4 · Chips and badges

- Objective: a compact token – a label, a filter, a removable value, a status.
  Value function: completeness of the metadata at a glance and one-click
  filtering/removal.
- Copies: **fourteen** families (counted below):
  - `.chip` `web/src/styles/shell.css:7` (top-bar branch chip, `App.tsx:244`)
  - `.chip-btn` `system.css:32`
  - `.chip-toggle` `agents-teams.css:82` (`Workflows.tsx:126`,
    `Skills.tsx:241`)
  - `.chip-x` / `.chip-x button` `settings.css:151-153` (`Autofill.tsx:162`,
    `TeamSidebar.tsx:189`)
  - `.tc-chip` `agents-teams.css:425`, `.tc-inh-chip` `:471`
  - `.ws-chip`, `.at-chip` `agents-terrain.css:137`, `.iso-chip`
    `graph.css:235`, `.trace-chip` `graph.css:160`, `.fence-key`
  - `.risk-pill` / `.status-pill` `web/src/styles/overview.css:28-31`
  - `.kind-badge` `graph.css:37,107` (symbol-kind square, `ui.tsx:107`)
  - `.tag` `web/src/styles/base.css:26-31` (a **third** tone scale: `accent`,
    `green`, `red`, `violet`, `yellow`), plus `.badge` `agents.css:71`
- Target: `<Chip kind="static|action|toggle|remove|status" tone="ok|warn|err"
  icon onRemove onClick title>`; `.kind-badge` stays its own glyph but reuses
  the tone scale.
- Stress (measured): `.chip` 118x28 fits; `.chip-x` measures 22px high, then
  is force-resized to 28px on desktop and 40px at phone width from three
  different files (`settings.css:151`, `agents.css:313-314,325`). Long labels:
  `.tc-chip` is `white-space: nowrap` (clips rather than ellipsis). Tones are
  duplicated between `.risk-pill` and `.status-pill` though the class names
  differ (same three states). Light: `.chip` bg `rgb(244,242,238)`, border
  `rgb(226,221,212)`; identical at 1100 dark. **200-item injection**
  (`focus200.mjs`): 200 cloned `.chip` into the top-bar strip on `#graph` /
  `#notes` overflow horizontally (`parentBox 1440x48`, `overflowX true`) – the
  chip strip **does not wrap**, so a long filter row runs off the right edge
  instead of wrapping or scrolling.
- Rating: Value 7, Clarity 6, Density 8, Consistency 3 (fourteen families),
  Interaction 6, Robustness 6, Polish 6.

## 5 · Cards

- Objective: a titled surface grouping related content. Value function:
  scanning and comparing several groups without losing the page.
- Copies: **`.card` is defined twice**, which is the headline defect:
  - `web/src/styles/overview.css:13` – `padding: 6px 6px 8px` **plus** a
    `view-in` entrance animation, and `:14` animates children 2-5.
  - `web/src/styles/system.css:14` – `border` + `background` only, with
    `.card:hover` / `.card.is-selected` at `:15-16`.
  `overview.css` is imported after `system.css` (`styles.css:4` then `:6`).
  Verified: `padding: 6px 6px 8px`, `border-radius: 0`, `min-width: 0` and the
  `view-in` animation exist **only** in `overview.css:13-14`, so they leak onto
  every `.card` app-wide *unconditionally*, whatever the import order; the order
  decides only the duplicated `border` + `background`, whose values are
  byte-identical in both files (`1px solid var(--line)`, `var(--panel)`), so the
  order has **no visible effect**. A card on a page that never imported
  overview styling still animates in and still carries overview padding.
  Card header/empty/note: `.card-head` `overview.css:16`, `.card-empty`
  `:18`, `.card-note` `:19`.
  KPI cards: `.kpi` `overview.css:8` and `.kpi-strip`/`.kpi-cell`
  `overview.css:57-64` are **dead CSS** – `views/Overview.tsx` now uses
  `StatTable` (`ui.tsx:299`) instead; grep found no `.kpi` usage in any `.tsx`.
  Agent cards: `.card.ag-card` (`AgentCard.tsx:99`) with `.card__art/body/
  meta/t/d/fmt` `agents.css:590-603`, `.rs-card` (`Research.tsx:123`),
  `.tpl-card`, `.org-card` (`TeamOrg.tsx:126`), `.ag-col-card`
  (`Overview.tsx:93`), `.card.coupling` (`Coupling.tsx:58`).
- Target: `<Card title actions tone span={1|2|full}>` around one `.card`
  definition; KPIs become `<StatTable>` (already shipped) and the dead `.kpi`
  block is deleted.
- Stress (measured): `#overview` shows 6 cards, 1280px wide, min 423x114, all
  fit; light bg `rgb(244,242,238)`, border `rgb(226,221,212)` (identical hex to
  dark modulo theme tokens); at 1100 `#overview` `.card` 996x636, min 996x114.
  `#agents` shows 28 `.card`, min 246x100. **Defect reproduced at 1440px**
  on 8071 (not only 390 as `map.md` §7 recorded): probe reports
  `overlap: div.card.ag-card "architect kula.toml" x button.sb-help "panel"` on
  `#agents` at 1440, **1100** (plus a second overlap with
  `button.sb-help.sb-keys "? shortcuts"`) and 390, and the class collision is
  worse on the fixture. Measured intersection at 1440:
  `div.card.ag-card[data-testid=ag-card-architect]` x `button.sb-help` =
  **22x28 px** (x 1248-1270, y 874-900) – the card runs under the help button,
  so the card's own click target is obscured. Image:
  `shots/a1-card-help-overlap-1440-dark.png`. **200-item injection**
  (`focus200.mjs`): 200 cloned `.card` on `#agents` lay out with 0 sibling
  overlaps but the page grows to `scrollH 20840` – no grid cap, the whole page
  becomes one very long column.
- Rating: Value 8, Clarity 7, Density 7, Consistency 3 (double definition +
  dead KPI block + 6 card variants), Interaction 6, Robustness 6 (card/help
  overlap), Polish 5.

## 6 · Inspectors

- Objective: the detail pane for the selected thing. Value function: reading
  and acting on the current selection without leaving the canvas.
- Copies: `web/src/views/GraphView.tsx:956` `.inspector` (`graph.css:27-33`,
  absolute right, 380px); `web/src/views/MapView.tsx:834`
  `.inspector.map-insp` (`workspace.css:381`); `AgentInspector.tsx:125-191`
  `.at-pane` (5 panes); `SkillIndex.tsx:76-91` `.sx-pane` (+ `-head/-body/
  -foot/-err`); `ResearchFlow.tsx:207,224` `.rf-panel`; `Contrast.tsx:259,311`
  `.split-pane` / `.contrast-panel`; `CodePanel.tsx:286` `.code-panel` (a
  `Window`, not a plain inspector).
- Target: one `<Inspector.Tabs/Meta/Row>` set, plus the `<Panel>` primitive it
  shares with Card. Each inspector keeps its container class, loses its
  bespoke header/tab/row grammar.
- Stress (measured): inspectors are absolutely positioned and fit at 1440; at
  390 the GraphView inspector overlays the canvas (by design). Focus ring
  present on inner tabs. No shared "inspector" test id exists, so each view
  needs its own selector in tests.
- Rating: Value 8, Clarity 7, Density 7, Consistency 4, Interaction 7,
  Robustness 6, Polish 6.

## 7 · Floating windows (`ui/windows.ts` + `ui/Window.tsx`)

- Objective: a movable, resizable, minimisable panel. Value function: keeping
  context on screen while doing a side task.
- Copies: **none in behaviour** – this is the model consolidation. One store
  (`web/src/ui/windows.ts`, `kula.windows.v2`, dock-right defaults) and one
  component (`web/src/ui/Window.tsx`), chrome `.win/.win-head/.pane-ctl/
  .win-body/.win-foot/.win-rz/.win-dock` (`styles/windows.css`).
- Target: keep as is; export `<Window>` to any view that currently builds its
  own overlay drawer (SettingsPanel, CodePanel already comply).
- Stress (measured): min 280x160, dock right (`windows.ts:50-59`), clamp on
  resize, focus ring on `.win-head` and `.win-dock button` (2px accent),
  `data-max` removes resize handles. Clean.
- Rating: Value 9, Clarity 9, Density 8, Consistency 9, Interaction 9,
  Robustness 8, Polish 8.

## 8 · Popovers and menus

- Objective: a transient list of choices. Value function: choosing without a
  page change.
- Copies: `.dd-menu` / `.dd-opt` (`system.css:105-114`) – the one select-style
  popover; `.ag-menu` `agents.css:487-497` – a **second** menu system built
  from the tab strip for the phone card; the command palette `.palette`
  (`shell.css:57-64`, `App.tsx:414`) – a modal in menu clothing; tooltips
  `.tip-box` (`system.css:50`).
- Target: `<Menu items onSelect anchor>` for both `.dd-menu` and `.ag-menu`;
  the tooltip stays `<Tip>` (`ui.tsx:203`).
- Stress (measured): `.dd-menu` is `position: fixed`, `max-width min(360px,
  100vw-16px)`, `max-height 320px`, keyboard selection class `.kb-sel`
  (`system.css:109`) – robust. `.ag-menu` inherits the phone problems of §3.
- Rating: Value 8, Clarity 8, Density 8, Consistency 5 (second menu system),
  Interaction 8, Robustness 7, Polish 7.

## 9 · Dropdowns

- Objective: choose one of many. Value function: finding the option fast.
- Copies: `web/src/ui/Dropdown.tsx` (role=listbox, keyboard, `dd-*` classes)
  used in **only two files** (`Settings.tsx`, `GraphView.tsx`); everywhere else
  the code falls back to a native `<select className="input">`
  (`base.css:17`: `.input, .textarea, select.input` share one rule), e.g.
  `TeamSidebar.tsx:170` `.input.tc-fence-level`, `Settings.tsx:98-106`.
- Target: adopt `<Dropdown>` for every native select so the popup looks like
  the rest of the app; `<Dropdown options value onChange label disabled>`.
- Stress (measured): `.dd-btn` `dd-value` truncates with ellipsis
  (`system.css:101`) – the only control in the app that handles a long value
  gracefully. Native selects revert to the OS popup and lose the warm palette.
- Rating: Value 7, Clarity 8, Density 8, Consistency 4 (2 adopters vs ~15
  native selects), Interaction 8, Robustness 8, Polish 7.

## 10 · Search inputs

- Objective: type a query to filter or jump. Value function: time from intent
  to narrowed result.
- Copies: `.search-trigger` `shell.css:14-17` (top bar, opens the palette);
  `.input` `base.css:17`; `.chips-in .input` `settings.css:154-155` (the only
  one that strips the border); `.palette input` `shell.css:58` (a third shape);
  `.cp-note-target` (`CodePanel.tsx:293`). The palette search debounces 80ms
  (`App.tsx:363`), autofill 110ms (`Autofill.tsx:57`).
- Target: `<SearchInput value onChange placeholder icon onClear debounce>`
  reusing `.input`, plus a `<Kbd>` for the shortcut.
- Stress (measured): `.search-trigger` is `min(420px, 40vw)` – fits both
  widths; the top-bar `⌘K` kbd sits in a flex row (`shell.css:17`). No search
  input ellipsises; a long query scrolls natively inside `.input`.
- Rating: Value 7, Clarity 7, Density 7, Consistency 4 (four shapes),
  Interaction 7, Robustness 7, Polish 6.

## 11 · Empty states

- Objective: tell the user a list is empty and what to do next. Value
  function: turning a dead end into the next action.
- Copies: **ten divergent families**:
  - `Empty` component `web/src/ui.tsx:278` -> `.empty` `base.css:32-33`
  - `.card-empty` `overview.css:18` (`CodePanel.tsx:345`, `Overview.tsx:63`,
    `Contrast.tsx:278,369`)
  - `.ag-empty` (`Settings.tsx:126`, `Overview.tsx:87,106,119,162`,
    `Docs.tsx:82`, `Teams.tsx:228`, `Memory.tsx:109,119`)
  - `.set-empty` (`SettingsPanel.tsx:128,140,292,381,402,410` – 6 sites)
  - `.ft-empty` `FileTree.tsx:65`, `.sk-empty` `Skills.tsx:120`,
    `.tc-side-empty` `TeamSidebar.tsx:66,213`, `.tc-empty`
    `TeamCanvas.tsx:178,335`, `.ac-empty` `AgentChecks.tsx:29-42`,
    `.sx-pane-body muted` `SkillIndex.tsx:89`
  Only `Empty` renders a heading (`h3`, styled by `type.css:8`); the other
  nine are a dim `div` with a sentence and no action.
- Target: `<EmptyState icon title body action tone>`; every variant becomes an
  instance, `.empty` stays the stylesheet rule.
- Stress (measured): `.empty` renders 1044x117 on `#agents` and fits; the dim
  variants are single lines with no CTA. None is a small target, none
  ellipsises. The problem is consistency and the missing next-action, not
  breakage.
- Rating: Value 6, Clarity 6, Density 8, Consistency 2 (ten families, one
  heading), Interaction 4 (most have no action), Robustness 7, Polish 6.

## 12 · Toasts

- Objective: transient feedback for a completed action. Value function: knowing
  the action succeeded without leaving the screen.
- Copies: one – `ToastProvider` / `useToast` `web/src/ui.tsx:263-276` ->
  `.toasts`/`.toast.ok|.err` `shell.css:67-70`. Twelve files call it
  (`App.tsx`, `Agents.tsx`, `GraphView.tsx`, `GitViews.tsx`, `MetaViews.tsx`,
  `Query.tsx`, `Contrast.tsx`, `Memory.tsx`, `Teams.tsx`, `Docs.tsx`,
  `SkillIndex.tsx`, `ui.tsx`).
- Target: keep; add a `<Toast>` kind prop if D1 wants a warn tone (only ok/err
  exist today).
- Stress (measured): `role="status"`, 3.2s ok / 6.5s err timers
  (`ui.tsx:268`), fixed bottom-right (`shell.css:67`). Message is
  `white-space: pre-wrap` so a long message **wraps** – the best-handled
  family for long content.
- Rating: Value 8, Clarity 8, Density 8, Consistency 9, Interaction 8,
  Robustness 8, Polish 8.

## 13 · Breadcrumbs

- Objective: where you are in a hierarchy and how to go up. Value function:
  climbing one level with one click.
- Copies: two systems – the top-bar repo/view crumb `.crumb` / `.crumb-repo` /
  `.crumb-view` (`shell.css:6,92-93`) and the map breadcrumb `.crumb-link`
  (`map.css:50-52`, `.on` = accent). They share the word "crumb" and nothing
  else.
- Target: `<Breadcrumb items={{label,onClick,current}}>`; the top bar passes
  its two-level crumb, the map passes its drill path.
- Stress (measured): `.crumb-link` is `min-height: 28px`, and `.on` is
  `--accent-text` only (no border), so the current level is distinguished by
  colour alone. Long paths on the map push the crumb wide; the sidebar
  scrolls, not the crumb.
- Rating: Value 7, Clarity 7, Density 8, Consistency 4 (two systems),
  Interaction 6, Robustness 6, Polish 6.

## 14 · Rows

- Objective: one item in a list. Value function: scan a dense list and open the
  right item.
- Copies: `Sym` row `web/src/ui.tsx:117-131` -> `.sym` (`code.css`); `.ov-row`
  `overview.css:20-24`; `.br-row` `:33-37`; `.hot-row` `:45-50`; the generic
  behaviour `.row-hover` `system.css:19-21`; agent rows `.ags-row`,
  `.ag-row`. Each re-implements hover (`.ov-row:hover`, `.br-row:hover`,
  `.hot-row:hover` vs the shared `.row-hover`).
- Target: `<Row selected icon title sub right onClick titleAttr>` on
  `.row-hover`; `.sym` keeps its Kind badge but drops its private hover.
- Stress (measured): `#branches` renders **2343 `.sym` rows** in the compare
  view with no virtualisation (min 465x24) – the emptiest evidence that row
  count is unbounded; `#overview` `.ov-row` 8 rows 833x49, `.br-row` 8 rows
  821x38, `.hot-row` 9 rows 409x25. Hover dark `none -> rgb(20,18,16)` on
  `.sym`, `.ov-row`, `.br-row`. Long titles ellipsis (`.ov-row .title`,
  `.br-name`, `.hot-path` `direction: rtl`) – rows are the best-handled family
  for text.
- Rating: Value 8, Clarity 8, Density 8, Consistency 5 (5 row types),
  Interaction 7, Robustness 6 (no virtualisation), Polish 7.
- **200-item injection** (`focus200.mjs`, all measured): 200 cloned `.ov-row`
  on `#overview` keep `833x49`, 0 sibling overlaps, page scrolls to 10091px;
  200 `.sym` on `#branches` (491x25) produce horizontal overflow of the rows
  container (`overflowX true`); 200 `.tc-node` on `#agents/teams` stack to
  `scrollH 18402` inside a 92px client box with 0 overlaps. Rows never overlap,
  but nothing is virtualised and `.sym` overflows sideways.
- Light: `.sym`/`.ov-row` text `rgb(35,29,24)` (dark `rgb(240,235,227)`);
  identical geometry at 1100 dark (`.sym` 321x25, `.ov-row` 982x49).

## 15 · Modals

- Objective: a blocking decision on top of the page. Value function: a focused
  choice the user cannot miss.
- Copies: `web/src/App.tsx:413-432` `.scrim` + `.palette` (command palette) and
  `App.tsx:441-449` `.scrim` + `.palette.help` (keyboard help) – the only two
  modals, both hand-built on the palette shell; `SettingsPanel.tsx` is a
  slide-over drawer, not a modal.
- Target: `<Modal>` (scrim + centred pane, `Esc`, focus trap) that both the
  palette and help use; `<Pane>` for the drawer.
- Stress (measured): `shell.css:57` `width: min(640px, 100vw-32px)` collapses
  correctly at 390. Both overlays are hand-built on the palette shell. A
  re-read of the DOM shows both carry `role="dialog"` (measured: `.palette`
  and `.palette.help`), correcting the earlier reading that the palette set
  none; neither sets `aria-modal`. `Esc` closes via the global keydown
  (`App.tsx:215`).
- **Focus trap measured** (`/tmp/help.mjs` equivalent, 1440 dark): the palette
  *does* declare `role="dialog"` (`.palette`, 640x557) but **no `aria-modal`**,
  and Tab leaves it after one step – `div.results` then `body` then the top bar
  (`button.brand`, `button.chip`, …). The help overlay (`role="dialog"`, opened
  with `?`) never takes focus at all: Tab 1 walks straight to `button.brand`
  **outside** `.palette.help`, so a keyboard user must Tab the entire page
  behind a modal overlay. Neither modal traps focus; neither sets
  `aria-modal`; neither moves focus into the dialog on open.
- Rating: Value 7, Clarity 8, Density 8, Consistency 5 (two bespoke modals),
  Interaction 6 (no focus trap), Robustness 7, Polish 7.

## 16 · Keyboard help

- Objective: teach the shortcuts. Value function: the number of shortcuts the
  user can learn without leaving the app.
- Copies: one – `Help` `web/src/App.tsx:438-449`, `.help-grid` / `.help-row` /
  `.help-sep` / `.help-head`, `GLOBAL_SHORTCUTS` + `VIEWS` + `CONTEXT_SHORTCUTS`
  rows, opened with `?` (`App.tsx:213`). `<kbd>` is the shared key token.
- Target: keep, but share `<Kbd>` with the palette footer (`App.tsx:432`) and
  the top bar (`App.tsx:248`).
- Stress (measured): rows are `kbd` + label pairs; the grid reflows at 390;
  no `data-testid` coverage exists for the grid order (the source sets
  `data-testid="help-grid"` but no spec asserts it). One focus ring, one
  dialog role. **Focus order**: opening with `?` does not move focus into the
  dialog and the dialog does not trap it – Tab 1 lands on `button.brand`
  outside `.palette.help` (measured, 1440 dark).
- Rating: Value 7, Clarity 8, Density 8, Consistency 7 (one Kbd, two hosts),
  Interaction 7, Robustness 7, Polish 7.

## 17 · Canvases and node types

- Objective: a spatial view of the code/agents/memory. Value function: seeing
  structure that a list hides.
- Copies: **four canvas engines and eleven node types**:
  - React Flow `flow/FlowCanvas.tsx` with `nodeTypes` `web/src/flow/nodes.tsx:268`
    = `sticky, tile, wide, circle, group, loop, block, gate, agent` (9 types);
    chrome `flow.css`.
  - React Flow `web/src/views/agents/TeamCanvas.tsx:72` with `tc` (SquareNode)
    and `tg` (team group) – a **second** node kit, `allTypes` at `:323`.
  - Sigma (WebGL) `GraphView.tsx`, `MiniGraph.tsx`, `NotesGraph.tsx`,
    `Contrast.tsx`.
  - Custom nested-box `web/src/views/map/canvas.tsx` (not React Flow).
  Plus `ResearchFlow.tsx` `.rf-panel`. Each canvas ships its own toolbar:
    `.hud` (`graph.css`), `.u7-legend-panel`, MapView chrome
    (`views/map/chrome.tsx`), FlowCanvas controls, TeamCanvas chrome.
- Target: `<CanvasToolbar>` (zoom, fit, layers, legend, one HUD grammar) used
  by all four; a `Node` shell (`.node`) that the eleven node types render
  inside, so padding/border/selection come from one place. Node types stay,
  but their chrome converges.
- Stress (measured): `#agents/teams` at 390 – `div.tc-canvas.tc-all` reported
  **off-screen** at `x 0-400` on a 390 viewport (`div.tc-head` likewise); at
  1100 dark the `.logo-click` node marks measure **11x13** (16 of them) – the
  same tiny-target defect persists at desktop width, not only at 390, while at
  1440 light the same family is 15x18 (`.tc-node` 73x46). Team group heads
  `.tg-head` measure 194x17 and `.tc-node-mark.logo-click` 10x12 to 15x18 – all
  far under a 28/40px target; on the swarm fixture the same 15 small-target
  findings repeat across the 9 teams. Measured canvas width at 390:
  `.tc-canvas.tc-all` is **400px wide in a 390 viewport** (x 0-400,
  `document.scrollWidth` 390, so the right 10px is clipped, not scrollable);
  image `shots/a1-teams-canvas-390-dark.png`. At 1440 the canvas fits.
  `#graph` (sigma) is clean (`PROBLEMS (0)` at 1440, 1100 and 390).
  **200-item injection**: 200 cloned `.tc-node` stack to `scrollH 18402` in a
  92px box with 0 overlaps (no node collision handling, no virtualisation).
- Rating: Value 9, Clarity 7, Density 6, Consistency 3 (two node kits, four
  toolbars), Interaction 6 (tiny node targets), Robustness 4 (390 canvas
  off-screen), Polish 6.

---

## 18 · Keyboard focus order, 200 items and light theme (measured)

The brief names three stress dimensions that are per-family but are easiest to
read once, consolidated. All numbers below are from `focus200.mjs` and the
re-run `stress.mjs` in `scratch/a1/out/`.

### 18.1 Focus order (Tab, 1440 dark, 8071)

| route | tab stops before the cycle closes | first stop | notable |
|---|---|---|---|
| agents | 45+ (no cycle in 45) | `button.brand` | rail (6-17) then the **same destinations again** as `button.ag-mi` (18-25) |
| agents/teams | 45+ | `button[team-tab-core]` | team tabs → toolbars → canvas |
| overview | 45+ | `button.brand` | 8 "Contrast" buttons in a row (39-45) is a repeated-stop smell |
| branches | 45+ | `button.brand` | clean, no duplicate rail |
| graph | 36 (cycle) | `button.brand` | closes back to `.brand` |
| notes | 28 (cycle) | `button.brand` | closes back to `.brand` |

The two defects this exposes, both reproducible at 1440:
1. **The phone menu is in the desktop tab order.** `button.ag-mi` is
   `display:flex`, `visibility:visible`, 110x38 at 1440 and takes focus at
   Tab 18-25 on `#agents`, so every nav destination is a tab stop twice
   (rail + menu). Evidence: `focus-order-agents.txt`.
2. **Cards are focusable containers.** `div.card.ag-card` has `tabIndex 0`, so
   each card is a tab stop *and* its own action buttons are separate stops:
   `#agents` reaches `.ag-card` (30), then `ag-art-explore` (31), then
   `.ag-card` (32), then `ag-art-fix` (33) – two stops per card where one is
   enough.

Modals (§15) trap nothing: opening the palette or `?`-help leaves Tab walking
the page behind the overlay.

### 18.2 200-item injection (measured)

| route | element | 200-item box | parent scrolls | sibling overlaps | horizontal overflow |
|---|---|---|---|---|---|
| agents | `.card` | 246x373 | yes (20840px) | 0 | no |
| overview | `.ov-row` | 833x49 | no | 0 | no |
| branches | `.sym` | 491x25 | no | 0 | **yes** |
| graph / notes | `.chip` | 118x28 | no | 0 | **yes** |
| agents/teams | `.tc-node` | 73x46 | yes (18402px) | 0 | no |

Read: nothing overlaps at 200 items, which is good, but (a) `.sym` rows and
(b) the top-bar `.chip` strip overflow **horizontally** instead of wrapping,
and (c) neither `.card` grids nor the teams canvas have any count cap – the
page/box just grows. The real unbounded list, `#branches` with **2343 `.sym`
rows**, is the same element as the synthetic case and is unvirtualised.

### 18.3 Light theme (1440 light, 8071)

Every family changes only its theme tokens; geometry is identical to dark.

| family | dark text/bg | light text/bg | light border |
|---|---|---|---|
| `.btn` | `rgb(194,185,172)` / none | `rgb(93,88,80)` / none | – |
| `.seg button.on` | `rgb(240,235,227)` / `rgb(20,18,16)` | `rgb(35,29,24)` / `rgb(235,228,217)` | `rgb(211,205,194)` |
| `.chip` | `rgb(194,185,172)` / `rgb(12,11,10)` | `rgb(93,88,80)` / `rgb(244,242,238)` | `rgb(226,221,212)` |
| `.card` | `rgb(240,235,227)` / `rgb(12,11,10)` | `rgb(35,29,24)` / `rgb(244,242,238)` | `rgb(226,221,212)` |
| `.empty` | `rgb(134,125,115)` | `rgb(106,98,88)` | – |
| `.sym` / `.ov-row` | `rgb(240,235,227)` | `rgb(35,29,24)` | – |
| `.ag-tabs button.on` | `rgb(240,235,227)` / accent 8% | `rgb(35,29,24)` / accent 10% | – |

No family is theme-broken; the light values are the same tokens inverted.
Three families (`card`, `chip`, `seg`) therefore show that the divergence the
ratings punish is *class and rule duplication*, not colour drift – light and
dark are consistent, the copies are not.

### 18.4 Screenshots (this pass)

- `shots/a1-card-help-overlap-1440-dark.png` – the 22x28px card x `sb-help`
  intersection on `#agents`.
- `shots/a1-agents-full-1440-dark.png` – the same page in context.
- `shots/a1-teams-canvas-390-dark.png` – `.tc-canvas` 400px in a 390 viewport.

---

## Measured problem counts (probe, launch-prep)

| route | 1440 problems | **1100 problems** | 390 problems | dominant finding |
|---|---|---|---|---|
| overview | 0 | **0** | 0 | clean |
| agents | 1 | **8** | 11 | card x help overlap; at 1100 a whole workflow card column is off-screen |
| agents/teams | 21 | **21** | 35 | small node targets; canvas off-screen at 390 |
| graph | 0 | **0** | 0 | clean |
| changes | 0 | **0** | – | clean |
| branches | 0 | **0** | – | 2343 `.sym` rows, no virtualisation |
| notes | 1 | **1** | 0 | `.tgl` 26px tall (under 28) |
| query | 1 | **1** | 0 | `.grip` resize handle 8px wide |
| contrast | 0 | **0** | – | clean |

(`agents` overlap reproduced at **1440, 1100 and 390**, and on the 8072
fixture; it is not a 390-only defect.)

**1100-only defect (new in this pass, no spec covers 1100).** `#agents` at
1100x900 reports 8 problems where 1440 reports 1: `div.row "e2e-tester
kula.toml"` and the workflow card body – `div.wf-about`, `div.wf-fences`,
`span.guard-tag.review`, `span.muted.wf-mem` – are all measured at
`x 835-1134` on an 1100 viewport, i.e. a full card column sits **off-screen**
while `#agents` still reports only the card x help overlap at 1440. The agents
grid does not reflow between 1440 and 1100. Raw:
`scratch/a1/out/probe1100-agents.txt`.

---

## Top 10 consolidations, ranked by payoff

Payoff = copies removed x (1 - consistency rating) x how many views it heals.

1. **`Tabs`** – collapse 7 tab strips (+ the mobile `.ag-menu`) into one component (Consistency 3 of 10;
   touches Agents, Teams, AgentInspector, GraphView, MapView, Workflows,
   SkillIndex, Contrast). Highest copy count in the app. S.
2. **`Seg`** – one segmented control, delete the `graph.css:10` vs `:187`
   override pair and the 4 modifiers; 14 instantiation sites. M.
3. **`EmptyState`** – 10 empty families, only one with a heading, nine without
   an action; heals nearly every view. S.
4. **`Chip`** – 14 chip families with duplicated tones (`.risk-pill` ==
   `.status-pill`). M.
5. **`Card`/`Panel`** – fix the **double `.card` definition**
   (`overview.css:13` vs `system.css:14`) and delete the dead `.kpi` block;
   the padding/animation leak is unconditional (only overview declares them),
   so this also fixes the `ag-card` x `sb-help` overlap measured at 1440, 1100
   and 390. S.
6. **`CanvasToolbar` + `Node` shell** – two React Flow node kits and four
   toolbars converge; fixes the tiny node targets and the 390 canvas overflow.
   L.
7. **`Button`** – fold `.tab-btn`, `.chip-btn`, `.pane-btn`, `.ag-mi`,
   `.crumb-link`, `.iso-chip` into `<Button>` variants; also fixes the
   long-label clip. M.
8. **`Row`** – 5 row types onto `.row-hover`, plus virtualisation for the
   2343-row list. M.
9. **`Dropdown`** – adopt the one good select over ~15 native `<select>`s.
   S.
10. **`Modal` + `Kbd` + `Breadcrumb`** – two bespoke modals, one `Kbd` token,
    two crumb systems; the smaller pair of the same story. S.

Expected named components to carry into F1: `Button`, `Tabs`, `Seg`, `Panel`,
`Card`, `Inspector`, `EmptyState`, `Chip`, `Row`, `Modal`, `SearchInput`,
`CanvasToolbar`, `Breadcrumb`, `Kbd`, and the shared `Node` shell.

## Hand-off notes for D1 and F1

- The single highest-value, lowest-risk fix is the `.card` double definition
  (item 5): one file, removes an app-wide animation leak and a measured
  overlap.
- `.kpi`, `.kpi-strip`, `.kpi-cell` in `overview.css:7-11,57-64` are dead –
  deleting them is free consolidation.
- Adopt `ui/Dropdown.tsx` and `ui/Window.tsx` patterns rather than writing new
  primitives; they are the two already-correct systems (Rating 8+).
- Test ids referenced by this audit: `ag-tabs`, `tc-limit-chip`, `ws-tabs`,
  `team-tab-delete`, `at-autonomy`, `at-block-chips`, `map-focus-chain`,
  `theme-seg`, `help-grid`, `win-dock`, `sb-dock`.
- Three keyboard defects F1 should fold into the `Tabs`/`Modal` work
  (§18.1): the phone menu `.ag-mi` is visible and focusable at 1440 so the nav
  is in the tab order twice; `div.card.ag-card` is `tabIndex 0` so each card
  costs two tab stops; and neither modal moves focus in or traps it (Tab
  escapes to `button.brand` behind the overlay).
- F1 should sanity-check its fix at **1100**, not just 1440/390: `#agents` at
  1100 has 8 probe problems (a whole workflow card column at `x 835-1134`) where
  1440 has 1. Any consolidation that only preserves 1440 behaviour ships that
  bug.
