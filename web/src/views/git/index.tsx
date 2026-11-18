// The Git view. One list at a time on the left (toggled in the header), the
// shared Detail on the right, sync and output docked in the shell's sidebar.
// Every list writes the same selection; Detail reads it.
import { useEffect, useRef, useState } from "react";
import { api, isConflict, type Branch, type FileStatus, type GitOp, type Proposal } from "../../api";
import type { Go, Target } from "../../nav";
import { Grip, listWidth } from "../../resize";
import { Docked } from "../../studio/Dock";
import { useToast } from "../../ui";
import { Branches } from "./Branches";
import { Changes } from "./Changes";
import { Detail } from "./Detail";
import { Header, MODES, type Mode } from "./Header";
import { History } from "./History";
import { track, type Sel } from "./parts";
import { Review } from "./Review";
import { Side, type Out } from "./Side";
import { Conflicts, Stashes } from "./Stashes";
import "./git-view.css";

type Props = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

const MODE_KEY = "kula.git.mode";
const savedMode = (): Mode => {
  try { const m = localStorage.getItem(MODE_KEY); if (MODES.some((x) => x.id === m)) return m as Mode; } catch {}
  return "changes";
};

export default function GitView({ onChanged, openSymbol, version, go, target }: Props) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [op, setOp] = useState<GitOp | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashes, setStashes] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [sel, setSel] = useState<Sel>(target?.sha ? { kind: "commit", sha: target.sha } : null);
  const [filter, setFilter] = useState("");
  const [mode, setModeState] = useState<Mode>(target?.sha ? "history" : savedMode);
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<Out[]>([]);

  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch {} };
  const refresh = () => setTick((t) => t + 1);
  const seeded = useRef(!!target?.sha);
  useEffect(() => {
    api.status().then((s) => {
      setBranch(s.branch); setFiles(s.files); setOp(s.state ?? null);
      // Detail is never blank on arrival: the first change, else the tip commit.
      if (!seeded.current) {
        seeded.current = true;
        const f = s.files[0];
        if (f) setSel({ kind: "file", path: f.path, staged: f.staged && !f.unstaged });
        else api.log(1).then((c) => c[0] && setSel((x) => x ?? { kind: "commit", sha: c[0].sha })).catch(() => {});
      }
    }).catch(() => {});
    api.branches().then((b) => { setBranches(b.branches); setTags(b.tags ?? []); setStashes(b.stashes); }).catch(() => {});
    api.meta().then((m) => setProposals(m.proposals.filter((p) => p.status === "open"))).catch(() => {});
  }, [version, tick]);
  useEffect(() => { if (target?.sha) { setSel({ kind: "commit", sha: target.sha }); setModeState("history"); } }, [target?.sha]);

  /** Run a git action, toast, then refresh every list. */
  const run = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    try {
      const r = await api.git(action, body);
      if (ok) toast(ok);
      refresh(); onChanged();
      return r.output;
    } catch (e: any) { toast(e.message, "err"); return null; }
  };

  /** Remote work: show it as busy, keep its output in the docked log. */
  const remote = async (label: string, f: () => Promise<{ text: string; err?: boolean }>) => {
    setBusy(label);
    const o = await f();
    setBusy("");
    setLog((l) => [{ label, text: o.text.trim() || `${label} done`, at: Date.now(), err: o.err }, ...l].slice(0, 20));
  };
  const sync = (label: "Fetch" | "Pull" | "Push") => remote(label, async () => {
    const o = await run(label.toLowerCase());
    return o === null ? { text: `${label} failed`, err: true } : { text: o };
  });
  const kula = (label: "Share" | "Sync") => remote(label, () => api.kula([label.toLowerCase()])
    .then((r) => { refresh(); onChanged(); return { text: r.stdout + r.stderr }; })
    .catch((e) => ({ text: e.message as string, err: true })));

  const showHistory = (b: string) => { setFilter(b); setMode("history"); };
  const local = branches.filter((b) => !b.remote);
  const current = local.find((b) => b.current);
  const { ahead, behind } = track(current?.track);
  const conflicts = files.filter(isConflict);

  let pane;
  if (mode === "changes") pane = <Changes files={files} sel={sel} setSel={setSel} run={run} />;
  else if (mode === "history") pane = <History version={version + tick} filter={filter} setFilter={setFilter} sel={sel} setSel={setSel} />;
  else if (mode === "branches") pane = <Branches branches={branches} tags={tags} current={branch} run={run} sel={sel} setSel={setSel} showHistory={showHistory} />;
  else if (mode === "stashes") pane = <Stashes stashes={stashes} run={run} sel={sel} setSel={setSel} />;
  else pane = <Review proposals={proposals} branches={local} current={branch} sel={sel} setSel={setSel} />;

  return (
    <div className="gv" data-testid="git-board">
      <Header upstream={current?.upstream} ahead={ahead} behind={behind} mode={mode} setMode={setMode}
        counts={{ changes: files.length, branches: local.length, stashes: stashes.length, review: proposals.length }} busy={busy} />
      <div className="gv-main" style={listWidth("git", 380)}>
        <div className="gv-list">
          {op && <Conflicts op={op} files={conflicts} run={run} sel={sel} setSel={setSel} />}
          {pane}
        </div>
        <Grip id="git" edge="right" target="prev" min={260} max={720} label="Resize list" />
        <Detail sel={sel} setSel={setSel} files={files} run={run} go={go} openSymbol={openSymbol} current={branch} version={version + tick} />
      </div>
      <Docked label="Git">
        <Side current={current} ahead={ahead} behind={behind} busy={busy} log={log} kula={kula} sync={sync} clear={() => setLog([])} />
      </Docked>
    </div>
  );
}
