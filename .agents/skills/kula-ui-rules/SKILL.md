---
name: kula-ui-rules
description: Visual rules for every kula web UI change. Read before touching web/src.
---
- Shared primitives live in web/src/ui.tsx, web/src/motion.tsx and web/src/canvas/; reuse them before adding new ones.
- Palette: absolute black bg, orange accent (tokens.css). Font: JetBrains Mono everywhere, tabular numerals.
- Never change button dimensions, at any screen size. Restyle only.
- Mode switches are button toggles (Segmented / icon toggles), not underline tabs.
- Icons wherever possible, each with tooltip + aria-label; glyphs come from the Icon set in ui.tsx.
- Look: sharp corners and hairlines, dither + code aesthetic, canvas backdrop, crisp glow (hairline ring + hard halo). No blur, liquid or metallic sheen.
- Less info dump: essentials first, detail behind hover cards, expanders, sheets, megamenus.
- No em dashes in UI copy; short labels.
- Motion 120 to 240ms ease-out; honour prefers-reduced-motion.
- Keep data-testid, aria and roles; if one must change, update web/e2e/ui.spec.ts in the same commit.
