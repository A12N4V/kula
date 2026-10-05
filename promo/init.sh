#!/bin/sh
# The install scene's terminal, for real: `kula init` in a fresh clone that has
# Claude Code and Cursor set up, its output saved for the film.
#   usage: sh promo/init.sh <out/init.json>
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
K="$ROOT/target/debug/kula"
D=$(mktemp -d)/kula
git clone -q "$ROOT" "$D"
mkdir -p "$D/.claude" "$D/.cursor"
VERSION=$("$K" --version)
INIT=$(cd "$D" && "$K" init 2>&1)
rm -rf "$(dirname "$D")"
python3 -c 'import json, sys; json.dump({"version": sys.argv[1], "init": sys.argv[2].splitlines()}, open(sys.argv[3], "w"), indent=1, ensure_ascii=False)' "$VERSION" "$INIT" "$1"
