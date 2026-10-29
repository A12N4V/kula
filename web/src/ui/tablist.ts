// Every [role=tablist] in the app behaves the same, whichever view drew it
// (WAI-ARIA tabs pattern): one Tab stop per strip – the selected tab – and
// ←/→ (↑/↓ when vertical), Home and End move along it and select.
function sync(list: Element) {
  const tabs = [...list.querySelectorAll<HTMLElement>(':scope > [role="tab"]')];
  if (!tabs.length) return;
  const on = tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
  for (const t of tabs) { const want = t === on ? "0" : "-1"; if (t.getAttribute("tabindex") !== want) t.setAttribute("tabindex", want); }
}

export function installTablists() {
  const all = () => document.querySelectorAll('[role="tablist"]').forEach(sync);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; all(); }, 0); })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
  all();
  document.addEventListener("keydown", (e) => {
    const tab = (e.target as HTMLElement).closest?.('[role="tab"]');
    const list = tab?.parentElement;
    if (!tab || !list || list.getAttribute("role") !== "tablist") return;
    const vertical = list.getAttribute("aria-orientation") === "vertical";
    const tabs = [...list.querySelectorAll<HTMLElement>(':scope > [role="tab"]:not([disabled])')];
    const i = tabs.indexOf(tab as HTMLElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 } as Record<string, number>;
    let j = -1;
    if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tabs.length - 1;
    else if (e.key in step && (vertical ? /Up|Down/ : /Left|Right/).test(e.key)) j = (i + step[e.key] + tabs.length) % tabs.length;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    tabs[j].focus();
    tabs[j].click();
  }, true);
}
