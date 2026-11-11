import { hash, pad } from "./b";
export class Store { get(k: string) { return hash(k); } put(k: string) { return this.get(k); } }
export function run(s: Store) { return pad(s.get("x")); }
