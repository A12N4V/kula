// Branches: local first, then remote, then tags. A row shows its tip in Detail.
import { useState } from "react";
import type { Branch } from "../../api";
import { relTime } from "../../api";
import { Icon } from "../../ui";
import { IB, WEmpty, Widget, type Run, type Sel, type SetSel } from "./parts";

export function Branches({ branches, tags, current, run, sel, setSel, showHistory }: { branches: Branch[]; tags: string[]; current: string; run: Run; sel: Sel; setSel: SetSel; showHistory: (b: string) => void }) {
  const [name, setName] = useState("");
  const make = async () => { const n = name.trim(); if (n && await run("branch", { name: n }, `Branch ${n} created`) !== null) setName(""); };
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);
  const isOn = (b: Branch) => (sel?.kind === "commit" && sel.sha === b.sha) || (sel?.kind === "compare" && !sel.proposal && sel.head === b.name);

  const row = (b: Branch) => (
    <div key={(b.remote ? "r:" : "l:") + b.name} className={`w-row gv-branch${isOn(b) ? " on" : ""}`} onClick={() => setSel({ kind: "commit", sha: b.sha })} title={b.subject}>
      <span className={`w-code gv-dot${b.current ? " cur" : ""}`}>{b.current ? "●" : "○"}</span>
      <span className="grow mono">{b.name}</span>
      {b.track && <span className="gv-track mono">{b.track.replace(/[[\]]/g, "")}</span>}
      <span className="dim gv-when">{relTime(b.time)}</span>
      <span className="acts">
        <IB tip="Show history" onClick={() => showHistory(b.name)}><Icon.history /></IB>
        {!b.current && <IB tip={`Compare with ${current}`} onClick={() => setSel({ kind: "compare", base: current, head: b.name })}><Icon.compare /></IB>}
        {!b.current && !b.remote && <IB tip="Check out" onClick={() => run("checkout", { name: b.name }, `On ${b.name}`)}><Icon.arrow /></IB>}
        {!b.current && <IB tip={`Merge into ${current}`} onClick={() => { if (confirm(`Merge ${b.name} into ${current}?`)) run("merge", { name: b.name }, `Merged ${b.name}`); }}><Icon.branches /></IB>}
        {!b.current && !b.remote && <IB tip="Delete branch" onClick={() => { if (confirm(`Delete ${b.name}?`)) run("branch_delete", { name: b.name }, `Deleted ${b.name}`); }}><Icon.close /></IB>}
      </span>
    </div>
  );

  return (
    <Widget area="br" title="Branches" count={local.length}
      foot={
        <div className="w-line gv-one">
          <input className="input gv-input" placeholder="New branch" aria-label="New branch name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()} />
          <IB tip="Create branch" onClick={make} disabled={!name.trim()}><Icon.plus /></IB>
        </div>
      }>
      {local.length === 0 ? <WEmpty icon={<Icon.branches />}>No branches</WEmpty> : (
        <>
          <div className="w-sec">Local {local.length}</div>
          {local.map(row)}
          {remote.length > 0 && <><div className="w-sec">Remote {remote.length}</div>{remote.map(row)}</>}
          {tags.length > 0 && (
            <>
              <div className="w-sec">Tags {tags.length}</div>
              {tags.map((t) => (
                <div key={"t:" + t} className={`w-row${sel?.kind === "commit" && sel.sha === t ? " on" : ""}`} onClick={() => setSel({ kind: "commit", sha: t })} title={t}>
                  <span className="w-code gv-dot">◇</span>
                  <span className="grow mono">{t}</span>
                  <span className="acts"><IB tip={`Compare with ${current}`} onClick={() => setSel({ kind: "compare", base: current, head: t })}><Icon.compare /></IB></span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </Widget>
  );
}
