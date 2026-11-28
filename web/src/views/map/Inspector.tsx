// The shared inspector: what a clicked domain, flow or station is, in one
// card. Map-specific by design – degree, flows through, overlays – plus a
// short code excerpt of the station's file. It does not duplicate the graph
// view's SelectedPanel.

import { useEffect, useState } from "react";
import { api, relTime } from "../../api";
import type { MapModel } from "./model";
import { LAYERS, type Layer } from "./model";
import type { Pick } from "./ab";
import type { OverlayState } from "./overlays";
import { pickCode } from "./ab";

const LAYER_LABEL: Record<Layer, string> = {
  entry: "entry", handler: "handler", logic: "logic", data: "data", io: "io", test: "test",
};

function CodeExcerpt({ path, line }: { path: string; line: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api.file(path).then((f) => !dead && setText(f.content)).catch(() => !dead && setText(null));
    return () => { dead = true; };
  }, [path]);
  if (text == null) return null;
  const from = Math.max(0, line - 4);
  const lines = text.split("\n").slice(from, from + 12);
  return (
    <pre className="map-code" data-testid="map-code">
      {lines.map((l, i) => (
        <div key={i} className={from + i === line - 1 ? "map-code-hl" : undefined}>
          <span className="map-code-ln">{from + i + 1}</span>{l}
        </div>
      ))}
    </pre>
  );
}

export function Inspector({ pick, model, overlays, onClose, onPick }: {
  pick: Pick;
  model: MapModel;
  overlays: OverlayState;
  onClose: () => void;
  onPick: (p: Pick) => void;
}) {
  const st = pick.kind === "station" ? model.stations.find((s) => s.id === pick.id) : undefined;
  const fl = pick.kind === "flow" ? model.flows.find((f) => f.id === pick.id) : undefined;
  const dm = pick.kind === "domain" ? model.domains.find((d) => String(d.id) === pick.id) : undefined;

  return (
    <aside className="map-inspector" data-testid="map-inspector">
      <header className="map-inspector-head">
        <span className="map-kind">{pick.kind}</span>
        <button className="btn sm icon" onClick={onClose} aria-label="Close inspector" data-testid="inspector-close"><span aria-hidden>✕</span></button>
      </header>
      {st && (
        <div className="map-inspector-body">
          <h3 className="map-title">{st.name}</h3>
          <p className="map-sentence">
            A {st.kind} in <code>{st.path}</code>, on {st.degree === 1 ? "one flow" : `${st.degree} flows`}
            {st.degree >= 2 ? ", an interchange" : ""}.
          </p>
          <dl className="map-facts">
            <dt>Layer</dt><dd><span className={`map-layer map-layer-${st.layer}`}>{LAYER_LABEL[st.layer]}</span> of {LAYERS.join(" · ")}</dd>
            {st.branch && (<><dt>Branch</dt><dd>inside a {st.branch} block</dd></>)}
            <dt>Overlays</dt>
            <dd>
              {overlays.fences[st.id] ? `fence ${overlays.fences[st.id]}` : "no fence"}
              {overlays.live[st.id] ? `, live ${overlays.live[st.id].toFixed(2)}` : ""}
              {overlays.churn[st.id] ? `, churn ${overlays.churn[st.id]}` : ""}
              {overlays.owners[st.id] ? `, owner ${overlays.owners[st.id]}` : ""}
            </dd>
          </dl>
          {st.flows.length > 0 && (
            <div className="map-chips" data-testid="station-flows">
              {st.flows.map((fid) => {
                const f = model.flows.find((x) => x.id === fid);
                return <button key={fid} className="map-chip" onClick={() => onPick({ kind: "flow", id: fid })}>{f?.label ?? fid}</button>;
              })}
            </div>
          )}
          <CodeExcerpt path={st.path} line={st.line} />
        </div>
      )}
      {fl && (
        <div className="map-inspector-body">
          <h3 className="map-title">{fl.label}</h3>
          <p className="map-sentence">
            {fl.kind === "route" ? `A route ${fl.route ?? ""}` : `A ${fl.kind} flow`}, {fl.steps.length} steps from {model.stations.find((s) => s.id === fl.entry)?.name ?? fl.entry}.
          </p>
          <ol className="map-steps" data-testid="flow-steps">
            {fl.steps.map((s) => {
              const station = model.stations.find((x) => x.id === s.station);
              return (
                <li key={s.order}>
                  <button className="map-step" onClick={() => onPick({ kind: "station", id: s.station })}>
                    <span className={`map-layer map-layer-${s.layer}`}>{LAYER_LABEL[s.layer]}</span>
                    {station?.name ?? s.station}
                    {s.branch ? <span className="map-branch"> {s.branch}</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {dm && (
        <div className="map-inspector-body">
          <h3 className="map-title">{dm.label}</h3>
          <p className="map-sentence">A district of {dm.flows.length} flows across {dm.files.length} files.</p>
          <div className="map-chips">
            {dm.flows.map((fid) => {
              const f = model.flows.find((x) => x.id === fid);
              return <button key={fid} className="map-chip" onClick={() => onPick({ kind: "flow", id: fid })}>{f?.label ?? fid}</button>;
            })}
          </div>
        </div>
      )}
      {!st && !fl && !dm && (
        <div className="map-inspector-body"><p className="map-sentence">Nothing here. <code>{pickCode(pick)}</code></p></div>
      )}
    </aside>
  );
}

/** One line hover card. */
export function HoverCard({ text, x, y }: { text: string; x: number; y: number }) {
  if (!text) return null;
  return (
    <div className="map-hover" style={{ left: x + 12, top: y + 12 }} role="status">
      {text}
    </div>
  );
}

export const relTimeOr = (t: number, fallback: string) => (t > 0 ? relTime(t) : fallback);
