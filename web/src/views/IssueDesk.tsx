import type React from "react";
// The issue desk: find, triage and edit issues; filters dock in the sidebar. Used
// full height in the Issues view and as a card inside Overview.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, relTime, type Issue, type IssueConfig, type IssueDraft, type IssuePatch, type IssueTemplate, type LabelDef, type Meta, type Milestone, type Priority } from "../api";
import { Docked, useDockOpen } from "../studio/Dock";
import { Empty, Icon, Md, useToast } from "../ui";

type Props = { version: number; onChanged: () => void; openSymbol: (id: number) => void; target?: number | null; embedded?: boolean };

const PRIOS: Priority[] = ["urgent", "high", "medium", "low"];
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, "": 4 };
const REASONS = [["completed", "Completed"], ["not_planned", "Not planned"], ["duplicate", "Duplicate"]] as const;
const EMPTY_CFG: IssueConfig = { templates: [], labels: [], milestones: [], people: [] };
const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const day = (t?: number) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "");

async function openByName(name: string, openSymbol: (id: number) => void) {
  const hits = await api.search(name.replace(/^(symbol|file):/, "").split(":").pop() ?? name);
  if (hits[0]) openSymbol(hits[0].id);
}

function Label({ name, cfg }: { name: string; cfg: IssueConfig }) {
  const c = cfg.labels.find((l) => l.name === name)?.color;
  return <span className="tag id-label" title={cfg.labels.find((l) => l.name === name)?.description || name} style={c ? { color: c, borderColor: `${c}55` } : undefined}>{name}</span>;
}

function Prio({ p }: { p?: string }) {
  if (!p) return null;
  return <span className={`id-prio p-${p}`} title={`${p} priority`}>{p}</span>;
}

/** A select that also takes a new value typed in. */
function Pick({ value, options, onPick, placeholder, allowNone = true }: { value: string; options: string[]; onPick: (v: string) => void; placeholder: string; allowNone?: boolean }) {
  return (
    <select className="input id-pick" value={value} onChange={(e) => onPick(e.target.value)} aria-label={placeholder}>
      {allowNone && <option value="">{placeholder}</option>}
      {!allowNone && !value && <option value="" disabled>{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const SORTS: [string, string][] = [["updated", "Recently updated"], ["created", "Newest"], ["priority", "Priority"], ["comments", "Most discussed"]];
const GROUPS = ["milestone", "priority", "assignee", "label"];

function IconBtn({ on, label, onClick, disabled, children }: { on?: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button className={`ib${on ? " on" : ""}`} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>{children}</button>;
}

/** One filter's options as chips; picking the active chip again clears it. */
function FilterChips({ title, value, options, names, required, onPick }: { title: string; value: string; options: string[]; names?: Record<string, string>; required?: boolean; onPick: (v: string) => void }) {
  return (
    <section className="ct-card">
      <h4>{title}</h4>
      <div className="ib-chips">
        {options.length === 0 && <span className="dim">None yet</span>}
        {options.map((o) => <button key={o} className={`chip${value === o ? " on" : ""}`} aria-pressed={value === o} onClick={() => onPick(value === o && !required ? "" : o)}>{names?.[o] ?? (o === "none" ? "Unset" : o)}</button>)}
      </div>
    </section>
  );
}

export default function IssueDesk({ version, onChanged, openSymbol, target, embedded }: Props) {
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [sel, setSel] = useState<number | null>(target ?? null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [f, setF] = useState({ label: "", who: "", milestone: "", prio: "" });
  const [sort, setSort] = useState<"updated" | "created" | "priority" | "comments">("updated");
  const [group, setGroup] = useState<"" | "milestone" | "priority" | "assignee" | "label">("");
  const [tpl, setTpl] = useState<IssueTemplate | null>(null);

  const load = () => api.meta().then(setMeta).catch((e) => toast(e.message, "err"));
  useEffect(() => { load(); }, [version]);
  useEffect(() => { if (target != null) { setSel(target); setMode("list"); } }, [target]);

  const cfg = meta?.issue_config ?? EMPTY_CFG;
  const all = meta?.issues ?? [];
  const people = useMemo(() => [...new Set([...cfg.people, ...all.flatMap((i) => [...(i.assignees ?? []), i.author])])].sort(), [meta]);
  const labels = useMemo(() => [...new Set([...cfg.labels.map((l) => l.name), ...all.flatMap((i) => i.labels)])].sort(), [meta]);
  const milestones = useMemo(() => [...new Set([...cfg.milestones.filter((m) => m.state === "open").map((m) => m.name), ...all.map((i) => i.milestone ?? "").filter(Boolean)])], [meta]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const num = /^#?(\d+)$/.exec(needle)?.[1];
    const out = all.filter((i) =>
      (show === "all" || i.status === show) &&
      (!f.label || i.labels.includes(f.label)) &&
      (!f.who || (f.who === "none" ? !(i.assignees ?? []).length : (i.assignees ?? []).includes(f.who))) &&
      (!f.milestone || (i.milestone ?? "") === (f.milestone === "none" ? "" : f.milestone)) &&
      (!f.prio || (i.priority ?? "") === (f.prio === "none" ? "" : f.prio)) &&
      (!needle || (num ? String(i.id) === num : `${i.title} ${i.body} ${i.labels.join(" ")} ${i.author} ${(i.assignees ?? []).join(" ")}`.toLowerCase().includes(needle))));
    const by: Record<typeof sort, (a: Issue, b: Issue) => number> = {
      updated: (a, b) => (b.updated || b.created) - (a.updated || a.created),
      created: (a, b) => b.created - a.created,
      priority: (a, b) => PRIO_RANK[a.priority ?? ""] - PRIO_RANK[b.priority ?? ""] || b.id - a.id,
      comments: (a, b) => b.comments.length - a.comments.length,
    };
    return out.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || by[sort](a, b));
  }, [meta, q, show, f, sort]);

  const groups = useMemo((): [string, Issue[]][] => {
    if (!group) return [["", list]];
    const m = new Map<string, Issue[]>();
    for (const i of list) {
      const keys = group === "milestone" ? [i.milestone || "No milestone"] : group === "priority" ? [i.priority || "No priority"] : group === "assignee" ? ((i.assignees ?? []).length ? i.assignees! : ["Unassigned"]) : (i.labels.length ? i.labels : ["No label"]);
      for (const k of keys) m.set(k, [...(m.get(k) ?? []), i]);
    }
    const order = group === "priority" ? (k: string) => PRIO_RANK[k] ?? 9 : () => 0;
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [list, group]);

  const dockOpen = useDockOpen();
  useEffect(() => { if (mode === "list" && sel == null && list[0] && !embedded) setSel(list[0].id); }, [list.length, mode]);
  const issue = sel != null ? all.find((i) => i.id === sel) ?? null : null;

  const run = async <T,>(p: Promise<T>, ok?: string) => {
    try { const v = await p; if (ok) toast(ok); await load(); onChanged(); return v; } catch (e: any) { toast(e.message, "err"); return null; }
  };
  const patch = (ids: number[], p: IssuePatch, ok?: string) => run(api.issuePatch(ids, p), ok);
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = list.length > 0 && list.every((i) => picked.has(i.id));
  const ids = [...picked];
  const nf = [f.label, f.who, f.milestone, f.prio].filter(Boolean).length;
  const filtered = !!(q || nf);
  const clear = () => { setQ(""); setF({ label: "", who: "", milestone: "", prio: "" }); };

  const open = all.filter((i) => i.status === "open").length;

  return (
    <div className={`idesk ${embedded ? "embedded" : ""}`} data-testid="issue-desk">
      {embedded && (
        <div className="id-bar">
          <input className="input id-search" placeholder="Search or #id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search issues" onFocus={() => setMode("list")} />
          <span className="spacer" />
          <button className="btn sm" onClick={() => { setTpl(null); setMode(mode === "new" ? "list" : "new"); }} aria-pressed={mode === "new"}><Icon.plus />New issue</button>
        </div>
      )}

      {!embedded && (
        <Docked id="issue-filters" label="Issues" icon={Icon.issues} badge={nf || undefined}>
          <div className="ct ct-side id-side" data-testid="issue-filters">
            <div className="ct-side-scroll">
              <section className="ct-card">
                <div className="id-find">
                  <input className="input" placeholder="Search or #id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search issues" onFocus={() => setMode("list")} />
                  <IconBtn on={mode === "new"} label="New issue" onClick={() => { setTpl(null); setMode(mode === "new" ? "list" : "new"); if (mode !== "new") dockOpen(null); }}><Icon.plus /></IconBtn>
                </div>
                <div className="ib-chips" role="group" aria-label="Status">
                  {([["open", open], ["closed", all.length - open], ["all", all.length]] as const).map(([k, n]) => (
                    <button key={k} className={`chip${mode === "list" && show === k ? " on" : ""}`} aria-pressed={mode === "list" && show === k} onClick={() => { setShow(k); setMode("list"); }}>{k[0].toUpperCase() + k.slice(1)} <em>{n}</em></button>
                  ))}
                </div>
              </section>
              {labels.length > 0 && <FilterChips title="Label" value={f.label} options={labels} onPick={(v) => setF({ ...f, label: v })} />}
              {people.length > 0 && <FilterChips title="Assignee" value={f.who} options={["none", ...people]} onPick={(v) => setF({ ...f, who: v })} />}
              {milestones.length > 0 && <FilterChips title="Milestone" value={f.milestone} options={["none", ...milestones]} onPick={(v) => setF({ ...f, milestone: v })} />}
              <FilterChips title="Priority" value={f.prio} options={["none", ...PRIOS]} onPick={(v) => setF({ ...f, prio: v })} />
              <FilterChips title="Sort" value={sort} options={SORTS.map((x) => x[0])} names={Object.fromEntries(SORTS)} required onPick={(v) => setSort((v || "updated") as typeof sort)} />
              <FilterChips title="Group" value={group} options={GROUPS} onPick={(v) => setGroup(v as typeof group)} />
              {cfg.templates.length > 0 && (
                <section className="ct-card">
                  <h4>Templates</h4>
                  <div className="ib-chips">{cfg.templates.map((t) => <button key={t.name} className="chip" onClick={() => { setTpl(t); setMode("new"); dockOpen(null); }}>{t.name}</button>)}</div>
                </section>
              )}
              {filtered && <button className="btn sm ghost id-clear" onClick={clear}><Icon.close />Clear filters</button>}
            </div>
          </div>
        </Docked>
      )}

      {mode === "list" && picked.size > 0 && (
        <Bulk n={picked.size} labels={labels} people={people} milestones={milestones}
          onPatch={(p, ok) => patch(ids, p, ok)}
          onDelete={async () => { if (!confirm(`Delete ${ids.length} issue(s)? This cannot be undone.`)) return; await run(api.issueDelete(ids), "Deleted"); setPicked(new Set()); setSel(null); }}
          onClear={() => setPicked(new Set())} />
      )}

      {mode === "list" && (
        <div className="id-body">
          <div className="id-list" role="list">
            <label className="id-all muted">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((i) => i.id)))} aria-label="Select all" />
              {list.length} {show === "all" ? "" : show} issue{list.length === 1 ? "" : "s"}
            </label>
            {list.length === 0 && <div className="card-empty">{filtered ? "Nothing matches." : `No ${show === "all" ? "" : show} issues.`}</div>}
            {groups.map(([g, rows]) => (
              <div key={g || "all"}>
                {g && <div className="id-group">{g} <span className="count">{rows.length}</span></div>}
                {rows.map((i) => (
                  <div key={`${g}${i.id}`} role="listitem" className={`id-row ${sel === i.id ? "on" : ""}`} onClick={() => setSel(i.id)} data-testid={`issue-row-${i.id}`}>
                    <input type="checkbox" checked={picked.has(i.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(i.id)} aria-label={`Select #${i.id}`} />
                    <span className={`id-state ${i.status}`} title={i.status === "closed" && i.reason ? i.reason.replace("_", " ") : i.status}><Icon.issues /></span>
                    <div className="id-main">
                      <div className="id-title">{i.pinned && <span className="acc" title="Pinned">● </span>}{i.title}</div>
                      <div className="id-sub">
                        <span className="mono">#{i.id}</span>
                        <span>{relTime(i.updated || i.created)}</span>
                        {i.milestone && <span className="mono">{i.milestone}</span>}
                        {i.labels.map((l) => <Label key={l} name={l} cfg={cfg} />)}
                      </div>
                    </div>
                    <Prio p={i.priority} />
                    {(i.assignees ?? []).length > 0 && <span className="id-who" title={i.assignees!.join(", ")}>{i.assignees!.map((a) => a[0]?.toUpperCase()).join("")}</span>}
                    {i.comments.length > 0 && <span className="mono dim id-n">{i.comments.length}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="id-detail">
            {issue ? <Detail key={issue.id} issue={issue} cfg={cfg} labels={labels} people={people} milestones={milestones} openSymbol={openSymbol}
              onPatch={(p, ok) => patch([issue.id], p, ok)}
              onComment={(b) => run(api.metaAction("issues", issue.id, { body: b }))}
              onCommentEdit={(idx, b) => run(api.issueComment(issue.id, idx, b))}
              onDelete={async () => { if (!confirm(`Delete #${issue.id}? This cannot be undone.`)) return; await run(api.issueDelete([issue.id]), "Deleted"); setSel(null); }} />
              : <Empty title="Pick an issue" />}
          </div>
        </div>
      )}

      {mode === "new" && (
        <NewIssue cfg={cfg} tpl={tpl} setTpl={setTpl} labels={labels} people={people} milestones={milestones}
          onCancel={() => setMode("list")}
          onCreate={async (d) => { const i = await run(api.issueCreate(d), "Issue opened"); if (i) { setSel(i.id); setShow("open"); setMode("list"); } }} />
      )}

    </div>
  );
}

// ------------------------------------------------------------------ bulk bar
function Bulk({ n, labels, people, milestones, onPatch, onDelete, onClear }: {
  n: number; labels: string[]; people: string[]; milestones: string[];
  onPatch: (p: IssuePatch, ok: string) => void; onDelete: () => void; onClear: () => void;
}) {
  const [reason, setReason] = useState("completed");
  return (
    <div className="id-bulk" data-testid="issue-bulk">
      <b>{n} selected</b>
      <button className="btn sm" onClick={() => onPatch({ status: "closed", reason }, "Closed")}>Close</button>
      <select className="input id-pick" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Close reason">{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button className="btn sm" onClick={() => onPatch({ status: "open" }, "Reopened")}>Reopen</button>
      <Pick value="" options={labels} placeholder="Add label" onPick={(v) => v && onPatch({ add_labels: [v] }, `Labelled ${v}`)} />
      <Pick value="" options={labels} placeholder="Remove label" onPick={(v) => v && onPatch({ remove_labels: [v] }, `Removed ${v}`)} />
      <Pick value="" options={people} placeholder="Assign" onPick={(v) => v && onPatch({ add_assignees: [v] }, `Assigned ${v}`)} />
      <Pick value="" options={["none", ...milestones]} placeholder="Milestone" onPick={(v) => v && onPatch({ milestone: v === "none" ? "" : v }, "Milestone set")} />
      <Pick value="" options={["none", ...PRIOS]} placeholder="Priority" onPick={(v) => v && onPatch({ priority: (v === "none" ? "" : v) as Priority }, "Priority set")} />
      <span className="spacer" />
      <button className="btn sm danger" onClick={onDelete}>Delete</button>
      <button className="btn sm ghost" onClick={onClear}>Done</button>
    </div>
  );
}

// ------------------------------------------------------------------ detail
function Chips({ items, options, onChange, placeholder, render }: { items: string[]; options: string[]; onChange: (v: string[]) => void; placeholder: string; render?: (s: string) => ReactNode }) {
  const [t, setT] = useState("");
  const add = (v: string) => { const x = v.trim(); if (x && !items.includes(x)) onChange([...items, x]); setT(""); };
  const id = `dl-${placeholder.replace(/\W/g, "")}`;
  return (
    <div className="id-chips">
      {items.map((x) => <span key={x} className="id-chip">{render ? render(x) : <span className="tag">{x}</span>}<button aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((y) => y !== x))}>×</button></span>)}
      <input className="input" list={id} placeholder={placeholder} value={t} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(t); } }} onBlur={() => t && add(t)} />
      <datalist id={id}>{options.filter((o) => !items.includes(o)).map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

function Detail({ issue, cfg, labels, people, milestones, openSymbol, onPatch, onComment, onCommentEdit, onDelete }: {
  issue: Issue; cfg: IssueConfig; labels: string[]; people: string[]; milestones: string[]; openSymbol: (id: number) => void;
  onPatch: (p: IssuePatch, ok?: string) => void; onComment: (b: string) => Promise<unknown>; onCommentEdit: (idx: number, b: string | null) => Promise<unknown>; onDelete: () => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [reason, setReason] = useState("completed");
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<{ idx: number; text: string } | null>(null);
  const closed = issue.status === "closed";

  // Comments and events on one timeline.
  const timeline = [
    ...issue.comments.map((c, idx) => ({ at: c.at, kind: "c" as const, c, idx })),
    ...(issue.events ?? []).map((e) => ({ at: e.at, kind: "e" as const, e })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="id-pane">
      <div className="id-head">
        {title == null
          ? <h2 onDoubleClick={() => setTitle(issue.title)} title="Double click to rename">{issue.title} <span className="muted">#{issue.id}</span></h2>
          : <input className="input id-title-in" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title"
              onKeyDown={(e) => { if (e.key === "Enter") { onPatch({ title }); setTitle(null); } if (e.key === "Escape") setTitle(null); }} onBlur={() => { if (title.trim() && title !== issue.title) onPatch({ title }); setTitle(null); }} />}
        <div className="id-meta">
          <span className={`tag ${closed ? "" : "green"}`}>{closed ? `closed${issue.reason ? ` · ${issue.reason.replace("_", " ")}` : ""}` : "open"}</span>
          <span className="muted">{issue.author} opened {relTime(issue.created)}{issue.template ? ` from ${issue.template}` : ""}</span>
          <span className="spacer" />
          {closed
            ? <button className="btn sm" onClick={() => onPatch({ status: "open" }, "Reopened")}>Reopen</button>
            : <><select className="input id-pick" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Close reason">{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <button className="btn sm" onClick={() => onPatch({ status: "closed", reason }, "Closed")}>Close</button></>}
        </div>
      </div>

      <div className="id-cols">
        <div className="id-left">
          {body == null ? (
            <div className="id-body-view" onDoubleClick={() => setBody(issue.body)}>
              {issue.body ? <Md text={issue.body} onSymbol={(n) => openByName(n, openSymbol)} /> : <span className="muted">No description.</span>}
              <button className="btn sm ghost id-edit" onClick={() => setBody(issue.body)}>Edit</button>
            </div>
          ) : (
            <div className="stack">
              <textarea className="textarea id-ta" autoFocus value={body} onChange={(e) => setBody(e.target.value)} aria-label="Description" />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn sm ghost" onClick={() => setBody(null)}>Cancel</button>
                <button className="btn sm primary" onClick={() => { onPatch({ body }); setBody(null); }}>Save</button>
              </div>
            </div>
          )}

          <div className="id-timeline">
            {timeline.map((t, k) => t.kind === "e"
              ? <div key={k} className="id-ev"><i /> <b>{t.e.by}</b> {t.e.what} <span className="dim">{relTime(t.e.at)}</span></div>
              : (
                <div key={k} className="id-comment">
                  <div className="id-c-head"><b>{t.c.author}</b><span className="muted">{relTime(t.c.at)}{t.c.edited ? " · edited" : ""}</span><span className="spacer" />
                    <button className="btn sm ghost" onClick={() => setEditing({ idx: t.idx, text: t.c.body })}>Edit</button>
                    <button className="btn sm ghost" onClick={() => confirm("Delete this comment?") && onCommentEdit(t.idx, null)}>Delete</button>
                  </div>
                  {editing?.idx === t.idx ? (
                    <div className="stack">
                      <textarea className="textarea" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} aria-label="Edit comment" />
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="btn sm primary" onClick={() => onCommentEdit(t.idx, editing.text).then(() => setEditing(null))}>Save</button>
                      </div>
                    </div>
                  ) : <Md text={t.c.body} onSymbol={(n) => openByName(n, openSymbol)} />}
                </div>
              ))}
          </div>
          {issue.locked ? <div className="card-empty">Thread locked.</div> : (
            <div className="stack">
              <textarea className="textarea" placeholder="Comment" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Comment"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reply.trim()) onComment(reply).then(() => setReply("")); }} />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {!closed && <button className="btn sm" disabled={!reply.trim()} onClick={() => onComment(reply).then(() => { setReply(""); onPatch({ status: "closed", reason: "completed" }, "Closed"); })}>Comment and close</button>}
                <button className="btn sm primary" disabled={!reply.trim()} onClick={() => onComment(reply).then(() => setReply(""))}>Comment</button>
              </div>
            </div>
          )}
        </div>

        <aside className="id-side">
          <div className="id-f"><span>Assignees</span><Chips items={issue.assignees ?? []} options={people} placeholder="Add person" onChange={(v) => onPatch({ assignees: v })} /></div>
          <div className="id-f"><span>Labels</span><Chips items={issue.labels} options={labels} placeholder="Add label" onChange={(v) => onPatch({ labels: v })} render={(l) => <Label name={l} cfg={cfg} />} /></div>
          <div className="id-f"><span>Milestone</span><Pick value={issue.milestone ?? ""} options={[...new Set([...milestones, ...(issue.milestone ? [issue.milestone] : [])])]} placeholder="None" onPick={(v) => onPatch({ milestone: v })} /></div>
          <div className="id-f"><span>Priority</span><Pick value={issue.priority ?? ""} options={PRIOS} placeholder="None" onPick={(v) => onPatch({ priority: v as Priority })} /></div>
          <div className="id-f"><span>Linked</span><Chips items={issue.links ?? []} options={["proposal:", "issue:", "branch:", "commit:"]} placeholder="proposal:3, branch:x" onChange={(v) => onPatch({ links: v })} /></div>
          <div className="id-f"><span>Anchors</span><Chips items={issue.anchors} options={[]} placeholder="symbol or file" onChange={(v) => onPatch({ anchors: v })}
            render={(a) => <button className="tag id-anchor" onClick={() => openByName(a, openSymbol)}>⌖ {a}</button>} /></div>
          <div className="id-f id-toggles">
            <label><input type="checkbox" checked={!!issue.pinned} onChange={(e) => onPatch({ pinned: e.target.checked })} /> Pinned</label>
            <label><input type="checkbox" checked={!!issue.locked} onChange={(e) => onPatch({ locked: e.target.checked })} /> Locked</label>
          </div>
          <div className="id-f"><button className="btn sm danger" onClick={onDelete}>Delete issue</button></div>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ new
function NewIssue({ cfg, tpl, setTpl, labels, people, milestones, onCancel, onCreate }: {
  cfg: IssueConfig; tpl: IssueTemplate | null; setTpl: (t: IssueTemplate | null) => void; labels: string[]; people: string[]; milestones: string[];
  onCancel: () => void; onCreate: (d: IssueDraft) => void;
}) {
  const blank: IssueDraft = { title: "", body: "", labels: [], assignees: [], milestone: "", priority: "", anchors: [], links: [] };
  const [d, setD] = useState<IssueDraft>(blank);
  const use = (t: IssueTemplate | null) => {
    setTpl(t);
    setD(t ? { ...blank, title: t.title, body: t.body, labels: [...t.labels], assignees: [...t.assignees], priority: t.priority, template: t.name } : blank);
  };
  if (cfg.templates.length && tpl === null && !d.title && !d.body && d.template === undefined) {
    return (
      <div className="id-tpls" data-testid="issue-templates">
        {cfg.templates.map((t) => (
          <button key={t.name} className="id-tpl" onClick={() => use(t)}>
            <b>{t.name}</b><span className="muted">{t.about || "Template"}</span>
          </button>
        ))}
        <button className="id-tpl" onClick={() => setD({ ...blank, template: "" })}><b>Blank issue</b><span className="muted">Start from nothing</span></button>
      </div>
    );
  }
  return (
    <div className="id-new">
      <div className="id-left stack">
        {tpl && <div className="muted">From <b>{tpl.name}</b> <button className="btn sm ghost" onClick={() => use(null)}>Change</button></div>}
        <input className="input" autoFocus placeholder="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Title" />
        <textarea className="textarea id-ta" placeholder="Describe it. Link code with [[symbol]]." value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} aria-label="Description" />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn sm ghost" onClick={() => { use(null); onCancel(); }}>Cancel</button>
          <button className="btn sm primary" disabled={!d.title.trim()} onClick={() => onCreate(d)}>Open issue</button>
        </div>
      </div>
      <aside className="id-side">
        <div className="id-f"><span>Assignees</span><Chips items={d.assignees ?? []} options={people} placeholder="Add person" onChange={(v) => setD({ ...d, assignees: v })} /></div>
        <div className="id-f"><span>Labels</span><Chips items={d.labels ?? []} options={labels} placeholder="Add label" onChange={(v) => setD({ ...d, labels: v })} render={(l) => <Label name={l} cfg={cfg} />} /></div>
        <div className="id-f"><span>Milestone</span><Pick value={d.milestone ?? ""} options={milestones} placeholder="None" onPick={(v) => setD({ ...d, milestone: v })} /></div>
        <div className="id-f"><span>Priority</span><Pick value={d.priority ?? ""} options={PRIOS} placeholder="None" onPick={(v) => setD({ ...d, priority: v as Priority })} /></div>
        <div className="id-f"><span>Linked</span><Chips items={d.links ?? []} options={["proposal:", "issue:", "branch:", "commit:"]} placeholder="proposal:3, branch:x" onChange={(v) => setD({ ...d, links: v })} /></div>
        <div className="id-f"><span>Anchors</span><Chips items={d.anchors ?? []} options={[]} placeholder="symbol or file" onChange={(v) => setD({ ...d, anchors: v })} /></div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ settings
type Named = { name: string };
function useRows<T extends Named>(init: T[]) {
  const [rows, setRows] = useState(init.map((r) => ({ ...r, _was: r.name })));
  useEffect(() => setRows(init.map((r) => ({ ...r, _was: r.name }))), [JSON.stringify(init)]);
  return [rows, setRows] as const;
}

/** Templates, labels, milestones and people; lives in Settings, Issues. */
export function IssueSettingsPanel({ cfg, onSave }: { cfg: IssueConfig; onSave: (c: IssueConfig, renames: [string, string, string][]) => Promise<unknown> }) {
  const [tab, setTab] = useState<"templates" | "labels" | "milestones" | "people">("templates");
  const [tpls, setTpls] = useRows<IssueTemplate>(cfg.templates);
  const [labs, setLabs] = useRows<LabelDef>(cfg.labels);
  const [mss, setMss] = useRows<Milestone>(cfg.milestones);
  const [people, setPeople] = useState(cfg.people.join(", "));
  useEffect(() => setPeople(cfg.people.join(", ")), [cfg.people.join(",")]);
  const [open, setOpen] = useState(0);

  const save = () => {
    const strip = <T extends Named>(rs: (T & { _was: string })[]) => rs.map(({ _was, ...r }) => r as unknown as T);
    const renames: [string, string, string][] = [
      ...labs.filter((l) => l._was && l._was !== l.name).map((l) => ["label", l._was, l.name] as [string, string, string]),
      ...mss.filter((m) => m._was && m._was !== m.name).map((m) => ["milestone", m._was, m.name] as [string, string, string]),
    ];
    return onSave({ templates: strip(tpls), labels: strip(labs), milestones: strip(mss), people: split(people) }, renames);
  };
  const dirty = JSON.stringify({ t: tpls, l: labs, m: mss, p: split(people) }) !== JSON.stringify({ t: cfg.templates.map((r) => ({ ...r, _was: r.name })), l: cfg.labels.map((r) => ({ ...r, _was: r.name })), m: cfg.milestones.map((r) => ({ ...r, _was: r.name })), p: cfg.people });

  return (
    <div className="id-settings" data-testid="issue-settings">
      <div className="id-bar">
        <div className="seg" role="group" aria-label="Settings">
          {(["templates", "labels", "milestones", "people"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
        <span className="spacer" />
        <button className="btn sm primary" disabled={!dirty} onClick={save}>Save settings</button>
      </div>

      {tab === "templates" && (
        <div className="id-set-list">
          {tpls.map((t, i) => (
            <div key={i} className={`id-set-row ${open === i ? "open" : ""}`}>
              <div className="id-set-line" onClick={() => setOpen(open === i ? -1 : i)}>
                <b>{t.name || "Untitled"}</b><span className="muted grow">{t.about}</span>
                <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setTpls(tpls.filter((_, j) => j !== i)); }}>Remove</button>
              </div>
              {open === i && (
                <div className="id-set-form">
                  <input className="input" placeholder="Name" value={t.name} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Template name" />
                  <input className="input" placeholder="About" value={t.about} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, about: e.target.value } : x))} />
                  <input className="input" placeholder="Title prefix" value={t.title} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                  <textarea className="textarea id-ta" placeholder="Body" value={t.body} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} aria-label="Template body" />
                  <div className="row">
                    <input className="input" placeholder="Labels" value={t.labels.join(", ")} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, labels: split(e.target.value) } : x))} />
                    <input className="input" placeholder="Assignees" value={t.assignees.join(", ")} onChange={(e) => setTpls(tpls.map((x, j) => j === i ? { ...x, assignees: split(e.target.value) } : x))} />
                    <Pick value={t.priority} options={PRIOS} placeholder="Priority" onPick={(v) => setTpls(tpls.map((x, j) => j === i ? { ...x, priority: v as Priority } : x))} />
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => { setTpls([...tpls, { name: "", about: "", title: "", body: "", labels: [], assignees: [], priority: "", _was: "" }]); setOpen(tpls.length); }}><Icon.plus /> Template</button>
            {tpls.length === 0 && <button className="btn sm ghost" onClick={() => setTpls(STARTERS.map((s) => ({ ...s, _was: "" })))}>Add bug, feature and task</button>}
          </div>
        </div>
      )}

      {tab === "labels" && (
        <div className="id-set-list">
          {labs.map((l, i) => (
            <div key={i} className="id-set-line">
              <input type="color" className="id-color" value={l.color || "#867d73"} onChange={(e) => setLabs(labs.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} aria-label="Colour" />
              <input className="input" placeholder="Name" value={l.name} onChange={(e) => setLabs(labs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Label name" />
              <input className="input grow" placeholder="Description" value={l.description} onChange={(e) => setLabs(labs.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              {l.name && <Label name={l.name} cfg={{ ...EMPTY_CFG, labels: [l] }} />}
              <button className="btn sm ghost" onClick={() => setLabs(labs.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setLabs([...labs, { name: "", color: "#867d73", description: "", _was: "" }])}><Icon.plus /> Label</button>
        </div>
      )}

      {tab === "milestones" && (
        <div className="id-set-list">
          {mss.map((m, i) => (
            <div key={i} className="id-set-line">
              <input className="input" placeholder="Name" value={m.name} onChange={(e) => setMss(mss.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Milestone name" />
              <input className="input grow" placeholder="Description" value={m.description} onChange={(e) => setMss(mss.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <input className="input id-date" type="date" value={day(m.due)} onChange={(e) => setMss(mss.map((x, j) => j === i ? { ...x, due: e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : undefined } : x))} aria-label="Due" />
              <div className="seg"><button className={m.state === "open" ? "on" : ""} onClick={() => setMss(mss.map((x, j) => j === i ? { ...x, state: "open" } : x))}>Open</button><button className={m.state === "closed" ? "on" : ""} onClick={() => setMss(mss.map((x, j) => j === i ? { ...x, state: "closed" } : x))}>Closed</button></div>
              <button className="btn sm ghost" onClick={() => setMss(mss.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setMss([...mss, { name: "", description: "", state: "open", _was: "" }])}><Icon.plus /> Milestone</button>
        </div>
      )}

      {tab === "people" && (
        <div className="id-set-list">
          <input className="input" placeholder="Names, comma separated" value={people} onChange={(e) => setPeople(e.target.value)} aria-label="People" />
        </div>
      )}
    </div>
  );
}

const STARTERS: IssueTemplate[] = [
  { name: "Bug", about: "Something is broken", title: "bug: ", body: "### What happened\n\n### Expected\n\n### Steps\n1. \n", labels: ["bug"], assignees: [], priority: "high" },
  { name: "Feature", about: "A new capability", title: "feat: ", body: "### Problem\n\n### Proposal\n\n### Done when\n- [ ] \n", labels: ["feature"], assignees: [], priority: "" },
  { name: "Task", about: "A chore or follow up", title: "", body: "- [ ] \n", labels: ["task"], assignees: [], priority: "low" },
];
