// Extensions: browse skills, prompts and MCP servers from web catalogs and our
// own store, install them, and publish new entries. Controls dock on the right.
import { useEffect, useMemo, useState } from "react";
import { hub, relTime, type ExtDraft, type ExtEntry, type ExtInstalled, type ExtSource } from "../api";
import { Docked } from "../studio/Dock";
import { Icon, useToast } from "../ui";

type Kind = "" | "skill" | "prompt" | "mcp";
const KINDS: [Kind, string, () => React.ReactElement][] = [
  ["", "All kinds", Icon.box],
  ["skill", "Skills", Icon.flask],
  ["prompt", "Prompts", Icon.doc],
  ["mcp", "MCP servers", Icon.plug],
];
const BLANK: ExtDraft = { kind: "skill", name: "", description: "", body: "", version: "0.1.0", command: "", args: [], url: "", env: [] };

function IB({ on, label, onClick, disabled, children }: { on?: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className={`ib${on ? " on" : ""}`} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>{children}</button>;
}

export default function Extensions({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [sources, setSources] = useState<ExtSource[]>([]);
  const [src, setSrc] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ExtEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [installed, setInstalled] = useState<ExtInstalled[]>([]);
  const [sel, setSel] = useState<ExtEntry | null>(null);
  const [draft, setDraft] = useState<ExtDraft>(BLANK);
  const [newSrc, setNewSrc] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    hub.extSources().then((r) => { setSources(r.sources); setSrc((s) => s || r.sources[0]?.id || ""); }).catch((e) => setErr(e.message));
    hub.extInstalled().then((r) => setInstalled(r.installed)).catch(() => {});
  }, [version, tick]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!src) return;
    setBusy(true); setErr("");
    hub.extBrowse(src, query, kind)
      .then((p) => { setRows(p.entries); setNext(p.next ?? null); })
      .catch((e) => { setRows([]); setNext(null); setErr(e.message); })
      .finally(() => setBusy(false));
  }, [src, query, kind, tick]);

  const more = () => next && hub.extBrowse(src, query, kind, next).then((p) => { setRows((r) => [...r, ...p.entries]); setNext(p.next ?? null); }).catch((e) => toast(e.message, "err"));
  const have = useMemo(() => new Set(installed.map((i) => `${i.kind}:${i.name}`)), [installed]);
  const isIn = (e: ExtEntry) => have.has(`${e.kind}:${e.name}`);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); setTick((t) => t + 1); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  const install = (e: ExtEntry) => act(() => hub.extAction("install", { entry: e }), `Installed ${e.name}`);
  const uninstall = (i: { kind: string; name: string }) => confirm(`Uninstall ${i.name}?`) && act(() => hub.extAction("uninstall", { kind: i.kind, name: i.name }), `Removed ${i.name}`);
  const publish = () => act(() => hub.extAction("publish", { draft }), `Published ${draft.name}`).then(() => setDraft(BLANK));
  const source = sources.find((s) => s.id === src);

  return (
    <div className="ext" data-testid="extensions">
      <div className="ext-grid" role="list" aria-busy={busy}>
        {err && <div className="card-empty">{err}</div>}
        {!err && !busy && rows.length === 0 && <div className="card-empty">Nothing here yet.</div>}
        {rows.map((e) => (
          <article key={`${e.source}:${e.id}`} role="listitem" className={`ext-card${sel?.id === e.id ? " on" : ""}`} onClick={() => setSel(e)} data-testid={`ext-${e.id}`}>
            <header>
              <span className={`kind k-${e.kind}`}>{e.kind}</span>
              <span className="spacer" />
              {e.version && <span className="mono dim">{e.version}</span>}
            </header>
            <h3>{e.name}</h3>
            <p>{e.description || "No description."}</p>
            <footer>
              <span className="mono dim">{e.author || e.source}</span>
              <span className="spacer" />
              {isIn(e)
                ? <button className="btn sm ghost" onClick={(x) => { x.stopPropagation(); uninstall(e); }}>Installed</button>
                : <button className="btn sm" onClick={(x) => { x.stopPropagation(); install(e); }}>Install</button>}
            </footer>
          </article>
        ))}
        {next && <button className="btn sm ghost ext-more" onClick={more}>Load more</button>}
      </div>

      <Docked id="ext-browse" label="Browse" icon={Icon.search} info={source?.label}>
        <div className="ct ct-side" data-testid="ext-browse">
          <div className="ct-side-head">
            <div className="ct-pick on"><b>{rows.length} result{rows.length === 1 ? "" : "s"}</b><span className="ct-sub">{source?.label ?? "No source"}</span></div>
          </div>
          <div className="ct-side-scroll">
            <section className="ct-card">
              <div className="ib-row" role="toolbar" aria-label="Kind">
                {KINDS.map(([k, label, I]) => <IB key={k || "all"} on={kind === k} label={label} onClick={() => setKind(k)}><I /></IB>)}
                <span className="ib-gap" />
                <IB label="Refresh" onClick={() => setTick((t) => t + 1)}><Icon.refresh /></IB>
              </div>
              <input className="input" placeholder="Search extensions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search extensions" />
            </section>
            <section className="ct-card">
              <h4>Source</h4>
              <div className="ib-chips">
                {sources.map((s) => <button key={s.id} className={`chip${s.id === src ? " on" : ""}`} aria-pressed={s.id === src} onClick={() => setSrc(s.id)}>{s.label}</button>)}
              </div>
            </section>
            {sel && (
              <section className="ct-card ext-sel">
                <h4>{sel.name}</h4>
                <p className="dim">{sel.description}</p>
                <div className="mono dim">{sel.install.type === "mcp" ? sel.install.command || sel.install.url : sel.install.type === "git" ? sel.install.repo : sel.install.type}</div>
                <div className="ib-row">
                  {isIn(sel) ? <IB label="Uninstall" onClick={() => uninstall(sel)}><Icon.minus /></IB> : <IB label="Install" onClick={() => install(sel)}><Icon.plus /></IB>}
                  {sel.homepage && <IB label="Open homepage" onClick={() => window.open(sel.homepage, "_blank", "noopener")}><Icon.arrow /></IB>}
                </div>
              </section>
            )}
          </div>
        </div>
      </Docked>

      <Docked id="ext-installed" label="Installed" icon={Icon.check} badge={installed.length || undefined}>
        <div className="ct ct-side" data-testid="ext-installed">
          <div className="ct-side-head"><div className="ct-pick"><b>{installed.length} installed</b><span className="ct-sub">In this repository</span></div></div>
          <div className="ct-side-scroll">
            <section className="ct-card">
              {installed.length === 0 && <span className="dim">None yet</span>}
              {installed.map((i) => (
                <div key={i.id} className="wt-row" title={i.source}>
                  <span className={`kind k-${i.kind}`}>{i.kind}</span>
                  <span className="wt-name">{i.name}</span>
                  <span className="mono dim">{relTime(i.at)}</span>
                  <IB label={`Uninstall ${i.name}`} onClick={() => uninstall(i)}><Icon.close /></IB>
                </div>
              ))}
            </section>
          </div>
        </div>
      </Docked>

      <Docked id="ext-sources" label="Sources" icon={Icon.folder} badge={sources.length || undefined}>
        <div className="ct ct-side" data-testid="ext-sources">
          <div className="ct-side-head"><div className="ct-pick"><b>{sources.length} sources</b><span className="ct-sub">Catalogs to browse</span></div></div>
          <div className="ct-side-scroll">
            <section className="ct-card">
              {sources.map((s) => (
                <div key={s.id} className="wt-row" title={s.url}>
                  <span className={`wt-dot${s.id === src ? " here" : ""}`} />
                  <span className="wt-name">{s.label}</span>
                  <span className="mono dim">{s.kind}</span>
                  {!s.builtin && <IB label={`Remove ${s.label}`} onClick={() => confirm(`Remove ${s.label}?`) && act(() => hub.extAction("remove-source", { id: s.id }), "Source removed")}><Icon.close /></IB>}
                </div>
              ))}
            </section>
            <section className="ct-card">
              <form className="set-add" onSubmit={(e) => { e.preventDefault(); if (newSrc.trim()) act(() => hub.extAction("add-source", { spec: newSrc.trim() }), "Source added").then(() => setNewSrc("")); }}>
                <input className="input" placeholder="Catalog URL or owner/repo" value={newSrc} onChange={(e) => setNewSrc(e.target.value)} aria-label="New source" />
                <IB label="Add source" disabled={!newSrc.trim()} onClick={() => {}}><Icon.plus /></IB>
              </form>
            </section>
          </div>
        </div>
      </Docked>

      <Docked id="ext-publish" label="Publish" icon={Icon.up}>
        <div className="ct ct-side" data-testid="ext-publish">
          <div className="ct-side-head"><div className="ct-pick"><b>New entry</b><span className="ct-sub">Goes to our store</span></div></div>
          <div className="ct-side-scroll">
            <section className="ct-card ext-form">
              <div className="ib-row" role="toolbar" aria-label="Entry kind">
                {KINDS.slice(1).map(([k, label, I]) => <IB key={k} on={draft.kind === k} label={label} onClick={() => setDraft({ ...draft, kind: k })}><I /></IB>)}
              </div>
              <input className="input" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Entry name" />
              <input className="input" placeholder="One line description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="Entry description" />
              {draft.kind === "mcp" ? (
                <>
                  <input className="input mono" placeholder="Command, e.g. npx" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} aria-label="Command" />
                  <input className="input mono" placeholder="Args, space separated" value={draft.args.join(" ")} onChange={(e) => setDraft({ ...draft, args: e.target.value.split(/\s+/).filter(Boolean) })} aria-label="Args" />
                  <input className="input mono" placeholder="Or a server URL" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} aria-label="Server URL" />
                </>
              ) : (
                <textarea className="input mono" rows={8} placeholder={draft.kind === "skill" ? "SKILL.md body" : "Prompt text"} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Entry body" />
              )}
              <button className="btn sm" disabled={!draft.name.trim() || (draft.kind === "mcp" ? !(draft.command || draft.url) : !draft.body.trim())} onClick={publish}>Publish</button>
            </section>
          </div>
        </div>
      </Docked>
    </div>
  );
}
