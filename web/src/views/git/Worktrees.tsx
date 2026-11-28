// Every worktree and branch at a glance, docked in the right sidebar.
import { useEffect, useState } from "react";
import { hub, relTime, type GitOverview } from "../../api";

export function Worktrees({ version }: { version: number }) {
  const [o, setO] = useState<GitOverview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { hub.gitOverview().then((x) => { setO(x); setErr(""); }).catch((e) => setErr(e.message)); }, [version]);
  return (
    <div className="ct ct-side gv-side" data-testid="git-worktrees">
      <div className="ct-side-head">
        <div className="ct-pick on"><b>{o ? `${o.worktrees.length} worktree${o.worktrees.length === 1 ? "" : "s"}` : "Worktrees"}</b><span className="ct-sub">{o ? `against ${o.base}` : err}</span></div>
      </div>
      {o && (
        <div className="ct-side-scroll">
          <section className="ct-card">
            <div className="w-sync">
              <div className="w-stat"><b>{o.local}</b><span>Local</span></div>
              <div className="w-stat"><b>{o.remote}</b><span>Remote</span></div>
              <div className="w-stat"><b className={o.stale ? "acc" : ""}>{o.stale}</b><span>Stale</span></div>
            </div>
          </section>
          <section className="ct-card">
            <h4>Worktrees</h4>
            {o.worktrees.map((w) => (
              <div key={w.path} className="wt-row" title={w.path}>
                <span className={`wt-dot ${w.dirty ? "dirty" : ""} ${w.current ? "here" : ""}`} />
                <span className="wt-name">{w.name}</span>
                <span className="mono dim wt-br">{w.detached ? w.head.slice(0, 7) : w.branch}</span>
                {w.dirty > 0 && <span className="mono acc">{w.dirty}</span>}
              </div>
            ))}
          </section>
          <section className="ct-card">
            <h4>Branches</h4>
            {o.branches.slice(0, 40).map((b) => (
              <div key={b.name} className="wt-row" title={b.subject}>
                <span className={`wt-dot ${b.current ? "here" : ""} ${b.merged ? "merged" : ""}`} />
                <span className="wt-name">{b.name}</span>
                <span className="mono dim wt-br">{b.ahead ? `+${b.ahead}` : ""}{b.behind ? ` ${"−"}${b.behind}` : ""}</span>
                <span className="mono dim">{relTime(b.time)}</span>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
