import { useEffect, useState } from "react";
import { api, relTime, type AgentsInfo, type Overview } from "../api";
import { useToast } from "../ui";
import type { Go } from "../nav";

/** One thing a person has to decide, whoever produced it. */
type Item = { key: string; kind: string; title: string; sub: string; tone: "bad" | "warn" | ""; at?: number; actions: { label: string; primary?: boolean; run: () => void }[] };

/** The review inbox: everything agents produced that waits on a person, in one
 *  ranked queue – proposals, agent branches nobody proposed, fence suggestions,
 *  memories the code moved out from under, and fenced files touched. */
export default function Inbox({ o, version, go, onChanged }: { o: Overview; version: number; go: Go; onChanged: () => void }) {
  const [a, setA] = useState<AgentsInfo | null>(null);
  const toast = useToast();
  useEffect(() => { api.agents().then(setA).catch(() => setA(null)); }, [version]);

  const act = (action: "suggestion_accept" | "suggestion_dismiss" | "confirm" | "forget", id: number, ok: string) =>
    api.agentAction(action, { id }).then(() => { toast(ok); onChanged(); api.agents().then(setA).catch(() => {}); }).catch((e: Error) => toast(e.message, "err"));

  const proposed = new Set(o.proposals.map((p) => p.proposal.head));
  const items: Item[] = [];
  for (const p of o.proposals) items.push({
    key: `pr${p.proposal.id}`, kind: "proposal", tone: p.risk === "high" ? "bad" : p.risk === "medium" ? "warn" : "",
    title: p.proposal.title, at: p.proposal.created,
    sub: `#${p.proposal.id} · ${p.proposal.head} → ${p.proposal.base} · ${p.risk} risk${p.files != null ? ` · ${p.files} files` : ""}`,
    actions: [{ label: "Review", primary: true, run: () => go("proposals", { proposal: p.proposal.id }) }],
  });
  for (const b of o.branches) {
    if (!b.name.startsWith("agent/") || b.ahead === 0 || proposed.has(b.name)) continue;
    items.push({
      key: `br${b.name}`, kind: "agent branch", tone: b.behind > 10 ? "warn" : "", title: b.subject || b.name, at: b.time,
      sub: `${b.name} · ${b.ahead} ahead, ${b.behind} behind ${o.default_branch} · not proposed`,
      actions: [{ label: "What changed", primary: true, run: () => go("graph", { contrast: { base: o.default_branch, head: b.name, mode: "report" } }) }],
    });
  }
  for (const s of a?.suggestions ?? []) items.push({
    key: `sg${s.id}`, kind: s.kind === "guard" ? "fence suggestion" : "workflow suggestion", tone: "", at: s.created,
    title: s.guard ? `${s.guard.level} ${(s.guard.paths ?? s.guard.symbols ?? []).join(", ")}` : s.workflow?.name ?? "workflow",
    sub: `${s.why} · by ${s.by.replace(/^agent:/, "")}`,
    actions: [{ label: "Accept", primary: true, run: () => act("suggestion_accept", s.id, "Added to kula.toml") }, { label: "Dismiss", run: () => act("suggestion_dismiss", s.id, "Dismissed") }],
  });
  for (const m of a?.memories ?? []) {
    if (!m.stale) continue;
    items.push({
      key: `m${m.id}`, kind: "stale memory", tone: "warn", at: m.created, title: m.body,
      sub: `${m.target} changed since ${m.author.replace(/^agent:/, "")} wrote this – agents still recall it`,
      actions: [{ label: "Still true", primary: true, run: () => act("confirm", m.id, "Re-anchored") }, { label: "Forget", run: () => act("forget", m.id, "Forgotten") }],
    });
  }
  const fenced = (a?.files ?? []).filter((f) => f.verdict.level === "locked" || f.verdict.level === "review");
  if (fenced.length) items.push({
    key: "fenced", kind: "fenced change", tone: fenced.some((f) => f.verdict.level === "locked") ? "bad" : "warn",
    title: `${fenced.length} changed file${fenced.length > 1 ? "s" : ""} behind a fence`,
    sub: fenced.slice(0, 3).map((f) => `${f.path} (${f.verdict.level})`).join(" · ") + (fenced.length > 3 ? ` · +${fenced.length - 3}` : ""),
    actions: [{ label: "Open changes", primary: true, run: () => go("changes") }],
  });
  const rank = { bad: 0, warn: 1, "": 2 } as const;
  items.sort((x, y) => rank[x.tone] - rank[y.tone] || (y.at ?? 0) - (x.at ?? 0));

  return (
    <section className="inbox" aria-label="Review inbox" data-testid="inbox">
      <div className="inbox-head">
        <h2>Inbox</h2>
        <span className="muted">{items.length ? `${items.length} waiting on you` : "nothing waiting on you"}</span>
      </div>
      {items.length === 0
        ? <div className="inbox-empty">Agents have nothing for you to review. Their branches, fence suggestions and memories land here.</div>
        : <ul className="inbox-list">
          {items.map((it) => (
            <li key={it.key} className={`inbox-row ${it.tone}`} data-kind={it.kind}>
              <span className="inbox-kind">{it.kind}</span>
              <div className="inbox-main">
                <div className="inbox-title">{it.title}</div>
                <div className="inbox-sub">{it.sub}{it.at ? ` · ${relTime(it.at)}` : ""}</div>
              </div>
              <div className="inbox-acts">
                {it.actions.map((x) => <button key={x.label} className={`btn sm${x.primary ? " primary" : " ghost"}`} onClick={x.run}>{x.label}</button>)}
              </div>
            </li>
          ))}
        </ul>}
    </section>
  );
}
