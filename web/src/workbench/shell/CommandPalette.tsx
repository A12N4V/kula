import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/workbench/kit/command";
import type { Activity } from "@/workbench/registry";

// Every kula CLI verb (probe target) + go-to-block + activity switching.
export const CLI_VERBS: { verb: string; hint: string }[] = [
  { verb: "kula agents ls", hint: "list agents" },
  { verb: "kula agents start", hint: "start an agent" },
  { verb: "kula runs ls", hint: "list runs" },
  { verb: "kula run show", hint: "show a run" },
  { verb: "kula graph query", hint: "SPARQL over the graph" },
  { verb: "kula graph context", hint: "360° symbol view" },
  { verb: "kula git status", hint: "repo status" },
  { verb: "kula git log", hint: "commit history" },
  { verb: "kula fences check", hint: "check guards" },
  { verb: "kula ledger tail", hint: "activity ledger" },
];

export interface BlockHit {
  symbol: string;
  path: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  activities,
  onActivity,
  onVerb,
  blocks = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activities: Activity[];
  onActivity: (id: string) => void;
  onVerb: (verb: string) => void;
  blocks?: BlockHit[];
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} data-testid="wb-command">
      <CommandInput placeholder="kula CLI verb, go-to-block…" />
      <CommandList>
        <CommandEmpty>no match</CommandEmpty>
        <CommandGroup heading="Go to block">
          {blocks.slice(0, 8).map((b) => (
            <CommandItem key={b.path + b.symbol} value={`block ${b.symbol} ${b.path}`} onSelect={() => onVerb(b.symbol)}>
              {b.symbol}
              <span className="ml-2 text-muted-foreground">{b.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="CLI verbs">
          {CLI_VERBS.map((v) => (
            <CommandItem key={v.verb} value={v.verb} onSelect={() => onVerb(v.verb)}>
              {v.verb}
              <CommandShortcut>{v.hint}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Activities">
          {activities.map((a, i) => (
            <CommandItem key={a.id} value={`activity ${a.label}`} onSelect={() => onActivity(a.id)}>
              <a.icon size={14} /> {a.label}
              <CommandShortcut>⌥{i + 1}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
