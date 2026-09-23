#!/usr/bin/env bash
# kula — unified test script.
#
#   ./scripts/test.sh           everything
#   ./scripts/test.sh --quick   skip packaging checks
#   ./scripts/test.sh web rust  run only the named stages (web rust e2e pkg)
#
# Stages
#   web   pnpm install · typecheck · production build
#   rust  rustfmt · clippy -D warnings · unit + integration tests
#   e2e   real `kula view` server against a fixture repo: auth guards, graph,
#         git actions, issues/proposals/notes over HTTP
#   pkg   npm launcher · pip wheel (maturin) · crate contents · brew/nix/sh syntax
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

c() { [ -t 1 ] && printf "\033[%sm%s\033[0m" "$1" "$2" || printf "%s" "$2"; }
PASS=(); FAIL=(); SKIP=()
step() { printf "\n%s %s\n" "$(c '38;5;215' '◯')" "$(c 1 "$1")"; }
ok() { PASS+=("$1"); printf "  %s %s\n" "$(c '38;5;114' '✓')" "$1"; }
bad() { FAIL+=("$1"); printf "  %s %s\n" "$(c '38;5;203' '✗')" "$1"; }
skip() { SKIP+=("$1"); printf "  %s %s %s\n" "$(c 2 '○')" "$1" "$(c 2 "($2)")"; }
run() { local name="$1"; shift; local log; log=$(mktemp); if "$@" >"$log" 2>&1; then ok "$name"; else bad "$name"; tail -n 30 "$log" | sed 's/^/    │ /'; fi; rm -f "$log"; }
has() { command -v "$1" >/dev/null 2>&1; }

STAGES=(web rust e2e pkg)
if [ "${1:-}" = "--quick" ]; then STAGES=(web rust e2e); elif [ $# -gt 0 ]; then STAGES=("$@"); fi
want() { [[ " ${STAGES[*]} " == *" $1 "* ]]; }
T0=$(date +%s)

# ------------------------------------------------------------------ web
if want web; then
  step "web"
  if has pnpm; then
    run "pnpm install" pnpm -C web install --frozen-lockfile
    run "typecheck" pnpm -C web typecheck
    run "vite build" pnpm -C web exec vite build
  else bad "pnpm not found"; fi
fi

# ------------------------------------------------------------------ rust
if want rust; then
  step "rust"
  run "rustfmt" cargo fmt --check
  run "clippy -D warnings" cargo clippy --all-targets --locked -- -D warnings
  run "cargo test (unit + e2e CLI)" cargo test --locked
fi

# ------------------------------------------------------------------ e2e server
if want e2e; then
  step "e2e · kula view"
  cargo build --locked -q 2>/dev/null || bad "cargo build"
  BIN="$ROOT/target/debug/kula"
  TMP=$(mktemp -d); trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT
  R="$TMP/repo"; mkdir -p "$R/src"
  git -C "$R" init -q -b main
  git -C "$R" config user.name e2e; git -C "$R" config user.email e2e@example.com; git -C "$R" config commit.gpgsign false
  printf 'export function a() { return b(); }\nexport function b() { return 1; }\n' > "$R/src/x.ts"
  git -C "$R" add -A && git -C "$R" commit -qm init
  "$BIN" -C "$R" index >/dev/null 2>&1 && ok "index fixture" || bad "index fixture"
  PORT=$(( 20000 + RANDOM % 20000 ))
  KULA_TOKEN=e2e-token "$BIN" -C "$R" view --no-open --port "$PORT" >"$TMP/srv.log" 2>&1 &
  SRV=$!
  PORT_UP=""
  for _ in $(seq 1 50); do
    P=$(grep -o 'localhost:[0-9]*' "$TMP/srv.log" 2>/dev/null | head -1 | cut -d: -f2)
    if [ -n "$P" ] && curl -s "http://localhost:$P/" >/dev/null; then PORT_UP=$P; break; fi
    sleep 0.1
  done
  if [ -z "$PORT_UP" ]; then bad "server start"; cat "$TMP/srv.log"; else
    U="http://localhost:$PORT_UP"; H=(-H "x-kula-token: e2e-token")
    code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
    [ "$(code "$U/api/repo")" = 401 ] && ok "rejects missing token" || bad "rejects missing token"
    [ "$(code -H 'Host: evil.example' "$U/")" = 403 ] && ok "rejects foreign Host (DNS rebinding)" || bad "rejects foreign Host"
    curl -s "$U/" | grep -q 'name="kula-token" content="e2e-token"' && ok "injects session token into UI" || bad "injects session token"
    curl -s "${H[@]}" "$U/api/repo" | grep -q '"index":"current"' && ok "GET /api/repo" || bad "GET /api/repo"
    curl -s "${H[@]}" "$U/api/graph" | grep -q '"name":"b"' && ok "GET /api/graph" || bad "GET /api/graph"
    ID=$(curl -s "${H[@]}" "$U/api/search?q=b" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
    curl -s "${H[@]}" "$U/api/impact/$ID" | grep -q '"name":"a"' && ok "GET /api/impact (b ← a)" || bad "GET /api/impact"
    printf 'hello\n' > "$R/NOTES.txt"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"paths":["NOTES.txt"]}' "$U/api/git/stage" | grep -q '"ok":true' && ok "POST git stage" || bad "POST git stage"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"message":"from e2e"}' "$U/api/git/commit" | grep -q '"ok":true' && ok "POST git commit" || bad "POST git commit"
    git -C "$R" log -1 --format=%s | grep -q "from e2e" && ok "commit landed in git" || bad "commit landed in git"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"title":"e2e issue"}' "$U/api/meta/issues/new" | grep -q '"status":"open"' && ok "POST issue" || bad "POST issue"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"target":"symbol:b","body":"note"}' "$U/api/meta/notes/new" | grep -q '"target":"symbol:b"' && ok "POST note" || bad "POST note"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"args":["rev-parse","--abbrev-ref","HEAD"]}' "$U/api/git/exec" | grep -q '"stdout":"main' && ok "git console exec" || bad "git console exec"
    curl -s "${H[@]}" -H 'content-type: application/json' -d '{"name":"--upload-pack=x"}' "$U/api/git/checkout" | grep -q 'invalid revision' && ok "rejects option injection" || bad "rejects option injection"
    git -C "$R" switch -qc feat/e2e && printf 'export function c() { return a(); }\n' >> "$R/src/x.ts" && git -C "$R" commit -qam "add c"
    curl -s "${H[@]}" "$U/api/graphdiff?base=main&head=feat/e2e" | grep -q '"name":"c","path":"src/x.ts","start_line":3,"status":"added"' && ok "GET /api/graphdiff (branch contrast)" || bad "GET /api/graphdiff"
    curl -s "${H[@]}" "$U/api/overview" | grep -q '"default_branch":"main"' && ok "GET /api/overview (review queue)" || bad "GET /api/overview"
    curl -s "${H[@]}" "$U/api/history/$ID" | grep -q '"owners":\[\["e2e"' && ok "GET /api/history (symbol ownership)" || bad "GET /api/history"
  fi
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
fi

# ------------------------------------------------------------------ packaging
if want pkg; then
  step "packaging"
  cargo build --release --locked -q 2>/dev/null && ok "release build" || bad "release build"
  REL="$ROOT/target/release/kula"
  SZ=$(du -h "$REL" 2>/dev/null | cut -f1); [ -n "$SZ" ] && ok "binary size $SZ"

  # npm: platform package + launcher, installed into a scratch project.
  if has npm; then
    NT=$(mktemp -d)
    PLAT="$(node -p 'process.platform+"-"+process.arch')"
    PD=$(./packaging/npm/make-platform-package.sh "$PLAT" "$REL" 0.1.0 "$NT/out")
    (cd "$NT" && npm pack -s "$PD" >/dev/null && npm pack -s "$ROOT/packaging/npm/kula-cli" >/dev/null)
    mkdir -p "$NT/app" && (cd "$NT/app" && npm init -y >/dev/null && npm i -s --no-audit --no-fund --omit=optional "$NT"/kula-cli-*-*.tgz "$NT"/kula-cli-0.1.0.tgz >/dev/null 2>&1)
    if [ -x "$NT/app/node_modules/.bin/kula" ] && "$NT/app/node_modules/.bin/kula" --version | grep -q "kula 0.1.0"; then ok "npm: kula-cli launcher → @kula-cli/$PLAT"; else bad "npm install + run"; fi
    rm -rf "$NT"
  else skip "npm" "npm not installed"; fi

  # pip: build a wheel with maturin and run the installed binary.
  if has uvx; then
    WT=$(mktemp -d)
    if uvx --quiet maturin build --release --quiet --out "$WT" >/dev/null 2>&1; then
      ok "pip: maturin wheel $(basename "$WT"/*.whl)"
      (cd "$WT" && uv venv -q .venv && uv pip install -q --python .venv/bin/python ./*.whl) >/dev/null 2>&1
      "$WT/.venv/bin/kula" --version | grep -q "kula 0.1.0" && ok "pip: installed kula runs" || bad "pip: installed kula runs"
    else bad "pip: maturin build"; fi
    rm -rf "$WT"
  else skip "pip wheel" "uv not installed"; fi

  run "crate contains embedded UI" sh -c "cargo package --list --allow-dirty 2>/dev/null | grep -q 'web/dist/index.html'"
  if has cargo-deb; then run "deb package" cargo deb --no-build -o "$(mktemp -d)"; else skip "deb package" "cargo-deb not installed; built in CI"; fi
  if has ruby; then run "homebrew formula syntax" ruby -c packaging/homebrew/kula.rb; else skip "homebrew formula" "ruby missing"; fi
  run "install.sh syntax" sh -n scripts/install.sh
  if has nix; then run "nix flake eval" nix flake show --no-write-lock-file; else skip "nix flake" "nix not installed; evaluated in CI"; fi
fi

# ------------------------------------------------------------------ summary
T=$(( $(date +%s) - T0 ))
printf "\n%s  %s passed" "$(c 1 'summary')" "$(c '38;5;114' "${#PASS[@]}")"
[ ${#FAIL[@]} -gt 0 ] && printf ", %s failed" "$(c '38;5;203' "${#FAIL[@]}")"
[ ${#SKIP[@]} -gt 0 ] && printf ", %s skipped" "${#SKIP[@]}"
printf "  %s\n" "$(c 2 "${T}s")"
[ ${#FAIL[@]} -eq 0 ]
