import { useEffect, useState } from "react";
import { api, colorFor, relTime, type Compare, type Flow, type Meta, type Node } from "../api";
import { Empty, Icon, Kind, Md, Sym, useToast } from "../ui";
import { CompareReport } from "./GitViews";
import type { Go, Target } from "../nav";
import { Grip, listWidth } from "../resize";
import { NotesGraph } from "./NotesGraph";
import { CodeField, HereHint, LinkArea } from "../Autofill";

type Nav = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

async function openByName(name: string, openSymbol: (id: number) => void) {
  const hits = await api.search(name.replace(/^(symbol|file):/, "").split(":").pop() ?? name);
  if (hits[0]) openSymbol(hits[0].id);
}

function Thread({ comments, onSend }: { comments: { author: string; body: string; at: number }[]; onSend: (b: string) => Promise<void> }) {
  const [b, setB] = useState("");
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="section-title">Discussion <span className="count">{comments.length}</span></div>
      {comments.map((c, i) => (
        <div key={i} style={{ padding: "10px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)" }}>
          <div className="row" style={{ marginBottom: 4 }}><b style={{ fontWeight: 600 }}>{c.author}</b><span className="muted">{relTime(c.at)}</span></div>
          <Md text={c.body} />
        </div>
      ))}
      <textarea className="textarea" placeholder="Leave a comment…" value={b} onChange={(e) => setB(e.target.value)} />
      <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!b.trim()} onClick={() => onSend(b).then(() => setB(""))}>Comment</button></div>
    </div>
  );
}

// ============================================================ Issues
export function Issues({ version, onChanged, openSymbol, target }: Nav) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sel, setSel] = useState<number | "new" | null>(target?.issue ?? null);
  const [show, setShow] = useState<"open" | "closed">("open");
  const [form, setForm] = useState({ title: "", body: "", labels: "", anchors: "" });
  const toast = useToast();
  const load = () => api.meta().then(setMeta);
  useEffect(() => { load(); }, [version]);
  const list = meta?.issues.filter((i) => i.status === show).sort((a, b) => b.id - a.id) ?? [];
  const issue = typeof sel === "number" ? meta?.issues.find((i) => i.id === sel) : null;
  useEffect(() => { if (sel == null && list[0]) setSel(list[0].id); }, [list.length]);
  const act = async (action: string | number, body: Record<string, unknown>, ok?: string) => {
    try { await api.metaAction("issues", action, body); if (ok) toast(ok); await load(); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="split" style={listWidth("issues", 340)}>
      <div className="list">
        <div className="list-head">
          <h2>Issues</h2>
          <div className="seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</button><button className={show === "closed" ? "on" : ""} onClick={() => setShow("closed")}>Closed</button></div>
          <span className="spacer" /><button className="btn sm primary" onClick={() => setSel("new")}><Icon.plus /> New</button>
        </div>
        {list.length === 0 && <Empty title={`No ${show} issues`}>Issues live in <code>refs/kula/meta</code> and travel with <code>kula sync</code>.</Empty>}
        {list.map((i) => (
          <div key={i.id} className={`item ${sel === i.id ? "on" : ""}`} onClick={() => setSel(i.id)}>
            <span style={{ color: i.status === "open" ? "var(--green)" : "var(--text-3)", marginTop: 1 }}><Icon.issues /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title">{i.title}</div>
              <div className="sub row" style={{ gap: 6, flexWrap: "wrap" }}>#{i.id} · {i.author} · {relTime(i.created)}{i.labels.map((l) => <span key={l} className="tag violet" style={{ height: 17 }}>{l}</span>)}{i.comments.length > 0 && <span>· {i.comments.length} 💬</span>}</div>
            </div>
          </div>
        ))}
      </div>
      <Grip id="issues" edge="right" target="prev" min={220} max={900} label="Resize list" />
      <div className="detail">
        {sel === "new" ? (
          <div className="detail-pad stack" style={{ maxWidth: 720 }}>
            <h1>New issue</h1>
            <input className="input" placeholder="Title" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="textarea" style={{ minHeight: 160 }} placeholder="Describe it. Link code with [[symbolName]]." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="row"><input className="input" placeholder="Labels (comma separated)" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} /><input className="input" placeholder="Anchor symbols/files (comma separated)" value={form.anchors} onChange={(e) => setForm({ ...form, anchors: e.target.value })} /></div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setSel(null)}>Cancel</button>
              <button className="btn primary" disabled={!form.title.trim()} onClick={async () => {
                await act("new", { title: form.title, body: form.body, labels: split(form.labels), anchors: split(form.anchors) }, "Issue opened");
                setForm({ title: "", body: "", labels: "", anchors: "" }); setSel(null);
              }}>Open issue</button>
            </div>
          </div>
        ) : issue ? (
          <div className="detail-pad" style={{ maxWidth: 820 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}><h1>{issue.title} <span className="muted" style={{ fontWeight: 400 }}>#{issue.id}</span></h1>
                <div className="row" style={{ marginBottom: 14 }}><span className={`tag ${issue.status === "open" ? "green" : ""}`}>{issue.status}</span><span className="muted">{issue.author} opened {relTime(issue.created)}</span></div></div>
              <button className="btn" onClick={() => act(issue.id, { status: issue.status === "open" ? "closed" : "open" }, issue.status === "open" ? "Closed" : "Reopened")}>{issue.status === "open" ? "Close issue" : "Reopen"}</button>
            </div>
            {issue.body ? <Md text={issue.body} onSymbol={(n) => openByName(n, openSymbol)} /> : <span className="muted">No description.</span>}
            {issue.anchors.length > 0 && (<><div className="section-title">Anchored to</div><div className="row" style={{ flexWrap: "wrap" }}>{issue.anchors.map((a) => <button key={a} className="btn sm" onClick={() => openByName(a, openSymbol)}>⌖ {a}</button>)}</div></>)}
            <Thread comments={issue.comments} onSend={(b) => act(issue.id, { body: b })} />
          </div>
        ) : <Empty title="Select an issue" />}
      </div>
    </div>
  );
}

// ============================================================ Proposals (local PRs)
export function Proposals({ version, onChanged, openSymbol, target }: Nav) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sel, setSel] = useState<number | null>(target?.proposal ?? null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [show, setShow] = useState<"open" | "done">("open");
  const toast = useToast();
  const load = () => api.meta().then(setMeta);
  useEffect(() => { load(); }, [version]);
  const list = meta?.proposals.filter((p) => (show === "open" ? p.status === "open" : p.status !== "open")).sort((a, b) => b.id - a.id) ?? [];
  const p = meta?.proposals.find((x) => x.id === sel) ?? null;
  useEffect(() => { if (sel == null && list[0]) setSel(list[0].id); }, [list.length]);
  useEffect(() => { setCmp(null); if (p && p.status === "open") api.compare(p.base, p.head).then(setCmp).catch(() => {}); }, [sel, p?.status]);
  const act = async (body: Record<string, unknown>, ok?: string) => {
    if (!p) return;
    try { await api.metaAction("proposals", p.id, body); if (ok) toast(ok); await load(); onChanged(); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="split" style={listWidth("proposals", 340)}>
      <div className="list">
        <div className="list-head">
          <h2>Proposals</h2>
          <div className="seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open</button><button className={show === "done" ? "on" : ""} onClick={() => setShow("done")}>Done</button></div>
        </div>
        {list.length === 0 && <Empty title="No proposals">Open one from <b>Branches → Compare</b> or <code>kula pr new</code>.</Empty>}
        {list.map((x) => (
          <div key={x.id} className={`item ${sel === x.id ? "on" : ""}`} onClick={() => setSel(x.id)}>
            <span style={{ color: x.status === "open" ? "var(--green)" : x.status === "merged" ? "var(--violet)" : "var(--text-3)" }}><Icon.pr /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="title">{x.title}</div>
              <div className="sub">#{x.id} · <span className="mono">{x.head} → {x.base}</span> · {relTime(x.created)}</div>
            </div>
          </div>
        ))}
      </div>
      <Grip id="proposals" edge="right" target="prev" min={220} max={900} label="Resize list" />
      <div className="detail">
        {p ? (
          <div className="detail-pad">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <h1>{p.title} <span className="muted" style={{ fontWeight: 400 }}>#{p.id}</span></h1>
                <div className="row" style={{ marginBottom: 14 }}>
                  <span className={`tag ${p.status === "open" ? "green" : p.status === "merged" ? "violet" : ""}`}>{p.status}</span>
                  <span className="muted">{p.author} wants to merge <span className="mono" style={{ color: "var(--text)" }}>{p.head}</span> into <span className="mono" style={{ color: "var(--text)" }}>{p.base}</span></span>
                </div>
              </div>
              {p.status === "open" && (<>
                <button className="btn" onClick={() => act({ status: "closed" }, "Closed")}>Close</button>
                <button className="btn primary" onClick={() => { if (confirm(`Merge ${p.head} into ${p.base}? Kula will switch to ${p.base} and create a merge commit.`)) act({ status: "merged" }, "Merged"); }}>Merge</button>
              </>)}
            </div>
            {p.body && <div style={{ marginBottom: 14 }}><Md text={p.body} /></div>}
            {p.merged_sha && <div className="muted">Merged as <span className="mono">{p.merged_sha.slice(0, 10)}</span></div>}
            {cmp && <CompareReport c={cmp} openSymbol={openSymbol} />}
            <Thread comments={p.comments} onSend={(b) => act({ body: b })} />
          </div>
        ) : <Empty title="Select a proposal" />}
      </div>
    </div>
  );
}

// ============================================================ Notes
export function Notes({ version, onChanged, openSymbol }: Nav) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState("repo");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [sel, setSel] = useState("");
  const [graphOn, setGraphOn] = useState(() => { try { return localStorage.getItem("kula.notes.graph") !== "off"; } catch { return true; } });
  const toggleGraph = () => { const v = !graphOn; setGraphOn(v); if (!v) setSel(""); try { localStorage.setItem("kula.notes.graph", v ? "on" : "off"); } catch { /* */ } };
  const toast = useToast();
  const load = () => api.meta().then(setMeta);
  useEffect(() => { load(); }, [version]);
  const notes = (meta?.notes ?? []).filter((n) => !q || (n.body + n.target).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updated - a.updated);
  const groups = new Map<string, typeof notes>();
  notes.forEach((n) => groups.set(n.target, [...(groups.get(n.target) ?? []), n]));
  const shown = sel ? notes.filter((n) => n.target === sel) : notes;
  // picking a target in the graph points the editor at it
  useEffect(() => { if (sel && !editing) setTarget(sel); }, [sel]);
  const save = async () => {
    try {
      if (editing) await api.metaAction("notes", editing, { body });
      else await api.metaAction("notes", "new", { target, body });
      toast("Saved"); setBody(""); setEditing(null); await load(); onChanged();
    } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div className="split" style={listWidth("notes", 380)}>
      <div className="list">
        <div className="list-head" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="row"><h2>{editing ? `Edit note #${editing}` : "New note"}</h2><span className="spacer" />{editing && <button className="btn sm ghost" onClick={() => { setEditing(null); setBody(""); }}>Cancel</button>}</div>
        </div>
        <div className="stack" style={{ padding: 14 }}>
          {!editing && (
            <div className="stack-tight">
              <CodeField value={target} onChange={setTarget} placeholder="repo · file:path · symbol:name · commit:sha" label="Note target" />
              <HereHint onUse={setTarget} />
            </div>
          )}
          <LinkArea minHeight={200} placeholder={"Write in markdown-ish text.\n`code`, **bold**, [[ links a symbol – it autofills.\n\nNotes are versioned in git and visible to AI agents via MCP."} value={body} onChange={setBody}
            onSubmit={() => { if (body.trim()) save(); }} label="Note text" />
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!body.trim()} onClick={save}>{editing ? "Update" : "Save note"}</button></div>
        </div>
      </div>
      <Grip id="notes" edge="right" target="prev" min={220} max={900} label="Resize list" />
      <div className="detail" style={{ padding: 0 }}>
        <div className="notes-split" style={graphOn ? undefined : { gridTemplateColumns: "1fr" }}>
          {graphOn && <NotesGraph notes={meta?.notes ?? []} sel={sel} onPick={setSel} />}
          <aside className="notes-side detail-pad" style={graphOn ? undefined : { borderLeft: 0, maxWidth: 980 }}>
            <div className="row" style={{ marginBottom: 12 }}><h1>Notes</h1><span className="muted">{shown.length}</span><span className="spacer" />{sel && <button className="btn sm ghost" onClick={() => setSel("")}>All</button>}<button className={`btn sm graph-toggle ${graphOn ? "on" : ""}`} aria-pressed={graphOn} onClick={toggleGraph} title="Show notes as a graph beside the list"><Icon.graph /> Graph {graphOn ? "on" : "off"}</button></div>
            <input className="input" style={{ width: "100%", marginBottom: 14 }} placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
            {shown.length === 0 && <Empty title={sel ? "No notes here" : "No notes yet"}>{sel ? "Write one on the left – the target is filled in." : "Annotate the repo, any file, symbol, commit or cluster."}</Empty>}
            {[...groups.entries()].filter(([t]) => !sel || t === sel).map(([t, list]) => (
              <div key={t} style={{ marginBottom: 18 }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <button className="btn sm ghost mono" onClick={() => t !== "repo" && openByName(t, openSymbol)}>{t.startsWith("file:") ? <Icon.doc /> : t.startsWith("symbol:") ? "ƒ" : t.startsWith("commit:") ? <Icon.history /> : <Icon.box />} {t}</button>
                </div>
                {list.map((n) => (
                  <div key={n.id} className={`note ${n.kind === "memory" ? "mem" : ""}`}>
                    <Md text={n.body} onSymbol={(s) => openByName(s, openSymbol)} />
                    <div className="row" style={{ marginTop: 8, fontSize: 11.5 }}>
                      {n.kind === "memory" && <span className="tag accent" title="An agent memory – see Agents">memory</span>}
                      <span className="muted">#{n.id} · {n.author} · {relTime(n.updated)}</span><span className="spacer" />
                      <button className="btn sm ghost" onClick={() => { setEditing(n.id); setBody(n.body); }}>Edit</button>
                      <button className="btn sm ghost danger" onClick={async () => { if (confirm("Delete this note?")) { await api.metaAction("notes", n.id, { status: "deleted" }); load(); } }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Flows
export function Flows({ openSymbol, version }: Nav) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [sel, setSel] = useState(0);
  useEffect(() => { api.flows().then(setFlows).catch(() => setFlows([])); }, [version]);
  const f = flows?.[sel];
  return (
    <div className="split" style={listWidth("flows", 340)}>
      <div className="list">
        <div className="list-head"><h2>Execution flows</h2><span className="muted">{flows?.length ?? ""}</span></div>
        {flows?.length === 0 && <Empty title="No flows found">Entry points are functions nothing calls that call at least two others.</Empty>}
        {flows?.map((x, i) => (
          <div key={x.entry.id} className={`item ${sel === i ? "on" : ""}`} onClick={() => setSel(i)}>
            <span className="dot" style={{ background: colorFor(x.entry.community) }} />
            <div style={{ minWidth: 0, flex: 1 }}><div className="title mono">{x.entry.name}</div><div className="sub">{x.entry.path} · reaches {x.reach}</div></div>
          </div>
        ))}
      </div>
      <Grip id="flows" edge="right" target="prev" min={220} max={900} label="Resize list" />
      <div className="detail">
        {f && (
          <div className="detail-pad">
            <h1 className="mono row" style={{ gap: 10 }}><Kind kind={f.entry.kind} community={f.entry.community} size={22} />{f.entry.name}</h1>
            <div className="muted" style={{ marginBottom: 18 }}>{f.entry.path}:{f.entry.start_line} · reaches {f.reach} symbols</div>
            {[1, 2, 3, 4].map((d) => {
              const steps = f.steps.filter((s) => s.depth === d);
              return steps.length ? (
                <div key={d} className="flow-step" style={{ marginLeft: (d - 1) * 22 }}>
                  <div className="section-title">Step {d}</div>
                  {steps.map((s) => <Sym key={s.node.id} n={s.node} onClick={(n) => openSymbol(n.id)} />)}
                </div>
              ) : null;
            })}
            <button className="btn" style={{ marginTop: 12 }} onClick={() => openSymbol(f.entry.id)}>Show on graph</button>
          </div>
        )}
      </div>
    </div>
  );
}
