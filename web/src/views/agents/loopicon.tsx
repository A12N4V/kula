// A loop's mark: a drawn glyph for each built-in template, or a generated
// sigil (`sigil:<n>`) for loops of your own. Unset falls back to the sigil of
// the loop's name, so every loop has one without anyone choosing.
import { useState, type ReactElement } from "react";
import { Sigil, SIGILS, sigilFor } from "../../sigil";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const A = { ...S, stroke: "var(--accent)" };

/** One glyph per template, drawn on a 24×24 grid. */
export const GLYPHS: Record<string, { label: string; draw: ReactElement }> = {
  "faster-tests": { label: "stopwatch", draw: <><circle cx={12} cy={13.5} r={7.5} {...S} /><path d="M10 3h4M12 3v3" {...S} /><path d="M12 13.5 15.5 10" {...A} /></> },
  "fix-failures": { label: "failing to passing", draw: <><path d="M4 6l5 5M9 6l-5 5" {...S} /><path d="M12.5 15.5l3 3 5.5-7" {...A} /><path d="M10 13.5h-6" {...S} strokeDasharray="1.5 2" /></> },
  lint: { label: "sweep", draw: <><path d="M4 7h11M4 12h8M4 17h5" {...S} /><path d="M14 19l6-9M17 19h4" {...A} /></> },
  "type-errors": { label: "types", draw: <><path d="M8 4c-2 0-3 1-3 3v2.5c0 1-1 2.5-2 2.5 1 0 2 1.5 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1 1 2.5 2 2.5-1 0-2 1.5-2 2.5V17c0 2-1 3-3 3" {...S} /><path d="M9.5 9h5M12 9v7" {...A} /></> },
  coverage: { label: "coverage", draw: <><circle cx={12} cy={12} r={8} {...S} /><path d="M12 4a8 8 0 0 1 8 8h-8z" fill="var(--accent)" stroke="none" /></> },
  bundle: { label: "package", draw: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" {...S} /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" {...S} /><path d="M8 5.25l8 4.5" {...A} /></> },
  benchmark: { label: "gauge", draw: <><path d="M4 17a8 8 0 1 1 16 0" {...S} /><path d="M12 17l4-6" {...A} /><circle cx={12} cy={17} r={1.4} fill="currentColor" /></> },
};

/** The icon for a loop, from its `research.icon`, else its name. */
export function LoopIcon({ icon, name, size = 16 }: { icon?: string; name: string; size?: number }) {
  // a loop made before icons existed, still named after its template ("faster-tests", "lint-2")
  icon ||= Object.keys(GLYPHS).find((g) => name === g || name.startsWith(`${g}-`));
  if (icon && GLYPHS[icon]) return <svg className="loop-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{GLYPHS[icon].draw}</svg>;
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
