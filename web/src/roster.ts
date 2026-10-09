// Generic agents: a name and a title per seat, so a team reads as people with
// jobs rather than a list of vendor products the user may not even have.
// Names are stable per (team, seat) and never repeat inside one team; the
// sigil comes from the name (see sigil.tsx).

const NAMES = (
  "Atlas Vega Orin Juno Kestrel Sable Ember Quill Nova Rook Lumen Cato Wren Iris Talon Marlo Pike Sol Tamsin Bram " +
  "Odette Ferro Lark Cass Hollis Ines Ravel Teo Mira Dax Elio Brisk Corin Ada Fennel Halden Isolde Jett Kaia Lowell " +
  "Maren Nils Opal Pell Quinn Rhea Soren Tova Ulric Vesna Wynn Xavi Yara Zeno Arlo Bex Cyra Dorian Esme Fable " +
  "Gideon Hale Ilya Jory Kit Linnea Moss Nadia Oskar Pema Rune Saskia Thane Una Viggo Willa Yusuf Zola Anouk " +
  "Basil Clio Dune Edda Flint Greer Hesper Indra Jules Koa Leif Mabel Nico Ondine Perrin Rafe Sage Tycho Vale"
).split(" ");

/** What each seat role is called on a card. */
export const TITLES: Record<string, string> = {
  lead: "Team lead",
  solver: "Researcher",
  review: "Reviewer",
  tests: "Test engineer",
  fix: "Fixer",
  docs: "Technical writer",
  writer: "Writer",
  triage: "Triage",
};

export const titleFor = (role?: string) => (role && TITLES[role]) || (role ? role[0].toUpperCase() + role.slice(1) : "Agent");

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Names for a team's seats: deterministic, unique within the team. */
export function namesFor(team: string, seats: number): string[] {
  const out: string[] = [];
  let i = hash(team) % NAMES.length;
  while (out.length < seats) {
    const n = NAMES[i % NAMES.length];
    out.push(out.length >= NAMES.length ? `${n} ${Math.floor(out.length / NAMES.length) + 1}` : n);
    i += 37; // coprime to the pool: walks every name before repeating
  }
  return out;
}
