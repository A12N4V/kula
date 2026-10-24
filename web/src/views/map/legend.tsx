// U7 – the map's key (plain-map.md §2): a chip in the canvas's top-right
// corner, below the Explorer toggle – collapsed by default (U11: it must
// never cover squares), one click opens the five fixed rows, one line each –
// colour = the area of the product (directory hues from colors.ts, imported
// never copied), size = amount of code, glyph = the language, ring = the
// picked journey's hue, dashed square = an agent works here. Never a modal
// (a modal hides the very thing it explains); open or collapsed stays for
// the session.

import { Icon } from "../../ui";
import { useState } from "react";
import { dirColor, groupDirs } from "../../colors";
import { LANG_GLYPH } from "../../colors";
import type { MapData } from "./types";

/** The legend's sample swatches: the real top directories of this repo, from
    the map's own leaf paths through groupDirs + dirColor – the same ranking
    the squares use, so the key never drifts from the terrain. */
function dirSwatches(data?: MapData | null): { dir: string; color: string }[] {
  if (!data) return [];
  const paths = Object.values(data.leaves).map((l) => l.path);
  if (!paths.length) return [];
  const groups = groupDirs(paths, 0);
  return groups.sizes.slice(0, 4).map(([dir]) => ({ dir: groups.label(dir), color: dirColor(dir, groups, { dirColors: {} } as never) }));
}

export function Legend({ data, ringHue }: { data?: MapData | null; ringHue?: string | null }) {
  const [open, setOpen] = useState(() => sessionStorage.getItem("kula.map.legend") === "open");
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try { sessionStorage.setItem("kula.map.legend", next ? "open" : "closed"); } catch { /* private */ }
      return next;
    });
  };
  const swatches = dirSwatches(data);
  return (
    <div className="u7-legend" data-testid="u7-legend">
      <button className="u7-legend-head" data-testid="x5-legend" aria-expanded={open} aria-controls="u7-legend-panel" onClick={toggle} title="What the colours, sizes and marks mean">
        <Icon.types /><span className="u7-legend-word">Key</span>
        <span className="u7-legend-chev" aria-hidden="true">·</span>
      </button>
      {open && (
        <dl className="u7-legend-panel" id="u7-legend-panel" data-testid="x5-legend-panel">
          <div className="u7-lg-row" data-testid="x5-legend-colour" title={swatches.map((s) => s.dir).join(", ")}>
            <span className="u7-lg-sample">
              {swatches.length
                ? swatches.map((s) => <i key={s.dir} className="u7-lg-swatch" style={{ background: s.color }} title={s.dir} />)
                : <i className="u7-lg-swatch" style={{ background: "var(--accent)" }} />}
            </span>
            <dt>colour</dt><dd>– the area of the product</dd>
          </div>
          <div className="u7-lg-row" data-testid="x5-legend-size">
            <span className="u7-lg-sample">
              <i className="u7-lg-sq u7-sq-1" /><i className="u7-lg-sq u7-sq-2" /><i className="u7-lg-sq u7-sq-3" />
            </span>
            <dt>size</dt><dd>– amount of code</dd>
          </div>
          <div className="u7-lg-row" data-testid="x5-legend-glyph">
            <span className="u7-lg-sample">
              {Object.entries(LANG_GLYPH).slice(0, 4).map(([lang, g]) => <b key={lang} className="mono u7-lg-glyph">{g}</b>)}
            </span>
            <dt>glyph</dt><dd>– the language</dd>
          </div>
          <div className="u7-lg-row" data-testid="x5-legend-ring">
            <span className="u7-lg-sample"><i className="u7-lg-ring" style={ringHue ? { borderColor: ringHue } : undefined} /></span>
            <dt>ring</dt><dd>– the picked journey</dd>
          </div>
          <div className="u7-lg-row" data-testid="x5-legend-agent">
            <span className="u7-lg-sample"><i className="u7-lg-agent" /></span>
            <dt>dashed square</dt><dd>– an agent works here</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
