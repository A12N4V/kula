import { useEffect, useRef, useState, type ReactNode } from "react";
import { dirColor, groupDirs, rankHue } from "./colors";
import { fuzzyScore } from "./nav";
import { settings, useKnownDirs, useSettings, type Settings } from "./settings";
import { Icon } from "./ui";
import { api, type LangRow } from "./api";
import { hasCustomSizes, resetSizes } from "./resize";

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg full">
      {options.map(([v, l]) => (
        <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function Row({ label, hint, q, children }: { label: string; hint?: string; q?: string; children: ReactNode }) {
  if (q && !fuzzyScore(q, `${label} ${hint ?? ""}`)) return null;
  return (
    <div className="set-row">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Toggle({ k, label, hint, q }: { k: keyof Settings; label: string; hint?: string; q?: string }) {
  const s = useSettings();
  const on = !!s[k];
  if (q && !fuzzyScore(q, `${label} ${hint ?? ""}`)) return null;
  return (
    <label className="set-row toggle">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => settings.set({ [k]: !on } as Partial<Settings>)}><i /></button>
    </label>
  );
}

const SECTIONS = [["appearance", "Appearance"], ["graph", "Graph encoding"], ["dirs", "Directory colours"], ["langs", "Languages"], ["disk", "Disk"]] as const;

const size = (b: number) => b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Kept agent runs, temp files and a store with free pages, cleared after the UI sits idle. Saved in the repo (`.kula/clean.json`) so the server can act on it. */
function DiskRows({ q }: { q: string }) {
  const [after, setAfter] = useState<number | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { api.clean().then((c) => { setAfter(c.policy.after_min); setUsed(c.size_bytes); }).catch(() => {}); }, []);
  const pick = (m: number) => { setAfter(m); api.setClean(m).catch((e) => setNote(e.message)); };
  const now = () => { setNote("Cleaning…"); api.cleanNow().then((r) => { setUsed(r.size_bytes); setNote(r.freed_bytes ? `Freed ${size(r.freed_bytes)}` : "Already clean"); }).catch((e) => setNote(e.message)); };
  if (after === null) return null;
  return (
    <>
      <Row label="Clean up after" hint={after ? `Once kula has been idle ${after} min: old agent run copies, temp files, cached graphs; the store is compacted` : "Off – use Clean now or `kula clean`"} q={q}>
        <Seg value={after} options={[[0, "Off"], [5, "5m"], [10, "10m"], [15, "15m"], [20, "20m"], [30, "30m"], [60, "1h"]]} onChange={pick} />
      </Row>
      <Row label="Disk used" hint={note || ".kula in this repository"} q={q}>
        <span className="mono">{used === null ? "–" : size(used)}</span>
        <button className="btn sm" onClick={now}>Clean now</button>
      </Row>
    </>
  );
}

/** Languages in this repository. Ones kula skips for want of a language pack get an
 *  Install button: it fetches the pack from the kula release and reindexes. */
function LangRows({ q }: { q: string }) {
  const [rows, setRows] = useState<LangRow[] | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState("");
  const load = () => api.langs().then((r) => setRows(r.detected)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const add = (ids: string[]) => {
    setBusy(ids.join(" ")); setNote("");
    api.langsAdd(ids).then(() => { setNote(`Installed ${ids.join(", ")} and reindexed`); load(); })
      .catch((e) => setNote(e.message)).finally(() => setBusy(""));
  };
  if (!rows) return null;
  const missing = rows.filter((r) => !r.indexed);
  const indexed = rows.filter((r) => r.indexed);
  return (
    <>
      <Row label="Indexed" hint={indexed.length ? indexed.map((r) => `${r.name} (${r.files})`).join(" · ") : "No source files found"} q={q}>
        <span className="mono">{indexed.length}</span>
      </Row>
      {missing.map((r) => (
        <Row key={r.id} label={r.name} hint={`${r.files} file${r.files === 1 ? "" : "s"} skipped – needs the ${r.id} language pack${r.tier ? ` (${r.tier === "imports" ? "definitions, calls, imports" : r.tier === "calls" ? "definitions and calls" : "definitions"})` : ""}`} q={q}>
          <button className="btn sm" disabled={!!busy} onClick={() => add([r.id])}>{busy.split(" ").includes(r.id) ? "Installing…" : "Install"}</button>
        </Row>
      ))}
      {missing.length > 1 && (
        <Row label="Install all" hint={note || `kula lang add --detected`} q={q}>
          <button className="btn sm" disabled={!!busy} onClick={() => add(missing.map((r) => r.id))}>Install {missing.length}</button>
        </Row>
      )}
      {missing.length <= 1 && note && <div className="muted set-empty">{note}</div>}
    </>
  );
}

/** Everything cosmetic, in one dialog: theme, density, graph encodings, directory colours.
 *  Grouped, searchable – the search filters rows live, everything takes effect immediately. */
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const dirs = useKnownDirs();
  const body = useRef<HTMLDivElement>(null);
  const [sec, setSec] = useState<string>("appearance");
  const [q, setQ] = useState("");
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // The section in view lights its tab.
  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let cur: string = SECTIONS[0][0];
    for (const [id] of SECTIONS) { const h = el.querySelector(`#set-${id}`); if (h && h.getBoundingClientRect().top - top < 80) cur = id; }
    setSec(cur);
  };
  const jump = (id: string) => { body.current?.querySelector(`#set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setSec(id); };
  const groups = groupDirs([], s.dirDepth);
  groups.index = new Map(dirs.list.map(([d], i) => [d, i]));
  const custom = Object.keys(s.dirColors).length;
  const visible = dirs.list.filter(([d, , label]) => fuzzyScore(q, `${d} ${label}`) >= 0);
  const noHits = q && !visible.length && !body.current?.textContent?.toLowerCase().includes(q.toLowerCase());

  return (
    <div className="scrim" onMouseDown={onClose}>
      <section className="settings dialog" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <Icon.gear />
          <h2>Settings</h2>
          <span className="spacer" />
          <button className="btn ghost sm restore-m" onClick={() => { resetSizes(); settings.reset(); }}>Restore defaults</button>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </header>
        <div className="set-search">
          <Icon.search />
          <input className="input" type="search" placeholder="Search settings…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search settings" />
          {q && <button className="btn ghost sm" aria-label="Clear search" onClick={() => setQ("")}><Icon.close /></button>}
        </div>
        <div className="set-main">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => <button key={id} className={sec === id ? "on" : ""} onClick={() => jump(id)}>{label}</button>)}
        </nav>
        <div className="set-body" ref={body} onScroll={onScroll}>
          <div className="set-sec" id="set-appearance">Appearance</div>
          <Row label="Theme" q={q}><Seg value={s.theme} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} onChange={(theme) => settings.set({ theme })} /></Row>
          <Toggle k="opening" label="Opening sequence" hint="Your repo's graph, dithered, once per session" q={q} />
          <Row label="Panel sizes" hint="Drag any panel edge; double-click an edge to reset it" q={q}>
            <button className="btn sm" disabled={!hasCustomSizes()} onClick={() => { resetSizes(); settings.set({}); }}>Reset all</button>
          </Row>
          <Row label="Density" q={q}><Seg value={s.density} options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} onChange={(density) => settings.set({ density })} /></Row>

          {(!q || fuzzyScore(q, "graph encoding colour nodes directory depth territories hub tiles labels imports packages curved edges flow") >= 0) && (
          <div className="set-sec" id="set-graph">Graph encoding</div>)}
          <Row label="Colour nodes by" hint={{ directory: "Where code lives", cluster: "What calls what", kind: "Function, method, class…", churn: "Commits in the last 90 days" }[s.colorBy]} q={q}>
            <Seg value={s.colorBy} options={[["directory", "Dir"], ["cluster", "Cluster"], ["kind", "Kind"], ["churn", "Churn"]]} onChange={(colorBy) => settings.set({ colorBy })} />
          </Row>
          <Row label="Directory depth" hint={s.dirDepth ? `Cut paths at ${s.dirDepth} segment${s.dirDepth > 1 ? "s" : ""}` : "Auto splits any directory holding over 30%"} q={q}>
            <Seg value={s.dirDepth} options={[[0, "Auto"], [1, "1"], [2, "2"], [3, "3"]]} onChange={(dirDepth) => settings.set({ dirDepth })} />
          </Row>
          <Toggle k="territories" label="Directory territories" hint="Tinted ground behind each directory" q={q} />
          <Toggle k="hubIcons" label="Hub tiles" hint="Most-connected nodes become labelled squares" q={q} />
          {s.hubIcons && (
            <Row label="Hub share" hint={`Top ${Math.round(s.hubShare * 100)}% by degree`} q={q}>
              <input type="range" className="range" min={1} max={15} value={Math.round(s.hubShare * 100)} onChange={(e) => settings.set({ hubShare: Number(e.target.value) / 100 })} />
            </Row>
          )}
          <Row label="Labels" q={q}><Seg value={s.labels} options={[["few", "Fewer"], ["normal", "Normal"], ["many", "More"]]} onChange={(labels) => settings.set({ labels })} /></Row>
          <Toggle k="imports" label="Import edges" hint="Off shows calls only" q={q} />
          <Toggle k="packages" label="Packages" hint="Dependencies on the rim, tied to their importers" q={q} />
          <Toggle k="curved" label="Curved edges" q={q} />
          <Toggle k="flow" label="Call direction dots" hint="Moving dots on the focused symbol's calls" q={q} />

          {(!q || fuzzyScore(q, "directory colours") >= 0) && (
          <div className="set-sec" id="set-dirs">
            Directory colours
            {custom > 0 && <button className="link" onClick={() => settings.set({ dirColors: {} })}>Reset {custom}</button>}
          </div>)}
          {dirs.list.length === 0 && <div className="muted set-empty">Open the graph to list its directories.</div>}
          <div className="dir-colors">
            {visible.map(([d, n, label]) => {
              const i = dirs.list.findIndex(([x]) => x === d);
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
            {q && !visible.length && <div className="muted set-empty">No directories match “{q}” – the rest of the settings above still searched.</div>}
          </div>
          {(!q || fuzzyScore(q, "languages language packs grammars install") >= 0) && <div className="set-sec" id="set-langs">Languages</div>}
          <LangRows q={q} />
          {(!q || fuzzyScore(q, "disk space clean cleanup idle timer storage") >= 0) && <div className="set-sec" id="set-disk">Disk</div>}
          <DiskRows q={q} />
          {noHits && <div className="muted set-empty">Nothing matches “{q}”.</div>}
        </div>
        </div>
        <footer>
          <button className="btn sm ghost" onClick={() => { resetSizes(); settings.reset(); }}>Restore defaults</button>
          <span className="spacer" />
          <span className="muted">Saved in this browser · Disk in .kula/clean.json</span>
        </footer>
      </section>
    </div>
  );
}
