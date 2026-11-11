# n8n, dissected – and what the Workspace takes from it

October 2026. n8n's editor is the reference for the Workspace: one canvas,
blocks added from a side panel, Run at the bottom, a logs panel under the
canvas and a details view per block. This file takes the editor apart, maps
each part to kula's version, and tracks parity. **When a row is done it moves
to "Shipped" and leaves the open list**; when the open list is empty, the
reference has done its job and this file goes.

Sources: n8n docs (keyboard shortcuts, sticky notes, the canvas and logs
experiments in the community forum), and the editor itself.

## Anatomy of the n8n editor

| Region | n8n | Workspace |
| --- | --- | --- |
| Canvas | Vue Flow, dot grid, nodes left → right | React Flow kit (`web/src/flow`), the code map below, the pipeline lane above |
| Node | 100 px square, icon centred, name under, D-shaped triggers | Tile (96 px), kind icon, name and section under, D-shaped triggers |
| Run state | spinning border, green border + check, red border + warning | `fc-is-running` sweep, `fc-is-success`, `fc-is-error` |
| Wires | bezier, item counts after a run, green once passed, hover shows `+` and delete | bezier, marching while data moves, green / red, hover `+` inserts |
| Empty output | a `+` stub opens the node panel | the stub on the last block opens the panel to append |
| Node panel | right side, search first, category → subcategory slides, keyboard | the same: `N`/Tab, search, Triggers · Agents · Crews · Loops · Gates · Flow, ↑↓ ↵ esc |
| Hover toolbar | execute step, deactivate, delete, more | run from here, deactivate, delete, done (waiting agent) |
| Context menu | open, execute, rename, deactivate, pin, copy, duplicate, delete; pane: add node, sticky, paste | the same set, minus pin; pane adds run and undo/redo |
| NDV | input · parameters · output | input (the fence or the previous block's output) · parameters · output (its log lines) |
| Run button | bottom centre, "Execute workflow" | a transport (after IDE debug bars and sema): run, pause/continue, step, re-run failed, stop, state, clock, the waiting agent's "done"; F5 · F8 · F10 · ⇧F5 |
| Logs panel | bottom, overview tree + per-node input/output | the dock's Run log: run tree with times, filter to one block |
| Executions | tab with past runs | the Live sidebar's Executions list, expandable per block |
| Sticky notes | markdown, 7 colours, Shift+S | text, 7 colours, Shift+S, drag to place |
| Shortcuts | N, Tab, ⌘↵, D, Del, F2, ⌘C/⌘V, ⌘Z, 1 fit, 0 reset, ± zoom, Shift+S | all of these |
| Canvas controls | fit, zoom in/out, reset, tidy | fit, zoom, tidy, reset, lock, minimap |

## Where kula differs on purpose

- **The data is the code.** An n8n node transforms items; a Workspace block
  acts on a *section* of the repo. The dashed wire from a block down to its
  section is the item flow – the fence it may edit.
- **Agents are not run by kula.** An agent block opens a fenced task and waits
  for a connected agent (MCP and hooks). n8n executes nodes itself.
- **Gates are kula's checks** (`verify`, `check`, `status`), and a failed gate
  can loop back through *Retry until pass* – n8n has no first-class retry loop.
- **Order is the lane.** Blocks run left to right; dragging a wire from a
  block onto a section re-targets it, dropping it on empty canvas opens the
  panel to insert after it.

## Open

- [ ] Multi-select and bulk actions (marquee works; actions act on one block)
- [ ] Pin a block's output (P) – replay a run without the agent
- [ ] Group / ungroup blocks (⌘G)
- [ ] Markdown in stickies; resize handles
- [ ] Launch a headless agent from an agent block (`kula run`) – needs a permission decision

## Shipped (October 2026)

Node panel with category slide and keyboard · square tiles with run rings ·
wire run states · `+` on wires and stubs · connectable handles (block → section,
block → empty canvas) · right-click menus · NDV · Run / Stop / Done bar ·
logs panel with run tree · executions history · deactivate · undo/redo ·
copy/paste/duplicate · stickies · n8n's shortcut set · wire counts after a run · hover lights a node's wires · fit once per layout
(the viewport is the user's).
