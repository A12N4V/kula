#!/bin/sh
# A stand-in agent for orchestration tests. Never calls a model.
#   FAKE_MODE=clean    write a file inside the slice's first scope entry
#   FAKE_MODE=outside  append to README.md (out of scope)
#   FAKE_SLEEP=n       sleep n seconds first
#   FAKE_SEEN=dir      copy the run state there as seen-<slice>-<attempt>.json
echo "fake-agent slice=$KULA_SLICE attempt=$KULA_ATTEMPT"
if [ -n "$FAKE_SEEN" ] && [ -n "$KULA_RUN_STATE" ]; then
  mkdir -p "$FAKE_SEEN"
  cp "$KULA_RUN_STATE" "$FAKE_SEEN/seen-$KULA_SLICE-$KULA_ATTEMPT.json" 2>/dev/null
fi
sleep "${FAKE_SLEEP:-0}"
case "${FAKE_MODE:-clean}" in
  clean)
    dir=$(printf '%s' "$KULA_SCOPE" | cut -d: -f1)
    mkdir -p "$dir"
    echo "// attempt $KULA_ATTEMPT" > "$dir/fake_$KULA_ATTEMPT.txt"
    ;;
  outside)
    echo "touched" >> README.md
    ;;
esac
exit 0
