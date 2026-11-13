import { Foo } from "./traps_foo";
import { Bar } from "./traps_bar";
import { Gadget } from "./traps_base";
import shout from "./traps_api";

export function useFoo(): number {
  const c = new Foo();
  return c.run();
}

export function useBar(c: Bar): number {
  return c.stop();
}

export function useGadget(): number {
  const g = new Gadget();
  return g.render();
}

export function useShout(): string {
  return shout("a");
}
