// FlowSidebar – the frame every canvas view fills in: title, one-line
// description, a two-column key/value table, the tinker section (controls
// that change the picture) and a related list. Drawer at phone width.
import type { ReactNode } from "react";

export type FlowSidebarProps = {
  title: string;
  /** One line, never a paragraph. */
  desc?: string;
  /** Key/value rows – label left, value right. */
  kv?: [string, ReactNode][];
  /** Controls that change the picture. */
  tinker?: ReactNode;
  /** "Related" entries – small links or chips. */
  related?: ReactNode;
  children?: ReactNode;
};

export function FlowSidebar({ title, desc, kv, tinker, related, children }: FlowSidebarProps) {
  return (
    <div className="fsb" data-testid="flow-sidebar">
      <h2 className="fsb-title">{title}</h2>
      {desc && <p className="fsb-desc">{desc}</p>}
      {kv && kv.length > 0 && (
        <table className="fsb-kv">
          <tbody>
            {kv.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {children}
      {tinker && (
        <section className="fsb-section" aria-label="Tinker">
          <h3 className="fsb-head">Tinker</h3>
          {tinker}
        </section>
      )}
      {related && (
        <section className="fsb-section" aria-label="Related">
          <h3 className="fsb-head">Related</h3>
          {related}
        </section>
      )}
    </div>
  );
}
