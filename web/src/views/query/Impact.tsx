// Impact: what a change to one symbol reaches. Callers going up, callees
// going down, grouped by distance; the docked panel holds the summary.
import { useEffect, useState } from "react";
import { api, type Impact as Hit, type Node } from "../../api";
import { useCode } from "../../CodePanel";
import { Docked } from "../../studio/Dock";
import { Icon, Kind } from "../../ui";
import { groupBy, IB, Seg, SymbolPicker, splitPath, useSaved, WEmpty, Widget, type Nav } from "./parts";

type Dir = "up" | "down";

export default function Impact({ target, go, version }: Nav) {
  const [root, setRoot] = useState<Node | null>(null);
  const [dir, setDir] = useSaved<Dir>("kula.impact.dir", "up");
  const [depth, setDepth] = useSaved<number>("kula.impact.depth", 3);
  const [res, setRes] = useState<Hit | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const code = useCode();
  useEffect(() => { if (target?.symbol) api.symbol(target.symbol).then((c) => setRoot(c.node)).catch(() => {}); }, [target?.symbol]);
  useEffect(() => {
    if (!root) return;
    let live = true;
    setBusy(true); setErr("");
    api.impact(root.id, dir, depth).then((r) => live && setRes(r)).catch((e) => live && setErr(e.message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [root?.id, dir, depth, version]);

  const levels = res ? groupBy([...res.hits].sort((a, b) => a.depth - b.depth), (h) => h.depth) : [];
  const name = (id: number | null) => (id === null ? null : id === res?.root.id ? res.root.name : res?.hits.find((h) => h.node.id === id)?.node.name);

  return (
    <div className="qv" data-testid="query-impact">
      <header className="qv-head">
        <SymbolPicker value={root} pick={setRoot} placeholder="Symbol to change" />
        <Seg label="Direction" value={dir} set={setDir} opts={[{ id: "up", label: "Callers", icon: Icon.up }, { id: "down", label: "Callees", icon: Icon.down }]} />
        <Seg label="Depth" value={depth} set={setDepth} opts={[1, 2, 3, 4, 5].map((d) => ({ id: d, label: String(d) }))} />
      </header>
      <div className="qv-main one">
        <Widget area="impact" title={root ? <span className="mono">{root.name}</span> : "Impact"} count={res ? `${res.hits.length} reached` : undefined}
          tools={root && <IB tip="Show on graph" primary onClick={() => go?.("graph", { symbol: root.id })}><Icon.graph /></IB>}>
          {!root ? <WEmpty icon={<Icon.target />}>Pick a symbol to see what it reaches</WEmpty>
            : err ? <pre className="w-out">{err}</pre>
            : busy && !res ? null
            : res && res.hits.length === 0 ? <WEmpty icon={<Icon.target />}>Nothing reached</WEmpty>
            : levels.map(([d, hs]) => (
              <div key={d}>
                <div className="w-sec">Hop {d}<span className="spacer" />{hs.length}</div>
                {hs.map((h) => (
                  <div key={h.node.id} className="w-row" onClick={() => code.open({ path: h.node.path, line: h.node.start_line, id: h.node.id, name: h.node.name, kind: h.node.kind })} title={`${h.node.path}:${h.node.start_line}`}>
                    <Kind kind={h.node.kind} size={14} />
                    <span className="grow"><span className="mono w-base">{h.node.name}</span><span className="w-dir mono">{splitPath(h.node.path).base}</span></span>
                    {h.via !== null && h.depth > 1 && <span className="dim mono">via {name(h.via)}</span>}
                    <span className="acts"><IB tip="Impact of this" onClick={() => setRoot(h.node)}><Icon.target /></IB></span>
                  </div>
                ))}
              </div>
            ))}
        </Widget>
      </div>
      <Docked label="Impact">
        <div className="ct ct-side qv-side" data-testid="impact-side">
          <div className="ct-side-head">
            <div className="ct-pick on"><b>{root?.name ?? "No symbol"}</b><span className="ct-sub">{root ? `${root.path}:${root.start_line}` : "pick one in the centre"}</span></div>
          </div>
          {res && (
            <div className="ct-side-scroll">
              <section className="ct-card">
                <h4>Reach</h4>
                <div className="w-sync">
                  <div className="w-stat"><b>{res.hits.length}</b><span>Symbols</span></div>
                  <div className="w-stat"><b>{res.files}</b><span>Files</span></div>
                  <div className="w-stat"><b className={/high/i.test(res.risk) ? "warn" : /med/i.test(res.risk) ? "acc" : ""}>{res.risk}</b><span>Risk</span></div>
                </div>
              </section>
              {res.communities.length > 0 && (
                <section className="ct-card">
                  <h4>Areas</h4>
                  <div className="qv-tags">{res.communities.map((c) => <span key={c} className="gv-tag">{c}</span>)}</div>
                </section>
              )}
              <section className="ct-card">
                <h4>By hop</h4>
                {levels.map(([d, hs]) => (
                  <div key={d} className="qv-bar"><span className="mono">{d}</span><i style={{ width: `${(hs.length / Math.max(1, res.hits.length)) * 100}%` }} /><b className="mono">{hs.length}</b></div>
                ))}
              </section>
            </div>
          )}
        </div>
      </Docked>
    </div>
  );
}
