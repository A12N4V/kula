// The logo studio: opened from any card's mark (fuse 5, module U17). A live
// preview of the name's harmonograph under the studio's controls – 2D or 3D,
// yaw and pitch dials, density and line weight sliders, a reroll seed – and
// Save logo, which posts `logo_save` (B2). The saved svg replaces the hashed
// mark everywhere the name is shown, via the mark cache in agentMark.

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { harmonographSegments, markPose, putLogo, svgId, type MarkFamily, type LogoParams } from "../../flow/agentMark";
import { api } from "../../api";
import { Icon } from "../../ui";

/** The studio's svg, as a string, from the same segments the preview draws –
 *  what the backend stores is exactly what the preview showed. */
export function logoSvg(name: string, family: MarkFamily, params: LogoParams, lw: number): string {
  const n = Math.round(params.density);
  const per = Math.max(4, Math.round(n / 100));
  const segs = harmonographSegments(name, n, per, family, { seed: params.seed, yaw: params.yaw, pitch: params.pitch, dims: params.dims });
  const paths = segs.map((g, i) => `<path d="${g.d}" fill="none" stroke="${g.stroke}" stroke-opacity="${g.opacity.toFixed(3)}" stroke-width="${lw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-figure data-logo="${svgId(name)}">${paths}</svg>`;
}

const KIND_LABEL: Record<MarkFamily, string> = { agent: "agent", team: "team", research: "research" };

function Studio({ kind, name, onClose }: { kind: MarkFamily; name: string; onClose: () => void }) {
  const pose = useMemo(() => markPose(name), [name]);
  const [dims, setDims] = useState<2 | 3>(3);
  const [yaw, setYaw] = useState<number>(pose.yaw);
  const [pitch, setPitch] = useState<number>(pose.pitch);
  const [density, setDensity] = useState(0.55); // 0–1 → segment count
  const [lw, setLw] = useState(0.5); // line weight, the stroke width
  const [seed, setSeed] = useState(0);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  // one interaction away, but still one interaction: Esc closes and focus
  // returns to the mark that opened the studio. While the studio is open the
  // page behind it is hidden from hit-testing and assistive tech – the studio
  // is the only interaction there is.
  useEffect(() => {
    opener.current = document.activeElement;
    closeRef.current?.focus();
    document.documentElement.classList.add("logo-studio-open");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("logo-studio-open");
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  const n = Math.round(400 + density * 2000);
  const params: LogoParams = { dims, yaw, pitch, density: n, seed };
  const segs = useMemo(
    () => harmonographSegments(name, n, Math.max(4, Math.round(n / 100)), kind, {
      seed,
      yaw,
      pitch,
      dims,
    }),
    [name, n, kind, yaw, pitch, seed, dims],
  );

  const save = async () => {
    setState("saving");
    setNote("");
    try {
      const svg = logoSvg(name, kind, params, lw);
      await api.logoSave({ kind, name, svg, params });
      putLogo({ kind, name, svg, params });
      setState("saved");
      setTimeout(onClose, 450);
    } catch (e) {
      setState("error");
      setNote(e instanceof Error && e.message ? e.message : "could not save – the backend refused");
    }
  };

  return (
    <div className="logo-veil" data-testid="logo-studio" role="dialog" aria-label={`Logo studio – ${name}`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="logo-win" onClick={(e) => e.stopPropagation()}>
        <header className="logo-head">
          <span className="mono">logo studio · {KIND_LABEL[kind]} · {name}</span>
          <span className="spacer" />
          <button ref={closeRef} className="btn sm ghost" onClick={onClose} aria-label="Close logo studio" data-testid="logo-close"><Icon.close /></button>
        </header>
        <div className="logo-body">
          <div className="logo-stage" data-testid="logo-stage">
            <svg viewBox="0 0 24 24" aria-hidden="true" data-figure data-testid="logo-preview">
              {segs.map((g, i) => (
                <path key={i} d={g.d} fill="none" stroke={g.stroke} strokeOpacity={g.opacity} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          </div>
          <div className="logo-ctl">
            <div className="logo-row" role="group" aria-label="Projection">
              <button className={`btn sm${dims === 2 ? " on" : ""}`} data-testid="logo-dims" aria-pressed={dims === 2} onClick={() => setDims(dims === 2 ? 3 : 2)}>2D</button>
              <button className={`btn sm${dims === 3 ? " on" : ""}`} aria-pressed={dims === 3} onClick={() => setDims(dims === 2 ? 3 : 2)}>3D</button>
              <span className="spacer" />
              <button className="btn sm ghost" data-testid="logo-reroll" title="A different curve from the same name" onClick={() => { setSeed(Math.floor(Math.random() * 100000)); setState("idle"); }}>reroll</button>
            </div>
            <label className="logo-slider"><span className="mono">yaw</span>
              <input type="range" min="0" max="6.28" step="0.01" value={yaw} onChange={(e) => setYaw(Number(e.target.value))} aria-label="Yaw" data-testid="logo-yaw" />
            </label>
            <label className="logo-slider"><span className="mono">pitch</span>
              <input type="range" min="0" max="1.57" step="0.01" value={pitch} onChange={(e) => setPitch(Number(e.target.value))} aria-label="Pitch" data-testid="logo-pitch" />
            </label>
            <label className="logo-slider"><span className="mono">density</span>
              <input type="range" min="0" max="1" step="0.01" value={density} onChange={(e) => setDensity(Number(e.target.value))} aria-label="Density" data-testid="logo-density" />
            </label>
            <label className="logo-slider"><span className="mono">line weight</span>
              <input type="range" min="0.15" max="1.4" step="0.01" value={lw} onChange={(e) => setLw(Number(e.target.value))} aria-label="Line weight" data-testid="logo-lw" />
            </label>
            <div className="logo-actions">
              <button className="btn" data-testid="logo-save" disabled={state === "saving"} onClick={save}>Save logo</button>
              {state === "saved" && <span className="mono logo-note" data-testid="logo-saved">saved</span>}
              {state === "error" && note && <span className="mono logo-note logo-note-err">{note}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Open the studio for one mark. Rendered in a portal so any view can call
 *  it without mounting anything; focus returns to the opener on close. */
export function openLogoStudio(kind: MarkFamily, name: string) {
  const div = document.createElement("div");
  div.className = "logo-root";
  document.body.appendChild(div);
  const root = createRoot(div);
  const close = () => { root.unmount(); div.remove(); };
  root.render(<Studio kind={kind} name={name} onClose={close} />);
}
