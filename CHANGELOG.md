# Changelog

## Fuse 5 – wave 3 (UX finishing)

### Map
- New map settings popover (gear in the map toolbar): layers, colour scheme, edge density (few / normal / full), label density, minimap and snap-to-grid, Tidy, Undo, Reset layout and Clear pin – all remembered in `kula.map.settings`. The scattered toolbar controls it replaces are gone.
- The map restores the viewport (zoom + pan) you left it at, per layout, instead of drilling back to the landing zoom.
- Map canvas reserves space for the transport bar and statusbar on a phone; HUD controls get a 40px touch floor at phone width.

### Agents
- The agents sub-nav is a thin icon tab bar at every width (was a 180px text column on desktop); on a phone the "Agents" title merges into the tab row.
- The keyboard-shortcuts statusbar button is hidden on phones (keyboard-only affordance); minor detail-pane padding trimmed.

### Settings
- Theme is a labelled three-way Light / Dark / System segment (was an unlabelled glyph), and "System" now follows `prefers-color-scheme` correctly.
- At phone width the settings window opens as a full-height sheet with wrapping subtitles instead of clipping row text.
- Row controls are consistently right-aligned; the maximized-window 100vmax shadow is gone.

### Shell
- Deep links survive the splash: `#workspace` aliases to `#map`, every view keeps its initial hash.
- Light theme contrast: `--lt-text-3` raised to ≈4.9:1, and accent-as-text uses a darker light-theme shade (`--accent-text`) across the UI.
- Loading states get padding; stale rail tooltips are suppressed for a beat after navigating; the team "+" button style is a filled grey square matching the rest.

### Docs and tests
- `docs/design/fuse5.md` records the space audit (each removal with px saved), sign-off and known gaps.
- e2e: new `x14-finishing.spec.ts`; visual baselines regenerated at the end of the wave.
