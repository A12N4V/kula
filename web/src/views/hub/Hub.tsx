// The agent hub: a palette of things to place, the team canvas over the flow
// map of the codebase, and an inspector for whatever is picked. Build edits
// the draft, Live paints the event log onto the seats, Runs lists past runs.

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api, type AgentsInfo, type FlowMap } from "../../api";
import { useToast } from "../../ui";
import type { Act } from "./data";
import { useDraft, type LinkKind, type Pick } from "./draft";
import { HubCanvas, type Item } from "./HubCanvas";
import { DeployDialog, SchedulesCard } from "./Deploy";
import { ChangesCard, Inspector } from "./Inspector";
import { paintAt, useEvents } from "./live";
import { LiveFeed } from "./LiveFeed";
import { Palette } from "./Palette";
import { RunsBoard, RunsTrends, useRuns } from "./Runs";
import { TEAM_TEMPLATES, teamFrom } from "./templates";

type Mode = "build" | "live" | "runs";
const MODES: { id: Mode; label: string }[] = [{ id: "build", label: "Build" }, { id: "live", label: "Live" }, { id: "runs", label: "Runs" }];

export default function Hub({ info, act }: { info: AgentsInfo; act: Act }) {
  const toast = useToast();
  const [pick, setPick] = useState<Pick>(null);
  const [flow, setFlow] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("build");
  const [showMap, setShowMap] = useState(false);
  const [link, setLink] = useState<LinkKind>("rt");
  const [map, setMap] = useState<FlowMap | null>(null);
  const [servers, setServers] = useState<string[]>([]);
  const [deploying, setDeploying] = useState<string | null>(null);
  const d = useDraft(info, setPick);

  useEffect(() => { api.configMatrix().then((c) => setServers(c.source.servers)).catch(() => setServers([])); }, []);
  useEffect(() => {
    if ((!showMap && !deploying) || map) return;
    api.flowmap(60).then(setMap).catch((e: Error) => toast(e.message, "err"));
  }, [showMap, deploying, map]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!showMap) setFlow(null); }, [showMap]);

  // Live: the event log painted onto the seats, with a scrubber over a run.
  const live = mode === "live";
  const ev = useEvents(live);
  const [run, setRun] = useState("");
  const [cursor, setCursor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const runs = useMemo(() => {
    const ids = ev.events.map((e) => e.run || e.plan).filter((x): x is string => !!x);
    return [...new Set(run ? [...ids, run] : ids)];
  }, [ev.events, run]);
  const feed = useMemo(() => (run ? ev.events.filter((e) => e.run === run || e.plan === run) : ev.events), [ev.events, run]);
  const ledger = useRuns(mode === "runs");
  // Deploy runs the saved team, so a picked team counts only once it is saved.
  const saved = pick?.team ? info.teams.find((t) => t.name === pick.team) : undefined;
  const deployTeam = deploying ? info.teams.find((t) => t.name === deploying) : undefined;
  const replay = (id: string) => { setRun(id); setCursor(null); setMode("live"); };
  const at = cursor !== null && feed[cursor] ? feed[cursor].ts : now;
  const paint = useMemo(() => (live ? paintAt(info, [], feed.slice(0, cursor === null ? feed.length : cursor + 1), at) : undefined), [live, info, feed, cursor, at]);

  const loop = info.workflows.find((w) => w.research)?.name ?? "";
  const onItem = (it: Item, at: Pick) => {
    const seat = at?.key ? at as { team: string; key: string } : null;
    switch (it.kind) {
      case "agent":
        if (seat) d.setMember(seat.team, seat.key, { agent: it.value });
        else if (at) d.addSeat(at.team, { agent: it.value });
        else {
          const name = d.freeTeam();
          d.addTeam({ name, about: "", prompt: "", members: [{ name: `${name}-lead`, agent: it.value, workflow: "", reports_to: "" }] });
        }
        return;
      case "skill":
      case "mcp":
        if (seat) d.attach(seat.team, seat.key, it.kind === "skill" ? "skills" : "mcp", it.value);
        else toast("Pick a seat first");
        return;
      case "memory":
        if (seat) d.setMember(seat.team, seat.key, { memory: it.value });
        else toast("Pick a seat first");
        return;
      case "template": {
        const tpl = TEAM_TEMPLATES.find((t) => t.id === it.value);
        if (tpl) d.addTeam(teamFrom(tpl, d.freeTeam(tpl.id), [], loop));
        return;
      }
    }
  };

  // on a narrow screen the inspector sits below the canvas: bring it into view when a seat is picked
  const inspRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!pick || !window.matchMedia("(max-width: 1100px)").matches) return;
    const phone = window.matchMedia("(max-width: 759px)").matches;
    // after the inspector has drawn the picked seat, so the scroll lands on its final height
    const t = window.setTimeout(() => inspRef.current?.scrollIntoView({ block: phone ? "start" : "nearest", behavior: "smooth" }), 80);
    return () => window.clearTimeout(t);
  }, [pick]);

  return (
    <div className={`hub-body mode-${mode}`}>
      {mode === "build" && <Palette info={info} servers={servers} onUse={(it) => onItem(it, pick)} />}
      <div className="hub-center">
        <div className="hub-bar">
          <div className="seg" role="group" aria-label="Mode">
            {MODES.map((m) => <button key={m.id} className={mode === m.id ? "on" : ""} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
          </div>
          {mode === "build" && <div className="hub-bar-group">
            <span className="hub-bar-label">Link</span>
            <div className="seg" role="group" aria-label="Link">
              <button className={link === "rt" ? "on" : ""} aria-pressed={link === "rt"} onClick={() => setLink("rt")} title="Drag between seats to set who reports to whom">Reports</button>
              <button className={link === "ho" ? "on" : ""} aria-pressed={link === "ho"} onClick={() => setLink("ho")} title="Drag between seats to hand work off">Hand off</button>
            </div>
          </div>}
          <span className="spacer" />
          {mode === "build" && <div className="seg" role="group" aria-label="Layers">
            <button className={`${showMap ? "on" : ""}${showMap && !map ? " loading" : ""}`} aria-pressed={showMap} onClick={() => setShowMap(!showMap)} title="Draw the codebase's execution flows behind the teams">Flow map</button>
          </div>}
          {d.dirty && <span className="hub-dirty mono">unsaved</span>}
          {mode !== "runs" && (d.dirty || !saved) && <span className="muted hub-bar-hint">{d.dirty ? "Save first" : "Pick a team"}</span>}
          {mode !== "runs" && <button className="btn sm primary hub-deploy-btn" disabled={!saved || d.dirty} onClick={() => saved && setDeploying(saved.name)}
            title={d.dirty ? "Save first" : saved ? `Deploy ${saved.name}` : "Pick a team"}>Deploy</button>}
        </div>
        {mode === "runs"
          ? <RunsBoard info={ledger.info} err={ledger.err} onReplay={replay} onBuild={() => setMode("build")} />
          : (
            <ReactFlowProvider>
              <HubCanvas info={info} d={d} pick={pick} setPick={setPick} flow={flow} setFlow={setFlow} map={showMap ? map : null} link={link} paint={paint} onItem={onItem} />
            </ReactFlowProvider>
          )}
      </div>
      <aside className="hub-inspector" aria-label="Inspector" ref={inspRef}>
        <div className="hub-insp-scroll">
          {mode === "live" && <LiveFeed events={feed} via={ev.via} runs={runs} run={run} setRun={setRun} cursor={cursor} setCursor={setCursor} />}
          {mode === "runs" && <><SchedulesCard /><RunsTrends info={ledger.info} /></>}
          {mode === "build" && <Inspector info={info} d={d} pick={pick} flow={flow} setFlow={setFlow} map={map} act={act} />}
        </div>
        <ChangesCard d={d} act={act} />
      </aside>
      {deployTeam && <DeployDialog team={deployTeam} map={map} onClose={() => setDeploying(null)} onDeployed={(plan) => { setDeploying(null); replay(plan); }} />}
    </div>
  );
}
