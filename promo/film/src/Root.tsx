import { useEffect, useState } from "react";
import { Composition, continueRender, delayRender, staticFile } from "remotion";
import { Film, TOTAL } from "./Film";
import { FPS, H, W } from "./theme";

const font = new FontFace("JBM", `url(${staticFile("fonts/jbm.woff2")}) format("woff2")`, { weight: "100 800" });

function WithFont() {
  const [handle] = useState(() => delayRender("JetBrains Mono"));
  useEffect(() => {
    font.load().then((f) => { document.fonts.add(f); continueRender(handle); }).catch(() => continueRender(handle));
  }, [handle]);
  return <Film />;
}

export function Root() {
  return <Composition id="Film" component={WithFont} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />;
}
