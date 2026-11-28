import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { relTime, type Node } from "./api";
import { GLYPH, kindColor } from "./colors";
import { nodeTarget, useCode } from "./CodePanel";
import { markPath, N } from "./mark";

// ---------- icons ----------
// One grammar on a 24 grid, 1.5 stroke: rounded squares are structure (files,
// hubs, heads), circles are points in time or graph nodes, a filled mark is
// "you are here". Mirrors the graph, where hubs are square tiles.
const P = { className: "ico", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  // research templates: one glyph each, the moving part in the accent
  stopwatch: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="13.5" r="7.5" /><path d="M10 3h4M12 3v3" /><path d="M12 13.5 15.5 10" stroke="var(--accent)" /></svg>),
  passing: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 6l5 5M9 6l-5 5" /><path d="M12.5 15.5l3 3 5.5-7" stroke="var(--accent)" /><path d="M10 13.5H4" strokeDasharray="1.5 2" /></svg>),
  sweep: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 7h11M4 12h8M4 17h5" /><path d="M14 19l6-9M17 19h4" stroke="var(--accent)" /></svg>),
  types: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M8 4c-2 0-3 1-3 3v2.5c0 1-1 2.5-2 2.5 1 0 2 1.5 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1 1 2.5 2 2.5-1 0-2 1.5-2 2.5V17c0 2-1 3-3 3" /><path d="M9.5 9h5M12 9v7" stroke="var(--accent)" /></svg>),
  coverage: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 8 8h-8z" fill="var(--accent)" stroke="none" /></svg>),
  package: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /><path d="M8 5.25l8 4.5" stroke="var(--accent)" /></svg>),
  gauge: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-6" stroke="var(--accent)" /><circle cx="12" cy="17" r="1.4" fill="currentColor" /></svg>),
  isolate: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="3" stroke="var(--accent)" /></svg>),
  box: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="7" width="17" height="10" /><path d="M7 7v10" /></svg>),
  home: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="7" height="7" fill="currentColor" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg>),
  graph: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" /><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="20" r="2" /></svg>),
  map: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" /><path d="M9 4v14M15 6v14" /></svg>),
  changes: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="16" height="16" /><path d="M12 7.5v6M9 10.5h6M9 16.5h6" /></svg>),
  history: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 3v5.5M12 10.5v3M12 15.5V21" /><circle cx="12" cy="9.5" r="1.1" fill="currentColor" /><circle cx="12" cy="14.5" r="1.1" fill="currentColor" /><circle cx="12" cy="9.5" r="2.5" /><circle cx="12" cy="14.5" r="2.5" /></svg>),
  branches: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="7" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><rect x="15" y="6" width="4" height="4" /><path d="M7 7v10M17 10c0 4-3 5-10 7" /></svg>),
  compare: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="3.5" width="11" height="11" /><rect x="9.5" y="9.5" width="11" height="11" strokeDasharray="2.2 2.2" /><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" stroke="none" /></svg>),
  issues: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="8.5" /><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor" /></svg>),
  pr: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><rect x="16" y="16.5" width="4" height="4" /><path d="M6 7.5v9M18 16.5V9a3 3 0 0 0-3-3h-4" /><path d="m13 3.5-2.5 2.5L13 8.5" /></svg>),
  notes: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4" /><path d="M8.5 12h7M8.5 15.5h4" /></svg>),
  flows: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="5" cy="6" r="2" /><path d="M7 6h7.5a3.5 3.5 0 0 1 0 7h-5a3.5 3.5 0 0 0 0 7H19" /><path d="m16.5 17.5 2.5 2.5-2.5 2.5" /></svg>),
  console: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3" y="4" width="18" height="16" /><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" /></svg>),
  search: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>),
  close: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 6l12 12M18 6 6 18" /></svg>),
  refresh: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>),
  plus: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 5v14M5 12h14" /></svg>),
  minus: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 12h14" /></svg>),
  fit: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>),
  target: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></svg>),
  gear: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M18.88 9.87L21.36 10.39L21.36 13.61L18.88 14.13L18.37 15.36L19.76 17.48L17.48 19.76L15.36 18.37L14.13 18.88L13.61 21.36L10.39 21.36L9.87 18.88L8.64 18.37L6.52 19.76L4.24 17.48L5.63 15.36L5.12 14.13L2.64 13.61L2.64 10.39L5.12 9.87L5.63 8.64L4.24 6.52L6.52 4.24L8.64 5.63L9.87 5.12L10.39 2.64L13.61 2.64L14.13 5.12L15.36 5.63L17.48 4.24L19.76 6.52L18.37 8.64Z" /><circle cx="12" cy="12" r="3" /></svg>),
  // An agent: a head (structure) wired to the graph by its antenna (a node), eyes as "you are here" marks.
  harmonograph: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M21.0 12.0 20.5 13.8 19.1 15.6 17.0 17.1 14.6 18.4 11.9 19.4 9.3 20.0 7.0 20.3 5.2 20.2 4.2 19.7 4.0 18.9 4.5 17.9 5.8 16.6 7.7 15.2 10.0 13.6 12.4 12.0 14.7 10.4 16.7 9.0 18.2 7.7 19.0 6.6 19.1 5.8 18.6 5.3 17.4 5.1 15.6 5.1 13.6 5.5 11.5 6.2 9.4 7.0 7.7 8.1 6.4 9.3 5.7 10.7 5.7 12.0 6.2 13.3 7.4 14.5 8.9 15.6 10.7 16.5 12.7 17.2 14.5 17.7 16.0 17.8 17.1 17.8 17.6 17.5 17.6 16.9 17.1 16.2 16.0 15.3 14.6 14.2 12.9 13.1 11.2 12.0 9.7 10.9 8.3 9.9 7.4 9.0 6.9 8.2 7.0 7.6 7.6 7.2 8.5 7.1 9.8 7.1 11.3 7.4 12.8 7.9 14.2 8.5 15.4 9.3 16.2 10.1 16.5 11.1 16.4 12.0 15.9 12.9 15.0 13.8 13.8 14.6 12.5 15.2 11.1 15.7 9.9 16.0 8.9 16.1 8.2 16.1 8.0 15.9 8.1 15.5 8.6 15.0 9.4 14.3 10.5 13.6 11.7 12.8 12.9 12.0 14.0 11.2 14.8 10.5 15.4 9.8 15.6 9.3 15.5 8.9 15.0 8.6 14.2 8.5 13.2 8.6 12.2 8.7 11.1 9.1 10.2 9.5 9.4 10.1 8.9 10.7 8.8 11.3 8.9 12.0 9.4 12.7 10.1 13.3 11.0 13.8 11.9 14.3 12.9 14.6 13.7 14.8 14.4 14.9 14.8 14.9 14.9 14.7 14.7 14.5 14.3 14.1 13.6 13.6 12.8 13.1 12.0 12.6 11.1 12.0 10.4 11.4 9.8 10.9 9.5 10.5 9.4 10.1 9.6 9.8 10.0 9.6 10.6 9.5 11.3 9.6 12.1 9.7 12.8 9.9 13.5 10.2 14.0 10.6 14.2 11.1 14.3 11.5 14.1 12.0 13.7 12.5 13.2 12.9 12.5 13.3 11.8 13.6 11.2 13.8 10.6 14.0 10.2 14.1 10.0 14.0 10.0 13.9 10.2 13.7 10.5 13.5 11.0 13.2 11.6 12.8 12.2 12.4 12.8 12.0 13.3 11.6 13.6 11.2 13.8 10.9 13.8 10.7 13.6 10.4 13.3 10.3 12.8 10.3 12.3 10.3 11.8 10.4 11.3 10.5 10.8 10.8 10.5 11.0 10.4 11.3 10.4 11.7 10.6 12.0" /></svg>),
  agents: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="5" y="8.5" width="14" height="11" /><path d="M12 8.5V5.5M3 12.5v3.5M21 12.5v3.5M9.5 16.5h5" /><circle cx="12" cy="4" r="1.6" /><rect x="8.5" y="11.5" width="2" height="2" fill="currentColor" /><rect x="13.5" y="11.5" width="2" height="2" fill="currentColor" /></svg>),
  workflow: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4" width="5" height="5" /><rect x="15.5" y="4" width="5" height="5" fill="currentColor" /><rect x="9.5" y="15" width="5" height="5" /><path d="M8.5 6.5h7M18 9v3.5H12V15" /></svg>),
  memory: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 4h12v16l-6-4-6 4z" /><circle cx="12" cy="10" r="1.6" fill="currentColor" /></svg>),
  doc: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 3.5h9l5 5v12H5z" /><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" /></svg>),
  team: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4" width="6" height="6" /><rect x="14.5" y="4" width="6" height="6" fill="currentColor" /><rect x="9" y="14" width="6" height="6" /><path d="M6.5 10v2h11v-2M12 12v2" /></svg>),
  flask: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.2 1.2 0 0 0 1 1.5h12a1.2 1.2 0 0 0 1-1.5l-5.5-9.5v-6" /><path d="M7.5 15h9" /></svg>),
  shield: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>),
  plug: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v4a5.5 5.5 0 0 1-11 0zM12 17v3.5" /></svg>),
  fence: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 20V7l2-2.5L9 7v13M15 20V7l2-2.5L19 7v13M3 11h18M3 16h18" /></svg>),
  edit: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 20h4L19.5 8.5l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>),
  up: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 15 6-6 6 6" /></svg>),
  down: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>),
  back: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>),
  arrow: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" /></svg>),
  query: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M8 4H6.5A1.5 1.5 0 0 0 5 5.5v4L3.5 12 5 14.5v4A1.5 1.5 0 0 0 6.5 20H8M16 4h1.5A1.5 1.5 0 0 1 19 5.5v4l1.5 2.5-1.5 2.5v4a1.5 1.5 0 0 1-1.5 1.5H16" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></svg>),
  copy: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="8.5" y="8.5" width="11" height="11" /><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></svg>),
  play: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M7 5v14l11-7z" fill="currentColor" /></svg>),
  lock: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>),
  panelRight: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4.5" width="17" height="15" /><path d="M14.5 4.5v15" /></svg>),
  sidebar: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="4.5" width="17" height="15" /><path d="M9.5 4.5v15" /><path d="M5.8 8.5h1.6M5.8 11h1.6M5.8 13.5h1.6" /></svg>),
  folder: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M3.5 6.5h6l2 2h9v10h-17z" /></svg>),
  file: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /></svg>),
  project: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M3.5 5.5h6l2 2h9v11h-17z" /><path d="M7 12h7M7 15h4" /></svg>),
  structure: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="4" y="4" width="5" height="5" /><path d="M6.5 9v9.5H12M6.5 13.5H12" /><rect x="12" y="11" width="5" height="5" /><rect x="12" y="16" width="5" height="5" /></svg>),
  chevron: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m6 9 6 6 6-6" /></svg>),
  sun: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>),
  check: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>),
  pin: () => (<svg viewBox="0 0 24 24" {...P} width="12" height="12"><circle cx="12" cy="12" r="4" /></svg>),
};

// Settings section icons: two tones – the outline in ink and one mark in the
// section hue (the section's --hue is set on the button's style). 18px.
// The SVG grammar is shared with the Icon set above: rounded structure
// geometry, one filled or accent-coloured mark per glyph.
const Q = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const SetIcon: Record<string, () => ReactNode> = {
  general: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" stroke="var(--hue)" /><circle cx="10" cy="17" r="2" stroke="var(--hue)" /></svg>),
  appearance: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="var(--hue)" stroke="none" /></svg>),
  graph: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><path d="M7 7l10 4M7 7l3 10M17 11l-7 6" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="11" r="2" fill="var(--hue)" stroke="var(--hue)" /><circle cx="10" cy="17" r="2" /></svg>),
  colours: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><rect x="4" y="4" width="7" height="7" rx="1.5" fill="var(--hue)" stroke="none" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>),
  keys: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" /><path d="M17 10h.01" stroke="var(--hue)" strokeWidth="2.4" /></svg>),
  git: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><circle cx="7" cy="5" r="2" /><circle cx="7" cy="19" r="2" /><circle cx="17" cy="8" r="2" stroke="var(--hue)" /><path d="M7 7v10M17 10c0 4-4 5-10 7" /></svg>),
  issues: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="var(--hue)" stroke="none" /></svg>),
  agents: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M12 8V5M9.5 16h5" /><circle cx="12" cy="4" r="1.4" /><circle cx="9.5" cy="12" r="1.2" fill="var(--hue)" stroke="none" /><circle cx="14.5" cy="12" r="1.2" fill="var(--hue)" stroke="none" /></svg>),
  extensions: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><path d="M9 4v4M15 4v4M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v3" stroke="var(--hue)" /></svg>),
  account: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" /><circle cx="18" cy="6" r="2" fill="var(--hue)" stroke="none" /></svg>),
  langs: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5" /><path d="M13.5 5l-3 14" stroke="var(--hue)" /></svg>),
  disk: () => (<svg viewBox="0 0 24 24" {...Q} width="18" height="18"><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="var(--hue)" /></svg>),
};
/**
 * The mark: the kula ring drawn with kula rings (src/mark.ts). Small sizes show
 * one level, where two would blur; from 28px up every cell is the ring again.
 */
const MARK_1 = markPath(1), MARK_2 = markPath(2);
export function Logo({ size = 18 }: { size?: number }) {
  const deep = size >= 28;
  const S = deep ? N * N : N;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={size} height={size} className="logo" shapeRendering="crispEdges" aria-hidden="true">
      <path className="logo-k" d={deep ? MARK_2 : MARK_1} fill="var(--accent)" />
    </svg>
  );
}


/** Square glyph for a symbol kind – the same tile the graph draws for hubs. */export function Kind({ kind, size = 16 }: { kind: string; community?: number; size?: number }) {
  const letter = GLYPH[kind] ?? "·";
  const c = kindColor(kind);
  return (
    <span className="kind-badge" title={kind} style={{ width: size, height: size, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)`, fontSize: size * 0.62 }}>
      {kind === "file" ? <svg viewBox="0 0 16 16" width={size * 0.62} height={size * 0.62} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 2h5l3 3v9H4z" /><path d="M9 2v3h3" /></svg> : letter}
    </span>
  );
}

/**
 * A symbol or file row. Clicking opens its source in the code panel; the
 * locate button (when given) moves the graph's focus to it instead.
 */
export function Sym({ n, onClick, right }: { n: Node; onClick?: (n: Node) => void; right?: ReactNode }) {
  const code = useCode();
  const t = nodeTarget(n);
  const on = !!t && code.target?.id === n.id;
  return (
    <div className={`sym ${on ? "on" : ""}`} onClick={() => (t ? code.open(t) : onClick?.(n))} title={`${n.path}:${n.start_line}`}>
      <Kind kind={n.kind} community={n.community} />
      <span className="nm">{n.name}</span>
      <span className="p">{right ?? (n.kind === "package" ? "package" : `${n.path}:${n.start_line}`)}</span>
      {onClick && t && (
        <button className="sym-locate" aria-label={`Locate ${n.name} in the graph`} title="Locate in graph" onClick={(e) => { e.stopPropagation(); onClick(n); }}><Icon.target /></button>
      )}
    </div>
  );
}

// ---------- tooltips ----------
/**
 * The one tooltip: appears after a short delay, carries real information
 * (full path, exact value, shortcut) and never repeats the visible label.
 * Styling and delay live in styles/system.css.
 */
export function Tip({ tip, place, children }: { tip: ReactNode; place?: "top" | "bottom"; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const enter = () => { t.current = setTimeout(() => setShow(true), 450); };
  const leave = () => { if (t.current) clearTimeout(t.current); setShow(false); };
  return (
    <span className="tip-host" data-place={place} onPointerEnter={enter} onPointerLeave={leave} onPointerDown={leave}>
      {children}
      {show && <span className="tip-box" role="tooltip">{tip}</span>}
    </span>
  );
}

// ---------- diff renderer ----------
export function Diff({ text }: { text: string }) {
  if (!text.trim()) return <div className="empty"><h3>No changes</h3></div>;
  const out: ReactNode[] = [];
  let a = 0, b = 0, k = 0;
  for (const line of text.split("\n")) {
    k++;
    if (line.startsWith("diff --git")) {
      const m = line.match(/ b\/(.+)$/);
      out.push(<div key={k} className="file">{m?.[1] ?? line}</div>);
    } else if (line.startsWith("@@")) {
      const m = line.match(/-(\d+)(?:,\d+)? \+(\d+)/);
      if (m) { a = +m[1]; b = +m[2]; }
      out.push(<div key={k} className="hunk">{line}</div>);
    } else if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary)/.test(line)) {
      continue;
    } else if (line.startsWith("+")) {
      out.push(<div key={k} className="ln add"><span className="n" /><span className="n">{b++}</span><span className="c">{line}</span></div>);
    } else if (line.startsWith("-")) {
      out.push(<div key={k} className="ln del"><span className="n">{a++}</span><span className="n" /><span className="c">{line}</span></div>);
    } else if (line.startsWith(" ")) {
      out.push(<div key={k} className="ln"><span className="n">{a++}</span><span className="n">{b++}</span><span className="c">{line}</span></div>);
    } else if (line) {
      out.push(<div key={k} className="meta">{line}</div>);
    }
  }
  return <div className="diff">{out}</div>;
}

/** `git show` output: header lines, then the patch. */
/** Files a patch touches with added and removed line counts. */
export function numstat(patch: string) {
  const out: { path: string; add: number; del: number }[] = [];
  for (const l of patch.split("\n")) {
    if (l.startsWith("diff --git ")) out.push({ path: l.replace(/^diff --git a\/.* b\//, ""), add: 0, del: 0 });
    else if (!out.length || l.startsWith("+++") || l.startsWith("---")) continue;
    else if (l[0] === "+") out[out.length - 1].add++;
    else if (l[0] === "-") out[out.length - 1].del++;
  }
  return out;
}

/** git show output: the message, who and when, the files touched, then the patch. */
export function ShowOutput({ text }: { text: string }) {
  const i = text.indexOf("\ndiff --git");
  const head = i >= 0 ? text.slice(0, i) : text;
  const patch = i >= 0 ? text.slice(i + 1) : "";
  const meta = (k: string) => head.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1]?.trim();
  const msg = head.split("\n").filter((l) => l.startsWith("    ")).map((l) => l.slice(4)).join("\n").trim();
  const author = meta("Author")?.replace(/\s*<.*>$/, "");
  const raw = meta("AuthorDate") ?? meta("Date");
  const ms = raw ? Date.parse(raw) : NaN;
  const date = Number.isNaN(ms) ? raw : relTime(ms / 1000);
  const files = numstat(patch);
  if (!msg) return <div className="stack"><pre className="code" style={{ maxHeight: "none", whiteSpace: "pre-wrap" }}>{head.trim()}</pre>{patch && <Diff text={patch} />}</div>;
  return (
    <div className="stack show-out">
      <div className="show-head">
        <p className="show-msg">{msg}</p>
        <p className="show-meta mono">{[author, date].filter(Boolean).join(" · ")}</p>
      </div>
      {files.length > 0 && (
        <ul className="show-files" aria-label="Files changed">
          {files.map((f) => (
            <li key={f.path}><span className="mono">{f.path}</span><b className="mono add">+{f.add}</b><b className="mono del">-{f.del}</b></li>
          ))}
        </ul>
      )}
      {patch && <Diff text={patch} />}
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; msg: string; kind: "ok" | "err" };
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "err" ? 6500 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

/** Tiny markdown: paragraphs, `code`, **bold**, [[symbol]] links. */
export function Md({ text, onSymbol }: { text: string; onSymbol?: (name: string) => void }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g);
  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) =>
        p.startsWith("`") ? <code key={i} style={{ background: "var(--panel-2)", padding: "1px 5px", borderRadius: 4 }}>{p.slice(1, -1)}</code>
        : p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b>
        : p.startsWith("[[") ? <a key={i} style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => onSymbol?.(p.slice(2, -2))}>{p.slice(2, -2)}</a>
        : <span key={i}>{p}</span>
      )}
    </div>
  );
}

/** A number per row: the name on the left, the figure on the right (replaces the old tile strips). */
export type Stat = { label: string; value: ReactNode; note?: ReactNode; tone?: string; onClick?: () => void; title?: string };
export function StatTable({ rows, label, className = "" }: { rows: Stat[]; label?: string; className?: string }) {
  return (
    <table className={`stat-table ${className}`} aria-label={label}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={`${r.onClick ? "go" : ""} ${r.tone ? `tone-${r.tone}` : ""}`} title={r.title}
            onClick={r.onClick} tabIndex={r.onClick ? 0 : undefined} onKeyDown={r.onClick ? (e) => { if (e.key === "Enter") r.onClick!(); } : undefined}>
            <th scope="row">{r.label}{r.note !== undefined && <span className="st-note">{r.note}</span>}</th>
            <td>{typeof r.value === "number" ? r.value.toLocaleString() : r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
