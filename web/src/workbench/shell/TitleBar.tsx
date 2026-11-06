import { Input } from "@/workbench/kit/input";
import { Badge } from "@/workbench/kit/badge";
import { GitBranch, Circle } from "lucide-react";
import { mockRepo, mockRun, mockTokens } from "@/workbench/mock/state";

// Title bar: repo, branch, live run, token total, ⌘K box. Deck page 2.
export function TitleBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  return (
    <header
      data-testid="wb-titlebar"
      data-figure="wb-titlebar"
      className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-3"
    >
      <span className="text-sm font-medium text-foreground">kula</span>
      <span className="hidden min-[520px]:inline text-xs text-muted-foreground" data-testid="wb-repo">
        {mockRepo.repo} · {mockRepo.branch}
        {mockRepo.dirty > 0 && <span className="ml-1 text-accent">{mockRepo.dirty}△</span>}
      </span>
      <span className="hidden min-[720px]:flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="wb-run-live">
        <Circle size={7} className="fill-accent text-accent" aria-label="live" />
        run #{mockRun.run} live · {mockRun.agents} agents
      </span>
      <span className="hidden min-[640px]:inline text-xs text-muted-foreground" data-testid="wb-tokens">
        {(mockTokens.total / 1e6).toFixed(2)}M tok
      </span>
      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          data-testid="wb-open-command"
          onClick={onOpenCommand}
          className="flex h-8 min-w-0 cursor-pointer items-center gap-2 border border-border bg-input px-2 text-left text-xs text-muted-foreground hover:border-accent/60"
        >
          <GitBranch size={12} className="shrink-0" />
          <span className="hidden min-[880px]:inline">kula CLI or go-to-block…</span>
          <kbd className="rounded-none border border-border px-1 text-[10px]">⌘K</kbd>
        </button>
        <Badge variant="outline" className="hidden sm:inline-flex rounded-none text-[10px]">MOCK</Badge>
      </div>
    </header>
  );
}
