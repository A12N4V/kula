// Stashes, and the conflict list that stands in for the tree mid merge or rebase.
import { useState } from "react";
import type { FileStatus, GitOp } from "../../api";
import { Icon } from "../../ui";
import { IB, OP_LABEL, WEmpty, Widget, type Run, type Sel, type SetSel } from "./parts";

export function Stashes({ stashes, run, sel, setSel }: { stashes: string[]; run: Run; sel: Sel; setSel: SetSel }) {
  const [msg, setMsg] = useState("");
  const save = async () => { if (await run(msg.trim() ? "stash_message" : "stash", msg.trim() ? { message: msg.trim() } : {}, "Stashed") !== null) setMsg(""); };
  return (
    <Widget area="stash" title="Stashes" count={stashes.length}
      foot={
        <div className="w-line gv-one">
          <input className="input gv-input" placeholder="Stash message" aria-label="Stash message" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <IB tip="Stash changes" onClick={save}><Icon.down /></IB>
        </div>
      }>
      {stashes.length === 0 ? <WEmpty icon={<Icon.doc />}>No stashes</WEmpty> : stashes.map((s, n) => (
        <div key={s} className={`w-row${sel?.kind === "stash" && sel.n === n ? " on" : ""}`} onClick={() => setSel({ kind: "stash", n })} title={s}>
          <span className="w-code gv-dot">{n}</span>
          <span className="grow">{s.replace(/^stash@\{\d+\}:\s*/, "")}</span>
          <span className="acts"><IB tip="Pop" onClick={() => run("stash_pop", { name: String(n) }, "Popped")}><Icon.up /></IB></span>
        </div>
      ))}
    </Widget>
  );
}

export function Conflicts({ op, files, run, sel, setSel }: { op: GitOp; files: FileStatus[]; run: Run; sel: Sel; setSel: SetSel }) {
  const label = OP_LABEL[op];
  return (
    <Widget area="conf" title={`${label} in progress`} count={files.length} alert
      tools={<>
        <IB tip={`Abort ${label.toLowerCase()}`} onClick={() => { if (confirm(`Abort the ${label.toLowerCase()}?`)) run("abort", {}, "Aborted"); }}><Icon.close /></IB>
        <IB tip="Continue" primary disabled={files.length > 0} onClick={() => run("continue", {}, "Continued")}><Icon.play /></IB>
      </>}>
      {files.length === 0 ? <WEmpty icon={<Icon.check />}>All conflicts resolved</WEmpty> : files.map((f) => (
        <div key={f.path} className={`w-row${sel?.kind === "file" && sel.path === f.path ? " on" : ""}`} onClick={() => setSel({ kind: "file", path: f.path, staged: false })} title={f.path}>
          <span className="w-code U">{f.index}{f.worktree}</span>
          <span className="grow mono">{f.path}</span>
          <span className="acts">
            <IB tip="Keep ours" onClick={() => run("resolve", { name: "ours", paths: [f.path] }, "Kept ours")}><Icon.back /></IB>
            <IB tip="Take theirs" onClick={() => run("resolve", { name: "theirs", paths: [f.path] }, "Took theirs")}><Icon.arrow /></IB>
            <IB tip="Mark resolved" onClick={() => run("stage", { paths: [f.path] }, "Marked resolved")}><Icon.check /></IB>
          </span>
        </div>
      ))}
    </Widget>
  );
}
