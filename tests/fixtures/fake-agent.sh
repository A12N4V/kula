#!/bin/sh
# A stand-in agent for orchestration tests. Never calls a model.
#   FAKE_MODE=clean    write a file inside the slice's first scope entry
#   FAKE_MODE=outside  append to README.md (out of scope)
#   FAKE_SLEEP=n       sleep n seconds first
#   FAKE_SEEN=dir      copy the run state there as seen-<slice>-<attempt>.json
#   FAKE_INTRUDER=id FAKE_INTO=dir  slice <id> writes into <dir> instead of its own scope
#   FAKE_PROBE=dir     copy the worktree's .claude/settings.json there as hooks-<slice>.json
echo "fake-agent slice=$KULA_SLICE attempt=$KULA_ATTEMPT"
if [ -n "$FAKE_SEEN" ] && [ -n "$KULA_RUN_STATE" ]; then
  mkdir -p "$FAKE_SEEN"
  cp "$KULA_RUN_STATE" "$FAKE_SEEN/seen-$KULA_SLICE-$KULA_ATTEMPT.json" 2>/dev/null
fi
if [ -n "$FAKE_PROBE" ] && [ -f .claude/settings.json ]; then
  mkdir -p "$FAKE_PROBE"
  cp .claude/settings.json "$FAKE_PROBE/hooks-$KULA_SLICE.json"
fi
sleep "${FAKE_SLEEP:-0}"
if [ -n "$FAKE_INTRUDER" ] && [ "$KULA_SLICE" = "$FAKE_INTRUDER" ]; then
  mkdir -p "$FAKE_INTO"
  echo "from $KULA_SLICE" > "$FAKE_INTO/intruder.txt"
  exit 0
fi
case "${FAKE_MODE:-clean}" in
  clean)
    dir=$(printf '%s' "$KULA_SCOPE" | cut -d: -f1)
    mkdir -p "$dir"
    echo "// $KULA_SLICE attempt $KULA_ATTEMPT" > "$dir/fake_$KULA_ATTEMPT.txt"
    ;;
  outside)
    echo "touched" >> README.md
    ;;
esac
exit 0
