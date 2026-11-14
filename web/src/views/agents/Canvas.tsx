// Canvas tab (P3.14): the agent canvas with the task at hand and what needs a
// person beside it. Replaces the old Overview roster. The canvas itself loads
// on demand; until it does the frame shows one quiet line.

import { lazy, Suspense, useState } from "react";
import "../../styles/canvas.css";
import type { AgentsInfo } from "../../api";
import { Icon } from "../../ui";
import type { Act, Tab } from "./data";
import { AGENT_NAME } from "./data";
import { workflowColor } from "./TeamOrg";
import { NowCard, NeedsCard } from "./Side";
import { keyName, seatName } from "./parts";
import { titleFor } from "../../roster";
import type { Seat } from "./CanvasFlow";
import { useDraft, ArchitectInspector, ChangesCard, type Pick, type LinkKind } from "./Architect";

const CanvasFlow = lazy(() => import("./CanvasFlow"));

export default function Canvas({ info, act, setTab, onGraph, open }: { info: AgentsInfo; act: Act; setTab: (t: Tab) => void; onGraph: (wf?: string) => void; open: (t: string) => void }) {
  const [lens, setLens] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Seat | null>(null);
  const [mode, setMode] = useState<"view" | "architect">("view");
  const [pick, setPick] = useState<Pick>(null);
  const [kind, setKind] = useState<LinkKind>("rt");
  const d = useDraft(info, pick, setPick, kind);
  const arch = mode === "architect";
  const shown = arch ? { ...info, teams: d.draft } : info;
  const used = info.workflows.filter((w) => info.teams.some((t) => t.members.some((m) => m.workflow === w.name)));
  const toggle = (n: string) => setLens((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const seats = info.teams.reduce((n, t) => n + t.members.length, 0);
  const team = sel ? info.teams.find((t) => t.name === sel.team) : undefined;

  return (
    <div className="cv-split">
      <section className="cv-frame" aria-label="Agent canvas">
        <div className="cv-bar">
          <span className="widget-title">Canvas</span>
          <span className="widget-count">{info.teams.length} teams · {seats} seats</span>
          <span className="spacer" />
          <div className="seg" role="group" aria-label="Canvas mode">
            <button className={!arch ? "on" : ""} aria-pressed={!arch} onClick={() => setMode("view")}>View</button>
            <button className={arch ? "on" : ""} aria-pressed={arch} onClick={() => { setMode("architect"); setSel(null); }}>Architect{d.dirty && <i className="cv-dirty" aria-label="unsaved" />}</button>
          </div>
          {arch && (
            <>
              <div className="seg" role="group" aria-label="Link kind" title="What a drag between seats draws">
                <button className={kind === "rt" ? "on" : ""} aria-pressed={kind === "rt"} onClick={() => setKind("rt")}>reports to</button>
                <button className={kind === "ho" ? "on" : ""} aria-pressed={kind === "ho"} onClick={() => setKind("ho")}>hands off</button>
              </div>
              <button className="btn sm ghost" onClick={d.addTeam}><Icon.plus /> team</button>
            </>
          )}
          {!arch && used.length > 0 && (
            <div className="cv-lenses" role="group" aria-label="Workflow lenses">
              {used.map((w) => (
                <button key={w.name} className={`cv-lens ${lens.has(w.name) ? "on" : ""}`} aria-pressed={lens.has(w.name)} onClick={() => toggle(w.name)} title={`Tint seats that run ${w.name}`} style={{ ["--wf" as string]: workflowColor(info.workflows, w.name) }}>
                  <i />{w.name}
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
                ? <CanvasFlow info={shown} lens={lens} onSelect={(s) => setPick(s ? { team: s.team, key: s.key } : null)} selected={pick?.key ? `seat:${pick.team}/${pick.key}` : null} edit={d.edit} />
                : <CanvasFlow info={info} lens={lens} onSelect={setSel} selected={sel ? `seat:${sel.team}/${sel.key}` : null} />}
            </Suspense>
          )}
          <div className="cv-legend" aria-hidden="true"><span><i className="rt" />reports to</span><span><i className="ho" />hands off</span></div>
        </div>
      </section>

      <aside className="cv-side">
        {arch && <><ChangesCard d={d} act={act} /><ArchitectInspector info={info} d={d} pick={pick} setPick={setPick} /></>}
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
        {!arch && <NowCard info={info} act={act} onGraph={onGraph} />}
        {!arch && <NeedsCard info={info} act={act} setTab={setTab} open={open} />}
      </aside>
    </div>
  );
}
