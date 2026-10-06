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
cat > "$out/index.html" <<HTML
<!doctype html><meta charset=utf-8><title>kula apt repository</title>
<pre>curl -fsSL https://a12n4v.github.io/kula/kula.gpg | sudo tee /usr/share/keyrings/kula.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/kula.gpg] https://a12n4v.github.io/kula/apt stable main" | sudo tee /etc/apt/sources.list.d/kula.list
sudo apt update && sudo apt install kula</pre>
HTML
echo "apt repository ready in $repo (key $key)"
