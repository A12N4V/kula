// The few glyphs the code canvas needs that the shared set lacks. Same grammar
// as ui.tsx: a 24 grid, 1.5 stroke, round caps.

const P = { className: "ico", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Glyph = {
  eye: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></svg>),
  funnel: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /></svg>),
  more: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><circle cx="12" cy="5.5" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="12" cy="18.5" r=".9" fill="currentColor" /></svg>),
  regex: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><circle cx="5.5" cy="18" r="1.3" fill="currentColor" /><path d="M16 4v9M12.2 6.2l7.6 4.6M19.8 6.2l-7.6 4.6" /></svg>),
  names: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M4 7h16M4 12h10M4 17h13" /></svg>),
  // Link kinds: a dot is the picked thing, the arrow is which way the link runs.
  out: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="6" cy="18" r="2.2" /><path d="M8 16 18 6M11 6h7v7" /></svg>),
  in: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="18" cy="6" r="2.2" /><path d="M5 19 15.5 8.5M15.5 15.5V8.5H8.5" /></svg>),
  imports: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="9" width="9" height="11" rx="1.5" /><path d="M10 13 20 3M14 3h6v6" /></svg>),
  importers: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="11.5" y="4" width="9" height="11" rx="1.5" /><path d="M3 21l11-11M14 16V10H8" /></svg>),
  types: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M5 5h14M12 5v14M8.5 19h7" /></svg>),
  // View options.
  link: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.3 11 15.7 7M8.3 13l7.4 4" /></svg>),
  rows: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M7 8.5h10M7 12h7M7 15.5h8.5" /></svg>),
  split: () => (<svg viewBox="0 0 24 24" {...P} width="16" height="16"><path d="M4 12h5M9 12c4 0 4-6 8-6h3M9 12c4 0 4 6 8 6h3M9 12h11" /></svg>),
};
