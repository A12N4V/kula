// Detail: whatever any list picked, a diff, a commit, a stash or a compare.
import { useEffect, useState, type ReactNode } from "react";
import { api, type Compare, type FileStatus, type Proposal } from "../../api";
import { useCode } from "../../CodePanel";
import type { Go } from "../../nav";
import { Diff, Icon, ShowOutput, useToast } from "../../ui";
import { CompareReport } from "../GitViews";
import { IB, WEmpty, type Run, type Sel, type SetSel } from "./parts";

export function Detail({ sel, setSel, files, run, go, openSymbol, current, version }: { sel: Sel; setSel: SetSel; files: FileStatus[]; run: Run; go?: Go; openSymbol: (id: number) => void; current: string; version: number }) {
  const [text, setText] = useState("");
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const code = useCode();
  const key = JSON.stringify(sel);
  useEffect(() => {
    setText(""); setCmp(null); setErr("");
    if (!sel) return;
    let live = true;
    setBusy(true);
    const fail = (e: any) => live && setErr(e.message ?? String(e));
    const done = () => live && setBusy(false);
    if (sel.kind === "file") api.diff(sel.path, sel.staged).then((d) => live && setText(d.diff)).catch(fail).finally(done);
    else if (sel.kind === "commit") api.show(sel.sha).then((s) => live && setText(s.show)).catch(fail).finally(done);
    else if (sel.kind === "stash") api.git("stash_show", { name: String(sel.n) }).then((r) => live && setText(r.output)).catch(fail).finally(done);
    else api.compare(sel.base, sel.head).then((c) => live && setCmp(c)).catch(fail).finally(done);
    return () => { live = false; };
  }, [key, version]);
  // A file that left the tree (committed, discarded) clears the selection.
  useEffect(() => { if (sel?.kind === "file" && !files.some((f) => f.path === sel.path)) setSel(null); }, [files]);

  let title: ReactNode = null, tools: ReactNode = null, body: ReactNode = null;
  if (!sel) body = <WEmpty icon={<Icon.target />}>Pick a file, commit, stash or branch</WEmpty>;
  else if (err) body = <pre className="w-out">{err}</pre>;
  else if (sel.kind === "file") {
    const slash = sel.path.lastIndexOf("/");
    title = <span className="gv-title mono"><b>{sel.path.slice(slash + 1)}</b>{slash > 0 && <span>{sel.path.slice(0, slash)}</span>}</span>;
    tools = <>
      <span className={`gv-tag${sel.staged ? " on" : ""}`}>{sel.staged ? "staged" : "working"}</span>
      <IB tip="Open file" onClick={() => code.open({ path: sel.path })}><Icon.file /></IB>
      {!sel.staged && <IB tip="Discard changes" onClick={() => { if (confirm(`Discard changes to ${sel.path}?`)) run("discard", { paths: [sel.path] }, "Discarded"); }}><Icon.close /></IB>}
    </>;
    if (!busy) body = text ? <Diff text={text} /> : <WEmpty icon={<Icon.changes />}>No textual diff</WEmpty>;
  } else if (sel.kind === "commit") {
    const sha = sel.sha;
    title = <span className="gv-title mono"><b>{/^[0-9a-f]{12,}$/.test(sha) ? sha.slice(0, 10) : sha}</b></span>;
    tools = <>
      <IB tip="Graph against parent" primary onClick={() => go?.("graph", { contrast: { base: `${sha}^`, head: sha } })}><Icon.graph /></IB>
      <IB tip="Cherry pick" onClick={() => run("cherry_pick", { name: sha }, "Cherry picked")}><Icon.copy /></IB>
      <IB tip="Revert" onClick={() => { if (confirm("Create a revert commit?")) run("revert", { name: sha }, "Reverted"); }}><Icon.back /></IB>
      <IB tip="Tag this commit" onClick={() => { const n = prompt("Tag name"); if (n) run("tag", { name: n, from: sha }, `Tagged ${n}`); }}><Icon.check /></IB>
      <IB tip="Branch from here" onClick={() => { const n = prompt("New branch name"); if (n) run("branch", { name: n, from: sha }, `Branch ${n} created`); }}><Icon.branches /></IB>
    </>;
    if (text) body = <div className="w-pad"><ShowOutput text={text} /></div>;
  } else if (sel.kind === "stash") {
    const n = sel.n;
    title = <span className="gv-title mono"><b>stash@{`{${n}}`}</b></span>;
    tools = <>
      <IB tip="Apply" onClick={() => run("stash_apply", { name: String(n) }, "Applied")}><Icon.check /></IB>
      <IB tip="Pop" onClick={() => run("stash_pop", { name: String(n) }, "Popped").then((o) => o !== null && setSel(null))}><Icon.up /></IB>
      <IB tip="Drop" onClick={() => { if (confirm(`Drop stash ${n}?`)) run("stash_drop", { name: String(n) }, "Dropped").then((o) => o !== null && setSel(null)); }}><Icon.close /></IB>
    </>;
    if (!busy) body = text ? <Diff text={text} /> : <WEmpty icon={<Icon.doc />}>Empty stash</WEmpty>;
  } else {
    const { base, head, proposal } = sel;
    title = <span className="gv-title mono"><b>{head}</b><span>into {base}</span></span>;
    tools = <>
      <IB tip="Graph contrast" primary onClick={() => go?.("graph", { contrast: { base, head } })}><Icon.graph /></IB>
      {proposal ? <IB tip="Open proposal" onClick={() => go?.("proposals", { proposal })}><Icon.pr /></IB>
        : <IB tip="Propose this change" onClick={() => api.metaAction<Proposal>("proposals", "new", { title: `${head} into ${base}`, base, head }).then((p) => { toast("Proposal opened"); go?.("proposals", { proposal: (p as Proposal).id }); }).catch((e) => toast(e.message, "err"))}><Icon.pr /></IB>}
      {base === current && <IB tip={`Merge ${head} here`} onClick={() => { if (confirm(`Merge ${head} into ${base}?`)) run("merge", { name: head }, `Merged ${head}`); }}><Icon.branches /></IB>}
    </>;
    if (cmp) body = <div className="w-pad"><CompareReport c={cmp} openSymbol={openSymbol} /></div>;
  }
  return (
    <section className="widget gv-detail" data-area="det" data-testid="w-det" aria-label="Detail" aria-busy={busy || undefined}>
      {title ? (
        <div className="w-detail-bar">{title}<span className="spacer" />{tools}<IB tip="Clear" onClick={() => setSel(null)}><Icon.close /></IB></div>
      ) : (
        <header className="widget-head"><span className="widget-title">Detail</span></header>
      )}
      <div className="widget-body">{body}</div>
    </section>
  );
}
