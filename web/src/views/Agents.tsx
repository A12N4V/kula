// Agents: the hub where agent teams are built over a flow map of the
// codebase, launched and watched. Every edit writes the same files the CLI
// does (kula.toml, refs/kula/meta), so MCP, the pre-edit hook and
// `kula check` see it at once.

import { useEffect, useState } from "react";
import { api, type AgentsInfo } from "../api";
import { Empty, useToast } from "../ui";
import type { Nav } from "./hub/data";
import { LEVEL_TEXT, LEVEL_MEANS, GuardTag } from "./hub/levels";
import Hub from "./hub/Hub";
import AsciiMark from "../AsciiMark";

export { LEVEL_TEXT, LEVEL_MEANS, GuardTag };

export default function Agents({ version, onChanged }: Nav) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const load = () => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => {
    try { const r = await api.agentAction(action, body); if (done) toast(done); await load(); onChanged(); return r; }
    catch (e: any) { toast(e.message, "err"); throw e; }
  };

  if (err) return <div className="page"><Empty title="Agent state unavailable">{err}</Empty></div>;
  if (!info) return <div className="loading"><div className="mini-loader"><div className="ml-field"><AsciiMark period={3.2} /></div><span>Reading teams and fences</span></div></div>;
  return (
    <div className="page agents hub">
      <Hub info={info} act={act} />
    </div>
  );
}
