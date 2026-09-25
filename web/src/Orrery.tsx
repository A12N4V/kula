// The overview's plate: the repository drawn as an orrery, in the manner of
// Homonin's engraved instrument plates. The repo is the star at the centre;
// its largest directories are planets on tilted orbits (radius by rank, body
// by file count, period by size); hotspots are four-point stars in the field;
// dotted trajectories carry imports between directories. Everything turns
// slowly, and holds still under reduced motion.

import { useEffect, useMemo, useState } from "react";
import { api, type GraphData, type Overview } from "./api";
import { groupDirs } from "./colors";

const W = 900, H = 300, CX = 600, CY = 146;

const star = (x: number, y: number, r: number) => {
  const k = r * 0.18;
  return `M${x} ${y - r}L${x + k} ${y - k}L${x + r} ${y}L${x + k} ${y + k}L${x} ${y + r}L${x - k} ${y + k}L${x - r} ${y}L${x - k} ${y - k}Z`;
};

export default function Orrery({ o, name, onDir, onHot }: { o: Overview; name: string; onDir: (dir: string) => void; onHot: (path: string) => void }) {
  const [g, setG] = useState<GraphData | null>(null);
  useEffect(() => { api.graph("file").then(setG).catch(() => {}); }, []);

  const model = useMemo(() => {
    if (!g) return null;
    const files = g.nodes.filter((n) => n.kind === "file");
    const groups = groupDirs(files.map((n) => n.path), 0);
    const top = groups.sizes.slice(0, 6);
    const max = Math.max(1, ...top.map(([, n]) => n));
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const planets = top.map(([dir, n], i) => ({
      dir, n, label: groups.label(dir),
      rx: 62 + i * 30, ry: 22 + i * 11, tilt: -14 + (i % 2 ? 9 : -4),
      r: 3 + Math.sqrt(n / max) * 8, phase: rnd() * 360, period: 60 + i * 22 + rnd() * 20,
    }));
    const pkgs = g.nodes.filter((n) => n.kind === "package").length;
    return { planets, dirs: groups.sizes.length, files: files.length, pkgs };
  }, [g]);

  // One clock for the whole system; still under reduced motion.
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, last = 0;
    const tick = (now: number) => { if (now - last > 33) { setT(now / 1000); last = now; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const ang = (p: { phase: number; period: number }) => ((p.phase / 360) + t / p.period) * Math.PI * 2;

  const hot = o.hotspots.slice(0, 5).map((h, i) => ({ ...h, x: 70 + ((i * 113) % 300), y: 40 + ((i * 53) % 190), r: 4 + (h.score / Math.max(1, o.hotspots[0]?.score ?? 1)) * 6 }));

  return (
    <section className="orrery" aria-label="Repository plate">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${name}: ${model?.dirs ?? "…"} directories`}>
        <defs>
          <radialGradient id="orr-sun"><stop offset="0" stopColor="var(--accent)" stopOpacity=".55" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        </defs>
        {/* ruler down the left edge, like the plate's meridian */}
        <g className="orr-rule">
          <path d={`M26 12V${H - 12}`} />
          {Array.from({ length: 14 }, (_, i) => <circle key={i} cx="26" cy={24 + i * 19.5} r={i % 4 === 0 ? 2.4 : 1.2} />)}
          <path d={`M12 ${CY}H${W - 12}`} className="orr-dash" />
        </g>
        {/* dotted field arcs */}
        <path className="orr-dash" d={`M40 ${H} C 160 170, 260 140, ${CX - 20} 20`} />
        <path className="orr-dash" d={`M0 80 C 120 60, 190 120, 260 ${H}`} />
        <circle className="orr-dash" cx="96" cy="236" r="58" />
        <circle className="orr-line" cx="96" cy="236" r="22" />
        <path className="orr-line" d="M60 236h72M96 200v72" />

        {/* the system */}
        <circle cx={CX} cy={CY} r="70" fill="url(#orr-sun)" className="orr-glow" />
        <path className="orr-line" d={`M${CX - 250} ${CY}H${CX + 250}M${CX} 6V${H - 6}`} opacity=".5" />
        {model?.planets.map((p, i) => (
          <g key={p.dir} transform={`rotate(${p.tilt} ${CX} ${CY})`}>
            <ellipse className={i % 2 ? "orr-dash" : "orr-line"} cx={CX} cy={CY} rx={p.rx} ry={p.ry} />
            <g className="orr-planet" transform={`translate(${CX + p.rx * Math.cos(ang(p))} ${CY + p.ry * Math.sin(ang(p))})`}
              onClick={() => onDir(p.dir)} role="button" aria-label={`${p.label}: ${p.n} files`}>
              <circle r={p.r + 5} className="orr-halo" />
              <circle r={p.r} className="orr-body" />
              <text x={p.r + 7} y="3" transform={`rotate(${-p.tilt})`}>{p.label}<tspan dx="6">{p.n}</tspan></text>
            </g>
          </g>
        ))}
        <path d={star(CX, CY, 15)} className="orr-star" />
        <circle cx={CX} cy={CY} r="3" className="orr-core" />

        {/* hotspots: stars in the field */}
        {hot.map((h) => (
          <g key={h.path} className="orr-hot" onClick={() => onHot(h.path)} role="button" aria-label={`Hotspot ${h.path}`}>
            <path d={star(h.x, h.y, h.r)} />
            <text x={h.x + h.r + 5} y={h.y + 3}>{h.path.split("/").pop()}</text>
          </g>
        ))}
      </svg>
      <div className="orr-legend">
        <span><b>{model?.files ?? "–"}</b> files</span>
        <span><b>{model?.dirs ?? "–"}</b> directories</span>
        <span><b>{model?.pkgs ?? "–"}</b> packages</span>
        <span><b>{o.hotspots.length}</b> hotspots</span>
      </div>
      <i className="orr-crop tl" /><i className="orr-crop tr" /><i className="orr-crop bl" /><i className="orr-crop br" />
    </section>
  );
}
