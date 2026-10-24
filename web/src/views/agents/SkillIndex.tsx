// Skills index – every skill an agent would load here, as a searchable list.
// Found the way the agents find them (src/skill_index.rs): a folder with a
// SKILL.md under .agents/skills (Codex, shared), .claude/skills (Claude Code,
// also nested and in plugins), .gemini/skills, legacy .claude/commands, Cursor
// rules, and the user-wide folders in ~. A row opens its instructions; a
// skill that lives outside the shared set can be added to it in one click.

import { useEffect, useMemo, useState } from "react";
import { api, get, post, type IndexedSkill, type SkillIndex as Ix } from "../../api";
import { Empty, Icon, useToast } from "../../ui";
import { useCode } from "../../CodePanel";
import { Grip, PaneControls } from "../../resize";
import { AGENT_NAME, type Act } from "./data";
import { AgentMark } from "./parts";

/** One hit from GitHub: a SKILL.md in a repo we can import from. */
export interface SkillHit { name: string; repo: string; path: string; url: string; source: "curated" | "search" }
const hitKey = (h: { repo: string; path: string }) => `${h.repo}:${h.path}`;

/** A flat GitHub mark, drawn in the same stroke style as the Icon set. */
export function GhMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

/** Fetch a hit's SKILL.md raw text from its own url – only when the pane opens. */
function useRawText(hit: SkillHit | null) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!hit) return;
    let alive = true;
    setText(null); setErr(null);
    fetch(hit.url)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? "SKILL.md not found at that path" : `fetch failed – ${r.status}`); return r.text(); })
      .then((t) => { if (alive) setText(t); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [hit]);
  return { text, err };
}

const SKILL_SEARCH_MS = 300;

/** Search GitHub SKILL.md folders, debounced; a stale answer never lands. */
function useSkillSearch(q: string, on: boolean) {
  const [hits, setHits] = useState<SkillHit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!on) return;
    const term = q.trim();
    if (!term) { setHits([]); setNote(null); setBusy(false); return; }
    setBusy(true);
    let alive = true;
    const t = setTimeout(() => {
      get<{ hits: SkillHit[]; note?: string }>(`/api/agent/skill_search?q=${encodeURIComponent(term)}`)
        .then((r) => { if (alive) { setHits(r.hits ?? []); setNote(r.note ?? null); setBusy(false); } })
        .catch((e) => { if (alive) { setHits([]); setNote(e.message); setBusy(false); } });
    }, SKILL_SEARCH_MS);
    return () => { alive = false; clearTimeout(t); };
  }, [q, on]);
  return { hits, note, busy };
}

/** Preview + import pane for one GitHub hit: same data-pane pattern as every
    sidebar in this run – Grip on the free edge, PaneControls up top, Esc out. */
function HitPane({ hit, installed, busy, onClose, onImport }: {
  hit: SkillHit; installed: boolean; busy: boolean; onClose: () => void; onImport: () => void;
}) {
  const { text, err } = useRawText(hit);
  return (
    <div className="sx-pane" data-pane data-testid="sx-hit-pane">
      <Grip id="sx-hit-pane" edge="left" min={280} max={720} label="Resize preview" />
      <div className="sx-pane-head">
        <span className="sx-mark"><GhMark /></span>
        <span className="sx-main">
          <span className="sx-name mono">{hit.name}</span>
          <span className="sx-desc mono">{hit.repo} · {hit.path}</span>
        </span>
        {hit.source === "curated" && <span className="tag accent">curated</span>}
        <a className="sx-link" href={hit.url} target="_blank" rel="noreferrer" aria-label={`Open ${hit.name} on GitHub`}>↗</a>
        <PaneControls onClose={onClose} closeTitle="Close preview  esc" testId="sx-hit" />
      </div>
      {err ? <div className="sx-pane-err" role="alert">{err}</div>
        : text === null ? <div className="sx-pane-body muted">Fetching SKILL.md…</div>
        : <pre className="sx-pane-body">{text.trim() || "(empty)"}</pre>}
      <div className="sx-pane-foot">
        <button className="btn sm primary" disabled={installed || busy} onClick={onImport} data-testid="sx-import">
          <Icon.plus /> {installed ? "Installed" : busy ? "Importing…" : "Import"}
        </button>
        {installed && <span className="muted">in .agents/skills, copied to every agent</span>}
      </div>
    </div>
  );
}

const SCOPES = [["all", "All"], ["repo", "This repo"], ["user", "Yours"], ["plugin", "Plugins"]] as const;
type Scope = (typeof SCOPES)[number][0];
const SCOPE_TAG: Record<IndexedSkill["scope"], string> = { repo: "repo", nested: "nested", plugin: "plugin", user: "yours", admin: "admin" };
const WHO: Record<IndexedSkill["agent"], string> = { shared: "Every agent", claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", cursor: "Cursor" };
const inScope = (s: IndexedSkill, f: Scope) => f === "all" || (f === "repo" ? s.scope === "repo" || s.scope === "nested" : f === "user" ? s.scope === "user" || s.scope === "admin" : s.scope === f);
const outside = (p: string) => p.startsWith("~") || p.startsWith("/");

/** Load the index once per change of `version`. */
export function useSkillIndex(version: unknown) {
  const [ix, setIx] = useState<Ix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.skillIndex().then((v) => { setIx(v); setErr(null); }).catch((e) => setErr(e.message)); }, [version]);
  return { ix, err };
}

export default function SkillIndex({ ix, err, act, shared }: { ix: Ix | null; err: string | null; act: Act; shared: string[] }) {
  const code = useCode();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [agent, setAgent] = useState<string>("");
  const [sel, setSel] = useState<string | null>(null);
  // One-shot: the Settings disclosure's "Search GitHub" lands here with the
  // GitHub side already up, then the flag is gone.
  const [gh, setGh] = useState(() => {
    try { if (sessionStorage.getItem("kula.x10.gh")) { sessionStorage.removeItem("kula.x10.gh"); return true; } } catch { /* private mode */ }
    return false;
  });
  const search = useSkillSearch(q, gh);
  const [openHit, setOpenHit] = useState<SkillHit | null>(null);
  const [installed, setInstalled] = useState<Record<string, true>>({});
  const [importing, setImporting] = useState(false);
  // After an import the index is re-read here: the tab strip's copy is older.
  const [override, setOverride] = useState<Ix | null>(null);
  const index = override ?? ix;
  const skills = index?.skills ?? [];
  const agents = useMemo(() => [...new Set(skills.map((s) => s.agent))], [skills]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return skills.filter((s) => inScope(s, scope) && (!agent || s.agent === agent) && (!t || `${s.name} ${s.description} ${s.plugin ?? ""}`.toLowerCase().includes(t)));
  }, [skills, q, scope, agent]);
  const count = (f: Scope) => skills.filter((s) => inScope(s, f)).length;
  if (err) return <Empty title="Skills index unavailable">{err}</Empty>;
  if (!index) return <div className="muted">Looking where Claude Code, Codex, Gemini and Cursor look…</div>;
  const cur = shown.find((s) => s.path === sel) ?? null;
  const addShared = (s: IndexedSkill) => act("skill_save", { name: s.name.toLowerCase().replace(/[^\w-]+/g, "-"), description: s.description, text: s.body }, `${s.name} added for every agent`).catch(() => {});
  const importHit = (h: SkillHit) => {
    if (importing || installed[hitKey(h)]) return;
    setImporting(true);
    post<{ name: string; written: string }>("/api/agent/skill_import", { repo: h.repo, path: h.path })
      .then((r) => {
        toast(`${r.name} installed for every agent`);
        setInstalled((s) => ({ ...s, [hitKey(h)]: true }));
        setOpenHit(null);
        return get<Ix>("/api/agent/skill_index").then((v) => setOverride(v)).catch(() => {});
      })
      .catch((e) => toast(e.message, "err"))
      .then(() => setImporting(false));
  };
  return (
    <div className="sx" data-testid="skill-index">
      <div className="sx-bar">
        <label className="sx-q"><Icon.search /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={gh ? "Search GitHub skills" : `Search ${skills.length} skills`} aria-label="Search skills" data-testid="sx-q" /></label>
        <div className="seg sm sx-mode" role="radiogroup" aria-label="Search where">
          <button role="radio" aria-checked={!gh} className={!gh ? "on" : ""} onClick={() => setGh(false)} data-testid="sx-mode-local"><Icon.box /> This machine</button>
          <button role="radio" aria-checked={gh} className={gh ? "on" : ""} onClick={() => setGh(true)} data-testid="sx-mode-github"><GhMark /> GitHub</button>
        </div>
        {!gh && <>
          <div className="seg sm" role="radiogroup" aria-label="Where the skill lives">
            {SCOPES.map(([k, l]) => <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? "on" : ""} onClick={() => setScope(k)} data-testid={`sx-scope-${k}`}>{l} <span className="sx-n">{count(k)}</span></button>)}
          </div>
          <div className="sx-agents" role="group" aria-label="Agent">
            {agents.map((a) => (
              <button key={a} className={`sx-agent ${agent === a ? "on" : ""}`} aria-pressed={agent === a} title={WHO[a]} aria-label={WHO[a]} onClick={() => setAgent(agent === a ? "" : a)}>
                {a === "shared" ? <Icon.box /> : <AgentMark id={a} size={14} />}
              </button>
            ))}
          </div>
        </>}
      </div>
      {gh ? <GithubHits search={search} installed={installed} importing={importing} openHit={openHit} setOpenHit={setOpenHit} onImport={importHit} /> : <LocalList ix={index} shown={shown} cur={cur} setSel={setSel} code={code} shared={shared} addShared={addShared} />}
    </div>
  );
}

/** GitHub mode: debounced hits with repo, curated badge and a link; a row
    opens the preview pane; after an import the row says "installed". */
function GithubHits({ search, installed, importing, openHit, setOpenHit, onImport }: {
  search: { hits: SkillHit[]; note: string | null; busy: boolean };
  installed: Record<string, true>; importing: boolean;
  openHit: SkillHit | null; setOpenHit: (h: SkillHit | null) => void; onImport: (h: SkillHit) => void;
}) {
  return (
    <div className="sx-gh" data-testid="sx-github">
      {search.busy && <div className="muted sx-gh-note" data-testid="sx-gh-busy">Searching GitHub…</div>}
      {!search.busy && !search.hits.length && <Empty title={search.note ? "Search unavailable" : "Search skills on GitHub"}>{search.note ?? "Type to look in anthropics/skills and openai/skills first, then across GitHub for SKILL.md folders."}</Empty>}
      <div className="sx-list" role="list">
        {search.hits.map((h) => {
          const done = installed[hitKey(h)];
          return (
            <div key={hitKey(h)} role="listitem" className="sx-row">
              <button className="sx-head" onClick={() => setOpenHit(h)} data-testid={`sx-gh-${h.name}`}>
                <span className="sx-mark"><GhMark /></span>
                <span className="sx-main">
                  <span className="sx-name mono">{h.name}</span>
                  <span className="sx-desc mono">{h.repo} · {h.path}</span>
                </span>
                <span className="sx-tags">
                  {done ? <span className="tag green" data-testid="sx-installed">installed</span>
                    : h.source === "curated" ? <span className="tag accent">curated</span> : null}
                  <a className="sx-link" href={h.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${h.name} on GitHub`}>↗</a>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {openHit && <HitPane hit={openHit} installed={!!installed[hitKey(openHit)]} busy={importing} onClose={() => setOpenHit(null)} onImport={() => onImport(openHit)} />}
    </div>
  );
}

/** Local mode: the index exactly as before – same rows, same detail, same
    "Where we looked" disclosure. */
function LocalList({ ix, shown, cur, setSel, code, shared, addShared }: {
  ix: Ix; shown: IndexedSkill[]; cur: IndexedSkill | null; setSel: (p: string | null) => void;
  code: ReturnType<typeof useCode>; shared: string[]; addShared: (s: IndexedSkill) => void;
}) {
  return (
    <>
      {shown.length === 0 && <Empty title={ix.skills.length ? "No skill matches" : "No skills yet"}>{ix.skills.length ? "Clear the search or the filters." : "Add a SKILL.md under .agents/skills, or import one from Settings."}</Empty>}
      <div className="sx-list" role="list">
        {shown.map((s) => {
          const open = cur?.path === s.path;
          return (
            <div key={s.path} role="listitem" className={`sx-row ${open ? "on" : ""}`}>
              <button className="sx-head" aria-expanded={open} onClick={() => setSel(open ? null : s.path)} data-testid={`sx-row-${s.name}`}>
                <span className="sx-mark" title={WHO[s.agent]}>{s.agent === "shared" ? <Icon.box /> : <AgentMark id={s.agent} size={14} />}</span>
                <span className="sx-main">
                  <span className="sx-name mono">{s.plugin ? <span className="muted">{s.plugin}:</span> : null}{s.name}</span>
                  <span className="sx-desc">{s.description || <span className="muted">no description</span>}</span>
                </span>
                <span className="sx-tags">
                  {s.kind !== "skill" && <span className="tag">{s.kind}</span>}
                  <span className={`tag ${s.scope === "repo" || s.scope === "nested" ? "" : "accent"}`}>{SCOPE_TAG[s.scope]}</span>
                </span>
                <span className={`sx-caret ${open ? "on" : ""}`}><Icon.chevron /></span>
              </button>
              {open && (
                <div className="sx-detail">
                  <div className="sx-facts">
                    <span><b>Loaded by</b> {WHO[s.agent]}</span>
                    <span className="mono sx-path" title={s.path}>{s.path}</span>
                    {Object.entries(s.meta).map(([k, v]) => <span key={k} className="sx-meta"><b>{k}</b> <span className="mono">{v || "…"}</span></span>)}
                  </div>
                  <pre className="sx-body">{s.body.trim() || "(empty)"}</pre>
                  <div className="row">
                    {!outside(s.path) && <button className="btn sm" onClick={() => code.open({ path: s.path })}><Icon.edit /> Edit</button>}
                    {s.agent !== "shared" && s.kind === "skill" && !shared.includes(s.name) && <button className="btn sm primary" onClick={() => addShared(s)} data-testid={`sx-share-${s.name}`}><Icon.plus /> Use for every agent</button>}
                    {shared.includes(s.name) && s.agent !== "shared" && <span className="muted">also in the shared set</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <details className="sx-where">
        <summary>Where we looked</summary>
        <ul>{ix.searched.map((w) => <li key={w} className="mono">{w}</li>)}</ul>
      </details>
    </>
  );
}

/** CLAUDE.md, AGENTS.md, GEMINI.md – the instruction files each agent reads first. */
export function Instructions({ ix, err }: { ix: Ix | null; err: string | null }) {
  const code = useCode();
  if (err) return <Empty title="Instructions unavailable">{err}</Empty>;
  if (!ix) return <div className="muted">Reading instruction files…</div>;
  const order = ["claude", "codex", "gemini"] as const;
  return (
    <div className="sx" data-testid="instructions">
      <p className="muted sx-lede">What each agent reads before anything else: Claude Code reads CLAUDE.md, Codex AGENTS.override.md then AGENTS.md in each folder from the repo root down, Gemini CLI GEMINI.md – plus a user-wide copy in your home folder.</p>
      {ix.instructions.length === 0 && <Empty title="No instruction files">Sync the brief from Docs to write CLAUDE.md and AGENTS.md.</Empty>}
      {order.map((a) => {
        const rows = ix.instructions.filter((i) => i.agent === a);
        return rows.length ? (
          <div key={a} className="sx-group">
            <div className="section-title"><AgentMark id={a} size={14} /> {AGENT_NAME[a] ?? a} <span className="count">{rows.length}</span></div>
            <div className="sx-list" role="list">
              {rows.map((i) => (
                <div key={i.path} role="listitem" className="sx-row">
                  <button className="sx-head" disabled={outside(i.path)} onClick={() => code.open({ path: i.path })} title={outside(i.path) ? "Outside this repo – open it in your editor" : "Open in the editor"}>
                    <span className="sx-mark"><Icon.doc /></span>
                    <span className="sx-main"><span className="sx-name mono">{i.path}</span><span className="sx-desc">{i.headline || <span className="muted">empty</span>}</span></span>
                    <span className="sx-tags"><span className={`tag ${i.scope === "user" ? "accent" : ""}`}>{i.scope === "user" ? "yours" : i.scope}</span><span className="muted sx-n">{(i.bytes / 1024).toFixed(1)} KB</span></span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })}
    </div>
  );
}
