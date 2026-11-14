// Canvas tab (P3.14): the agent canvas with the task at hand and what needs a
// person beside it. Replaces the old Overview roster. The canvas itself loads
// on demand; until it does the frame shows one quiet line.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "../../styles/canvas.css";
import { api, type AgentsInfo, type MemoryLayer, type Territory } from "../../api";
import { Icon } from "../../ui";
import type { Act, Tab } from "./data";
import { AGENT_NAME } from "./data";
import { workflowColor } from "./TeamOrg";
import { NowCard, NeedsCard } from "./Side";
import { keyName, seatName } from "./parts";
import { titleFor } from "../../roster";
import type { Land, Pocket, Seat } from "./CanvasFlow";
import { coverage, levelFor, pins, pocket, refusal, seatScope } from "./territory";
import { SeatMemory } from "./SeatMemory";
import { seatKey } from "../../roster";
import { useDraft, ArchitectInspector, ChangesCard, type Pick, type LinkKind } from "./Architect";
import { paintAt, useEvents } from "./live";
import { LiveFeed } from "./LiveFeed";

const CanvasFlow = lazy(() => import("./CanvasFlow"));

export default function Canvas({ info, act, setTab, onGraph, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; onGraph: (wf?: string) => void; open: (t: string) => void }) {
  const [lens, setLens] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Seat | null>(null);
  const [mode, setMode] = useState<"view" | "architect" | "live">("view");
  const [pick, setPick] = useState<Pick>(null);
  const [kind, setKind] = useState<LinkKind>("rt");
  const d = useDraft(info, pick, setPick, kind);
  const arch = mode === "architect";
  const live = mode === "live";
  const shown = arch ? { ...info, teams: d.draft } : info;
  const used = info.workflows.filter((w) => info.teams.some((t) => t.members.some((m) => m.workflow === w.name)));
  const toggle = (n: string) => setLens((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const seats = info.teams.reduce((n, t) => n + t.members.length, 0);
  const team = sel ? info.teams.find((t) => t.name === sel.team) : undefined;

  // P3.16: the repository's areas under the teams, the brush, memory pins
  const [areas, setAreas] = useState<Territory[]>([]);
  const [layers, setLayers] = useState<MemoryLayer[]>([]);
  const [brush, setBrush] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [rank, setRank] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let live = true;
    api.agentAction<{ areas: Territory[] }>("territories", {}).then((r) => live && setAreas(r.areas)).catch(() => {});
    api.memoryLayers().then((l) => live && setLayers(l)).catch(() => {});
    return () => { live = false; };
  }, [info.rules, info.workflows, info.memories.length]);
  const picked = arch
    ? (pick?.key ? d.draft.find((t) => t.name === pick.team)?.members.find((m) => seatKey(m) === pick.key) : undefined)
    : sel?.m;
  const pickedTeam = arch ? pick?.team : sel?.team;
  useEffect(() => { setNote(null); setRank(new Map()); }, [pickedTeam, picked && seatKey(picked)]);
  const wfShelf = useMemo(() => {
    const c = new Map<string, Pocket>();
    for (const l of layers) if (l.scope === "workflow") { const x = c.get(l.scope_name) ?? { fresh: 0, stale: 0 }; if (l.stale) x.stale++; else x.fresh++; c.set(l.scope_name, x); }
    return c;
  }, [layers]);
  const land = useMemo<Land>(() => {
    const p = pins(areas, info.memories);
    const lensWf = [...lens][0];
    const scope = picked ? seatScope(shown, picked) : null;
    const pockets = new Map<string, Pocket>();
    if (areas.length) for (const t of shown.teams) for (const m of t.members) {
      const mine = pocket(shown, areas, m);
      if (mine.length) pockets.set(`seat:${t.name}/${seatKey(m)}`, { fresh: mine.filter((x) => !x.stale).length, stale: mine.filter((x) => x.stale).length });
    }
    return {
      areas, pins: p.by, pockets, rank,
      level: (t) => levelFor(t, picked ? picked.workflow : lensWf),
      cover: scope ? (a) => coverage(scope, a) : null,
      refuse: arch && brush && picked ? (t) => refusal(t, picked) : null,
      brush: arch && brush,
      onPaint: (area, erase) => {
        if (!picked || !pick?.key) { setNote("pick a seat to paint its scope"); return; }
        const t = areas.find((x) => x.path === area);
        const why = t && refusal(t, picked);
        if (why) { setNote(why); return; }
        const own = picked.scope ?? [];
        const bare = (e: string) => e.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        if (erase) {
          if (!own.some((e) => bare(e) === area)) { setNote(`${area} is not painted on ${seatName(picked)}`); return; }
          d.setMember(pick.team, pick.key, { scope: own.filter((e) => bare(e) !== area) });
          setNote(`${area} taken out of ${seatName(picked)}`);
        } else {
          if (own.length && coverage(own, area) === "all") { setNote(`${area} is already in scope`); return; }
          d.setMember(pick.team, pick.key, { scope: [...own.filter((e) => !bare(e).startsWith(area + "/")), `${area}/**`] });
          setNote(`${area} painted into ${seatName(picked)}`);
        }
      },
    };
  }, [areas, info.memories, shown, picked, lens, arch, brush, rank, pick, d]);

  // P3.17: the event log streamed onto the canvas, and replay of a run
  const ev = useEvents(live);
  const [run, setRun] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const runs = useMemo(() => [...new Set(ev.events.map((e) => e.plan).filter((x): x is string => !!x))], [ev.events]);
  const feed = useMemo(() => run ? ev.events.filter((e) => e.plan === run) : ev.events, [ev.events, run]);
  const at = cursor !== null && feed[cursor] ? feed[cursor].ts : now;
  const paint = useMemo(() => live ? paintAt(info, areas, feed.slice(0, cursor === null ? feed.length : cursor + 1), at) : undefined, [live, info, areas, feed, cursor, at]);

  return (
    <div className="cv-split">
      <section className="cv-frame" aria-label="Agent canvas">
        <div className="cv-bar">
          <span className="widget-title">Canvas</span>
          <span className="widget-count">{info.teams.length} teams · {seats} seats</span>
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Canvas mode">
            <button className={mode === "view" ? "on" : ""} aria-pressed={mode === "view"} onClick={() => setMode("view")}>View</button>
            <button className={live ? "on" : ""} aria-pressed={live} onClick={() => { setMode("live"); setCursor(null); }}>Live</button>
            <button className={arch ? "on" : ""} aria-pressed={arch} onClick={() => { setMode("architect"); setSel(null); }}>Architect{d.dirty && <i className="cv-dirty" aria-label="unsaved" />}</button>
          </div>
          {arch && (
            <>
              <div className="seg" role="group" aria-label="Link kind" title="What a drag between seats draws">
                <button className={kind === "rt" ? "on" : ""} aria-pressed={kind === "rt"} onClick={() => setKind("rt")}>reports to</button>
                <button className={kind === "ho" ? "on" : ""} aria-pressed={kind === "ho"} onClick={() => setKind("ho")}>hands off</button>
              </div>
              <button className={`btn sm ghost cv-brush ${brush ? "on" : ""}`} aria-pressed={brush} onClick={() => { setBrush((b) => !b); setNote(null); }} title="Paint areas into the picked seat's scope">brush</button>
              <button className="btn sm ghost" onClick={d.addTeam}><Icon.plus /> team</button>
            </>
          )}
          {!arch && used.length > 0 && (
            <div className="cv-lenses" role="group" aria-label="Workflow lenses">
              {used.map((w) => (
                <button key={w.name} className={`cv-lens ${lens.has(w.name) ? "on" : ""}`} aria-pressed={lens.has(w.name)} onClick={() => toggle(w.name)} title={`Tint seats that run ${w.name}`} style={{ ["--wf" as string]: workflowColor(info.workflows, w.name) }}>
                  <i />{w.name}
                  {wfShelf.get(w.name) && <span className={`cv-lens-n ${wfShelf.get(w.name)!.stale ? "stale" : ""}`} title="Memories kept under this workflow">{wfShelf.get(w.name)!.fresh + wfShelf.get(w.name)!.stale}</span>}
                </button>
              ))}
              {lens.size > 0 && <button className="cv-lens clear" onClick={() => setLens(new Set())} title="Clear lenses" aria-label="Clear lenses"><Icon.close /></button>}
            </div>
          )}
        </div>
        <div className="cv-stage">
          {shown.teams.length === 0 && !arch ? (
            <div className="w-empty"><Icon.team /><span>No teams yet</span><button className="btn sm" onClick={() => setTab("teams")}>Make a team</button></div>
          ) : (
            <Suspense fallback={<div className="cv-msg">Loading the canvas</div>}>
              {arch
                ? <CanvasFlow info={shown} lens={lens} onSelect={(s) => setPick(s ? { team: s.team, key: s.key } : null)} selected={pick?.key ? `seat:${pick.team}/${pick.key}` : null} edit={d.edit} land={land} />
                : <CanvasFlow info={info} lens={lens} onSelect={setSel} selected={sel ? `seat:${sel.team}/${sel.key}` : null} land={land} paint={paint} />}
            </Suspense>
          )}
          {(() => {
            const s = pins(areas, info.memories).shelf;
            return (s.fresh + s.stale > 0) && (
              <button className={`cv-shelf ${s.stale ? "stale" : ""}`} onClick={() => setTab("memory")} title="Memories about the whole repository" aria-label="Repository memories">
                <span>repo</span>{s.fresh > 0 && <b>◆{s.fresh}</b>}{s.stale > 0 && <b className="stale">◆{s.stale}</b>}
              </button>
            );
          })()}
          {note && <div className="cv-note" role="status">{note}</div>}
          <div className="cv-legend" aria-hidden="true"><span><i className="rt" />reports to</span><span><i className="ho" />hands off</span></div>
        </div>
      </section>

      <aside className="cv-side">
        {arch && <><ChangesCard d={d} act={act} /><ArchitectInspector info={info} d={d} pick={pick} setPick={setPick} /></>}
        {live && <LiveFeed events={feed} via={ev.via} runs={runs} run={run} setRun={setRun} cursor={cursor} setCursor={setCursor} />}
        {!arch && sel && team && (
          <section className="card cv-inspect" aria-label="Seat">
            <div className="card-head"><h2>{seatName(sel.m)}</h2><span className="muted">{team.name}</span><span className="spacer" /><button className="icon-btn" onClick={() => setSel(null)} title="Close" aria-label="Close"><Icon.close /></button></div>
            <dl className="ov-health">
              <dt>Role</dt><dd>{titleFor(sel.m.role || (sel.m.reports_to ? "member" : "lead"))}</dd>
              <dt>Runner</dt><dd className="mono">{sel.m.agent ? AGENT_NAME[sel.m.agent] ?? sel.m.agent : "any agent"}{sel.m.model ? ` · ${sel.m.model}` : ""}</dd>
              <dt>Workflow</dt><dd className="mono">{sel.m.workflow || "none"}</dd>
              <dt>Scope</dt><dd className="mono">{sel.m.scope?.length ? sel.m.scope.join(", ") : "whole repository"}</dd>
              <dt>Reports to</dt><dd className="mono">{sel.m.reports_to ? keyName(team.members, sel.m.reports_to) : "nobody"}</dd>
              <dt>Hands off</dt><dd className="mono">{sel.m.hands_off?.length ? sel.m.hands_off.map((h) => keyName(team.members, h)).join(", ") : "nobody"}</dd>
            </dl>
            <div className="row"><span className="spacer" /><button className="btn sm ghost" onClick={() => { setMode("architect"); setPick({ team: sel.team, key: sel.key }); setSel(null); }}>Edit <Icon.arrow /></button></div>
          </section>
        )}
        {picked && pickedTeam && <SeatMemory info={shown} areas={areas} m={picked} onRank={setRank} />}
        {!arch && <NowCard info={info} act={act} onGraph={onGraph} />}
        {!arch && <NeedsCard info={info} act={act} setTab={setTab} open={open} />}
      </aside>
    </div>
  );
}
