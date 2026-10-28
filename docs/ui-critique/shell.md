# The kula shell: git, review, meta and the frame around them (UI critique, A4)

Scope: `web/src` shell and the views a developer actually lives in – Changes,
History, Branches & compare, Proposals (PRs and review), Issues, Notes,
Settings, plus the top bar, left rail, command palette, keyboard help and the
first-run card. Companion to `docs/ui-critique/vision.md` (that one is about
what the product lacks; this one is about what the product already ships and
how it fails).

Method: two shared servers, both already running, probed read-only at
1440x900, 1100x800 and 390x844, dark and light.

- `http://localhost:8071` – kula's own repo on `launch-prep` (1 changed file,
  748 files, 3249 symbols, 11032 edges, 661 clusters, 94 branches).
- `http://localhost:8072` – the e2e swarm fixture (PR #1 `feat/agent-scope` →
  `main` open, issue #2, three seeded notes, two uncommitted files).

Every claim below is a measured value from a probe, not a reading of a
screenshot: this reviewer cannot see pixels, so a finding is either a
`getBoundingClientRect`, a computed style, a DOM attribute, a scroll
extent or a probe-flagged `PROBLEM`. Screenshots are kept as artefacts for
a human to confirm the numbers, and are indexed at the end.

## The value function

kula's shell only earns its keep if a developer can complete the loop the
product claims – **change → look → decide → record** – (a) without leaving
the keyboard, (b) on whatever screen is in front of them, and (c) without
having to wonder whether the UI is telling them the truth. So:

> V = reachability × truthfulness × speed

*Reachability*: every pane a view opens is readable at the width you have.
*Truthfulness*: a control that is enabled does something; a control that
cannot do anything says so; the numbers shown are the numbers the repo has.
*Speed*: the keyboard is a first-class path, not an easter egg, and a list can
be walked without a mouse.

Measured against that, the shell is a genuinely good desktop git client and a
dishonest phone app. The desktop path (1440 and 1100) is coherent, dense,
fast and quiet. The 390 path is not a degraded version of it: it is a version
where **the content is deleted and the controls that would let you reach it
are still shown**.

## Layout map

```
┌───────────────────────────────────────────────────────────────────────┐
│ .topbar   brand ▸ chip(branch)   …   Back  Search  Settings           │  47px
├──────┬────────────────────────────────────────────────────────────────┤
│ .rail│ .view                                                          │
│  48  │  ┌─ .head (title, counts, view controls) ─────────────────┐    │
│  px  │  ├─ .split ───────────────────────────────────────────────┤   │
│      │  │  .list  (rows)          │ grip │  .detail (the content) │   │
│      │  └─────────────────────────────────────────────────────────┘   │
├──────┴────────────────────────────────────────────────────────────────┤
│ .statusbar  kula 0.3.0 · 748 files · 3249 symbols …   panel  ? help   │  26px
└───────────────────────────────────────────────────────────────────────┘
```

- `.split` is a two-column grid (`shell.css:35`); at `max-width: 760px` it
  becomes one column and `.split > .detail { display: none }` (`shell.css:72-74`).
- Rail groups (`App.tsx:52-77`): Overview, Graph, Flows, Workspace, then GIT
  (Changes `4`, History `5`, Branches `6`, Proposals `7`, Issues `8`, Notes
  `9`), then Agents `a`, Query `q`, and a hidden `0`.
- `1` = Overview, `y` = Workspace (map), `?` = keyboard sheet, `⌘K` = palette.
- Palette prefixes (`App.tsx:349-436`): `#` views and files, `@` symbols,
  `>` commands.

## What was walked

**The PR review, end to end, without merging (8072).** Opened `#proposals`,
selected PR #1, read the header block (Ahead 1 / Behind 17 / Files 2 / Symbols
changed 1 / Risk Low / Clusters affected `bench/mapping · names`), the
`CHANGED FILES` list (`src/guard.rs`, `src/memory.rs`, one `ƒ words` L87), the
`RIPPLES INTO` list (two dependent symbols, both `d1`/`d2` depth in
`src/bench/mapping/names.rs`), `COMMITS` (`fd0859c`), then typed a comment and
submitted it. Result: `DISCUSSION 1 · e2e · just now · "A4 review walk: read the
diff and the ripples. Not merging."`. After the walk the detail still reads
`open` and the `Merge` button is still present and enabled – verified twice
(`walk-review.txt`, `check2.txt`). The review flow itself is the best thing in
the shell: blast radius, cluster impact and fence report are on one card, and
the diff is one click deeper. It is calm, it is ordered, and nothing shouts.

**Create an issue (8072).** `#issues` → `New` → title, label `ux`, body, submit.
Landed as `#6 · e2e · just now`, list row immediately above the seeded `#2`, and
the form swapped to the reading pane with `Close issue` offered. No confirm
dialog, no surprise modal.

**Create a note (8072).** `#notes` → `New note` → set target to `[[Guards]]`,
title, body (`[[Guards]] still reads as a link.`), save. Landed as note #7,
`symbol:Guards` target intact, `[[link]]` syntax echoed back in the editor as a
live syntax hint. Notes are the cleanest CRUD surface in the app.

**Keyboard-only tour (8071).** `?` opens the sheet, `Esc` closes it. `4 5 6 7 8
9 y q a 1` all land on the right view. `⌘K` opens the palette, `>contrast` →
Enter lands on `#graph/contrast/HEAD/WORKTREE`. In History, `j` moves the
selection and the detail pane follows. This all works, and it works on the
first try with no documentation.

**First 60 seconds (8071, `sessionStorage.kula.opened` cleared).** The first-run
card assembles a dithered graph, prints `KULA` and "git, with a map", then
reports `748 files · 3249 symbols · 11032 edges · 661 clusters` and
`indexed in 408ms`. It closes on any key or click, or by itself after 3600 ms
(`Opening.tsx:20`). Behind it the app is already live.

## Ratings

| Axis | Score | Why |
|---|---|---|
| **Value** (V above) | **7 / 10** | Desktop: high. The review card, the graph check on the Changes pane and the note editor are real differentiators. Phone: near zero, because the content panes are removed. |
| **Clarity** | **6 / 10** | Labels are plain ("Branches & compare", "Suggest a task scope from what an agent touched") and jargon is kept out of the way. Lost points to the Back control and to `Needs review 0` next to 94 branches. |
| **Density / hierarchy** | **7 / 10** | At 1440 the type scale, 1px rules and mono labels give a genuinely readable hierarchy. The Branches list at 390 is 5184px of `Checkout` buttons – density with no hierarchy. |
| **Consistency** | **6 / 10** | One focus idiom for buttons, a different and invisible one for text fields. One `.seg` control is 28px on desktop and 40px on a phone for no reason. Toggles and `.seg` disagree on the hit floor. |
| **Interaction** | **5 / 10** | `j`/`k` works but is invisible and unreachable by Tab; the keyboard ordering is list-first with no way in from the outside. Back is a trapdoor. |
| **Robustness** | **4 / 10** | Back can navigate you out of the app to `about:blank` and stay there across reloads. A comment box lives under the statusbar at 1100x800. Detail panes are unreachable at 390. |
| **Polish** | **6 / 10** | The design contract holds almost everywhere: no shadows, no glow, no hover scale, square corners, spaced en dashes, zero em dashes in `web/src`. The failures are layout, not taste. |

## Ranked issues

### 1. Blocker – at 390px every detail pane is deleted, including the PR you just opened

`shell.css:72-74` sets `.split > .detail { display: none }` under
`max-width: 760px`. Measured on all six split views: `detail=none, list=390px`
(`check.txt`). `.detail` still renders into the DOM and still holds its text –
the probe reads `detailText="kula.tomlworking tree…@@ -1,12 +1,21 @@"` for
Changes and the full PR body for Proposals – it is simply not displayed.

So on a phone you can open PR #1 from the list and you will never see the
description, the changed files, the ripples, the commits or the comments. You
can select a commit in History and never see its diff. You can tap a note and
never read it. The app shows the affordance (the row is tappable, and a `Back`
button sits in the top bar) and withholds the destination.

Fix, at CSS and routing level: at `max-width: 760px` make `.split` a single
column whose two children swap rather than stack – a `data-pane="list|detail"`
attribute on `.view` driven by whether a row is selected, `display: none` on
whichever pane is not active, and a back affordance in `.head` that clears the
selection and sets `data-pane="list"`. The URL needs to carry it
(`#proposals/1`) so the phone's own back gesture and the top bar's `Back` agree.
Do not delete the pane; move to it.

### 2. Blocker – the Proposals comment box sits under the statusbar at 1100x800

Measured (`check.txt`, `p72-proposals-1100x800.txt`): textarea
`[424, 718, 648, 84]` → occupies y718–802. `.detail` clip bottom is 774.
The statusbar occupies `[774, 800]`. Result: `intersectsStatusbar: true`,
`insideClip: false`, and the probe raises two `PROBLEM`s – the textarea
overlaps `button.sb-help "panel"` and `button.sb-help.sb-keys "? shortcuts"`.
At 1100 the box's top half scrolls out of `.detail` (`scrollH 814` vs
`clientH 726`) and its bottom 28px is painted behind the statusbar.

At 1440 the same element measures `[673, 757, 424, 1412]` against a clip
bottom of 874: `insideClip: true`, no problem. So this is a height-dependent
bug that a 1440-only review would never catch, and 1100x800 is a normal
laptop.

Fix: make `.detail` a flex column with the composer as a non-scrolling last
row and `.detail`'s scrollable body as `flex: 1; min-height: 0`; the view grid
then needs a `padding-bottom` equal to the statusbar height, or the statusbar
needs to be a grid row rather than an overlay. Also give the statusbar an
opaque background and check its `z-index` against `.detail`, so a future
overflow fails visibly instead of silently.

### 3. Blocker – the top bar's `Back` is enabled when it cannot work, and it lies

Fresh session, one `goto('#changes')`, then click `Back`: the app leaves to
`about:blank`, and `F5` keeps you at `about:blank` (`check2.txt`:
`Back on arrival: #changes -> #notes`, `after F5: about:blank crumb=undefined`).
After an in-app navigation (`1` → `2`, then `Back`) the same button works and
returns to the previous view. The button's `enabled` is `true` in both states –
there is no disabled or would-leave presentation, and its ARIA is a plain
button, so a screen reader is told nothing either.

The cause is the obvious one: it calls `history.back()` with no knowledge of
whether this app put anything on the stack. A deep link, a bookmark, a
palette result or a refresh all leave the control armed and pointed at
whatever came before kula.

Fix: keep the app's own navigation stack (push on every route change, cap it
at ~50), render `Back` as `disabled` with `aria-disabled="true"` when the stack
is empty, and never call `history.back()` unless the app pushed. Label it
`Back` with a `Tip` that says "back in kula" so it is not mistaken for the
browser's own control.

### 4. Major – text inputs have no visible focus indicator at all

`system.css:41-42` establishes one honest global rule,
`:focus-visible { outline: 2px solid var(--accent) }`, and then deletes it for
exactly the two controls that need it most:
`.input:focus-visible, .textarea:focus-visible { outline: none }`. The
compensating border colour in `base.css:19`
(`.input:focus, .textarea:focus { border-color: var(--accent-text) }`) **does
not apply**. Measured on the commit textarea and the History filter
(`check2.txt`):

```
blurred: outline none 3px · border 1px rgb(51, 45, 40) · shadow none
focused: outline none 3px rgb(240, 235, 227) · border 1px rgb(51, 45, 40) · shadow none
```

The border is `rgb(51, 45, 40)` – `--line-2` – in both states. Tab order at
`#changes` is 23 stops; stops 22 and 23 are the two fields, and 22 of 23 stops
show a 2px orange ring while the two you can type into show nothing. The
theory-of-focus comment in `system.css` says "Inputs focus with a border
shift" – the shift is not happening.

A second defect is latent behind the first: `--accent-text` is `#a83a00` in
light while `--accent` is `#F05201` (`tokens.css:57`). If the border shift ever
starts working, focus colour will differ between themes for no reason a user
can infer.

Fix: delete the `.input:focus-visible, .textarea:focus-visible { outline: none }`
override, or replace it with a ring that is visible on both grounds
(`outline: 2px solid var(--accent); outline-offset: -2px` inside the field, plus
`border-color: var(--accent)`). Then make `--accent-text` equal `--accent` or
document why it differs.

### 5. Major – the keyboard sheet at 390 is clipped, and it is the scrim that scrolls

`check2.txt`: `.palette.help` sits at y186–844, `scrollH=1126 clientH=656
overflowY=hidden`. `check.txt` adds: the inner grid is 1069px tall,
`overflowY=visible`, laid out in two columns of `170px 170px`, 27 rows – at a
390px viewport. The sheet's own scroll extent (`scrollTop` max 470) is only
reachable because the `.scrim` behind it scrolls, which means the modal is not
scrolling: the backdrop is, dragging the sheet with it.

Two bugs in one: a two-column keyboard table at phone width produces ~11px of
horizontal room per verb, and the scroll container is the wrong element.

Fix: at `max-width: 760px` collapse `.help` to one column
(`grid-template-columns: 1fr`), give the sheet itself
`overflow-y: auto; overscroll-behavior: contain`, cap its height to
`100dvh - <topbar> - <statusbar>`, and make `.scrim` non-scrolling. Keep the
`Esc` hint pinned at the sheet's bottom so it is always reachable.

### 6. Major – keyboard selection is invisible, and list rows are not reachable by Tab

`walk-keys.txt`: `j` in History moves the selection from
`docs: vision gaps and missing features` to `UI: one tab strip for Agents…`
and `focus outline on the selected row: outline=none 3px boxShadow=none`.
`check2.txt`: `history .item tabIndex: DIV:-1:role=null` for every row.
Tab order at `#changes` contains 23 stops, all of them chrome (brand, chip,
Back, Search, Settings, eleven rail buttons, Refresh, Stage all, verifier,
textarea, checkbox) – not one list row.

So the two inputs a keyboard user has contradict each other. The global
shortcut model says the list is the point; the tab order says the list does
not exist. And when you use `j`, the only feedback is a background tint that
the probe measures as no outline and no shadow, so on a dense list you cannot
tell which of 40 rows is live.

Fix: give `.item` `tabindex="0"`, `role="option"` inside a
`role="listbox"` `.list`, `aria-selected` for the current row, and a visible
selected style that is not colour alone – a 2px `--accent` left rule plus
`outline: 2px solid var(--accent); outline-offset: -2px` on `:focus-visible`.
Keep `j`/`k` as an accelerator, not as the only route in.

### 7. Major – the Branches sheet at 390 is a 5184px column of identical buttons

`p71-branches-390x844.txt`: 107 controls, of which 94 are
`button.btn.sm "Checkout" [297, 40, 80, 40]` – one per local branch, all
rendered at once, the last at y 5131. Two `PROBLEM`s are raised in the same
probe:

- `off-screen: span.sub.mono "stash@{0}: WIP on team/fuse3-u" at x 12–881`
- `off-screen: span.sub.mono "stash@{1}: WIP on team/a2: 12c" at x 12–868`

The stash subject lines are ~870px wide in a 390px viewport with no ellipsis,
so they run under and past everything. And the last `Checkout` at `[297, 40]`
with y 5131 collides with `button.sb-help "panel" [317, 805, 66, 40]` on the
way – the probe flags the overlap.

Fix: three small ones. `span.sub.mono { max-width: 100%; overflow: hidden;
text-overflow: ellipsis; white-space: nowrap }` for the stash rows. Reveal
`Checkout` on hover/focus-within (or collapse the row actions into a single
`⋯` menu) so the list is not 94 identical primary buttons. And put
`padding-bottom: <statusbar + sb-help height>` on the branch scroller so no row
can land under the floating help button.

### 8. Minor – the Notes graph toggle is below the desktop hit floor

`check.txt`: `notes toggle: 90x26 aria-pressed=null`, and `p72-notes-*` and
`p72-overview-*` both raise it as a problem at 1440 and at 1100. The control
renders as `BUTTON.tgl on sm role=switch aria-checked=true` – so it already
knows it is a switch, it is just 26px tall where every other desktop control in
the shell is 28px or more (`--ctl-h` family in `base.css`), and where the
phone floor used elsewhere in the app is 40px.

Fix: give `.tgl` `min-height: var(--ctl-h)` (28px) at desktop and the 40px
phone floor at `max-width: 760px`, matching `.seg`. While in there: the probe
sees `aria-pressed=null` on a `role="switch"`, so the ARIA contract is
half-implemented – `role="switch"` wants `aria-checked`, which it has, so drop
the `aria-pressed` expectation and make sure the label is associated.

### 9. Minor – the same `.seg` control is 28px on desktop and 40px on a phone

`check.txt`: `issues .seg button heights @1440: Open:28, Closed:28` and
`@390: Open:40, Closed:40`. Both come from `graph.css` – `height: 28px` at the
desktop rule (`:192`) and `height: 40px` under `@media (max-width: 760px)`
(`:216`). The intent (a bigger target on touch) is right; the implementation
makes the control change shape between viewports, so a layout tuned on desktop
is not the layout you get on a phone, and every future `.seg` has to remember
the magic numbers.

Fix: one `min-height: var(--ctl-h)` on `.seg button` with `--ctl-h` overridden
once at the phone breakpoint (the app already has this pattern in
`base.css` via `--ctl-h`/`--ctl-h-sm`). One declaration, one place to change.

### 10. Minor – the palette footer wraps into a 52px second row at 390

`check.txt`: `palette @390: palette 358x545 at y101; footer 356x52
scrollW 356 overflowY=visible wrapped=true; results visible 7`. Six hint
groups plus `esc` cannot fit on one line at 356px, so the footer silently
becomes two lines – which is 52px of a 545px sheet spent on hints, and it makes
the sheet's own height jump depending on the width.

Fix: at `max-width: 560px` keep one line only (`↑↓ move · ↵ open · esc close`)
and hide the rest; or make the footer a deliberate two-row block with
`row-gap` and a fixed height so nothing below it moves.

### 11. Minor – `Needs review 0` next to 94 branches reads as a lie

On 8071 the Overview pane reports `Needs review 0` and `All proposals –
Nothing waiting. Open a proposal from Branches or kula pr new.`, while
`#branches` lists 94 local branches and the Branches view offers to compare
every one of them against `main`. The second sentence is honest and helpful; the
first number is the problem, because "Needs review" is a status, not a
count of a thing the user can see. Someone arriving from a forge reads 0 and
concludes the queue is empty rather than that nothing has been proposed.

Fix: label it as what it counts (`Open proposals 0`), or make the number a link
into `#proposals` so 0 has a destination. Do not change the copy below it – it
already does the work.

### 12. Minor – the Changes composer is offered on a clean tree and pollutes the tab order

`check.txt`: `changes @8071: rows=1 … commitDisabled=true`, and the tab walk
shows the commit textarea as the **22nd stop** and the "Amend" checkbox as the
23rd, on a worktree where there is nothing to commit. The pane correctly says
`Working tree clean / Nothing to commit.` and correctly disables `Commit`, then
asks you to tab through a composer you cannot use.

Fix: when nothing is staged, render the composer `disabled` and `inert`, or
omit it and let `Stage all` be the only control. The disabled `Commit` already
tells the truth; the textarea in front of it does not need to.

### 13. Minor – the first-run card can be missed entirely and is not the tour it wants to be

`Opening.tsx:20` closes on a 3600 ms timer as well as on any key. It shows
`KULA`, "git, with a map", a cycling set of index facts and "press any key" –
it never says what to do first. It is gated on `sessionStorage.kula.opened`, so
a developer who looks away for four seconds, or who reloads, gets a plain
`#changes` with no idea what this app is for. The only way to see it again is
Settings → "Opening sequence", which is exactly where a first-time user would
not look.

Fix: drop the auto-close timer (close on key/click only), keep it skippable,
and use its last two lines to give one action: "press 4 for Changes, ? for
keys, ⌘K to search". Add `>opening` to the palette so it is replayable from
the keyboard.

### 14. Nit – WebGL warnings on unrelated pages

`GL Driver Message … GPU stall due to ReadPixels` appears in the console on
`#notes` and during the first-run card, both of which draw an ascii/dither
effect. Harmless, but it lands in the console of the one app whose whole pitch
is talking to agents that read consoles.

Fix: gate the pixel readback behind a debug flag, or log it at debug level so a
clean console means something.

### 15. Nit – the Branches view is a wall of unlabelled `Checkout`

Folded into #7, but worth naming on its own for desktop: at 1440 the Branches
list still shows a `Checkout` button per row regardless of state, so a branch
you are already on, a branch 91 commits behind and a stash entry all offer the
same action in the same weight. The `main – ahead 37, behind 91` row is the
only row that communicates its state, and only because the seed data happens
to have a divergence string.

Fix: suppress `Checkout` on the current branch (show `current`), and let
`ahead/behind` be a small coloured count rather than prose.

## What the shell gets right

Worth protecting while the above is fixed:

- **The review card.** Ahead/Behind/Files/Symbols/Risk/Clusters, the changed
  files with symbol line numbers, the ripples with depth, the commits, the
  discussion – one screen, no tabs, no accordions. Nothing else in the local
  git-client space shows blast radius next to a diff.
- **The graph check on Changes.** `verify-head` renders `no symbol moved` or
  `2 fenced files` inline with the diff, before you commit. It is the product's
  thesis made visible at exactly the moment it matters.
- **The keyboard map.** `1`/`4`–`9`/`y`/`q`/`a`, `?`, `⌘K`, `j`/`k`. One
  keystroke per destination, no modifier, and the numbers follow the rail
  order so you learn the rail by using the keyboard.
- **The palette prefixes.** `#` views and files, `@` symbols, `>contrast`
  commands. `>contrast` → Enter landing on
  `#graph/contrast/HEAD/WORKTREE` in one gesture is the fastest path to the
  app's headline feature.
- **The note editor.** `[[link]]` targets rendered as live syntax, per-target
  colouring, `symbol:`/`file:`/`repo`/`agent:` targets that round-trip. It
  reads like a tool, not like a form.
- **The design contract.** Zero em dashes anywhere in `web/src`; spaced en
  dashes in prose; no decorative shadow, no glow, no hover scale; 1px warm
  lines on an absolute-black ground; mono labels. It is a real visual
  identity and it is held consistently across all six views.

## Evidence index

Measurements: `.kula-team/scratch/a4/check.txt`, `check2.txt`,
`walk-review.txt`, `walk-issue.txt`, `walk-note.txt`, `walk-keys.txt`,
`walk-palette-dark.txt`, `walk-firstrun.txt`, `p71-*.txt` (8071),
`p72-*.txt` (8072), `probe-*.txt` (first pass).

All 49 screenshots in `docs/ui-critique/shots/`, by group:

- **Overall shell** – `a4-shell-1440x900-dark.png`, `a4-shell-1440x900-light.png`,
  `a4-shell-1100x800-dark.png`, `a4-shell-1100x800-light.png`,
  `a4-shell-390x844-dark.png`, `a4-shell-390x844-light.png`
- **Changes** – `a4-changes-1440x900-dark.png`, `a4-changes-1440x900-light.png`,
  `a4-changes-1100x800-dark.png`, `a4-changes-1100x800-light.png`,
  `a4-changes-390x844-dark.png`, `a4-changes-390x844-light.png`
- **History** – `a4-history-1440x900-dark.png`, `a4-history-1100x800-dark.png`,
  `a4-history-390x844-dark.png`
- **Branches** – `a4-branches-1440x900-dark.png`, `a4-branches-1100x800-dark.png`,
  `a4-branches-390x844-dark.png`
- **Proposals** – `a4-proposals-1440x900-dark.png`,
  `a4-proposals-1440x900-light.png`, `a4-proposals-1100x800-dark.png`,
  `a4-proposals-1100x800-light.png`, `a4-proposals-390x844-dark.png`,
  `a4-proposals-390x844-light.png`
- **Issues** – `a4-issues-1440x900-dark.png`, `a4-issues-1100x800-dark.png`,
  `a4-issues-390x844-dark.png`
- **Notes** – `a4-notes-1440x900-dark.png`, `a4-notes-1100x800-dark.png`,
  `a4-notes-390x844-dark.png`
- **Palette** – `a4-palette-1440-dark.png`, `a4-palette-1100x800-dark.png`,
  `a4-palette-390x844-dark.png`, `a4-palette-390-typed-dark.png`
- **Keyboard** – `a4-keys-1-help-dark.png`, `a4-keys-2-palette-dark.png`,
  `a4-keys-3-history-after-j-dark.png`
- **Review walk** – `a4-review-1-list-dark.png`, `a4-review-2-detail-dark.png`,
  `a4-review-3-commented-dark.png`
- **Issue walk** – `a4-issue-1-list-dark.png`, `a4-issue-2-form-dark.png`,
  `a4-issue-3-filled-dark.png`, `a4-issue-4-created-dark.png`
- **Note walk** – `a4-note-1-list-dark.png`, `a4-note-2-editor-dark.png`,
  `a4-note-3-saved-dark.png`
- **First run** – `a4-firstrun-1-opening-dark.png`, `a4-firstrun-2-after-dark.png`
