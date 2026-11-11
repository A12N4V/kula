// Agent state plus the one write path, shared by every canvas that shows or
// edits it (Connectors, Agents). Same calls the Agents tabs make.
import { useCallback, useEffect, useState } from "react";
import { api, type AgentsInfo } from "../api";
import { useToast } from "../ui";

export function useAgents(version: number, onChanged?: () => void) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const load = useCallback(() => api.agents().then((i) => { setInfo(i); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load, version]);
  const act = useCallback(async (action: Parameters<typeof api.agentAction>[0], body: Record<string, unknown>, done: string) => {
    try { const r = await api.agentAction(action, body); if (done) toast(done); await load(); onChanged?.(); return r; }
    catch (e: any) { toast(e.message, "err"); throw e; }
  }, [load, onChanged, toast]);
  return { info, err, load, act };
}
