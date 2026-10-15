// fmap icons – the graph's own kind glyphs and colours (colors.ts GLYPH /
// kindColor), extended with the kinds the map adds, plus one role mark per
// role. Every row, box and chain step uses these; no per-view copies.

import { GLYPH, kindColor } from "../../colors";
import type { Role } from "./types";
import { ROLE_RULES } from "./types";

/** The map's extra kinds, in the same one-or-two-character language. */
const EXTRA: Record<string, string> = {
  variable: "v", const: "k", constant: "k", type: "T", enum: "E", struct: "S", trait: "I", loop: "↻",
};
/** Fixture / short spellings onto the store's kind names. */
const ALIAS: Record<string, string> = { fn: "function", var: "variable" };

export const kindName = (k: string) => ALIAS[k] ?? k;
export const kindGlyph = (k: string) => { const n = kindName(k); return GLYPH[n] ?? EXTRA[n] ?? "·"; };

export function KindIcon({ kind, className = "" }: { kind: string; className?: string }) {
  const n = kindName(kind);
  return (
    <span className={`fm-kind ${className}`} style={{ color: kindColor(n) }} title={n} aria-label={n} data-kind={n}>
      {kindGlyph(n)}
    </span>
  );
}

/** Role marks: one letter, coloured, with the role's rule as its title. */
export const ROLE_GLYPH: Record<Role, string> = {
  entry: "e", orchestrator: "o", core: "c", utility: "u", adapter: "a",
  model: "m", config: "k", test: "t", glue: "g",
};
export const ROLE_COLOR: Record<Role, string> = {
  entry: "var(--accent)", orchestrator: "var(--violet)", core: "var(--text-2)",
  utility: "var(--green)", adapter: "var(--blue)", model: "var(--yellow)",
  config: "var(--yellow)", test: "var(--red)", glue: "var(--text-3)",
};

export function RoleMark({ role }: { role: Role }) {
  return (
    <span className={`sy-role sy-role-${role}`} style={{ color: ROLE_COLOR[role] }} title={`${role} – ${ROLE_RULES[role]}`} data-role={role}>
      {ROLE_GLYPH[role]}
    </span>
  );
}
