// Typed client for the local `kula view` API.

const token =
  document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ??
  (import.meta.env.VITE_KULA_TOKEN as string | undefined) ??
  "dev";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "x-kula-token": token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const get = <T>(path: string) => req<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => req<T>("POST", path, body);
const q = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export interface Node {
  id: number;
  kind: "file" | "function" | "method" | "class" | "interface" | "package";
  name: string;
  path: string;
  lang: string;
  start_line: number;
  end_line: number;
  parent: number | null;
  community: number;
}
export interface Edge { src: number; dst: number; kind: string; weight: number }
export interface Community { id: number; label: string; size: number }
export interface GraphData { nodes: Node[]; edges: Edge[]; communities: Community[]; truncated: boolean; churn?: Record<string, number> }
export interface RepoInfo {
  name: string; root: string; branch: string; head: string | null; indexed_head: string | null;
  index: "current" | "stale" | "missing"; user: string; remotes: string[]; version: string;
  stats: { files: number; parsed: number; symbols: number; edges: number; communities: number; millis: number } | null;
}
export interface Note { id: number; target: string; body: string; author: string; created: number; updated: number; kind?: "memory"; anchor?: string }
/** How far agents may go with a file or symbol (src/guard.rs). */
export type GuardLevel = "open" | "review" | "scope" | "locked" | "hidden";
export interface Verdict { level: GuardLevel; reason: string; rule: string }
/** An agent memory as recalled (src/memory.rs): stale when its code changed since. */
export interface Memory { id: number; target: string; body: string; author: string; created: number; stale: boolean; via: string }
export interface Task { title: string; scope: string[]; started: number; by: string }
export interface GuardRule { level: GuardLevel; paths: string[]; symbols: string[]; reason: string }
export interface AgentsInfo {
  rules: GuardRule[]; task: Task | null; files: { path: string; verdict: Verdict }[]; levels: Record<string, GuardLevel>;
  memories: Memory[]; secrets_hidden: boolean; memory_enabled: boolean; mcp_registered: boolean; hook_installed: boolean; kula_toml: boolean;
}
export type SparqlValue = string | number | boolean;
export interface SparqlResult { vars?: string[]; rows?: Record<string, SparqlValue>[]; truncated?: boolean; boolean?: boolean; triples?: [SparqlValue, SparqlValue, SparqlValue][]; millis?: number }
export interface Context {
  node: Node; community: string | null; callers: Node[]; callees: Node[]; children: Node[];
  imports: Node[]; imported_by: Node[]; container: Node | null; snippet: string; notes: Note[];
  guard?: Verdict; memories?: Memory[];
}
export interface ImpactHit { node: Node; depth: number; via: number | null }
export interface Impact { root: Node; direction: string; hits: ImpactHit[]; files: number; communities: string[]; risk: string }
export interface FileStatus { path: string; orig: string | null; index: string; worktree: string; staged: boolean; unstaged: boolean; untracked: boolean }
export interface Commit { sha: string; short: string; parents: string[]; author: string; email: string; time: number; refs: string[]; subject: string }
export interface Branch { name: string; remote: boolean; sha: string; time: number; upstream: string; track: string; current: boolean; subject: string }
export interface Comment { author: string; body: string; at: number }
export interface Issue { id: number; title: string; body: string; status: string; labels: string[]; anchors: string[]; author: string; created: number; comments: Comment[] }
export interface Proposal { id: number; title: string; body: string; base: string; head: string; status: string; author: string; created: number; comments: Comment[]; merged_sha: string | null }
export interface Meta { issues: Issue[]; proposals: Proposal[]; notes: Note[] }
export interface Compare {
  base: string; head: string; ahead: number; behind: number; commits: Commit[];
  files: { status: string; path: string; symbols: Node[] }[];
  touched: number; affected: ImpactHit[]; communities: string[]; risk: string;
}
export interface Flow { entry: Node; steps: ImpactHit[]; reach: number }
export type DiffStatus = "added" | "removed" | "modified" | "same";
export interface DiffNode { id: number; status: DiffStatus; kind: Node["kind"]; name: string; path: string; start_line: number; community: number; container: string | null }
export interface DiffEdge { src: number; dst: number; kind: string; status: DiffStatus }
export interface GraphDiff {
  base: string; head: string; nodes: DiffNode[]; edges: DiffEdge[]; communities: Community[]; focused: boolean;
  summary: { added: number; removed: number; modified: number; same: number; edges_added: number; edges_removed: number; files_touched: number };
}
export interface SymbolHistory { commits: { sha: string; short: string; author: string; time: number; subject: string }[]; owners: [string, number][] }
export interface Hotspot { path: string; churn: number; symbols: number; degree: number; score: number }
export interface BranchRow { name: string; current: boolean; time: number; subject: string; ahead: number; behind: number; upstream: string; track: string }
export interface Overview {
  default_branch: string; branches: BranchRow[]; issues: Issue[]; issues_open: number; notes: number; hotspots: Hotspot[]; recent: Commit[]; changes: number;
  proposals: { proposal: Proposal; risk: string; touched?: number; affected?: number; ahead?: number; behind?: number; files?: number }[];
}

/** The stored index build, as the server reports it while it runs. */
export interface IndexProgress { active: boolean; phase: "idle" | "walk" | "parse" | "link" | "cluster" | "write"; done: number; total: number; elapsed_ms: number }

/** A located symbol in an agent answer (src/agent.rs Ref). */
export interface AgentRef { name: string; path: string; line: number; detail?: string }
/** Before editing a symbol (src/agent.rs pre_edit). */
export interface PreEdit { symbol: Node; risk: string; dependents: number; files: number; direct_callers: string[]; tests: string[]; co_changes: [string, number][]; notes: string[]; advice: string[]; direct_caller_refs: AgentRef[]; test_refs: AgentRef[]; guard: Verdict; memories: Memory[] }
/** The working tree's graph against HEAD (src/agent.rs verify_edit). */
export interface Verify {
  summary: { added: number; removed: number; modified: number; same: number; edges_added: number; edges_removed: number; files_touched: number };
  changed: string[]; dangling: string[]; recheck: string[]; ok: boolean;
  changed_refs: AgentRef[]; dangling_refs: AgentRef[]; recheck_refs: AgentRef[];
  guard_violations: [string, Verdict][];
}

export const api = {
  repo: () => get<RepoInfo>("/api/repo"),
  reindex: () => post("/api/index"),
  progress: () => get<IndexProgress>("/api/index/progress"),
  preEdit: (id: number) => get<PreEdit>(`/api/agent/pre_edit/${id}`),
  verify: () => get<Verify>("/api/agent/verify"),
  graph: (level = "symbol") => get<GraphData>(`/api/graph?${q({ level })}`),
  search: (s: string) => get<Node[]>(`/api/search?${q({ q: s })}`),
  symbol: (id: number) => get<Context>(`/api/symbol/${id}`),
  impact: (id: number, dir = "up", depth = 3) => get<Impact>(`/api/impact/${id}?${q({ dir, depth })}`),
  flows: () => get<Flow[]>("/api/flows"),
  file: (path: string) => get<{ path: string; content: string }>(`/api/file?${q({ path })}`),
  compare: (base: string, head?: string) => get<Compare>(`/api/compare?${q({ base, head })}`),
  status: () => get<{ branch: string; files: FileStatus[] }>("/api/git/status"),
  log: (limit = 300) => get<Commit[]>(`/api/git/log?${q({ limit })}`),
  branches: () => get<{ branches: Branch[]; tags: string[]; stashes: string[] }>("/api/git/branches"),
  diff: (path?: string, staged = false) => get<{ diff: string }>(`/api/git/diff?${q({ path, staged: staged ? "1" : undefined })}`),
  show: (sha: string) => get<{ show: string }>(`/api/git/show/${sha}`),
  git: (action: string, body: Record<string, unknown> = {}) => post<{ ok: boolean; output: string }>(`/api/git/${action}`, body),
  exec: (args: string[]) => post<{ code: number; stdout: string; stderr: string }>("/api/git/exec", { args }),
  kula: (args: string[]) => post<{ code: number; stdout: string; stderr: string }>("/api/git/kula", { args }),
  meta: () => get<Meta>("/api/meta"),
  graphDiff: (base: string, head?: string, focus?: "changed" | "all") => get<GraphDiff>(`/api/graphdiff?${q({ base, head, focus })}`),
  history: (id: number) => get<SymbolHistory>(`/api/history/${id}`),
  overview: () => get<Overview>("/api/overview"),
  agents: () => get<AgentsInfo>("/api/agents"),
  agentAction: <T = unknown>(action: "task_start" | "task_done" | "remember" | "confirm" | "forget", body: Record<string, unknown> = {}) =>
    post<T>(`/api/agents/${action}`, body),
  sparql: (query: string, limit = 500) => post<SparqlResult>("/api/kg/sparql", { query, limit }),
  kgExport: (format: "ttl" | "nt" | "jsonld" | "rdfxml") => get<{ format: string; text: string }>(`/api/kg/export?${q({ format })}`),
  kgExamples: () => get<{ examples: { title: string; query: string }[]; vocabulary: { term: string; kind: string; doc: string }[]; prefixes: { prefix: string; iri: string }[] }>("/api/kg/examples"),
  metaAction: <T = unknown>(kind: "issues" | "proposals" | "notes", action: string | number, body: Record<string, unknown>) =>
    post<T>(`/api/meta/${kind}/${action}`, body),
};

export function relTime(ts: number) {
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

// Cluster colours share the graph palette (see colors.ts).
export { hue as colorFor } from "./colors";
