import { alpha, renamed } from "./barrel";

export function viaBarrel(): number {
  return alpha() + renamed();
}
