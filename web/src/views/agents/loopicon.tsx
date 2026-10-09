// A loop's mark: a drawn glyph for each built-in template, or a generated
// sigil (`sigil:<n>`) for loops of your own. Unset falls back to the sigil of
// the loop's name, so every loop has one without anyone choosing.
import { useState } from "react";
import { Icon } from "../../ui";
import { Sigil, SIGILS, sigilFor } from "../../sigil";

/** One icon-set glyph per template (ui.tsx). */
export const GLYPHS: Record<string, { label: string; icon: keyof typeof Icon }> = {
  "faster-tests": { label: "stopwatch", icon: "stopwatch" },
  "fix-failures": { label: "failing to passing", icon: "passing" },
  lint: { label: "sweep", icon: "sweep" },
  "type-errors": { label: "types", icon: "types" },
  coverage: { label: "coverage", icon: "coverage" },
  bundle: { label: "package", icon: "package" },
  benchmark: { label: "gauge", icon: "gauge" },
};

/** The icon for a loop, from its `research.icon`, else its name. */
export function LoopIcon({ icon, name, size = 16 }: { icon?: string; name: string; size?: number }) {
  // a loop made before icons existed, still named after its template ("faster-tests", "lint-2")
  icon ||= Object.keys(GLYPHS).find((g) => name === g || name.startsWith(`${g}-`));
  if (icon && GLYPHS[icon]) { const G = Icon[GLYPHS[icon].icon]; return <span className="loop-icon" aria-hidden="true"><G /></span>; }
  const n = icon?.startsWith("sigil:") ? Number(icon.slice(6)) : sigilFor(name);
  return <Sigil seed={Number.isFinite(n) ? n : sigilFor(name)} size={size} className="loop-icon" />;
}

/** Pick a glyph or a generated mark; "more" deals a fresh row of sigils. */
export function IconPicker({ value, name, onChange }: { value: string; name: string; onChange: (v: string) => void }) {
  const [deal, setDeal] = useState(() => sigilFor(name));
  const sigils = Array.from({ length: 9 }, (_, i) => `sigil:${(deal + i * 43) % SIGILS}`);
  const cur = value || `sigil:${sigilFor(name)}`;
  return (
    <div className="icon-pick" role="radiogroup" aria-label="Loop icon">
      {[...Object.keys(GLYPHS), ...sigils].map((v) => (
        <button key={v} type="button" role="radio" aria-checked={cur === v} className={cur === v ? "on" : ""} onClick={() => onChange(v)}
          title={GLYPHS[v]?.label ?? "generated mark"} aria-label={GLYPHS[v]?.label ?? `generated mark ${v.slice(6)}`}>
          <LoopIcon icon={v} name={name} size={18} />
        </button>
      ))}
      <button type="button" className="icon-more" onClick={() => setDeal((d) => (d + 97) % SIGILS)} title="more generated marks">more</button>
    </div>
  );
}
