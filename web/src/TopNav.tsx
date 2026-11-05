// The top navbar, after the homonin.com landing nav: one floating bar, the mark
// on the left, icon tabs in the middle with a hover glow that springs between
// them, a single accent point under the page you are on, and one accent
// control on the right. Labels show only as tooltips. Every button is a fixed
// 32px square at every screen size; narrow screens drop the wordmark, never
// resize a control.
import { useRef, useState, type ReactElement } from "react";
import { Icon, Logo } from "./ui";
import type { View } from "./nav";

export type Dest = { id: string; label: string; icon: () => ReactElement; key: string; home: View; views: View[] };

export default function TopNav({ dests, current, badge, onGo, onSearch, onSettings, repo, branch }: {
  dests: Dest[]; current: string; badge: Record<string, number>;
  onGo: (d: Dest) => void; onSearch: () => void; onSettings: () => void; repo?: string; branch?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState<{ x: number; w: number } | null>(null);
  const hover = (el: HTMLElement | null) => {
    if (!el || !row.current) return setGlow(null);
    setGlow({ x: el.offsetLeft, w: el.offsetWidth });
  };
  return (
    <header className="topnav" data-testid="topnav">
      <nav className="topnav-bar" aria-label="Destinations">
        <button className="topnav-brand" onClick={() => onGo(dests[0])} aria-label="kula home" data-tip={repo ? `${repo} · ${branch ?? ""}` : "kula"}>
          <span className="topnav-logo"><Logo size={20} /></span>
          <span className="topnav-mark">KULA</span>
        </button>
        <div className="topnav-tabs" ref={row} onMouseLeave={() => setGlow(null)}>
          {glow && <span className="topnav-glow" aria-hidden="true" style={{ transform: `translateX(${glow.x}px)`, width: glow.w }} />}
          {dests.map((d) => (
            <button key={d.id} className="topnav-tab" data-dest={d.id} aria-label={d.label} data-tip={`${d.label}  ${d.key}`}
              aria-current={current === d.id ? "page" : undefined}
              onMouseEnter={(e) => hover(e.currentTarget)} onFocus={(e) => hover(e.currentTarget)} onBlur={() => setGlow(null)}
              onClick={() => onGo(d)}>
              <d.icon />
              {!!badge[d.id] && <span className="topnav-badge tnum">{badge[d.id]}</span>}
              {current === d.id && <span className="topnav-here" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="topnav-end">
          <button className="topnav-tab" aria-label="Settings" data-tip="Settings  ," onClick={onSettings}><Icon.gear /></button>
          <button className="topnav-cta" aria-label="Search" data-tip="Search  ⌘K" onClick={onSearch}><Icon.search /></button>
        </div>
      </nav>
    </header>
  );
}
