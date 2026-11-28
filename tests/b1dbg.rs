//! Throwaway: reproduce the flaky missing-util.rs-import run under concurrency.
use std::path::Path;
use std::process::Command;
const KULA: &str = env!("CARGO_BIN_EXE_kula");
fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}
fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(ok.status.success());
}
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "T"]);
    git(d, &["config", "user.email", "t@e.c"]);
    write(d, "Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n");
    write(d, "crates/printer/Cargo.toml", "[package]\nname = \"printer\"\nversion = \"0.1.0\"\n");
    write(d, "crates/printer/src/lib.rs", "mod stats;\nmod util;\n");
    write(d, "crates/printer/src/stats.rs", "use crate::util::helper;\npub fn s() { helper(); }\n");
    write(d, "crates/printer/src/util.rs", "pub fn helper() {}\n");
    write(d, "crates/matcher/Cargo.toml", "[package]\nname = \"matcher\"\nversion = \"0.1.0\"\n");
    write(d, "crates/matcher/src/lib.rs", "pub fn m() {}\n");
    write(d, "crates/matcher/tests/util.rs", "pub fn helper() {}\n");
    write(d, "crates/matcher/tests/tests.rs", "mod util;\n");
    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "i"]);
    t
}
#[test]
fn flake_hunt() {
    for it in 0..40 {
        let mut dirs = Vec::new();
        let mut kids = Vec::new();
        for _ in 0..4 {
            let t = fixture();
            kids.push(
                Command::new(KULA)
                    .arg("-C")
                    .arg(t.path())
                    .args(["index"])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .unwrap(),
            );
            dirs.push(t);
        }
        let mut bad = false;
        for (k, t) in kids.into_iter().zip(dirs.iter()) {
            let out = k.wait_with_output().unwrap();
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            let repo = kula::git::Repo::discover(t.path()).unwrap();
            let st = kula::store::Store::open(&repo).unwrap();
            let nodes = st.nodes_where("kind = 'file'", []).unwrap();
            let util = nodes.iter().filter(|n| n.name == "util.rs").count();
            if util != 2 {
                bad = true;
                eprintln!("ITER {it}: util.rs file nodes = {util}; {text}");
                for n in &nodes {
                    eprintln!("  file {}", n.path);
                }
            }
        }
        if bad {
            panic!("flake at iter {it}");
        }
    }
}
