// What can go on the canvas: agents, skills, MCP servers, memory files and
// team templates. Drag one onto a seat, a team or empty canvas; a click puts
// it on whatever is picked.

import { useState } from "react";
import type { AgentsInfo } from "../../api";
import { Mark } from "../../brands";
import { AGENT_IDS, AGENT_NAME } from "./data";
import { TEAM_TEMPLATES } from "./templates";
import { DND, type Item } from "./HubCanvas";

export function Palette({ info, servers, onUse }: { info: AgentsInfo; servers: string[]; onUse: (it: Item) => void }) {
  const [q, setQ] = useState("");
  const has = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const groups: { title: string; kind: Item["kind"]; items: { value: string; label: string; icon?: string }[] }[] = [
    { title: "Agents", kind: "agent", items: AGENT_IDS.map((a) => ({ value: a, label: AGENT_NAME[a] ?? a, icon: a })) },
    { title: "Templates", kind: "template", items: TEAM_TEMPLATES.map((t) => ({ value: t.id, label: t.title })) },
    { title: "Skills", kind: "skill", items: (info.skills ?? []).map((s) => ({ value: s.name, label: s.name })) },
    { title: "MCP", kind: "mcp", items: servers.map((s) => ({ value: s, label: s })) },
    { title: "Memory", kind: "memory", items: info.docs_list.map((p) => ({ value: p, label: p })) },
  ];
  return (
    <aside className="hub-palette" aria-label="Palette">
      <input className="input hub-pal-q" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter palette" />
      <div className="hub-pal-scroll">
        {groups.map((g) => {
          const items = g.items.filter((i) => has(i.label));
          return (
            <section key={g.kind} className="hub-pal-group" data-kind={g.kind}>
              <h3>{g.title}<span className="mono muted">{items.length}</span></h3>
              {items.length === 0 && <div className="hub-pal-none muted">None</div>}
              {items.map((i) => (
                <button
                  key={i.value} className={`hub-pal-item ${g.kind}`} draggable title={i.value}
                  onDragStart={(e) => { e.dataTransfer.setData(DND, JSON.stringify({ kind: g.kind, value: i.value })); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => onUse({ kind: g.kind, value: i.value })}
                >
                  {i.icon ? <Mark id={i.icon} size={13} /> : <span className={`hub-pal-dot ${g.kind}`} />}
                  <span className="hub-pal-label">{i.label}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
