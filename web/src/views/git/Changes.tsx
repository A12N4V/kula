// The working tree: staged and unstaged files, the commit box, and j/k/s/u.
import { useEffect, useRef, useState } from "react";
import type { FileStatus } from "../../api";
import { Icon } from "../../ui";
import { IB, WEmpty, Widget, type Run, type Sel, type SetSel } from "./parts";

const code = (f: FileStatus, s: boolean) => (s ? f.index : f.untracked ? "?" : f.worktree);
const cls = (c: string) => (c === "?" ? "q" : c);

export function Changes({ files, sel, setSel, run }: { files: FileStatus[]; sel: Sel; setSel: SetSel; run: Run }) {
  const [msg, setMsg] = useState("");
  const [amend, setAmend] = useState(false);
  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => f.unstaged || f.untracked);
  const commit = async () => {
    if (await run("commit", { message: msg, amend }, amend ? "Amended last commit" : "Committed") !== null) { setMsg(""); setAmend(false); }
  };

  // j/k walk the rows, s stages, u unstages; typing in a field is left alone.
  const flat = [...staged.map((f) => ({ path: f.path, staged: true })), ...unstaged.map((f) => ({ path: f.path, staged: false }))];
  const keys = useRef({ flat, sel, setSel, run });
  keys.current = { flat, sel, setSel, run };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.closest("[role=dialog]")))) return;
      const { flat, sel, setSel, run } = keys.current;
      if (!flat.length || e.key.length !== 1 || !"jksu".includes(e.key)) return;
      const i = sel?.kind === "file" ? flat.findIndex((r) => r.path === sel.path && r.staged === sel.staged) : -1;
      const cur = flat[i];
      if (e.key === "j") setSel({ kind: "file", ...flat[Math.min(flat.length - 1, i + 1)] });
      else if (e.key === "k") setSel({ kind: "file", ...flat[Math.max(0, i - 1)] });
      else if (e.key === "s" && cur && !cur.staged) run("stage", { paths: [cur.path] }).then(() => setSel({ kind: "file", path: cur.path, staged: true }));
      else if (e.key === "u" && cur && cur.staged) run("unstage", { paths: [cur.path] }).then(() => setSel({ kind: "file", path: cur.path, staged: false }));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  // keep the picked row in view as j/k walk
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.querySelector(".w-row.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const row = (f: FileStatus, s: boolean) => {
    const on = sel?.kind === "file" && sel.path === f.path && sel.staged === s;
    const c = code(f, s);
    const slash = f.path.lastIndexOf("/");
    return (
      <div key={(s ? "s:" : "u:") + f.path} className={`w-row${on ? " on" : ""}`} onClick={() => setSel({ kind: "file", path: f.path, staged: s })} title={f.path}>
        <span className={`w-code ${cls(c)}`}>{c}</span>
        <span className="grow mono"><span className="w-base">{f.path.slice(slash + 1)}</span>{slash > 0 && <span className="w-dir">{f.path.slice(0, slash)}</span>}</span>
        <span className="acts">
          {s ? <IB tip="Unstage" onClick={() => run("unstage", { paths: [f.path] })}><Icon.minus /></IB>
             : <IB tip="Stage" onClick={() => run("stage", { paths: [f.path] })}><Icon.plus /></IB>}
        </span>
      </div>
    );
  };

  return (
    <Widget area="tree" title="Working tree" count={files.length}
      foot={
        <>
          <textarea className="input gv-msg" rows={2} placeholder="Commit message" aria-label="Commit message" value={msg} onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && msg.trim() && (staged.length || amend)) { e.preventDefault(); commit(); } }} />
          <div className="w-line">
            <label className="gv-check"><input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} /><span>Amend</span></label>
            <span className="w-note"><kbd>⌘↵</kbd></span>
            <span className="spacer" />
            <button className="btn sm primary" disabled={!msg.trim() || (!staged.length && !amend)} onClick={commit}><Icon.check /> Commit {staged.length ? staged.length : ""}</button>
          </div>
        </>
      }>
      <div ref={body}>
        {files.length === 0 ? <WEmpty icon={<Icon.check />}>Working tree clean</WEmpty> : (
          <>
            <div className="w-sec">Staged {staged.length}<span className="spacer" />{staged.length > 0 && <IB tip="Unstage all" onClick={() => run("unstage", { paths: staged.map((f) => f.path) })}><Icon.minus /></IB>}</div>
            {staged.length === 0 ? <div className="w-note gv-none">Nothing staged</div> : staged.map((f) => row(f, true))}
            <div className="w-sec">Changes {unstaged.length}<span className="spacer" />{unstaged.length > 0 && <IB tip="Stage all" onClick={() => run("stage", { paths: unstaged.map((f) => f.path) })}><Icon.plus /></IB>}</div>
            {unstaged.map((f) => row(f, false))}
          </>
        )}
      </div>
    </Widget>
  );
}
