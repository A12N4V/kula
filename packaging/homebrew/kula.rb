# Homebrew formula. The release workflow rewrites VERSION and the sha256 values
# and pushes this file to the tap repo (github.com/A12N4V/homebrew-tap).
#   brew install A12N4V/tap/kula
class Kula < Formula
  desc "Git, with a map: local-first git client with a knowledge-graph view"
  homepage "https://github.com/A12N4V/kula"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-aarch64-apple-darwin.tar.gz"
      sha256 "SHA256_AARCH64_APPLE_DARWIN"
    end
    on_intel do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-x86_64-apple-darwin.tar.gz"
      sha256 "SHA256_X86_64_APPLE_DARWIN"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "SHA256_AARCH64_UNKNOWN_LINUX_GNU"
    end
    on_intel do
      url "https://github.com/A12N4V/kula/releases/download/v#{version}/kula-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "SHA256_X86_64_UNKNOWN_LINUX_GNU"
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
