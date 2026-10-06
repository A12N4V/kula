#!/bin/sh
# Build a signed apt repository from the release .debs.
#   build-repo.sh <dir-with-debs> <out-site-dir>
# Needs APT_GPG_KEY (ASCII-armoured private key) in the environment, plus
# dpkg-scanpackages (dpkg-dev) and apt-ftparchive (apt-utils).
set -eu
in=$1; out=$2
repo="$out/apt"
mkdir -p "$repo/pool/main"
find "$in" -name '*.deb' -exec cp {} "$repo/pool/main/" \;

export GNUPGHOME="$(mktemp -d)"
printf '%s\n' "$APT_GPG_KEY" | gpg --batch --import
key=$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')

cd "$repo"
for arch in amd64 arm64; do
  d="dists/stable/main/binary-$arch"
  mkdir -p "$d"
  dpkg-scanpackages --arch "$arch" pool/ > "$d/Packages"
  gzip -9kf "$d/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=kula -o APT::FTPArchive::Release::Label=kula \
  -o APT::FTPArchive::Release::Suite=stable -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" -o APT::FTPArchive::Release::Components=main \
  release dists/stable > dists/stable/Release
gpg --batch --yes --local-user "$key" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --local-user "$key" -abs -o dists/stable/Release.gpg dists/stable/Release
cd - >/dev/null

# Public key, binary form for `signed-by=`.
gpg --export "$key" > "$out/kula.gpg"
# The docs site at the root, the apt repository under it.
cp -R site/. "$out/"
mkdir -p "$out/assets" && cp docs/assets/*.svg docs/assets/*.png "$out/assets/"
echo "apt repository ready in $repo (key $key)"
