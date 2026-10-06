#!/bin/sh
# A disposable clone of this repository with guards, a task and agent memories,
# served for the agents tests – they write memories and tasks, so they never
# touch the real repository's refs/kula/meta.
#   usage: sh e2e/fixture.sh <port>
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
K="$ROOT/target/debug/kula"
# /tmp on purpose: mktemp in the system temp dir (macOS /var/folders) is
# unreliable in sandboxed checkouts – git clone intermittently fails with
# "Operation not permitted" – so the fixture repo always lives under /tmp.
D=$(mktemp -d "/tmp/kula-fixture.XXXXXX")/kula
echo "$D" > "/tmp/kula-fixture-$1.path"
# Clone through a cached bundle: in sandboxed checkouts a concurrent temp-file
# reaper can make a loose object in the shared object store unreadable
# ("Operation not permitted") while a clone streams it, and every clone re-reads
# all of them (fresh loose objects are also intermittently unreadable for a
# moment under macOS Desktop file protection). So pack the repo once per HEAD
# into a bundle under /tmp (atomic rename, so concurrent workers share one
# winner) and clone from that single file – the clone then reads no loose
# objects at all – retrying before giving up.
SHA=$(git -C "$ROOT" rev-parse HEAD)
CACHE="/tmp/kula-fixture-bundle-$SHA.bundle"
if [ ! -f "$CACHE" ]; then
  n=0
  until git -C "$ROOT" bundle create "$CACHE.tmp.$$" --all 2>/dev/null && \
        mv -f "$CACHE.tmp.$$" "$CACHE"; do
    rm -f "$CACHE.tmp.$$"
    n=$((n + 1))
    [ "$n" -ge 10 ] && { echo "fixture: git bundle failed $n times, giving up" >&2; exit 1; }
    sleep 1
  done
fi
n=0
until git clone -q "$CACHE" "$D"; do
  rm -rf "$D"
  n=$((n + 1))
  [ "$n" -ge 10 ] && { echo "fixture: git clone failed $n times, giving up" >&2; exit 1; }
  sleep 1
done
cd "$D"
git config user.name e2e
git config user.email e2e@example.com
git config commit.gpgsign false
git switch -q -C main
cat > kula.toml <<'TOML'
[[guard]]
paths = ["packaging/apt/**"]
level = "locked"
reason = "release pipeline: signed packages"

[[guard]]
symbols = ["src/store.rs:publish"]
level = "locked"
reason = "atomic index swap"

[[guard]]
paths = ["web/src/colors.ts"]
level = "review"
reason = "palette is shared with the README"

# T1: a team the Teams tab and its e2e tests can show – a lead and three
# members across two workflows, with hand-offs between them.
[[team]]
name = "ship"
about = "the e2e team: build it, then check it"
prompt = "ship the change; keep the graph green"
members = [
  { agent = "claude", workflow = "tests", role = "lead", prompt = "you lead; review every hand-off before it lands" },
  { agent = "cursor", workflow = "tests", role = "builder", reports_to = "claude", hands_off = ["codex"] },
  { agent = "codex", workflow = "explore", role = "review", reports_to = "claude" },
  { agent = "gemini", workflow = "explore", role = "scout", reports_to = "claude", hands_off = ["cursor"] },
]
TOML
git add kula.toml
git commit -qm "e2e guards"
# A branch with a structural change, proposed for review; an issue and a note.
git switch -q -c feat/agent-scope
cat >> src/guard.rs <<'RS'

/// The narrowest scope that still holds every path an agent touched.
pub fn suggest_scope(paths: &[String]) -> Vec<String> {
    let mut dirs: Vec<String> = paths.iter().map(|p| p.rsplit_once('/').map(|(d, _)| format!("{d}/**")).unwrap_or_else(|| p.clone())).collect();
    dirs.sort();
    dirs.dedup();
    dirs
}
RS
perl -pi -e 's/w\.len\(\) > 2/w.len() > 1/' src/memory.rs   # modify a symbol that recall depends on
git commit -qam "Suggest a task scope from the paths an agent touched"
git switch -q main
"$K" index -q
"$K" pr new "Suggest a task scope from what an agent touched" --base main --head feat/agent-scope -b "Agents start broad. This proposes the narrowest scope that covers the files they actually changed." >/dev/null
"$K" issue new "Recall should prefer recent memories inside a tier" -b "Two fresh memories on the same symbol come back in creation order." -a src/memory.rs:recall -l memory >/dev/null
"$K" note add symbol:Guards "One verdict per path: MCP, the hook and kula check all read this." >/dev/null
"$K" memory add publish "Unlink, never truncate, the WAL files under open readers." --by agent:e2e >/dev/null
"$K" memory add file:src/kg.rs "SPARQL is read-only: updates are rejected by the parser." --by agent:e2e >/dev/null
"$K" task start "harden the MCP server" --scope src/mcp.rs src/agent.rs --workflow fix >/dev/null
# Claude Code is wired up; AGENTS.md carries the brief; an agent has suggested a fence.
"$K" agents connect claude >/dev/null
"$K" agents sync >/dev/null
if [ -n "$KULA_PROMO" ]; then
  # The launch film: Cursor connected too, a clean tree, and Claude Code's half of
  # a real agent session (promo/session.py) – its suggestion waits in the UI.
  "$K" task done >/dev/null
  "$K" agents connect cursor >/dev/null
  git add -A && git commit -qm "kula init"
  python3 "$ROOT/promo/session.py" "$D" claude "$KULA_PROMO/session.json" >/dev/null
  echo "$D" > "$KULA_PROMO/repo"
else
cat > .kula/suggestions.json <<'JSON'
[{ "id": 1, "kind": "guard", "guard": { "paths": ["web/dist/**"], "level": "locked", "reason": "built by vite" }, "why": "generated by the web build", "by": "agent:e2e", "created": 1791200000 }]
JSON
# An uncommitted edit, so Changes has something to show.
printf '\n// TODO: cache the RDF store per indexed head\n' >> src/kg.rs
fi
exec env KULA_TOKEN=test "$K" view --no-open --port "$1"
