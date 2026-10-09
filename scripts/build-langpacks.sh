#!/usr/bin/env bash
# Build every language pack for this machine into dist/langpacks: one shared
# library per grammar (langpack-<id>-<triple>.<so|dylib>) plus the sha256
# manifest (langpacks-<triple>.json) that `kula lang add` checks downloads
# against. Prints a TSV report: size, ABI, query patterns, and what each
# pack's queries find in the grammar's test corpus (its tier).
#
# Needs git, curl, tar and a C/C++ compiler (CC/CXX are honoured, e.g.
# CC="cc -arch x86_64" for an Intel build on Apple silicon).
#   scripts/build-langpacks.sh [out-dir] [ids…]
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-dist/langpacks}"
shift || true
jobs="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
bin="${KULA_BIN:-target/release/kula}"
[ -x "$bin" ] || cargo build --release --locked
mkdir -p "$out"
if [ $# -gt 0 ]; then
  "$bin" lang build "$@" --out "$out" -j "$jobs" | tee "$out/report.tsv"
else
  "$bin" lang build --all --out "$out" -j "$jobs" | tee "$out/report.tsv"
fi
