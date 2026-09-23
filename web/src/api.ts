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
  kind: "file" | "function" | "method" | "class" | "interface";
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
export interface GraphData { nodes: Node[]; edges: Edge[]; communities: Community[]; truncated: boolean }
export interface RepoInfo {
  name: string; root: string; branch: string; head: string | null; indexed_head: string | null;
  index: "current" | "stale" | "missing"; user: string; remotes: string[]; version: string;
  stats: { files: number; parsed: number; symbols: number; edges: number; communities: number; millis: number } | null;
}
export interface Note { id: number; target: string; body: string; author: string; created: number; updated: number }
export interface Context {
  node: Node; community: string | null; callers: Node[]; callees: Node[]; children: Node[];
  imports: Node[]; imported_by: Node[]; container: Node | null; snippet: string; notes: Note[];
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

export const api = {
  repo: () => get<RepoInfo>("/api/repo"),
  reindex: () => post("/api/index"),
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
  meta: () => get<Meta>("/api/meta"),
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

// Community palette: muted, distinguishable on near-black and on paper.
export const PALETTE = ["#ff9e6d", "#7cb7ff", "#8fd694", "#d49cf0", "#f2cc60", "#5fd4c8", "#f08a9b", "#a8a4ff", "#c9b28f", "#76c8f0", "#e0a86b", "#9fd0a8"];
// Deeper variants with enough contrast on the light (paper) theme.
export const PALETTE_LIGHT = ["#c8531d", "#2f6fcf", "#2f8a44", "#8a4fb0", "#9a7400", "#12867a", "#c23d5a", "#5a55d6", "#8a6a3a", "#1f7fb0", "#b0651e", "#3f8a55"];
function isLight() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "light" : window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}
export const colorFor = (c: number) => {
  const p = isLight() ? PALETTE_LIGHT : PALETTE;
  return p[((c % p.length) + p.length) % p.length];
};
