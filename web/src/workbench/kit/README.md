# workbench kit

S1 – Tailwind v4 + shadcn + 21st.dev picks, themed to kula. Everything in
`web/src/workbench/kit/` is scoped: it renders inside a wrapper with class
`kwb-theme` and never leaks into the legacy views.

## Wiring

- `web/vite.config.ts` – `@tailwindcss/vite` plugin, aliases `@` → `src` and
  `#own-styles` → `src/styles`.
- `src/styles.css` line 2 – `@import "./workbench/kit/theme.css";` (imports
  sit at the top because CSS requires it).
- `theme.css` – loads `tailwindcss/theme.css` (reference) and
  `tailwindcss/utilities.css` only. **Preflight is deliberately not
  imported**, so the legacy views cannot shift. Tokens live under
  `.kwb-theme`; `@theme inline` maps them onto Tailwind color utilities.

## Theme tokens (kula variant)

Black `#000000` page, warm greys (`#0c0b0a` card, `#141210` secondary/muted,
`#24201d` border/input), one accent `#ff5a1f` (primary, accent, ring, chart-1),
`--radius: 0rem` on every level, JetBrains Mono forced on all kit markup.
These mirror `src/styles/tokens.css` values without touching them.

## shadcn primitives

All generated with `npx shadcn@latest add` (new-york style), then left in
place under `src/workbench/kit/`:

| file | exports |
|---|---|
| `badge.tsx` | `Badge` |
| `button.tsx` | `Button`, `buttonVariants` |
| `collapsible.tsx` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| `command.tsx` | `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandSeparator` |
| `context-menu.tsx` | `ContextMenu*` set |
| `dialog.tsx` | `Dialog*` set |
| `input.tsx` / `textarea.tsx` | `Input` / `Textarea` |
| `resizable.tsx` | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` |
| `scroll-area.tsx` | `ScrollArea`, `ScrollBar` |
| `select.tsx` | `Select*` set |
| `separator.tsx` | `Separator` |
| `sheet.tsx` | `Sheet*` set |
| `table.tsx` | `Table*` set |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `toggle.tsx` / `toggle-group.tsx` | `Toggle`, `toggleVariants` / `ToggleGroup`, `ToggleGroupItem` |
| `tooltip.tsx` | `Tooltip*` set |
| `lib/utils.ts` | `cn` (clsx + tailwind-merge) |

Notes:

- `resizable` uses **react-resizable-panels v2** (pinned `^2.1.9`). v4 of the
  library renamed the primitives (`Group`/`Separator` →
  `PanelGroup`/`PanelResizeHandle`); the wrapper maps the shadcn API onto v2.
- The tailwind theme is scoped to `.kwb-theme`, so a kit component outside
  that wrapper loses its tokens. Always mount kit UI under a
  `<div className="kwb-theme">`.

## 21st.dev picks (vendored, MIT)

| kit dir | upstream pick | kula variant |
|---|---|---|
| `file-tree/` | TreeView by romanhaendler/umriss-ui (21st.dev) | radius 0, hairline greys, accent selected row, chevron folder collapse via shadcn `Collapsible`. `FileTree({ nodes, selectedId, onSelect, defaultOpenIds })`. |
| `code-view/` | code-block by bigbullui (21st.dev) + blame gutter added here | line-number table, diff line kinds (`add`/`del`/`mod`), optional blame gutter (`author · rev · date`). `CodeView({ lines, blame, showBlame, path })`. |
| `lane-chart/` | gantt-lite by bigbullui (21st.dev) | CSS-grid lanes × slots, radius 0 bars, accent start bar, dimmed continuation. `LaneChart({ lanes, tasks, slots })`. |

The 21st.dev registry (`/r/`) is auth-gated, so sources were vendored from the
authors' public repos (same code, MIT) and re-themed; test ids
(`kwb-file-tree`, `kwb-code-view`, `kwb-lane-chart`, `code-line-*`,
`lane-bar-*`) were added for e2e.

## Usage

```tsx
import { kwb } from "@/workbench/kit/theme" // or plain <div className="kwb-theme">
<div className="kwb-theme">
  <FileTree nodes={tree} onSelect={setSel} />
  <CodeView lines={lines} blame={blame} showBlame />
  <LaneChart lanes={lanes} tasks={tasks} />
</div>
```

## Demo + e2e

- `KitShowcase.tsx` renders all three picks plus representative primitives.
- `kit-demo.html` is a dev-only entry (`/kit-demo.html`); it is not part of
  the app build.
- `web/e2e/wbkit.spec.ts` spawns its own vite on port 5199 and asserts the
  showcase mounts, the tree selects, blame toggles and the lane bars render.
