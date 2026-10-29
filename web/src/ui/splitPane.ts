// Phones: a split view (list | detail) is one column, so the panes swap rather
// than the detail being hidden. Tapping a list row moves to the detail; the
// "‹ List" button (or Escape) moves back. Delegated once for every .split, so
// no view has to wire it.
const PHONE = "(max-width: 760px)";

function back(split: HTMLElement) {
  split.dataset.side = "list";
  split.querySelector<HTMLElement>(".list .item.on, .list .item")?.focus?.();
}

function ensureButton(split: HTMLElement) {
  if (split.querySelector(":scope > .split-back")) return;
  const b = document.createElement("button");
  b.className = "split-back btn sm ghost";
  b.type = "button";
  b.textContent = "‹ List";
  b.setAttribute("aria-label", "Back to the list");
  split.appendChild(b);
}

export function installSplitPanes() {
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const split = t.closest<HTMLElement>(".split");
    if (!split) return;
    if (t.closest(".split-back")) { back(split); return; }
    if (!matchMedia(PHONE).matches || split.classList.contains("no-swap")) return;
    if (t.closest(".split > .list .item")) { ensureButton(split); split.dataset.side = "detail"; split.querySelector<HTMLElement>(":scope > .detail")?.scrollTo(0, 0); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const split = document.querySelector<HTMLElement>('.split[data-side="detail"]');
    if (split) back(split);
  });
}
