// The right stripe's index when a view has no modes: the sections of the centre
// pane, or the top symbols of the open file. Digits 1 to 9 pick them.

import { useEffect, useState, type ReactNode } from "react";
import { api, type Node } from "../api";
import { Icon, Kind } from "../ui";

export type RailItem = { id: string; label: string; icon: ReactNode; on?: boolean; badge?: number; info?: string; run: () => void };
/** The stripe's items plus how far the centre pane has read through them, as a
 *  fractional item index (2.5 is halfway from the third mark to the fourth). */
export type Rail = { items: RailItem[]; at: number };

const ICONS: [RegExp, () => ReactNode][] = [
  [/glance|stat|size/i, () => <Icon.gauge />],
  [/coupl|compare|contrast/i, () => <Icon.compare />],
  [/index|graph/i, () => <Icon.graph />],
  [/branch|git|worktree/i, () => <Icon.branches />],
  [/issue/i, () => <Icon.issues />],
  [/hotspot|target/i, () => <Icon.target />],
  [/history|commit|recent/i, () => <Icon.history />],
  [/change|diff/i, () => <Icon.changes />],
  [/proposal|review|pull/i, () => <Icon.pr />],
  [/deploy|run|launch/i, () => <Icon.play />],
  [/note|doc/i, () => <Icon.notes />],
  [/flow|path/i, () => <Icon.flows />],
  [/memory/i, () => <Icon.memory />],
  [/agent|team|seat/i, () => <Icon.agents />],
  [/skill|test|flask/i, () => <Icon.flask />],
  [/fence|guard|lock/i, () => <Icon.fence />],
  [/slice|inside|isolate|cluster/i, () => <Icon.isolate />],
  [/inbound|outbound|boundary|caller|callee/i, () => <Icon.arrow />],
  [/cover/i, () => <Icon.coverage />],
  [/type/i, () => <Icon.types />],
  [/package|dep/i, () => <Icon.package />],
  [/console|terminal|log/i, () => <Icon.console />],
  [/search|query/i, () => <Icon.query />],
];
const iconFor = (name: string) => (ICONS.find(([re]) => re.test(name))?.[1] ?? (() => <Icon.doc />))();

const SECTION = "section.card, section.widget, table.stat-table[aria-label]";
const infoOf = (el: Element) => (el.getAttribute("data-rail-info") || el.querySelector(".card-head .tag, .card-head .muted, .card-head .count")?.textContent || "").trim().slice(0, 40);
const badgeOf = (el: Element) => Number(el.getAttribute("data-rail-badge")) || undefined;
const scrollerOf = (el: Element | null): HTMLElement | null => {
  for (let e = el?.parentElement ?? null; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return null;
};
const nameOf = (el: Element) => {
  const h = el.querySelector("h2, h3, .widget-title")?.textContent?.trim();
  const n = h || el.getAttribute("aria-label") || "";
  return /glance/i.test(n) ? "Stats" : n;
};

/** Top level sections of the centre pane, kept current as the view renders,
 *  with the reading position measured from the pane's scroll. */
export function useSections(key: string, off: boolean): Rail {
  const [list, setList] = useState<{ id: string; label: string; info: string; badge?: number; el: Element }[]>([]);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (off) { setList([]); return; }
    const main = document.querySelector("main.main");
    if (!main) return;
    let t = 0;
    const scan = () => {
      const els = [...main.querySelectorAll(SECTION)].filter((el) => !el.parentElement?.closest(SECTION) && !el.closest(".tw-dock"));
      const tops = els.map((el) => el.getBoundingClientRect().top);
      const order = els.map((_, i) => i).sort((a, b) => tops[a] - tops[b] || a - b);
      const next = order.map((i) => els[i]).map((el, i) => ({ id: `${i}:${nameOf(el)}`, label: nameOf(el), info: infoOf(el), badge: badgeOf(el), el })).filter((s) => s.label).slice(0, 9);
      setList((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.el === next[i].el && p.info === next[i].info && p.badge === next[i].badge) ? prev : next));
    };
    scan();
    const mo = new MutationObserver(() => { clearTimeout(t); t = window.setTimeout(scan, 120); });
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); clearTimeout(t); };
  }, [key, off]);
  // Reading position: which section's start the top of the pane has passed,
  // and how far it is toward the next one. The bottom of the pane reads as the last.
  useEffect(() => {
    if (off || !list.length) { setAt(0); return; }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const sc = scrollerOf(list[0].el);
      if (!sc) { setAt(0); return; }
      const top = sc.getBoundingClientRect().top + 8;
      const ys = list.map((s) => s.el.getBoundingClientRect().top);
      let i = 0;
      while (i + 1 < ys.length && ys[i + 1] <= top) i++;
      let f = i + (i + 1 < ys.length && ys[i] <= top ? Math.min(1, (top - ys[i]) / Math.max(1, ys[i + 1] - ys[i])) : 0);
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) f = ys.length - 1;
      setAt(Math.round(f * 100) / 100);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    document.addEventListener("scroll", on, { capture: true, passive: true });
    window.addEventListener("resize", on);
    return () => { document.removeEventListener("scroll", on, { capture: true }); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [list, off]);
  const here = Math.round(at);
  return {
    at,
    items: list.map((s, i) => ({ id: s.id, label: s.label, info: s.info, badge: s.badge, on: i === here && at > 0, icon: iconFor(s.label), run: () => s.el.scrollIntoView({ behavior: "smooth", block: "start" }) })),
  };
}

/** Top symbols of the open file; methods only when nothing else is there. */
export function useSymbols(path: string | null, line: number | undefined, jump: (line: number) => void): Rail {
  const [syms, setSyms] = useState<Node[]>([]);
  useEffect(() => {
    if (!path) { setSyms([]); return; }
    let live = true;
    api.near(path).then((n) => {
      if (!live) return;
      const all = [...n.symbols].sort((a, b) => a.start_line - b.start_line);
      const top = all.filter((s) => s.kind !== "method");
      setSyms((top.length ? top : all).slice(0, 9));
    }).catch(() => live && setSyms([]));
    return () => { live = false; };
  }, [path]);
  const here = syms.filter((s) => line && s.start_line <= line && line <= s.end_line).pop();
  // Reading position by line: past a symbol's first line, part way to the next.
  let at = 0;
  if (line) {
    let i = -1;
    while (i + 1 < syms.length && syms[i + 1].start_line <= line) i++;
    if (i >= 0) at = i + (i + 1 < syms.length ? Math.min(1, (line - syms[i].start_line) / Math.max(1, syms[i + 1].start_line - syms[i].start_line)) : 0);
  }
  return {
    at,
    items: syms.map((s) => ({ id: String(s.id), label: s.name, info: `${s.kind} · line ${s.start_line}`, icon: <Kind kind={s.kind} size={14} />, on: here?.id === s.id, run: () => jump(s.start_line) })),
  };
}
