// Syntagm readout: the right/foot panel. Block facts as a two-column table
// (label left, value right – the house style), plus the embedding state chip.
// The chip opens an inline check table with an Install button; the install
// call goes to E1's API and never runs unless the check passes or the user
// confirms explicitly.

import { useState } from "react";
import { api } from "../../api";
import type { Block, EmbedCheck, EmbedState, SyntagmData } from "./types";

const EMBED_LABEL: Record<EmbedState, string> = { off: "off", on: "on", stale: "stale" };

export function Readout({ data, block, onLeaf }: { data: SyntagmData; block: Block | null; onLeaf: (id: number) => void }) {
  const [embedOpen, setEmbedOpen] = useState(false);
  const [check, setCheck] = useState<EmbedCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const counts = { fn: 0, class: 0, var: 0, type: 0 } as Record<string, number>;
  let leaves = 0;
  if (block) {
    if (block.children.length === 0) {
      for (const id of block.symbols) {
        const k = data.leaves[id]?.kind;
        if (k) counts[k] = (counts[k] ?? 0) + 1;
      }
      leaves = block.symbols.length;
    } else {
      for (const c of block.children) leaves += data.blocks[c]?.symbols.length ?? 0;
    }
  }

  const runCheck = async () => {
    setChecking(true); setInstallMsg(null);
    try { setCheck(await api.embedCheck()); }
    catch (e: unknown) { setCheck({ rows: [["error", (e as Error).message]], verdict: "refuse", reasons: ["embed API not available in this build"] }); }
    finally { setChecking(false); }
  };

  const install = async () => {
    try {
      const r = await api.embedInstall();
      setInstallMsg(r.ok ? "install started – progress on the index feed" : (r as { error?: string }).error ?? "refused");
    } catch (e: unknown) { setInstallMsg((e as Error).message); }
  };

  return (
    <aside className="sy-readout" data-testid="syntagm-readout" aria-label="Syntagm readout">
      {block && (
        <>
          <h2 className="mono">{block.name}</h2>
          <p className="sy-summary">{block.summary}</p>
          <table className="sy-t" data-testid="syntagm-block-table">
            <tbody>
              <tr><th>kind</th><td>{block.kind}</td></tr>
              <tr><th>source</th><td>{block.source}</td></tr>
              <tr><th>files</th><td>{block.files}</td></tr>
              <tr><th>cohesion</th><td>{(block.cohesion * 100).toFixed(0)}%</td></tr>
              <tr><th>leaves</th><td>{block.children.length === 0 ? leaves : `${leaves} (one level down)`}</td></tr>
              {block.children.length === 0 && (Object.keys(counts) as string[]).map((k) =>
                counts[k] > 0 ? <tr key={k}><th>{k}</th><td>{counts[k]}</td></tr> : null)}
            </tbody>
          </table>
        </>
      )}
      <table className="sy-t" data-testid="syntagm-stats-table">
        <tbody>
          <tr><th>build</th><td>{(data.stats.ms / 1000).toFixed(1)}s</td></tr>
          <tr><th>batches</th><td>{data.stats.batches}</td></tr>
          <tr><th>threads</th><td>{data.stats.threads}</td></tr>
          <tr><th>chains</th><td>{data.chains.length}</td></tr>
          <tr><th>blocks</th><td>{Object.keys(data.blocks).length}</td></tr>
        </tbody>
      </table>
      <button className={`chip-btn sy-embed-chip embed-${data.stats.embed}`} data-testid="syntagm-embed-chip"
        aria-expanded={embedOpen} onClick={() => { setEmbedOpen((o) => !o); if (!embedOpen && !check) void runCheck(); }}>
        embedding: {EMBED_LABEL[data.stats.embed]}
      </button>
      {embedOpen && (
        <div className="sy-embed" data-testid="syntagm-embed">
          {checking && <div className="muted">checking system…</div>}
          {check && (
            <>
              <table className="sy-t">
                <tbody>
                  {check.rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
                  <tr><th>verdict</th><td className={`embed-verdict-${check.verdict}`}>{check.verdict}</td></tr>
                </tbody>
              </table>
              {check.reasons.length > 0 && check.verdict !== "ok" && <div className="sy-embed-reasons">{check.reasons.join(" · ")}</div>}
              {check.verdict === "ok" && <button className="btn primary sm" onClick={install}>Install</button>}
              {check.verdict === "warn" && !confirming && <button className="btn sm" onClick={() => setConfirming(true)}>Install anyway…</button>}
              {check.verdict === "warn" && confirming && (
                <div className="sy-confirm">
                  <span>warn: the check flagged this machine. Install?</span>
                  <div><button className="btn sm danger" onClick={install}>Yes, install</button>
                    <button className="btn sm ghost" onClick={() => setConfirming(false)}>No</button></div>
                </div>
              )}
              {check.verdict === "refuse" && <div className="muted">install refused – see reasons above</div>}
            </>
          )}
          {installMsg && <div className="sy-embed-msg" data-testid="syntagm-embed-msg">{installMsg}</div>}
        </div>
      )}
    </aside>
  );
}
