// Flows: ordered execution paths from each entry point (src/graph/flowmap.rs),
// grouped into domains. The list sits beside the steps; the docked panel
// carries what the flow touches.
import { useEffect, useMemo, useState } from "react";
import { api, colorFor, type FlowMap, type FlowPath } from "../../api";
import { useCode } from "../../CodePanel";
import { ModeToggle } from "../../modes";
import { Docked } from "../../studio/Dock";
import { Grip, listWidth } from "../../resize";
import { Icon, Kind } from "../../ui";
import { IB, Seg, splitPath, useSaved, WEmpty, Widget, type Nav } from "./parts";

const KINDS = [
  { id: "all", label: "All" }, { id: "route", label: "Routes" }, { id: "main", label: "Main" },
  { id: "entry", label: "Entries" }, { id: "test", label: "Tests" },
] as const;
type KindF = (typeof KINDS)[number]["id"];

export default function Flows({ version, go }: Nav) {
  const [map, setMap] = useState<FlowMap | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [domain, setDomain] = useState<number | null>(null);
  const [kind, setKind] = useSaved<KindF>("kula.flows.kind", "all");
  const [filter, setFilter] = useState("");
  const code = useCode();
  useEffect(() => {
    api.flowmap(120).then((m) => { setMap(m); setErr(""); setSel((s) => s ?? m.flows[0]?.id ?? null); }).catch((e) => setErr(e.message));
  }, [version]);

  const label = useMemo(() => new Map(map?.domains.map((d) => [d.id, d.label]) ?? []), [map]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (map?.flows ?? []).filter((x) =>
      (kind === "all" || x.kind === kind) && (domain === null || x.domain === domain) &&
      (!f || x.entry.name.toLowerCase().includes(f) || (x.route ?? "").toLowerCase().includes(f) || x.entry.path.toLowerCase().includes(f)));
  }, [map, kind, domain, filter]);
  const flow: FlowPath | undefined = map?.flows.find((x) => x.id === sel);

  return (
    <div className="qv" data-testid="query-flows">
      <header className="qv-head">
        <ModeToggle />
        <Seg label="Flow kind" value={kind} set={setKind} opts={[...KINDS]} />
        <div className="qv-domains" role="radiogroup" aria-label="Domain">
          <button role="radio" aria-checked={domain === null} className={`qv-chip${domain === null ? " on" : ""}`} onClick={() => setDomain(null)}>All domains</button>
          {map?.domains.map((d) => (
            <button key={d.id} role="radio" aria-checked={domain === d.id} className={`qv-chip${domain === d.id ? " on" : ""}`} onClick={() => setDomain(domain === d.id ? null : d.id)} title={`${d.flows} flows, ${d.files.length} files`}>
              <i style={{ background: colorFor(d.id) }} />{d.label}
            </button>
          ))}
        </div>
      </header>
      <div className="qv-main" style={listWidth("flows", 340)}>
        <Widget area="flows" title="Flows" count={map ? shown.length : undefined}
          tools={<input className="input qv-filter" placeholder="Filter" aria-label="Filter flows" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
          {err ? <pre className="w-out">{err}</pre>
            : !map ? null
            : shown.length === 0 ? <WEmpty icon={<Icon.flows />}>No flows match</WEmpty>
            : shown.map((x) => (
              <div key={x.id} className={`w-row qv-flow${x.id === sel ? " on" : ""}`} onClick={() => setSel(x.id)} role="button" tabIndex={0} aria-pressed={x.id === sel}
                onKeyDown={(e) => { if (e.key === "Enter") setSel(x.id); }}>
                <i className="qv-dot" style={{ background: colorFor(x.domain) }} />
                <span className="grow"><span className="mono w-base">{x.route ?? x.entry.name}</span>{x.route && <span className="w-dir mono">{x.entry.name}</span>}</span>
                <span className={`qv-kind k-${x.kind}`}>{x.kind}</span>
                <span className="dim mono">{x.steps.length}</span>
              </div>
            ))}
        </Widget>
        <Grip id="flows" edge="right" target="prev" min={240} max={640} label="Resize list" />
        <Widget area="steps" title={flow ? <span className="mono">{flow.route ?? flow.entry.name}</span> : "Steps"} count={flow ? `${flow.steps.length} steps` : undefined}
          tools={flow && <>
            <IB tip="Open entry" onClick={() => code.open({ path: flow.entry.path, line: flow.entry.start_line, id: flow.entry.id, name: flow.entry.name, kind: flow.entry.kind })}><Icon.file /></IB>
            <IB tip="Show on graph" primary onClick={() => go?.("graph", { symbol: flow.entry.id })}><Icon.graph /></IB>
          </>}>
          {!flow ? <WEmpty icon={<Icon.flows />}>Pick a flow</WEmpty> : (
            <ol className="qv-steps">
              <li className="qv-step entry" style={{ ["--d" as string]: 0 }}>
                <span className="qv-n mono">0</span><Kind kind={flow.entry.kind} size={14} />
                <button className="kq-iri mono" onClick={() => code.open({ path: flow.entry.path, line: flow.entry.start_line })}>{flow.entry.name}</button>
                <span className="dim mono">{flow.entry.path}:{flow.entry.start_line}</span>
              </li>
              {flow.steps.map((s, i) => (
                <li key={`${s.id}-${i}`} className="qv-step" style={{ ["--d" as string]: Math.min(s.depth, 6) }} title={`${s.conf} confidence`}>
                  <span className="qv-n mono">{i + 1}</span>
                  {s.branch ? <span className={`qv-br b-${s.branch}`}>{s.branch}</span> : <Kind kind={s.kind} size={14} />}
                  <button className="kq-iri mono" onClick={() => code.open({ path: s.path, line: s.line, id: s.id, name: s.name })}>{s.name}</button>
                  <span className="dim mono">{splitPath(s.path).base}:{s.line}</span>
                </li>
              ))}
            </ol>
          )}
        </Widget>
      </div>
      <Docked label="Flow">
        <div className="ct ct-side qv-side" data-testid="flows-side">
          <div className="ct-side-head">
            <div className="ct-pick on"><b>{flow ? flow.entry.name : "No flow"}</b><span className="ct-sub">{flow ? `${flow.kind} in ${label.get(flow.domain) ?? "unsorted"}` : "pick one in the list"}</span></div>
          </div>
          {flow && (
            <div className="ct-side-scroll">
              <section className="ct-card">
                <h4>Shape</h4>
                <div className="w-sync">
                  <div className="w-stat"><b>{flow.steps.length}</b><span>Steps</span></div>
                  <div className="w-stat"><b>{Math.max(0, ...flow.steps.map((s) => s.depth))}</b><span>Depth</span></div>
                  <div className="w-stat"><b className={flow.steps.some((s) => s.branch) ? "acc" : ""}>{flow.steps.filter((s) => s.branch).length}</b><span>Branches</span></div>
                </div>
                {flow.route && <p className="ct-hint mono qv-route">{flow.route}</p>}
              </section>
              <section className="ct-card">
                <h4>Files<span className="spacer" /><span className="widget-count">{flow.files.length}</span></h4>
                {flow.files.map((f) => {
                  const p = splitPath(f);
                  return <div key={f} className="w-row" onClick={() => code.open({ path: f })} title={f}><Icon.file /><span className="grow"><span className="w-base">{p.base}</span><span className="w-dir">{p.dir}</span></span></div>;
                })}
              </section>
            </div>
          )}
        </div>
      </Docked>
    </div>
  );
}
