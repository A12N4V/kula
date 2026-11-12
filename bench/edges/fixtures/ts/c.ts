import Widget from "./widget";

export function make(): number {
  const w = new Widget();
  return w.render();
}
