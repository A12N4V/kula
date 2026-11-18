// A house dropdown in place of a native select: a chip that opens a
// filterable list, driven by arrows and Enter. Shares the branch menu styles.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../ui";

type Opt = string | [value: string, label: string];
type Props = { label: string; value: string; options: Opt[]; onChange: (v: string) => void; icon?: ReactNode; className?: string };
const val = (o: Opt) => (typeof o === "string" ? o : o[0]);
const txt = (o: Opt) => (typeof o === "string" ? o : o[1]);

export default function Picker({ label, value, options, onChange, icon, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setHi(Math.max(0, options.findIndex((o) => val(o) === value)));
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const hits = options.filter((o) => txt(o).toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const pick = (o: Opt) => { setOpen(false); if (val(o) !== value) onChange(val(o)); };
  const cur = options.find((o) => val(o) === value);

  return (
    <div className={`tb-menu picker ${className}`} ref={box}>
      <button className="chip picker-btn" onClick={() => setOpen((o) => !o)} aria-label={label} title={label}
        aria-haspopup="listbox" aria-expanded={open}>
        {icon}<b>{cur ? txt(cur) : value || "…"}</b><span className="tb-caret"><Icon.chevron /></span>
      </button>
      {open && (
        <div className="menu" role="dialog" aria-label={label}>
          {options.length > 8 && (
            <input className="menu-filter" autoFocus placeholder="Filter" value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                else if (e.key === "Enter" && hits[hi]) pick(hits[hi]);
              }} />
          )}
          <div className="menu-list" role="listbox" aria-label={label}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
            {hits.map((o, i) => (
              <button key={val(o)} role="option" aria-selected={val(o) === value} className={`menu-item${i === hi ? " hi" : ""}${val(o) === value ? " on" : ""}`}
                autoFocus={options.length <= 8 && val(o) === value} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                <span>{txt(o)}</span>
              </button>
            ))}
            {hits.length === 0 && <p className="menu-none">No match</p>}
          </div>
        </div>
      )}
    </div>
  );
}
