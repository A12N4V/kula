import { useEffect, useState } from "react";
import { api, type GraphData, type RepoInfo } from "./api";
import Dither from "./Dither";
import { groupDirs } from "./colors";

/**
 * Once per session: the repository assembles itself out of noise as a dithered
 * object, the wordmark sets underneath and the index reports in. Any key or
 * click skips it; it never blocks the app, which is already live behind it.
 */
export default function Opening({ repo, onDone }: { repo: RepoInfo | null; onDone: () => void }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [lines, setLines] = useState(0);

  useEffect(() => { api.graph("symbol").then(setData).catch(() => onDone()); }, [onDone]);

  useEffect(() => {
    const close = () => { setLeaving(true); window.setTimeout(onDone, 420); };
    const t = window.setTimeout(close, 3600);
    const tick = window.setInterval(() => setLines((n) => n + 1), 260);
    window.addEventListener("keydown", close, { once: true });
    return () => { clearTimeout(t); clearInterval(tick); window.removeEventListener("keydown", close); };
  }, [onDone]);

  const dirs = data ? groupDirs(data.nodes.map((n) => n.path), 0).sizes.length : 0;
  const facts: [string, string][] = [
    ["repo", repo?.name ?? "…"],
    ["head", `${repo?.branch ?? "…"} @ ${repo?.head?.slice(0, 7) ?? "…"}`],
    ["symbols", (repo?.stats?.symbols ?? data?.nodes.length ?? 0).toLocaleString()],
    ["edges", (repo?.stats?.edges ?? data?.edges.length ?? 0).toLocaleString()],
    ["directories", String(dirs)],
    ["graph", repo?.index === "current" ? "current" : repo?.index ?? "…"],
  ];
  const cols = "ABCDEFGH".split("");

  return (
    <div className={`opening ${leaving ? "leaving" : ""}`} onClick={() => { setLeaving(true); window.setTimeout(onDone, 420); }} role="presentation">
      <div className="op-ruler">{cols.map((c) => <span key={c}>{c}0</span>)}</div>
      <i className="op-corner tl" /><i className="op-corner tr" /><i className="op-corner bl" /><i className="op-corner br" />
      <Dither data={data} pixel={3} className="op-dither" />
      <div className="op-foot">
        <div className="op-mark">
          <div className="op-word">KULA</div>
          <div className="op-tag">git, with a map</div>
        </div>
        <dl className="op-facts">
          {facts.slice(0, lines).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </div>
      <div className="op-skip">press any key</div>
    </div>
  );
}
