#!/bin/sh
# The two-minute launch film, end to end: score → voices → a real kula init and
# agent session → app shots → Remotion.
#   sh promo/film.sh            everything
#   sh promo/film.sh render     only re-render (after editing promo/film/src)
# Needs ffmpeg, Python 3 + numpy, pnpm, and a Chromium: PW_CHROMIUM for the app shots,
# REMOTION_BROWSER for Remotion (both default to Playwright's own when unset).
# Voices: Kokoro from promo/.venv when it is there (see promo/voice.py), else macOS say.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
P="$ROOT/promo/film/public"
mkdir -p "$P/fonts"
if [ -z "$REMOTION_BROWSER" ]; then
  REMOTION_BROWSER=$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)
  export REMOTION_BROWSER
fi
if [ "$1" != "render" ]; then
  PY=python3; [ -x "$ROOT/promo/.venv/bin/python" ] && PY="$ROOT/promo/.venv/bin/python"
  python3 "$ROOT/promo/score.py" "$P/score.wav" --layout=launch
  "$PY" "$ROOT/promo/voice.py" "$P"
  sh "$ROOT/promo/init.sh" "$P/init.json"
  # the fixture runs Claude Code's half of the session; capture runs Cursor's after the accept shot
  PROMO_FILM=1 node "$ROOT/promo/capture.mjs" graph impact contrast query console accept research teams
  cp "$ROOT/web/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" "$P/fonts/jbm.woff2"
fi
cd "$ROOT/promo/film"
[ -d node_modules ] || pnpm install
npx remotion render src/index.ts Film out/kula-film.mp4
A="$ROOT/docs/assets"
ffmpeg -hide_banner -loglevel error -y -i out/kula-film.mp4 -vf scale=1280:-2:flags=lanczos -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "$A/promo.mp4"
ffmpeg -hide_banner -loglevel error -y -ss 81 -t 12 -i out/kula-film.mp4 \
  -vf "fps=8,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 "$A/promo.gif"
echo "→ promo/film/out/kula-film.mp4 · docs/assets/promo.mp4 · docs/assets/promo.gif"
