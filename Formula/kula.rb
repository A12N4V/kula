# Homebrew formula; this repo is its own tap. The release workflow rewrites the
# version and sha256 values here and commits them to main.
#   brew tap a12n4v/kula https://github.com/A12N4V/kula   # once
#   brew install kula
class Kula < Formula
  desc "Git, with a map: local-first git client with a knowledge-graph view"
  homepage "https://github.com/A12N4V/kula"
  version "0.3.0"
  # 0.3 follows the 1.0.x tags: a fresh scheme so brew upgrades past them
  version_scheme 1
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-aarch64-apple-darwin.tar.gz"
      sha256 "73023d8e16361e043b03fc15cf734bbd6ced4c84b5a64b0449ac72ad7e8ff51c"
    end
    on_intel do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-x86_64-apple-darwin.tar.gz"
      sha256 "45126129eaaa3644cebef76f8b82ed9abf3a8bf45826bca13e0c6b3abadc0203"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "d921f4b1273a82eaec1c799d10c6e4431d9b6a67432818f769ed7abf3b372706"
    end
    on_intel do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "82568709380ba5a3a5ae8fb07d94134436fabdbb075a3fabfb5e9f3cbe3c42bb"
    end
  end

  depends_on "git"

  def install
    bin.install "kula"
  end

  test do
    system "git", "init", "-q", testpath/"r"
    (testpath/"r/a.py").write "def hello():\n    return world()\n\ndef world():\n    return 1\n"
    system bin/"kula", "-C", testpath/"r", "index"
    assert_match "world", shell_output("#{bin}/kula -C #{testpath}/r query world")
  end
end
