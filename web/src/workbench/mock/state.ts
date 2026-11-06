// W1 – typed mock data for the workbench shell. Everything here carries a
// MOCK tag in the UI; real API calls replace it module by module (W2–W4).
// No module-load side effects: plain objects only.

export interface RepoInfo {
  repo: string;
  branch: string;
  dirty: number;
}

export interface RunStatus {
  run: number;
  live: boolean;
  agents: number;
}

export interface TokenTotal {
  total: number;
}

export const mockRepo: RepoInfo = {
  repo: "kula",
  branch: "main",
  dirty: 3,
};

export const mockRun: RunStatus = { run: 42, live: true, agents: 4 };

export const mockTokens: TokenTotal = { total: 1_270_000 };

export interface ActivityItem {
  ts: string;
  kind: string;
  text: string;
}

export const mockLedger: ActivityItem[] = [
  { ts: "09:41:02", kind: "commit", text: "s1: kit merged – 21 primitives themed" },
  { ts: "09:44:17", kind: "agent", text: "W2 · Map started run #42" },
  { ts: "09:44:18", kind: "fence", text: "guard: map/** scope granted to W2" },
  { ts: "09:47:55", kind: "agent", text: "W3 · Ledger waiting on /api/agents" },
  { ts: "09:52:10", kind: "commit", text: "w1: shell frame" },
];

export const mockTerminal = [
  "kula agents ls",
  "id   name            state    tokens",
  "w2   map             running   412k",
  "w3   ledger          idle      188k",
  "w4   git             idle       97k",
  "$",
];

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  no: number;
  text: string;
}

export const mockDiff: DiffLine[] = [
  { kind: "ctx", no: 61, text: "fn parse_hash(h: &str) -> Option<Dest> {" },
  { kind: "del", no: 62, text: "    match VIEWS.binary_search(h) {" },
  { kind: "add", no: 62, text: "    if let Some(wb) = h.strip_prefix(\"#/wb\") {" },
  { kind: "add", no: 63, text: "        return Some(Dest::Workbench);" },
  { kind: "ctx", no: 64, text: "    }" },
];

export const mockTests = [
  { file: "e2e/wbkit.spec.ts", state: "pass", ms: 412 },
  { file: "e2e/workbench.spec.ts", state: "run", ms: 0 },
  { file: "e2e/map.spec.ts", state: "pass", ms: 1180 },
];

export const mockProblems = [
  { path: "web/src/workbench/Workbench.tsx", line: 12, sev: "info", text: "panel state not persisted yet – W1 todo" },
];

export const mockChecks = [
  { name: "cargo clippy", state: "pass" },
  { name: "tsc", state: "pass" },
  { name: "e2e wbkit", state: "pass" },
];

export interface ExplorerNode {
  id: string;
  label: string;
  children?: ExplorerNode[];
}

// file-tree shaped: children under each section, leaves selectable
export const mockExplorerTree = [
  {
    id: "src",
    label: "web/src",
    children: [
      { id: "src/workbench", label: "workbench", children: [
        { id: "kit", label: "kit" },
        { id: "mock", label: "mock" },
        { id: "shell", label: "shell" },
        { id: "registry", label: "registry.ts" },
        { id: "Workbench", label: "Workbench.tsx" },
      ] },
      { id: "src/App", label: "App.tsx" },
    ],
  },
  {
    id: "crates",
    label: "crates/kula",
    children: [
      { id: "main", label: "main.rs" },
      { id: "graph", label: "graph.rs" },
    ],
  },
];

export interface InspectorSection {
  title: string;
  rows: [string, string][];
}

// plan §6 fixed inspector sections, counts before lists
export const mockInspector: InspectorSection[] = [
  { title: "Identity", rows: [["symbol", "parse_hash"], ["kind", "fn"], ["defined in", "src/hash.rs:62"]] },
  { title: "Metrics", rows: [["callers", "14"], ["callees", "3"], ["churn", "moderate"]] },
  { title: "Fences", rows: [["scope", "web/src/**"], ["level", "review"], ["count", "2"]] },
  { title: "Spend", rows: [["tokens", "1.27M"], ["runs", "42"], ["cost", "$6.30"]] },
  { title: "Memory", rows: [["notes", "5"], ["stale", "1"]] },
  { title: "Access", rows: [["owner", "w1"], ["scope", "workbench/**"]] },
];
