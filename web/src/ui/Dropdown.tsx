// Fluid dropdown – the one select-style control, used across the app.
// A listbox pattern: the trigger reads the chosen option, the popup lists
// options with aria-selected, and everything works by keyboard (arrows,
// Home/End, typeahead, Enter, Esc). Rendering is a portal so a transformed
// ancestor can never clip it.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";

export interface DropdownOption<V = string> {
  value: V;
  label: string;
  /** Optional leading mark (an icon, an agent glyph). */
  icon?: React.ReactNode;
  /** One line of muted detail under the label. */
  hint?: string;
}

/** A fluid dropdown: the trigger shows the value, the menu opens with a short
    ease and sizes to its longest option. Keyboard: Enter opens, arrows move,
    Home/End jump, letters type ahead, Enter picks, Esc cancels. */
export function Dropdown<V extends string>({ value, options, onChange, label, testId, disabled, className = "" }: {
  value: V;
  options: DropdownOption<V>[];
  onChange: (v: V) => void;
  /** Accessible name of the control (also the trigger's aria-label). */
  label: string;
  testId?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ q: "", at: 0 });
  const id = useId();
  const current = options.find((o) => o.value === value);

  // Close on outside click, scroll the active option into view, flip the
  // menu above the trigger when there is no room below.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!btn.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const b = btn.current?.getBoundingClientRect();
    const l = list.current;
    if (!b || !l) return;
    const h = l.offsetHeight;
    const room = window.innerHeight - b.bottom;
    setUp(room < h + 8 && b.top > room);
    setStyle({ left: b.left, top: up ? undefined : b.bottom + 4, bottom: up ? window.innerHeight - b.top + 4 : undefined, minWidth: b.width });
  }, [open, up, options]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const pick = (o: DropdownOption<V>) => { setOpen(false); btn.current?.focus(); if (o.value !== value) onChange(o.value); };
  const move = (dir: 1 | -1) => setActive((a) => (a + dir + options.length) % options.length);
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); setActive(Math.max(0, options.findIndex((o) => o.value === value))); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(options[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "Tab") { setOpen(false); } // focus moves on, the menu does not linger
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typeahead: first option whose label starts with the typed run, else the next hit.
      const now = Date.now();
      if (now - typed.current.at > 500) typed.current = { q: "", at: now };
      typed.current = { q: typed.current.q + e.key.toLowerCase(), at: now };
      const q = typed.current.q;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
      if (i >= 0) setActive(i);
      else { const next = options.findIndex((o) => o.label.toLowerCase().includes(q)); if (next >= 0) setActive(next); }
    }
  };

  const listId = `${id}-list`;
  const opts = useMemo(() => options, [options]);
  return (
    <span className={`dd ${className}`} data-testid={testId}>
      <button type="button" ref={btn} className="dd-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-label={label} disabled={disabled}
        onClick={() => { if (open) { setOpen(false); } else { setOpen(true); setActive(Math.max(0, opts.findIndex((o) => o.value === value))); } }}
        onKeyDown={onKey}>
        <span className="dd-value">{current?.icon}{current?.label ?? "–"}</span>
        <span className={`dd-caret ${open ? "on" : ""}`} aria-hidden="true"><Icon.chevron /></span>
      </button>
      {open && createPortal(
        <ul className={`dd-menu ${up ? "up" : ""}`} role="listbox" aria-label={label} id={listId} ref={list}
          style={style} tabIndex={-1}
          onKeyDown={onKey}>
          {opts.map((o, i) => (
            <li key={o.value}>
              <div role="option" aria-selected={o.value === value} aria-label={o.label} tabIndex={-1}
                className={`dd-opt ${i === active ? "kb-sel" : ""}`}
                onPointerMove={() => setActive(i)}
                onClick={(e) => { e.preventDefault(); pick(o); }}>
                {o.icon && <span className="dd-mark">{o.icon}</span>}
                <span className="dd-text">{o.label}{o.hint && <span className="muted dd-hint">{o.hint}</span>}</span>
                {o.value === value && <Icon.check />}
              </div>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </span>
  );
}
