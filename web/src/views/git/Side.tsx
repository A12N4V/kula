// The Git tool window, docked in the shell's right sidebar: sync state, kula
// meta sharing, and the output of every remote command run this session.
import { relTime, type Branch } from "../../api";
import { Icon } from "../../ui";
import { IB } from "./parts";

export type Out = { label: string; text: string; at: number; err?: boolean };

export function Side({ current, ahead, behind, busy, log, kula, sync, clear }: {
  current?: Branch; ahead: number; behind: number; busy: string; log: Out[];
  kula: (label: "Share" | "Sync") => void; sync: (label: "Fetch" | "Pull" | "Push") => void; clear: () => void;
}) {
  return (
    <div className="ct ct-side gv-side" data-testid="w-sync">
      <div className="ct-side-head">
        <div className="ct-pick on"><b>{current?.name ?? "detached"}</b><span className="ct-sub">{current?.upstream || "no upstream"}</span></div>
      </div>
      <div className="ct-side-scroll">
        <section className="ct-card">
          <h4>Sync<span className="spacer" />
            <IB tip="Fetch" disabled={!!busy} onClick={() => sync("Fetch")}><Icon.refresh /></IB>
            <IB tip="Pull" disabled={!!busy || !current?.upstream} onClick={() => sync("Pull")}><Icon.down /></IB>
            <IB tip="Push" disabled={!!busy} primary={ahead > 0} onClick={() => sync("Push")}><Icon.up /></IB>
          </h4>
          <div className="w-sync">
            <div className="w-stat"><b className={ahead ? "acc" : ""}>{ahead}</b><span>Ahead</span></div>
            <div className="w-stat"><b className={behind ? "warn" : ""}>{behind}</b><span>Behind</span></div>
            <div className="w-stat"><b>{current ? relTime(current.time) : "none"}</b><span>Last</span></div>
          </div>
        </section>
        <section className="ct-card">
          <h4>Kula meta<span className="spacer" />
            <IB tip="Share kula meta" disabled={!!busy} onClick={() => kula("Share")}><Icon.team /></IB>
            <IB tip="Sync kula meta" disabled={!!busy} onClick={() => kula("Sync")}><Icon.workflow /></IB>
          </h4>
          <p className="ct-hint gv-pad">Issues, notes and proposals travel on refs/kula/meta.</p>
        </section>
        <section className="ct-card">
          <h4>Output<span className="spacer" />{log.length > 0 && <IB tip="Clear output" onClick={clear}><Icon.close /></IB>}</h4>
          {busy && <div className="w-note gv-pad">{busy}</div>}
          {log.length === 0 && !busy ? <p className="ct-hint gv-pad">Fetch, pull and push output lands here.</p>
            : log.map((o) => (
              <div key={o.at} className={`gv-out${o.err ? " err" : ""}`}>
                <div className="gv-out-head mono"><b>{o.label}</b><span>{relTime(o.at / 1000)}</span></div>
                <pre className="w-out">{o.text}</pre>
              </div>
            ))}
        </section>
      </div>
    </div>
  );
}
