// The agent hub: a palette of things to place, the team canvas over the flow
// map of the codebase, and an inspector for whatever is picked. Build edits
// the draft, Live paints the event log onto the seats, Runs lists past runs.

import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { api, type AgentsInfo, type FlowMap } from "../../api";
import { useToast } from "../../ui";
import type { Act } from "./data";
import { useDraft, type LinkKind, type Pick } from "./draft";
import { HubCanvas, type Item } from "./HubCanvas";
import { ChangesCard, Inspector } from "./Inspector";
import { paintAt, useEvents } from "./live";
import { LiveFeed } from "./LiveFeed";
import { Palette } from "./Palette";
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
  const d = useDraft(info, setPick);

  useEffect(() => { api.configMatrix().then((c) => setServers(c.source.servers)).catch(() => setServers([])); }, []);
  useEffect(() => {
    if (!showMap || map) return;
    api.flowmap(60).then(setMap).catch((e: Error) => toast(e.message, "err"));
  }, [showMap, map]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const runs = useMemo(() => [...new Set(ev.events.map((e) => e.plan).filter((x): x is string => !!x))], [ev.events]);
  const feed = useMemo(() => (run ? ev.events.filter((e) => e.plan === run) : ev.events), [ev.events, run]);
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

  return (
    <div className="hub-body">
      <Palette info={info} servers={servers} onUse={(it) => onItem(it, pick)} />
      <div className="hub-center">
        <div className="hub-bar">
          <div className="seg" role="group" aria-label="Mode">
            {MODES.map((m) => <button key={m.id} className={mode === m.id ? "on" : ""} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Link">
            <button className={link === "rt" ? "on" : ""} aria-pressed={link === "rt"} onClick={() => setLink("rt")} title="Drag between seats to set who reports to whom">Reports</button>
            <button className={link === "ho" ? "on" : ""} aria-pressed={link === "ho"} onClick={() => setLink("ho")} title="Drag between seats to hand work off">Hands off</button>
          </div>
          <span className="spacer" />
          <label className="hub-toggle">
            <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} aria-label="Flow map" />
            <span>Flow map</span>
          </label>
          {d.dirty && <span className="hub-dirty mono">unsaved</span>}
        </div>
        <ReactFlowProvider>
          <HubCanvas info={info} d={d} pick={pick} setPick={setPick} flow={flow} setFlow={setFlow} map={showMap ? map : null} link={link} paint={paint} onItem={onItem} />
        </ReactFlowProvider>
      </div>
      <aside className="hub-inspector" aria-label="Inspector">
        <div className="hub-insp-scroll">
          {mode === "live" && <LiveFeed events={feed} via={ev.via} runs={runs} run={run} setRun={setRun} cursor={cursor} setCursor={setCursor} />}
          {mode === "runs" && <section className="hub-sec" aria-label="Runs"><h3>Runs</h3><p className="muted">No runs recorded yet</p></section>}
          <Inspector info={info} d={d} pick={pick} flow={flow} setFlow={setFlow} map={map} act={act} />
        </div>
        <ChangesCard d={d} act={act} />
      </aside>
    </div>
  );
}
