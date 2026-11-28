import { api } from "../api";
import Contrast from "./Contrast";
import CodeCanvas from "./graph/CodeCanvas";
import type { ContrastMode, Go } from "../nav";

type Props = {
  focus: number | null; setFocus: (id: number | null) => void; onChanged: () => void; version: number;
  contrast: { base: string; head: string; mode?: ContrastMode } | null; setContrast: (c: { base: string; head: string; mode?: ContrastMode } | null) => void; go: Go;
  openSettings: () => void;
  /** Open with the fences overlay: "" for what is in force, or a workflow to preview. */
  fences?: string;
};

export default function GraphView(props: Props) {
  const { contrast, setContrast, setFocus } = props;
  if (contrast)
    return (
      <Contrast
        base={contrast.base}
        head={contrast.head}
        mode={contrast.mode ?? "overlay"}
        onMode={(mode) => setContrast({ ...contrast, mode })}
        onChange={(base, head) => setContrast({ ...contrast, base, head })}
        onExit={() => setContrast(null)}
        openInMap={async (name, path) => {
          const hits = await api.search(name);
          const hit = hits.find((h) => h.path === path) ?? hits[0];
          setContrast(null);
          if (hit) setFocus(hit.id);
        }}
      />
    );
  return <Layouts {...props} />;
}

/** The graph is the canvas: the repo drawn as nested boxes. */
function Layouts(props: Props) {
  return <CodeCanvas focus={props.focus} setFocus={props.setFocus} version={props.version} />;
}
