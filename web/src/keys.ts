// Keybindings: every rebindable action with its default chord. Overrides live
// in settings.keys, so a user's bindings follow the rest of their preferences.

import { settings, useSettings } from "./settings";

export type ActionId =
  | "palette" | "palette.slash" | "project" | "right" | "back" | "forward"
  | "console" | "agents" | "query" | "settings" | "keys" | "extensions" | "map";

export type KeyAction = { id: ActionId; label: string; group: "Navigate" | "Panels" | "Views"; def: string };

/** A chord is its modifiers in ⌃⌥⇧⌘ order, then one key, e.g. "⌥1", "⌘K", "⇧/". */
export const ACTIONS: KeyAction[] = [
  { id: "palette", label: "Command palette", group: "Navigate", def: "⌘K" },
  { id: "palette.slash", label: "Command palette, quick", group: "Navigate", def: "/" },
  { id: "back", label: "Go back", group: "Navigate", def: "⌥←" },
  { id: "forward", label: "Go forward", group: "Navigate", def: "⌥→" },
  { id: "project", label: "Toggle Project tree", group: "Panels", def: "⌥1" },
  { id: "right", label: "Toggle option panel", group: "Panels", def: "⌥7" },
  { id: "settings", label: "Open settings", group: "Panels", def: "," },
  { id: "keys", label: "Open keybindings", group: "Panels", def: "⇧/" },
  { id: "console", label: "Console", group: "Views", def: "⌃`" },
  { id: "agents", label: "Agents", group: "Views", def: "A" },
  { id: "query", label: "Ask", group: "Views", def: "Q" },
  { id: "extensions", label: "Extensions", group: "Views", def: "X" },
  { id: "map", label: "Map", group: "Views", def: "M" },
];

/** Fixed chords, listed so the sheet is complete but not rebindable. */
export const FIXED: { keys: string; label: string }[] = [
  { keys: "⇧ ⇧", label: "Search everywhere" },
  { keys: "1 to 9", label: "Options row" },
  { keys: "⇧1 to ⇧0", label: "Left rail" },
  { keys: "esc", label: "Close what is open" },
  { keys: "⌘↵", label: "Commit, save or run" },
  { keys: "j k s u", label: "Walk and stage git files" },
  { keys: "↑ ↓", label: "Console history" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform || navigator.userAgent);

const NAMED: Record<string, string> = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space", Enter: "↵",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Tab: "Tab", Backspace: "⌫",
};

/** The chord a key event spells, or "" for a bare modifier. */
export function chordOf(e: KeyboardEvent): string {
  const code = e.code;
  let k = /^Key([A-Z])$/.exec(code)?.[1] ?? /^Digit([0-9])$/.exec(code)?.[1] ?? NAMED[code] ?? (/^F\d+$/.test(code) ? code : "");
  if (!k) return "";
  const cmd = isMac ? e.metaKey : e.ctrlKey || e.metaKey;
  const ctrl = isMac && e.ctrlKey;
  const shift = e.shiftKey || (e.key === "?" && k === "/");
  return (ctrl ? "⌃" : "") + (e.altKey ? "⌥" : "") + (shift ? "⇧" : "") + (cmd ? "⌘" : "") + k;
}

/** True when the chord carries ⌘, ⌃ or ⌥ and so may fire while typing. */
export const strong = (c: string) => /[⌘⌃⌥]/.test(c);

export const bindingOf = (id: ActionId, keys = settings.get().keys) => keys[id] ?? ACTIONS.find((a) => a.id === id)!.def;

/** The action a chord triggers under the current overrides. */
export function actionFor(chord: string): ActionId | null {
  const keys = settings.get().keys;
  for (const a of ACTIONS) if (bindingOf(a.id, keys) === chord) return a.id;
  return null;
}

/** Rebind one action; a chord another action holds is taken from it. Null restores the default. */
export function rebind(id: ActionId, chord: string | null) {
  const keys = { ...settings.get().keys };
  if (chord === null) delete keys[id];
  else {
    for (const a of ACTIONS) if (a.id !== id && bindingOf(a.id, keys) === chord) keys[a.id] = "";
    keys[id] = chord;
  }
  for (const a of ACTIONS) if (keys[a.id] === a.def) delete keys[a.id];
  settings.set({ keys });
}

export const useBindings = () => {
  const s = useSettings();
  return (id: ActionId) => bindingOf(id, s.keys);
};
