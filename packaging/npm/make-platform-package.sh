#!/usr/bin/env bash
# Build an npm platform package around a compiled binary.
#   make-platform-package.sh <platform-arch> <path/to/kula[.exe]> <version> <outdir>
# e.g.  make-platform-package.sh darwin-arm64 target/release/kula 0.1.0 dist/npm
set -euo pipefail
target="$1"; bin="$2"; version="$3"; out="$4"
os="${target%-*}"; cpu="${target#*-}"
dir="$out/$target"
mkdir -p "$dir/bin"
cp "$bin" "$dir/bin/"
chmod +x "$dir/bin/"* || true
cat > "$dir/package.json" <<JSON
{
  "name": "@kula-cli/$target",
  "version": "$version",
  "description": "kula prebuilt binary for $target",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/A12N4V/kula.git" },
  "os": ["$os"],
  "cpu": ["$cpu"],
  "files": ["bin"]
}
JSON
echo "$dir"
