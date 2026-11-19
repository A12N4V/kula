// Slice: one part of the graph cut out with its boundary (src/isolate.rs).
// Selectors are symbols, paths, globs or clusters; the slice lists its nodes
// by file and who crosses in and out.
import { useEffect, useState } from "react";
import { api, type Peer, type Slice as S } from "../../api";
import { useCode } from "../../CodePanel";
import { Docked } from "../../studio/Dock";
import { Icon, Kind } from "../../ui";
import { groupBy, IB, Seg, splitPath, useSaved, WEmpty, Widget, type Nav } from "./parts";

const KEY = "kula.slice.select";

function Peers({ title, area, peers, open }: { title: string; area: string; peers: Peer[]; open: (p: Peer) => void }) {
  return (
    <Widget area={area} title={title} count={peers.length}>
      {peers.length === 0 ? <WEmpty icon={<Icon.isolate />}>None</WEmpty> : peers.map((p) => (
        <div key={p.node.id} className="w-row" onClick={() => open(p)} title={`${p.node.path}:${p.node.start_line}`}>
          <Kind kind={p.node.kind} size={14} />
          <span className="grow"><span className="mono w-base">{p.node.name}</span><span className="w-dir mono">{splitPath(p.node.path).base}</span></span>
          <span className="dim mono">{p.kinds.join(" ")}</span>
          <span className="dim mono">{p.edges}</span>
        </div>
      ))}
    </Widget>
  );
}

export default function Slice({ go, version, target }: Nav) {
  const [text, setText] = useSaved<string>(KEY, "");
  const [hops, setHops] = useSaved<number>("kula.slice.hops", 1);
  const [res, setRes] = useState<S | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const code = useCode();
  const sels = text.split(/[\s,]+/).filter(Boolean);
  const run = () => {
    if (!sels.length) return;
    setBusy(true); setErr("");
    api.isolate(sels, hops).then(setRes).catch((e) => { setErr(e.message); setRes(null); }).finally(() => setBusy(false));
  };
  useEffect(() => { if (sels.length && res) run(); }, [hops, version]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Slice from here" on a graph node lands with its selector and cuts at once.
  useEffect(() => {
    const t = target?.slice;
    if (!t) return;
    setText(t); setBusy(true); setErr("");
    api.isolate([t], hops).then(setRes).catch((e) => { setErr(e.message); setRes(null); }).finally(() => setBusy(false));
  }, [target?.slice]); // eslint-disable-line react-hooks/exhaustive-deps
  const openNode = (n: { path: string; start_line: number; id: number; name: string; kind: any }) => code.open({ path: n.path, line: n.start_line, id: n.id, name: n.name, kind: n.kind });
  const files = res ? groupBy(res.nodes.filter((n) => n.kind !== "file" && n.kind !== "package"), (n) => n.path) : [];

  return (
    <div className="qv" data-testid="query-slice">
      <header className="qv-head">
        <form className="qv-pick" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <Icon.isolate />
          <input className="input qv-pick-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Symbols, paths or globs" aria-label="Slice selectors" />
        </form>
        <Seg label="Hops" value={hops} set={setHops} opts={[0, 1, 2, 3].map((h) => ({ id: h, label: `${h} hop${h === 1 ? "" : "s"}` }))} />
        <button className="btn sm primary" onClick={run} disabled={busy || !sels.length}><Icon.play /> Cut</button>
      </header>
      {!res ? (
        <div className="qv-main one">
          <Widget area="slice" title="Slice">{err ? <pre className="w-out">{err}</pre> : <WEmpty icon={<Icon.isolate />}>Name what to cut out, like src/graph or Repo.status</WEmpty>}</Widget>
        </div>
      ) : (
        <div className="qv-main" style={{ ["--list-w" as string]: "minmax(0, 1fr)" }}>
          <Widget area="slice" title="Inside" count={`${res.counts.nodes} nodes`}
            tools={<IB tip="Isolate on graph" primary onClick={() => go?.("graph", { search: sels[0] })}><Icon.graph /></IB>}>
            {files.length === 0 ? <WEmpty icon={<Icon.isolate />}>Empty slice</WEmpty> : files.map(([path, ns]) => {
              const p = splitPath(path);
              return (
                <div key={path}>
                  <div className="w-sec qv-file" onClick={() => code.open({ path })} title={path}><Icon.file />{p.base}<span className="w-dir">{p.dir}</span><span className="spacer" />{ns.length}</div>
                  {ns.map((n) => (
                    <div key={n.id} className="w-row" onClick={() => openNode(n)}>
                      <Kind kind={n.kind} size={14} /><span className="grow mono">{n.name}</span><span className="dim mono">{n.start_line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </Widget>
          <div className="qv-col">
            <Peers title="Inbound" area="inbound" peers={res.inbound} open={(p) => openNode(p.node)} />
            <Peers title="Outbound" area="outbound" peers={res.outbound} open={(p) => openNode(p.node)} />
          </div>
        </div>
      )}
      <Docked label="Slice">
        <div className="ct ct-side qv-side" data-testid="slice-side">
          <div className="ct-side-head">
            <div className="ct-pick on"><b>{sels.length ? sels.join(" ") : "No slice"}</b><span className="ct-sub">{`${hops} hop${hops === 1 ? "" : "s"} around`}</span></div>
          </div>
          {res && (
            <div className="ct-side-scroll">
              <section className="ct-card">
                <h4>Size</h4>
                <div className="w-sync">
                  <div className="w-stat"><b>{res.counts.nodes}</b><span>Nodes</span></div>
                  <div className="w-stat"><b>{res.counts.files}</b><span>Files</span></div>
                  <div className="w-stat"><b>{res.counts.internal}</b><span>Edges</span></div>
                </div>
              </section>
              <section className="ct-card">
                <h4>Boundary</h4>
                <div className="w-sync">
                  <div className="w-stat"><b className={res.counts.inbound ? "acc" : ""}>{res.counts.inbound}</b><span>In peers</span></div>
                  <div className="w-stat"><b>{res.counts.outbound}</b><span>Out peers</span></div>
                  <div className="w-stat"><b>{res.counts.inbound_edges + res.counts.outbound_edges}</b><span>Crossings</span></div>
                </div>
              </section>
              {res.clusters.length > 0 && (
                <section className="ct-card">
                  <h4>Clusters</h4>
                  <div className="qv-tags">{res.clusters.map((c) => <span key={c} className="gv-tag">{c}</span>)}</div>
                </section>
              )}
            </div>
          )}
        </div>
      </Docked>
    </div>
  );
}
