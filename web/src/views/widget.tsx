// The pane frame shared by the Git and Query views: a mono title strip, a body
// that alone scrolls, an optional foot; plus the icon button and empty state.
import type { ReactNode } from "react";
import { Tip } from "../ui";
import "../styles/widget.css";

/** A pane: a mono title strip, a body that alone scrolls, an optional foot. */
export function Widget({ area, title, count, tools, foot, alert, className, children }: { area: string; title: ReactNode; count?: ReactNode; tools?: ReactNode; foot?: ReactNode; alert?: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={`widget${alert ? " alert" : ""}${className ? ` ${className}` : ""}`} data-area={area} data-testid={`w-${area}`} aria-label={typeof title === "string" ? title : area}>
      <header className="widget-head">
        <span className="widget-title">{title}</span>
        {count !== undefined && <span className="widget-count">{count}</span>}
        <span className="spacer" />
        {tools}
      </header>
      <div className="widget-body">{children}</div>
      {foot && <footer className="widget-foot">{foot}</footer>}
    </section>
  );
}

export function WEmpty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="w-empty">{icon}<span>{children}</span></div>;
}

/** An icon only button with a tooltip; the tooltip doubles as its accessible name. */
export function IB({ tip, onClick, disabled, children, primary }: { tip: string; onClick: () => void; disabled?: boolean; children: ReactNode; primary?: boolean }) {
  return (
    <Tip tip={tip}>
      <button className={`btn sm ${primary ? "primary" : "ghost"} icon-only`} aria-label={tip} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
    </Tip>
  );
}
