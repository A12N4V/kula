export function hash(s: string) { return s + "#"; }
export function pad(s: string) { return hash(s).padEnd(8); }
export function get() { return 1; }
