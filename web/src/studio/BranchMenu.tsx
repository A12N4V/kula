// The branch widget in the top bar: shows where you are, opens a filterable
// list of local branches, and checks one out on click.
import { useEffect, useRef, useState } from "react";
import { api, type Branch } from "../api";
import { Icon, useToast } from "../ui";

export default function BranchMenu({ branch, onChanged, openGit }: { branch?: string; onChanged: () => void; openGit: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Branch[] | null>(null);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setHi(0); setList(null);
    api.branches().then((b) => setList(b.branches.filter((x) => !x.remote))).catch(() => setList([]));
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  const hits = (list ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const pick = async (b: Branch) => {
    setOpen(false);
    if (b.current) return;
    try { await api.git("checkout", { name: b.name }); toast(`On ${b.name}`); onChanged(); }
    catch (e: any) { toast(e.message, "err"); }
  };

  return (
    <div className="tb-menu" ref={box}>
      <button className="chip tb-widget" onClick={() => setOpen((o) => !o)} title="Switch branch" aria-haspopup="listbox" aria-expanded={open}>
        <Icon.branches /><b className="mono">{branch ?? "…"}</b><span className="tb-caret"><Icon.chevron /></span>
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label="Branches">
          <input className="menu-filter" autoFocus placeholder="Filter branches" value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter" && hits[hi]) pick(hits[hi]);
            }} />
          <div className="menu-list" role="listbox" aria-label="Local branches">
            {hits.map((b, i) => (
              <button key={b.name} role="option" aria-selected={b.current} className={`menu-item${i === hi ? " hi" : ""}${b.current ? " on" : ""}`}
                onMouseEnter={() => setHi(i)} onClick={() => pick(b)}>
                <Icon.branches /><span className="mono">{b.name}</span>
              </button>
            ))}
            {list && hits.length === 0 && <p className="menu-none">No branch</p>}
          </div>
          <button className="menu-foot" onClick={() => { setOpen(false); openGit(); }}><Icon.history /><span>Open Git</span></button>
        </div>
      )}
    </div>
  );
}
