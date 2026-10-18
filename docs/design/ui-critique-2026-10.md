# UI critique – October 2026 (lead review before ship)

Reviewed on the homonin-scripts map (629 files, 255 blocks, 4 127 symbols)
at 1440x900, after the flow canvas work (PR #6). Ranked by user cost. The
principle behind most of it: **kula shows everything at once. It should show
the one thing you need and put the rest one click away** – menus, popovers,
collapsed sections, details on selection.

## Whole app

1. **Everything is visible, nothing is prioritised.** Every view opens with
   every control, filter and list expanded. There is no primary action per
   view and no progressive disclosure. Rule from now on: one primary action
   per view, secondary actions in a menu, detail on selection.
2. **The left rail is 14 unlabelled icons.** No labels, no grouping that
   reads, tooltips only on hover. New users cannot find the map or agents.
   Group the rail (Code · Map · Agents · Git · Settings) with labels on
   hover-expand, or a labelled megamenu on the logo.
3. **Overview is empty space.** Six tiny rows top left, two empty cards at the
   bottom, a blank middle. It should answer "what is this repo and what needs
   me" in one screen: the map's pipeline headline, what changed, what is
   waiting – each row clickable into its view.
4. **Density without hierarchy.** 13–14 px mono everywhere, uppercase labels
   everywhere, every box the same 1 px border. Titles, primary values and
   actions need size and weight steps; labels should recede.
5. **Long lists are never collapsed.** The map sidebar dumps 255 blocks and
   their 4 205 functions as an open tree.

## Map tab

Fixed by the lead in `1fa74bb` (keep it):
- Sections are laid out as **pipeline columns** (entry → steps → terminal,
  shared utilities last) in the kit's new preset layout mode, instead of
  dagre stacking everything into one 10 % column.
- Sections start **collapsed** to one coloured wide node; `+` on the hover
  toolbar or double-click opens a section into a frame of its blocks;
  "open all / close all" replaces "depth 1/2".
- Only forward flows, two heaviest per section; no forced tie-up edges.
- Nodes are **tinted by role** (n8n-style), with role-coloured left edges.

Still wrong:
6. **The toolbar is 13 flat buttons** (functions, utilities, all, flow,
   capabilities, blocks, chains, expand, open all, roles, hide tests,
   re-layout, pin) mixing lenses, filters and actions; it overflows at
   1100 px. Want: a lens segmented control (Flow · Capabilities · Blocks ·
   Chains) on the left, search, and one "View" popover holding filters,
   roles, hide tests, re-layout and pin. Selection actions (expand, pin) live
   on the node toolbar and in the sidebar, not the global bar.
7. **The sidebar shows structure before meaning.** Selected-thing details
   should come first and the block/function tree should be collapsed by
   default behind a "Browse" section with search.
8. **Capabilities lens: unlabelled bars.** 24 lanes of tiny grey tiles with no
   names at fit zoom. Lane label left, entry → terminal, nodes coloured by
   role, lanes collapsed beyond the top 8.
9. **No canvas affordances a user expects from n8n:** no edge labels (chain
   count), no hover highlight of a node's connections, no "+" between nodes,
   no right-click menu. At minimum: hover a node → its edges and neighbours
   light up, the rest dims; edge labels on hover.
10. **Code panel carries a decorative drop shadow** (`code.css` `.code-panel`
    box-shadow), against the design language. Replace with the 1 px line.

## Agents tab

11. **Ten sub-tabs** (Overview, Workflows, Research, Teams, Skills, Fences,
    Memory, Docs, Connect + nested tabs) – the tab bar is the navigation
    model and it does not scale. Group into four: **Overview · Build**
    (Workflows, Teams, Skills) **· Run** (Research loops, live tasks) **·
    Knowledge** (Memory, Docs) – with Fences and Connect under a Setup menu.
12. **Teams canvas:** group frames overlap (Explore and Tests frames sit on
    top of each other); every member's name is printed twice (in the card and
    under it); the legend is a separate strip. Frames must not overlap, one
    label per node, legend in the sidebar.
13. **Research is cards + a static 6-step strip.** It should be a canvas
    pipeline (research → hypothesis → edit → experiment → keep/revert →
    remember) with the metric cards as a picker in the sidebar.
14. **Memory is an empty form and a sentence.** Empty states should teach the
    one action (add a memory) and show what it will look like.
15. **Orchestration is not visible.** Nothing on the agents tab shows a team
    actually running: who is working, on what, hand-offs, spend. A live run
    view (the team as a canvas with running/success/error marks and a feed in
    the sidebar) is the feature that makes agents worth a tab.
16. **Editing is form-first.** Workflow and team edits are long forms under
    the canvas. Edits should start from the canvas (select a node → edit in
    the sidebar), with the full form behind "Edit all".

## Ship readiness

17. `A2.1` roster test is flaky: other tests register agents on the shared
    fixture in parallel (expects 4 rows, sees 6). Isolate or serialise.
18. No release pass yet on this branch: version, changelog, release build,
    screenshots in the README, phone (390 px) probe of every view.
