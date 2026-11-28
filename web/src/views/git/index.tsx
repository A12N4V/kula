// The Git view. Changes on the left, the shared Detail on the right; history,
// branches, sync and the rest dock in the shell's sidebar.
// Every list writes the same selection; Detail reads it.
import { useEffect, useRef, useState } from "react";
import { api, isConflict, type Branch, type FileStatus, type GitOp, type Issue, type Proposal } from "../../api";
import type { Go, Target } from "../../nav";
import { Grip, listWidth } from "../../resize";
import { Docked, useDockOpen } from "../../studio/Dock";
import { Icon, useToast } from "../../ui";
import { Worktrees } from "./Worktrees";
import { Branches } from "./Branches";
import { Changes } from "./Changes";
import { Detail } from "./Detail";
import { History } from "./History";
import { track, type Sel } from "./parts";
import { Issues } from "./Issues";
import { Review } from "./Review";
import { Side, type Out } from "./Side";
import { Conflicts, Stashes } from "./Stashes";
import "./git-view.css";

type Props = { onChanged: () => void; openSymbol: (id: number) => void; version: number; go?: Go; target?: Target };

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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sel, setSel] = useState<Sel>(target?.sha ? { kind: "commit", sha: target.sha } : null);
  const [filter, setFilter] = useState("");
  const dockOpen = useDockOpen();
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<Out[]>([]);

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
    api.meta().then((m) => { setProposals(m.proposals.filter((p) => p.status === "open")); setIssues(m.issues.filter((i) => i.status === "open")); }).catch(() => {});
  }, [version, tick]);
  useEffect(() => { if (target?.sha) { setSel({ kind: "commit", sha: target.sha }); dockOpen("git-history"); } }, [target?.sha]);

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

  const showHistory = (b: string) => { setFilter(b); dockOpen("git-history"); };
  const local = branches.filter((b) => !b.remote);
  const current = local.find((b) => b.current);
  const { ahead, behind } = track(current?.track);
  const conflicts = files.filter(isConflict);

  return (
    <div className="gv" data-testid="git-board">
      <div className="gv-main" style={listWidth("git", 380)}>
        <div className="gv-list">
          {op && <Conflicts op={op} files={conflicts} run={run} sel={sel} setSel={setSel} />}
          <Changes files={files} sel={sel} setSel={setSel} run={run} />
        </div>
        <Grip id="git" edge="right" target="prev" min={260} max={720} label="Resize list" />
        <Detail sel={sel} setSel={setSel} files={files} run={run} go={go} openSymbol={openSymbol} current={branch} version={version + tick} />
      </div>
      <Docked id="git-history" label="History" icon={Icon.history}>
        <div className="ct ct-side gv-side gv-dock-list"><History version={version + tick} filter={filter} setFilter={setFilter} sel={sel} setSel={setSel} /></div>
      </Docked>
      <Docked id="git-branches" label="Branches" icon={Icon.branches} badge={local.length || undefined}>
        <div className="ct ct-side gv-side gv-dock-list"><Branches branches={branches} tags={tags} current={branch} run={run} sel={sel} setSel={setSel} showHistory={showHistory} /></div>
      </Docked>
      <Docked id="git-sync" label="Sync" icon={Icon.refresh} badge={ahead + behind || undefined} info={current?.upstream ? `${ahead} ahead, ${behind} behind` : current?.name}>
        <Side current={current} ahead={ahead} behind={behind} busy={busy} log={log} kula={kula} sync={sync} clear={() => setLog([])} />
      </Docked>
      <Docked id="git-worktrees" label="Worktrees" icon={Icon.folder}>
        <Worktrees version={version + tick} />
      </Docked>
      <Docked id="git-stashes" label="Stashes" icon={Icon.doc} badge={stashes.length || undefined}>
        <div className="ct ct-side gv-side gv-dock-list"><Stashes stashes={stashes} run={run} sel={sel} setSel={setSel} /></div>
      </Docked>
      <Docked id="git-issues" label="Issues" icon={Icon.issues} badge={issues.length || undefined}>
        <div className="ct ct-side gv-side gv-dock-list"><Issues issues={issues} go={go} /></div>
      </Docked>
      <Docked id="git-review" label="Review" icon={Icon.pr} badge={proposals.length || undefined}>
        <div className="ct ct-side gv-side gv-dock-list"><Review proposals={proposals} branches={local} current={branch} sel={sel} setSel={setSel} /></div>
      </Docked>
    </div>
  );
}
