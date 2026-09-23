import { useEffect, type ReactNode } from "react";
import { dirColor, groupDirs, rankHue } from "./colors";
import { settings, useKnownDirs, useSettings, type Settings } from "./settings";
import { Icon } from "./ui";

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg full">
      {options.map(([v, l]) => (
        <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Toggle({ k, label, hint }: { k: keyof Settings; label: string; hint?: string }) {
  const s = useSettings();
  const on = !!s[k];
  return (
    <label className="set-row toggle">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <button role="switch" aria-checked={on} className={`switch ${on ? "on" : ""}`} onClick={() => settings.set({ [k]: !on } as Partial<Settings>)}><i /></button>
    </label>
  );
}

/** Everything cosmetic, out of the way: theme, density, graph encodings, directory colours. */
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const dirs = useKnownDirs();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const groups = groupDirs([], s.dirDepth);
  groups.index = new Map(dirs.list.map(([d], i) => [d, i]));
  const custom = Object.keys(s.dirColors).length;

  return (
    <div className="scrim clear" onMouseDown={onClose}>
      <aside className="settings" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <Icon.sliders />
          <h2>Settings</h2>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </header>
        <div className="set-body">
          <div className="set-sec">Appearance</div>
          <Row label="Theme"><Seg value={s.theme} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} onChange={(theme) => settings.set({ theme })} /></Row>
          <Row label="Density"><Seg value={s.density} options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} onChange={(density) => settings.set({ density })} /></Row>

          <div className="set-sec">Graph encoding</div>
          <Row label="Colour nodes by" hint={{ directory: "Where code lives", cluster: "What calls what", kind: "Function, method, class…", churn: "Commits in the last 90 days" }[s.colorBy]}>
            <Seg value={s.colorBy} options={[["directory", "Dir"], ["cluster", "Cluster"], ["kind", "Kind"], ["churn", "Churn"]]} onChange={(colorBy) => settings.set({ colorBy })} />
          </Row>
          <Row label="Directory depth" hint={s.dirDepth ? `Cut paths at ${s.dirDepth} segment${s.dirDepth > 1 ? "s" : ""}` : "Auto splits any directory holding over 30%"}>
            <Seg value={s.dirDepth} options={[[0, "Auto"], [1, "1"], [2, "2"], [3, "3"]]} onChange={(dirDepth) => settings.set({ dirDepth })} />
          </Row>
          <Toggle k="territories" label="Directory territories" hint="Tinted ground behind each directory" />
          <Toggle k="hubIcons" label="Hub tiles" hint="Most-connected nodes become labelled squares" />
          {s.hubIcons && (
            <Row label="Hub share" hint={`Top ${Math.round(s.hubShare * 100)}% by degree`}>
              <input type="range" className="range" min={1} max={15} value={Math.round(s.hubShare * 100)} onChange={(e) => settings.set({ hubShare: Number(e.target.value) / 100 })} />
            </Row>
          )}
          <Row label="Labels"><Seg value={s.labels} options={[["few", "Fewer"], ["normal", "Normal"], ["many", "More"]]} onChange={(labels) => settings.set({ labels })} /></Row>
          <Toggle k="imports" label="Import edges" hint="Off shows calls only" />
          <Toggle k="curved" label="Curved edges" />
          <Toggle k="flow" label="Call direction dots" hint="Moving dots on the focused symbol's calls" />

          <div className="set-sec">
            Directory colours
            {custom > 0 && <button className="link" onClick={() => settings.set({ dirColors: {} })}>Reset {custom}</button>}
          </div>
          {dirs.list.length === 0 && <div className="muted set-empty">Open the graph to list its directories.</div>}
          <div className="dir-colors">
            {dirs.list.map(([d, n, label], i) => {
              const c = dirColor(d, groups, s);
              return (
                <label key={d} className="dir-color">
                  <span className="swatch" style={{ background: c }}>
                    <input type="color" value={c} onChange={(e) => settings.set({ dirColors: { ...s.dirColors, [d]: e.target.value } })} aria-label={`Colour for ${d}`} />
                  </span>
                  <span className="mono lbl">{label}</span>
                  <span className="n">{n}</span>
                  {s.dirColors[d] && (
                    <button className="btn ghost sm" title="Reset" aria-label={`Reset colour for ${d}`}
                      onClick={(e) => { e.preventDefault(); const { [d]: _, ...rest } = s.dirColors; void _; settings.set({ dirColors: rest }); }}>
                      <span className="swatch sm" style={{ background: rankHue(i) }} />
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        <footer>
          <button className="btn sm ghost" onClick={() => settings.reset()}>Restore defaults</button>
          <span className="spacer" />
          <span className="muted">Saved in this browser</span>
        </footer>
      </aside>
    </div>
  );
}
