// Editor tabs: views and files side by side, the active one underlined in the
// accent, middle click or the cross closes one.

import { Icon } from "../ui";

export type Tab = { kind: "view"; view: string } | { kind: "file"; path: string; line?: number };
export const tabKey = (t: Tab) => (t.kind === "view" ? `v:${t.view}` : `f:${t.path}`);

export default function EditorTabs({ tabs, active, label, onPick, onClose }: {
  tabs: Tab[]; active: string | null; label: (t: Tab) => { name: string; icon: React.ReactNode; title: string };
  onPick: (t: Tab) => void; onClose: (t: Tab) => void;
}) {
  return (
    <div className="etabs" role="tablist" aria-label="Editor tabs">
      {tabs.map((t) => {
        const k = tabKey(t), l = label(t);
        return (
          <div key={k} role="tab" aria-selected={k === active} className={`etab ${k === active ? "on" : ""}`} title={l.title}
            onClick={() => onPick(t)} onAuxClick={(e) => { if (e.button === 1) onClose(t); }}>
            {l.icon}<span className="etab-name">{l.name}</span>
            <button className="etab-x" aria-label={`Close ${l.name}`} onClick={(e) => { e.stopPropagation(); onClose(t); }}><Icon.close /></button>
          </div>
        );
      })}
    </div>
  );
}
