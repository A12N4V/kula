// The few glyphs the code canvas needs that the shared set lacks. Same grammar
// as ui.tsx: a 24 grid, 1.5 stroke, round caps.

const P = { className: "ico", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Glyph = {
  eye: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></svg>),
  funnel: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /></svg>),
  more: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><circle cx="12" cy="5.5" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="12" cy="18.5" r=".9" fill="currentColor" /></svg>),
  regex: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><circle cx="5.5" cy="18" r="1.3" fill="currentColor" /><path d="M16 4v9M12.2 6.2l7.6 4.6M19.8 6.2l-7.6 4.6" /></svg>),
  names: () => (<svg viewBox="0 0 24 24" {...P} width="14" height="14"><path d="M4 7h16M4 12h10M4 17h13" /></svg>),
};
