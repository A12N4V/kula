#!/bin/sh
# kula installer —  curl -fsSL https://raw.githubusercontent.com/arnavsharma/kula/main/scripts/install.sh | sh
# Env: KULA_VERSION (default: latest), KULA_INSTALL_DIR (default: ~/.local/bin)
set -eu
repo="arnavsharma/kula"
dir="${KULA_INSTALL_DIR:-$HOME/.local/bin}"
os=$(uname -s); arch=$(uname -m)
case "$os-$arch" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
  Linux-aarch64|Linux-arm64) target=aarch64-unknown-linux-gnu ;;
  *) echo "kula: unsupported platform $os-$arch — try: cargo install kula" >&2; exit 1 ;;
esac
if [ -n "${KULA_VERSION:-}" ]; then tag="v$KULA_VERSION"; else
  tag=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
fi
url="https://github.com/$repo/releases/download/$tag/kula-$target.tar.gz"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "◯ downloading kula $tag for $target"
curl -fsSL "$url" -o "$tmp/kula.tgz"
if curl -fsSL "$url.sha256" -o "$tmp/kula.sha256" 2>/dev/null; then
  expected=$(cut -d' ' -f1 < "$tmp/kula.sha256")
  actual=$( (sha256sum "$tmp/kula.tgz" 2>/dev/null || shasum -a 256 "$tmp/kula.tgz") | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || { echo "kula: checksum mismatch" >&2; exit 1; }
fi
tar -xzf "$tmp/kula.tgz" -C "$tmp"
mkdir -p "$dir"
install -m 755 "$tmp/kula" "$dir/kula"
echo "✓ installed to $dir/kula"
case ":$PATH:" in *":$dir:"*) ;; *) echo "  add $dir to your PATH" ;; esac
