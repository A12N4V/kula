// The ribbon: one bar across the top in the manner of Office's simplified
// ribbon. The tab row holds the open views; a file opens as a contextual tab in
// the accent. The options row under it changes with the tab: a view's panels,
// its sections, or the open file's symbols. A panel opens as a sheet over the
// centre pane, anchored under its option.

import type { ReactNode } from "react";
import { Icon } from "../ui";
import type { RailItem } from "./RailIndex";

export type Tab = { kind: "view"; id: string; view: string } | { kind: "file"; path: string; line?: number };
export const tabKey = (t: Tab) => (t.kind === "view" ? `v:${t.id}` : `f:${t.path}`);
let seq = 0;
export const newTabId = () => `t${++seq}`;

export function RibbonTabs({ tabs, active, label, onPick, onClose, onNew }: {
  tabs: Tab[]; active: string | null; label: (t: Tab) => { name: string; icon: ReactNode; title: string };
  onPick: (t: Tab) => void; onClose: (t: Tab) => void; onNew: () => void;
}) {
  const views = tabs.filter((t) => t.kind === "view"), files = tabs.filter((t) => t.kind === "file");
  const one = (t: Tab) => {
    const k = tabKey(t), l = label(t);
    return (
      <div key={k} role="tab" aria-selected={k === active} className={`rb-tab${t.kind === "file" ? " ctx" : ""}${k === active ? " on" : ""}`} title={l.title}
        onClick={() => onPick(t)} onAuxClick={(e) => { if (e.button === 1 && tabs.length > 1) onClose(t); }}>
        {l.icon}<span className="rb-name">{l.name}</span>
        {tabs.length > 1 && <button className="rb-x" aria-label={`Close ${l.name}`} onClick={(e) => { e.stopPropagation(); onClose(t); }}><Icon.close /></button>}
      </div>
    );
  };
  return (
    <div className="rb-tabs" role="tablist" aria-label="Tabs">
      {views.map(one)}
      <button className="rb-new" aria-label="New tab" title="New tab" onClick={onNew}><Icon.plus /></button>
      {files.length > 0 && <span className="rb-sep" aria-hidden="true" />}
      {files.map(one)}
    </div>
  );
}

export function RibbonOptions({ items, name, pressable }: { items: RailItem[]; name: string; pressable: boolean }) {
  return (
    <div className="rb-opts" role="toolbar" aria-label={name}>
      {items.map((d, i) => (
        <button key={d.id} data-id={d.id} className={`rb-opt${d.on ? " on" : ""}`} onClick={d.run}
          aria-pressed={pressable ? !!d.on : undefined} aria-label={d.info ? `${d.label}, ${d.info}` : d.label}
          title={[d.info, i < 9 ? String(i + 1) : ""].filter(Boolean).join("  ") || undefined}>
          {d.icon}<span>{d.label}</span>{!!d.badge && <em>{d.badge > 99 ? "99+" : d.badge}</em>}
        </button>
      ))}
    </div>
  );
}
