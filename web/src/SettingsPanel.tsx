// Settings: one dialog, one section at a time. Each section has its own colour
// and icon; search filters the sections and the rows inside them. Viewer
// preferences save in this browser, repository settings save to the repo.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { dirColor, groupDirs, rankHue } from "./colors";
import { fuzzyScore } from "./nav";
import { settings, useKnownDirs, useSettings, type Settings } from "./settings";
import { Icon, SetIcon, useToast } from "./ui";
import { api, hub, relTime, type ConfigMatrix, type ExtInstalled, type ExtSource, type GitOverview, type IssueConfig, type LangRow, type MemoryLayer, type RepoInfo, type StoreCommit, type StoreSummary } from "./api";
import { hasCustomSizes, resetSizes } from "./resize";
import { ACTIONS, FIXED, chordOf, rebind, useBindings, type ActionId } from "./keys";
import { IssueSettingsPanel } from "./views/IssueDesk";

export type SettingsSection = "general" | "appearance" | "graph" | "colours" | "keys" | "git" | "issues" | "agents" | "extensions" | "account" | "langs" | "disk";

// Section icons live in the design system (ui.tsx SetIcon): two tones, the
// outline in ink and one mark in the section hue.
const I = SetIcon as Record<SettingsSection, () => ReactElement>;

type Sec = { id: SettingsSection; label: string; hue: string; group: "You" | "Workspace" | "Repository"; words: string };
const SECTIONS: Sec[] = [
  { id: "general", label: "General", hue: "#f97f3a", group: "You", words: "general startup opening panel sizes reset defaults" },
  { id: "appearance", label: "Appearance", hue: "#e3b26b", group: "You", words: "appearance theme dark light system density compact comfortable" },
  { id: "keys", label: "Keybindings", hue: "#d98fb5", group: "You", words: "keybindings shortcuts keys keyboard chords rebind hotkeys" },
  { id: "graph", label: "Graph", hue: "#7fb3d5", group: "Workspace", words: "graph encoding colour nodes directory depth territories hub tiles labels imports packages curved edges flow" },
  { id: "colours", label: "Directory colours", hue: "#9fc28a", group: "Workspace", words: "directory colours colors swatches palette" },
  { id: "git", label: "Git", hue: "#f0a76b", group: "Repository", words: "git worktrees branches remotes stale merged base" },
  { id: "issues", label: "Issues", hue: "#e88a7a", group: "Repository", words: "issues templates labels milestones people" },
  { id: "agents", label: "Agents", hue: "#b49ae0", group: "Repository", words: "agents mcp servers rules memory layers claude codex gemini" },
  { id: "extensions", label: "Plugins", hue: "#6fc7b8", group: "Repository", words: "plugins extensions skills prompts mcp installed sources catalogs" },
  { id: "account", label: "Account", hue: "#c9b48a", group: "Repository", words: "account user identity remotes kulastore store snapshot push pull memory" },
  { id: "langs", label: "Languages", hue: "#8fb0e8", group: "Repository", words: "languages language packs grammars install indexed" },
  { id: "disk", label: "Disk", hue: "#a8a29a", group: "Repository", words: "disk space clean cleanup idle timer storage" },
];

const size = (b: number) => b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

// ------------------------------------------------------------------ controls
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg full">
      {options.map(([v, l]) => <button key={String(v)} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

const hit = (q: string, s: string) => !q || fuzzyScore(q, s) >= 0;

function Row({ label, hint, q, wide, children }: { label: string; hint?: string; q?: string; wide?: boolean; children: ReactNode }) {
  if (q && !hit(q, `${label} ${hint ?? ""}`)) return null;
  return (
    <div className={`set-row ${wide ? "wide" : ""}`}>
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Toggle({ k, label, hint, q }: { k: keyof Settings; label: string; hint?: string; q?: string }) {
  const s = useSettings();
  const on = !!s[k];
  if (q && !hit(q, `${label} ${hint ?? ""}`)) return null;
  return (
    <label className="set-row toggle">
      <div className="set-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => settings.set({ [k]: !on } as Partial<Settings>)}><i /></button>
    </label>
  );
}

function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="set-group">
      <div className="set-sec"><span>{title}</span>{right}</div>
      <div className="set-card">{children}</div>
    </div>
  );
}

function Stat({ n, label }: { n: ReactNode; label: string }) {
  return <div className="set-stat"><b>{n}</b><span>{label}</span></div>;
}

function useLoad<T>(f: () => Promise<T>, deps: unknown[] = []): [T | null, () => void, string] {
  const [v, setV] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const load = () => { f().then((x) => { setV(x); setErr(""); }).catch((e) => setErr(e.message)); };
  useEffect(load, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, load, err];
}

// ------------------------------------------------------------------ sections
function General({ q }: { q: string }) {
  return (
    <>
      <Group title="Startup">
        <Toggle k="opening" label="Opening sequence" hint="Your repo's graph, dithered, once per session" q={q} />
      </Group>
      <Group title="Layout">
        <Row label="Panel sizes" hint="Drag any panel edge; double click an edge to reset it" q={q}>
          <button className="btn sm" disabled={!hasCustomSizes()} onClick={() => { resetSizes(); settings.set({}); }}>Reset all</button>
        </Row>
        <Row label="Everything" hint="Theme, graph, colours and keybindings back to defaults" q={q}>
          <button className="btn sm" onClick={() => { resetSizes(); settings.reset(); }}>Restore defaults</button>
        </Row>
      </Group>
    </>
  );
}

function Appearance({ q }: { q: string }) {
  const s = useSettings();
  return (
    <Group title="Look">
      <Row label="Theme" q={q}><Seg value={s.theme} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} onChange={(theme) => settings.set({ theme })} /></Row>
      <Row label="Density" q={q}><Seg value={s.density} options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} onChange={(density) => settings.set({ density })} /></Row>
    </Group>
  );
}

function GraphSec({ q }: { q: string }) {
  const s = useSettings();
  return (
    <>
      <Group title="Encoding">
        <Row label="Colour nodes by" hint={{ directory: "Where code lives", cluster: "What calls what", kind: "Function, method, class", churn: "Commits in the last 90 days" }[s.colorBy]} q={q}>
          <Seg value={s.colorBy} options={[["directory", "Dir"], ["cluster", "Cluster"], ["kind", "Kind"], ["churn", "Churn"]]} onChange={(colorBy) => settings.set({ colorBy })} />
        </Row>
        <Row label="Directory depth" hint={s.dirDepth ? `Cut paths at ${s.dirDepth} segment${s.dirDepth > 1 ? "s" : ""}` : "Auto splits any directory holding over 30%"} q={q}>
          <Seg value={s.dirDepth} options={[[0, "Auto"], [1, "1"], [2, "2"], [3, "3"]]} onChange={(dirDepth) => settings.set({ dirDepth })} />
        </Row>
        <Row label="Labels" q={q}><Seg value={s.labels} options={[["few", "Fewer"], ["normal", "Normal"], ["many", "More"]]} onChange={(labels) => settings.set({ labels })} /></Row>
      </Group>
      <Group title="Layers">
        <Toggle k="territories" label="Directory territories" hint="Tinted ground behind each directory" q={q} />
        <Toggle k="hubIcons" label="Hub tiles" hint="Most connected nodes become labelled squares" q={q} />
        {s.hubIcons && (
          <Row label="Hub share" hint={`Top ${Math.round(s.hubShare * 100)}% by degree`} q={q}>
            <input type="range" className="range" min={1} max={15} value={Math.round(s.hubShare * 100)} onChange={(e) => settings.set({ hubShare: Number(e.target.value) / 100 })} />
          </Row>
        )}
        <Toggle k="imports" label="Import edges" hint="Off shows calls only" q={q} />
        <Toggle k="packages" label="Packages" hint="Dependencies on the rim, tied to their importers" q={q} />
        <Toggle k="curved" label="Curved edges" q={q} />
        <Toggle k="flow" label="Call direction dots" hint="Moving dots on the focused symbol's calls" q={q} />
      </Group>
    </>
  );
}

function Colours({ q }: { q: string }) {
  const s = useSettings();
  const dirs = useKnownDirs();
  const groups = groupDirs([], s.dirDepth);
  groups.index = new Map(dirs.list.map(([d], i) => [d, i]));
  const custom = Object.keys(s.dirColors).length;
  const visible = dirs.list.filter(([d, , label]) => hit(q, `${d} ${label}`));
  return (
    <Group title="Directories" right={custom > 0 && <button className="link" onClick={() => settings.set({ dirColors: {} })}>Reset {custom}</button>}>
      {dirs.list.length === 0 && <div className="muted set-empty">Open the graph to list its directories</div>}
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
      </div>
    </Group>
  );
}

/** Rebind a key: click the chord, press the new one. Esc cancels, Backspace clears. */
function Keys({ q }: { q: string }) {
  const bind = useBindings();
  const s = useSettings();
  const [capture, setCapture] = useState<ActionId | null>(null);
  useEffect(() => {
    if (!capture) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setCapture(null);
      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) { rebind(capture, ""); return setCapture(null); }
      const c = chordOf(e);
      if (!c) return;
      rebind(capture, c); setCapture(null);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [capture]);
  const custom = Object.keys(s.keys).length;
  const groups = ["Navigate", "Panels", "Views"] as const;
  return (
    <div data-capture-keys={capture ? "" : undefined} data-testid="keybindings">
      {groups.map((g) => {
        const rows = ACTIONS.filter((a) => a.group === g && hit(q, `${a.label} ${bind(a.id)}`));
        if (!rows.length) return null;
        return (
          <Group key={g} title={g} right={g === "Navigate" && custom > 0 ? <button className="link" onClick={() => settings.set({ keys: {} })}>Reset {custom}</button> : undefined}>
            {rows.map((a) => {
              const c = bind(a.id);
              const changed = a.id in s.keys;
              return (
                <div key={a.id} className="set-row toggle key-row" data-action={a.id}>
                  <div className="set-label"><span>{a.label}</span>{changed && <small>Default {a.def}</small>}</div>
                  <div className="set-ctl">
                    <button className={`kbd-cap ${capture === a.id ? "on" : ""} ${c ? "" : "none"}`} onClick={() => setCapture(capture === a.id ? null : a.id)} aria-label={`Rebind ${a.label}`}>
                      {capture === a.id ? "Press keys" : c || "Unbound"}
                    </button>
                    {changed && <button className="btn ghost sm" aria-label={`Reset ${a.label}`} title="Reset" onClick={() => rebind(a.id, null)}><Icon.refresh /></button>}
                  </div>
                </div>
              );
            })}
          </Group>
        );
      })}
      {FIXED.some((f) => hit(q, `${f.label} ${f.keys}`)) && (
        <Group title="Fixed">
          {FIXED.filter((f) => hit(q, `${f.label} ${f.keys}`)).map((f) => (
            <div key={f.keys} className="set-row toggle key-row fixed">
              <div className="set-label"><span>{f.label}</span></div>
              <div className="set-ctl"><kbd className="kbd-cap fixed">{f.keys}</kbd></div>
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}

function GitSec({ q }: { q: string }) {
  const [o, reload, err] = useLoad<GitOverview>(hub.gitOverview);
  const [repo] = useLoad<RepoInfo>(api.repo);
  if (err) return <div className="muted set-empty">{err}</div>;
  if (!o) return <div className="muted set-empty">Loading</div>;
  return (
    <>
      <div className="set-stats">
        <Stat n={o.local} label="Local" /><Stat n={o.remote} label="Remote" /><Stat n={o.worktrees.length} label="Worktrees" /><Stat n={o.stale} label="Stale" />
      </div>
      <Group title="Repository" right={<button className="link" onClick={reload}>Refresh</button>}>
        <Row label="Base branch" hint="Ahead and behind count against it" q={q}><span className="mono">{o.base}</span></Row>
        <Row label="Remotes" hint={repo?.remotes.join(" · ") || "None"} q={q}><span className="mono">{repo?.remotes.length ?? 0}</span></Row>
      </Group>
      <Group title="Worktrees">
        {o.worktrees.map((w) => (
          <Row key={w.path} label={w.name} hint={w.path} q={q}>
            <span className="mono">{w.detached ? w.head.slice(0, 7) : w.branch}</span>
            {w.dirty > 0 && <span className="pill warn">{w.dirty} dirty</span>}
            {w.current && <span className="pill on">here</span>}
          </Row>
        ))}
      </Group>
    </>
  );
}

function IssuesSec() {
  const [meta] = useLoad(api.meta);
  const [saved, setSaved] = useState<IssueConfig | null>(null);
  const toast = useToast();
  if (!meta) return <div className="muted set-empty">Loading</div>;
  const cfg = saved ?? meta.issue_config ?? { templates: [], labels: [], milestones: [], people: [] };
  return <IssueSettingsPanel key={JSON.stringify(cfg)} cfg={cfg}
    onSave={async (c, r) => { try { setSaved(await api.issueConfig(c, r)); toast("Settings saved"); } catch (e: any) { toast(e.message, "err"); } }} />;
}

function AgentsSec({ q }: { q: string }) {
  const [m, reload] = useLoad<ConfigMatrix>(api.configMatrix);
  const [mem] = useLoad<MemoryLayer[]>(api.memoryLayers);
  const toast = useToast();
  const sync = (name: string) => api.mcpSync(name).then((r) => { toast(`Wrote ${r.written.length} file${r.written.length === 1 ? "" : "s"}`); reload(); }).catch((e) => toast(e.message, "err"));
  if (!m) return <div className="muted set-empty">Loading</div>;
  const by = (s: string) => (mem ?? []).filter((x) => x.scope === s).length;
  return (
    <>
      <div className="set-stats">
        <Stat n={m.source.servers.length} label="MCP servers" /><Stat n={m.agents.length} label="Agents" /><Stat n={m.rules.filter((r) => r.exists).length} label="Rule files" /><Stat n={(mem ?? []).length} label="Memories" />
      </div>
      <Group title="MCP servers" right={<span className="mono dim">{m.source.path}</span>}>
        {m.agents.map((a) => (
          <Row key={a.agent} label={a.agent} hint={a.missing.length ? `Missing ${a.missing.join(", ")}` : a.differs.length ? `Differs ${a.differs.join(", ")}` : a.path} q={q}>
            <span className={`pill ${a.missing.length || a.differs.length ? "warn" : "ok"}`}>{a.missing.length || a.differs.length ? "Out of sync" : "In sync"}</span>
            {m.source.servers.length > 0 && (a.missing.length > 0 || a.differs.length > 0) && <button className="btn sm" onClick={() => m.source.servers.forEach(sync)}>Sync</button>}
          </Row>
        ))}
      </Group>
      <Group title="Rules">
        {m.rules.map((r) => <Row key={r.path} label={r.agent} hint={r.path} q={q}><span className="mono dim">{r.exists ? size(r.bytes) : "None"}</span></Row>)}
      </Group>
      <Group title="Memory">
        <Row label="Repository" q={q}><span className="mono">{by("repo")}</span></Row>
        <Row label="Workflow" q={q}><span className="mono">{by("workflow")}</span></Row>
        <Row label="Task" q={q}><span className="mono">{by("task")}</span></Row>
      </Group>
    </>
  );
}

function Plugins({ q }: { q: string }) {
  const [inst, reloadI] = useLoad(hub.extInstalled);
  const [src, reloadS] = useLoad(hub.extSources);
  const [spec, setSpec] = useState("");
  const toast = useToast();
  const act = (a: Parameters<typeof hub.extAction>[0], body: object, ok: string) =>
    hub.extAction(a, body).then(() => { toast(ok); reloadI(); reloadS(); }).catch((e) => toast(e.message, "err"));
  const list: ExtInstalled[] = inst?.installed ?? [];
  const sources: ExtSource[] = src?.sources ?? [];
  return (
    <>
      <div className="set-stats">
        {(["skill", "prompt", "mcp"] as const).map((k) => <Stat key={k} n={list.filter((x) => x.kind === k).length} label={k === "mcp" ? "MCP" : `${k[0].toUpperCase()}${k.slice(1)}s`} />)}
        <Stat n={sources.length} label="Sources" />
      </div>
      <Group title="Installed">
        {list.length === 0 && <div className="muted set-empty">Nothing installed yet; browse in Extensions</div>}
        {list.filter((x) => hit(q, `${x.name} ${x.kind} ${x.source}`)).map((x) => (
          <div key={x.id} className="set-row toggle">
            <div className="set-label"><span><em className={`kind k-${x.kind}`}>{x.kind}</em> {x.name}</span><small>{x.source} · {relTime(x.at)}{x.needs.length ? ` · needs ${x.needs.join(", ")}` : ""}</small></div>
            <div className="set-ctl"><button className="btn sm" onClick={() => confirm(`Uninstall ${x.name}?`) && act("uninstall", { kind: x.kind, name: x.name }, "Uninstalled")}>Uninstall</button></div>
          </div>
        ))}
      </Group>
      <Group title="Sources">
        {sources.filter((s) => hit(q, `${s.label} ${s.url}`)).map((s) => (
          <div key={s.id} className="set-row toggle">
            <div className="set-label"><span>{s.label}</span><small>{s.kind} · {s.url || "this repository"}</small></div>
            <div className="set-ctl">{s.builtin ? <span className="pill">Built in</span> : <button className="btn sm" onClick={() => act("remove-source", { id: s.id }, "Source removed")}>Remove</button>}</div>
          </div>
        ))}
        <form className="set-add" onSubmit={(e) => { e.preventDefault(); if (spec.trim()) act("add-source", { spec: spec.trim() }, "Source added").then(() => setSpec("")); }}>
          <input className="input" placeholder="owner/repo, catalog URL or registry" value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="New source" />
          <button className="btn sm" disabled={!spec.trim()}>Add</button>
        </form>
      </Group>
    </>
  );
}

function Account({ q }: { q: string }) {
  const [repo] = useLoad<RepoInfo>(api.repo);
  const [st, reload, err] = useLoad<StoreSummary>(hub.store);
  const [log, reloadLog] = useLoad(() => hub.storeLog(6));
  const [busy, setBusy] = useState("");
  const toast = useToast();
  const act = async (a: "snapshot" | "push" | "pull", ok: string) => {
    if (a === "push" && !confirm("Push the kulastore to the remote? Memory, skills and config become visible to anyone with access.")) return;
    if (a === "pull" && !confirm("Pull the kulastore from the remote into this repository?")) return;
    setBusy(a);
    try { await hub.storeAction(a, a === "snapshot" ? { message: "Snapshot from settings" } : {}); toast(ok); reload(); reloadLog(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(""); }
  };
  const commits: StoreCommit[] = log?.log ?? [];
  return (
    <>
      <Group title="Identity">
        <Row label="Git user" hint="From git config; kula signs notes and issues with it" q={q}><span className="mono">{repo?.user || "Not set"}</span></Row>
        <Row label="kula" hint={repo?.root} q={q}><span className="mono">{repo?.version}</span></Row>
      </Group>
      <Group title="Kulastore" right={st && <span className="mono dim">{st.head ? st.head.slice(0, 7) : "Empty"}</span>}>
        {err && <div className="muted set-empty">{err}</div>}
        {st && (
          <>
            <div className="set-stats in">
              {Object.entries(st.sections).map(([k, n]) => <Stat key={k} n={n} label={k} />)}
              <Stat n={st.changed} label="Changed" />
            </div>
            <Row label="Snapshot" hint="Commit agent memory, skills and config to the private store" q={q}>
              <button className="btn sm" disabled={!!busy} onClick={() => act("snapshot", "Snapshot saved")}>{busy === "snapshot" ? "Saving" : "Snapshot"}</button>
            </Row>
            <Row label="Sync" hint="Stays private until you push" q={q}>
              <button className="btn sm" disabled={!!busy} onClick={() => act("pull", "Pulled")}>Pull</button>
              <button className="btn sm" disabled={!!busy || !st.commits} onClick={() => act("push", "Pushed")}>Push</button>
            </Row>
          </>
        )}
        {commits.map((c) => <Row key={c.sha} label={c.subject} hint={`${c.sha.slice(0, 7)} · ${relTime(c.time)} · ${c.files} files`}><span /></Row>)}
      </Group>
    </>
  );
}

function Langs({ q }: { q: string }) {
  const [rows, setRows] = useState<LangRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = () => api.langs().then((r) => setRows(r.detected)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const add = (ids: string[]) => {
    setBusy(ids.join(" ")); setNote("");
    api.langsAdd(ids).then(() => { setNote(`Installed ${ids.join(", ")} and reindexed`); load(); }).catch((e) => setNote(e.message)).finally(() => setBusy(""));
  };
  if (!rows) return null;
  const missing = rows.filter((r) => !r.indexed);
  const indexed = rows.filter((r) => r.indexed);
  return (
    <Group title="Language packs">
      <Row label="Indexed" hint={indexed.length ? indexed.map((r) => `${r.name} (${r.files})`).join(" · ") : "No source files found"} q={q}><span className="mono">{indexed.length}</span></Row>
      {missing.map((r) => (
        <Row key={r.id} label={r.name} hint={`${r.files} file${r.files === 1 ? "" : "s"} skipped, needs the ${r.id} language pack`} q={q}>
          <button className="btn sm" disabled={!!busy} onClick={() => add([r.id])}>{busy.split(" ").includes(r.id) ? "Installing" : "Install"}</button>
        </Row>
      ))}
      {missing.length > 1 && <Row label="Install all" hint={note || "kula lang add --detected"} q={q}><button className="btn sm" disabled={!!busy} onClick={() => add(missing.map((r) => r.id))}>Install {missing.length}</button></Row>}
      {missing.length <= 1 && note && <div className="muted set-empty">{note}</div>}
    </Group>
  );
}

function Disk({ q }: { q: string }) {
  const [after, setAfter] = useState<number | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { api.clean().then((c) => { setAfter(c.policy.after_min); setUsed(c.size_bytes); }).catch(() => {}); }, []);
  const pick = (m: number) => { setAfter(m); api.setClean(m).catch((e) => setNote(e.message)); };
  const now = () => { setNote("Cleaning"); api.cleanNow().then((r) => { setUsed(r.size_bytes); setNote(r.freed_bytes ? `Freed ${size(r.freed_bytes)}` : "Already clean"); }).catch((e) => setNote(e.message)); };
  if (after === null) return null;
  return (
    <Group title="Cleanup">
      <Row label="Clean up after" hint={after ? `Idle ${after} min clears old run copies, temp files and caches` : "Off; use Clean now or kula clean"} q={q}>
        <Seg value={after} options={[[0, "Off"], [5, "5m"], [10, "10m"], [15, "15m"], [20, "20m"], [30, "30m"], [60, "1h"]]} onChange={pick} />
      </Row>
      <Row label="Disk used" hint={note || ".kula in this repository"} q={q}>
        <span className="mono">{used === null ? "0" : size(used)}</span>
        <button className="btn sm" onClick={now}>Clean now</button>
      </Row>
    </Group>
  );
}

// ------------------------------------------------------------------ dialog
export default function SettingsPanel({ section, setSection, onClose }: { section: SettingsSection; setSection: (s: SettingsSection) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  // Subscribe once: re-adding the listener during an Escape dispatch would miss that key.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-capture-keys]")) close.current(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const shown = useMemo(() => SECTIONS.filter((s) => !q || hit(q, `${s.label} ${s.words}`)), [q]);
  const cur = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  useEffect(() => { if (q && shown.length && !shown.includes(cur)) setSection(shown[0].id); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // Search narrows the sections; rows inside filter only when the section name itself did not match.
  const rq = q && !hit(q, `${cur.label} ${cur.words}`) ? q : "";
  const Ico = I[cur.id];
  const body: Record<SettingsSection, ReactNode> = {
    general: <General q={rq} />, appearance: <Appearance q={rq} />, keys: <Keys q={rq} />, graph: <GraphSec q={rq} />, colours: <Colours q={rq} />,
    git: <GitSec q={rq} />, issues: <IssuesSec />, agents: <AgentsSec q={rq} />, extensions: <Plugins q={rq} />, account: <Account q={rq} />,
    langs: <Langs q={rq} />, disk: <Disk q={rq} />,
  };
  let last = "";
  return (
    <div className="scrim" onMouseDown={onClose}>
      <section className="settings dialog" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-main">
          <nav className="set-nav" aria-label="Settings sections">
            <div className="set-search">
              <Icon.search />
              <input type="search" placeholder="Search settings" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search settings" autoFocus />
            </div>
            {shown.map((s) => {
              const head = s.group !== last ? (last = s.group) : null;
              const Ic = I[s.id];
              return (
                <div key={s.id} className="set-nav-item">
                  {head && <div className="set-nav-grp">{head}</div>}
                  <button className={cur.id === s.id ? "on" : ""} style={{ "--hue": s.hue } as CSSProperties} onClick={() => setSection(s.id)} data-section={s.id}>
                    <span className="set-ico"><Ic /></span>{s.label}
                  </button>
                </div>
              );
            })}
            {!shown.length && <div className="muted set-empty">Nothing matches</div>}
          </nav>
          <div className="set-pane" style={{ "--hue": cur.hue } as CSSProperties}>
            <header>
              <span className="set-ico lg"><Ico /></span>
              <h2>{cur.label}</h2>
              <span className="spacer" />
              <span className="muted set-where">{cur.group === "You" || cur.id === "graph" || cur.id === "colours" ? "Saved in this browser" : "Saved to this repository"}</span>
              <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon.close /></button>
            </header>
            <div className="set-body" data-testid={`settings-${cur.id}`}>{body[cur.id]}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
