# Source-built formula in homebrew/core style, ready to submit once the repo
# meets Homebrew's notability bar (https://docs.brew.sh/Package-Acceptance-Policy).
# The src tarball on each release already carries the built web UI, so only
# Rust is needed to build.
class Kula < Formula
  desc "Local-first git client with a knowledge-graph view of your code"
  homepage "https://github.com/A12N4V/kula"
  url "https://github.com/A12N4V/kula/releases/download/vVERSION/kula-VERSION-src.tar.gz"
  sha256 "SHA256_SRC"
  license "MIT"
  head "https://github.com/A12N4V/kula.git", branch: "main"

  depends_on "rust" => :build
  depends_on "git"

  def install
    system "cargo", "install", *std_cargo_args
  end

  test do
    system "git", "init", "-q", testpath/"r"
    (testpath/"r/a.py").write "def hello():\n    return world()\n\ndef world():\n    return 1\n"
    system bin/"kula", "-C", testpath/"r", "index"
    assert_match "world", shell_output("#{bin}/kula -C #{testpath}/r query world")
  end
end
