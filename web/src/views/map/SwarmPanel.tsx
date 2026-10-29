import { useMemo, useState } from "react";
import type { AgentsInfo, Team } from "../../api";
import { AgentHarmonograph } from "../../flow/agentMark";
import { seatName, seatProvider } from "../agents/parts";
import type { Access } from "./workspace";

type Seat = { team: string; who: string; role: string; workflow: string; key: string };

/** The swarm as an organisation on the Workspace canvas: teams nested under
 *  the teams they answer to, each seat one row. Picking a seat turns on the
 *  access lens for its workflow – the map lights what it may change. */
export function SwarmPanel({ info, picked, access, onPick }: {
  info: AgentsInfo; picked: string | null; access: Record<string, Access>;
  onPick: (workflow: string | null, label: string | null) => void;
}) {
  // Shut by default: open, the panel sits over the canvas's left edge and
  // hides cards there. The choice is remembered per browser.
  const [open, setOpenRaw] = useState(() => { try { return localStorage.getItem("kula.swarm.open") === "1"; } catch { return false; } });
  const setOpen = (f: (o: boolean) => boolean) => setOpenRaw((o) => { const n = f(o); try { localStorage.setItem("kula.swarm.open", n ? "1" : "0"); } catch { /* private */ } return n; });
  const [seat, setSeat] = useState<string | null>(null);
  const tree = useMemo(() => {
    const kids = new Map<string, Team[]>();
    for (const t of info.teams) { const k = t.under ?? ""; kids.set(k, [...(kids.get(k) ?? []), t]); }
    const out: { team: Team; depth: number }[] = [];
    const walk = (k: string, d: number, seen: Set<string>) => {
      for (const t of kids.get(k) ?? []) { if (seen.has(t.name)) continue; seen.add(t.name); out.push({ team: t, depth: d }); walk(t.name, d + 1, seen); }
    };
    const seen = new Set<string>();
    walk("", 0, seen);
    for (const t of info.teams) if (!seen.has(t.name)) out.push({ team: t, depth: 0 }); // a cycle or a missing parent
    return out;
  }, [info.teams]);
  const solo = info.workflows.filter((w) => !w.builtin && !w.research);
  const counts = useMemo(() => {
    const c = { open: 0, review: 0, out: 0 };
    for (const a of Object.values(access)) c[a]++;
    return c;
  }, [access]);
  const pick = (s: Seat) => {
    const key = s.key;
    if (seat === key) { setSeat(null); onPick(null, null); return; }
    setSeat(key); onPick(s.workflow, `${s.who} · ${s.role} in ${s.team}`);
  };
  const row = (s: Seat, key: string) => {
    const on = seat === key || (!seat && picked === s.workflow && s.team === "");
    return (
      <button key={key} type="button" className={`sw-seat${on ? " on" : ""}`} aria-pressed={on} onClick={() => pick(s)}
        title={`${s.who} (${s.role}) works under the ${s.workflow} fence – click to light what it may change`} data-testid="sw-seat">
        <AgentHarmonograph name={s.key} size={16} />
        <span className="sw-who">{s.who}</span>
        <span className="sw-role">{s.role}</span>
        <span className="sw-wf mono">{s.workflow}</span>
      </button>
    );
  };
  return (
    <aside className={`swarm${open ? "" : " shut"}`} aria-label="Swarm" data-testid="swarm">
      <button type="button" className="sw-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <b>Swarm</b><span className="muted">{info.teams.length} teams · {info.teams.reduce((n, t) => n + t.members.length, 0)} seats</span>
        <span className="spacer" /><span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {open && picked && (
        <div className="sw-lens" data-testid="sw-lens">
          <span className="sw-k open" /> {counts.open} may change
          <span className="sw-k review" /> {counts.review} review
          <span className="sw-k out" /> {counts.out} fenced off
        </div>
      )}
      {open && <div className="sw-body">
        {tree.map(({ team, depth }) => (
          <div key={team.name} className="sw-team" style={{ marginLeft: depth * 12 }}>
            <div className="sw-team-name"><span className="mono">{team.name}</span>{team.about && <span className="muted"> – {team.about}</span>}</div>
            {team.members.map((m, i) => {
              const who = seatName(m), prov = seatProvider(m);
              return row({ team: team.name, who, role: prov ? `on ${prov}` : "any provider", workflow: m.workflow ?? "", key: `${team.name}/${i}` }, `${team.name}/${i}`);
            })}
          </div>
        ))}
        {solo.length > 0 && <div className="sw-team">
          <div className="sw-team-name"><span className="mono">workflows</span><span className="muted"> – solo agents</span></div>
          {solo.map((w) => row({ team: "", who: w.name, role: "solo", workflow: w.name, key: `/${w.name}` }, `/${w.name}`))}
        </div>}
      </div>}
    </aside>
  );
}
