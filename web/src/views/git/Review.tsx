// Review: open proposals, and any two branches set side by side.
import { useState } from "react";
import type { Branch, Proposal } from "../../api";
import { relTime } from "../../api";
import { Icon } from "../../ui";
import { IB, WEmpty, Widget, type Sel, type SetSel } from "./parts";

export function Review({ proposals, branches, current, sel, setSel }: { proposals: Proposal[]; branches: Branch[]; current: string; sel: Sel; setSel: SetSel }) {
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const names = branches.filter((x) => !x.remote).map((x) => x.name);
  const b = base || current, h = head || names.find((x) => x !== b) || "";
  return (
    <Widget area="rev" title="Review" count={proposals.length}
      foot={
        <div className="w-line gv-one">
          <select className="input gv-input" aria-label="Base" value={b} onChange={(e) => setBase(e.target.value)}>{names.map((x) => <option key={x}>{x}</option>)}</select>
          <Icon.arrow />
          <select className="input gv-input" aria-label="Head" value={h} onChange={(e) => setHead(e.target.value)}>{names.map((x) => <option key={x}>{x}</option>)}</select>
          <IB tip="Compare" disabled={!b || !h || b === h} onClick={() => setSel({ kind: "compare", base: b, head: h })}><Icon.compare /></IB>
        </div>
      }>
      {proposals.length === 0 ? <WEmpty icon={<Icon.pr />}>No open proposals</WEmpty> : proposals.map((p) => (
        <div key={p.id} className={`w-row gv-prop${sel?.kind === "compare" && sel.proposal === p.id ? " on" : ""}`} onClick={() => setSel({ kind: "compare", base: p.base, head: p.head, proposal: p.id })} title={p.title}>
          <span className="w-code gv-dot">#{p.id}</span>
          <span className="grow">{p.title}</span>
          <span className="gv-track mono">{p.head}</span>
          <span className="dim gv-when">{relTime(p.created)}</span>
        </div>
      ))}
    </Widget>
  );
}
