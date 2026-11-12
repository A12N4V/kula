export function digest(s: string) { return s + "#"; }
export function pad(s: string) { return digest(s).padEnd(8); }
export function get() { return 1; }
