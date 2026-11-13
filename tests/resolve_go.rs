//! End-to-end tests for the Go resolver (phase K1).
//!
//! Each test builds a small module, runs the real `kula` binary and reads the
//! graph back through `impact --json`, asserting the exact `resolved` call
//! target *file*, so a name linker guess cannot pass.

use serde_json::Value;
use std::path::Path;
use std::process::Command;

const KULA: &str = env!("CARGO_BIN_EXE_kula");

fn git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(ok.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&ok.stderr));
}

fn kula(dir: &Path, args: &[&str]) -> String {
    let out = Command::new(KULA).arg("-C").arg(dir).args(args).env("NO_COLOR", "1").output().unwrap();
    assert!(
        out.status.success(),
        "kula {:?} failed:\n{}{}",
        args,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn kula_json(dir: &Path, args: &[&str]) -> Value {
    let mut a = vec!["--json"];
    a.extend_from_slice(args);
    serde_json::from_str(&kula(dir, &a)).expect("valid json")
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn git_init(d: &Path) {
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);
}

/// Callers of `target` at a minimum confidence tier, as (name, path).
fn callers(dir: &Path, target: &str, min_conf: &str) -> Vec<(String, String)> {
    let imp = kula_json(dir, &["impact", target, "--depth", "8", "--min-confidence", min_conf]);
    imp["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| (h["node"]["name"].as_str().unwrap_or("").to_string(), h["node"]["path"].as_str().unwrap_or("").to_string()))
        .collect()
}

fn resolved_callers(dir: &Path, target: &str) -> Vec<(String, String)> {
    callers(dir, target, "resolved")
}

fn has(calls: &[(String, String)], name: &str, path: &str) -> bool {
    calls.iter().any(|(n, p)| n == name && p == path)
}

/// One module exercising the resolution rules, plus the negative cases.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git_init(d);
    write(d, "go.mod", "module example.com/m\n\ngo 1.21\n");
    write(
        d,
        "mathutil/mathutil.go",
        r#"package mathutil

// Clamp clamps x into [lo, hi].
func Clamp(x int, lo int, hi int) int {
	if x < lo {
		return lo
	}
	if x > hi {
		return hi
	}
	return x
}

// Circle is a shape with a radius.
type Circle struct {
	R int
}

// Area returns the circle area.
func (c Circle) Area() int {
	return 3 * c.R * c.R
}

// Shaper is anything with an area.
type Shaper interface {
	Area() int
}
"#,
    );
    write(
        d,
        "shapes.go",
        r#"package main

// Wheel spins.
type Wheel struct {
	R int
}

// Spin turns the wheel.
func (w Wheel) Spin() int {
	return w.R
}
"#,
    );
    write(
        d,
        "main.go",
        r#"package main

import (
	"example.com/m/mathutil"
)

// Report dumps a summary. Its name also exists in report.go so a resolver
// mistake would be visible.
func Report() int {
	return 1
}

func main() {
	n := mathutil.Clamp(5, 0, 10)
	_ = n

	w := Wheel{}
	_ = w.Spin()

	var s mathutil.Shaper = mathutil.Circle{}
	_ = s.Area()

	mystery.Report()
}
"#,
    );
    write(
        d,
        "report.go",
        r#"package main

// Report in another file of the same package: an unimported `mystery.Report()`
// call must not resolve here.
func Report() int {
	return 2
}
"#,
    );

    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "fixture"]);
    t
}

/// A two-package import cycle: indexing must stay cycle-free and both sides
/// must still resolve.
fn cycle_fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git_init(d);
    write(d, "go.mod", "module example.com/m\n\ngo 1.21\n");
    write(
        d,
        "pkga/a.go",
        r#"package a

import "example.com/m/pkgb"

// Helper backs the cycle.
func Helper() int {
	return 1
}

// DoA calls into b.
func DoA() int {
	return pkgb.DoB() + Helper()
}
"#,
    );
    write(
        d,
        "pkgb/b.go",
        r#"package b

import "example.com/m/pkga"

// DoB calls back into a.
func DoB() int {
	return pkga.Helper() + 1
}
"#,
    );

    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "fixture"]);
    t
}

#[test]
fn go_pkg_call_across_packages_resolves() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    let c = resolved_callers(d, "mathutil/mathutil.go:Clamp");
    assert!(has(&c, "main", "main.go"), "pkg.Func across packages: {c:?}");
}

#[test]
fn go_same_package_method_call_resolves() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `w := Wheel{}; w.Spin()` – the receiver's type is declared in the same
    // package (a sibling file), so the method set gives one exact target.
    let c = resolved_callers(d, "shapes.go:Spin");
    assert!(has(&c, "main", "main.go"), "method on a same-package receiver: {c:?}");
    // Circle.Area must NOT gain main as a resolved caller through the same
    // method name.
    let wrong = resolved_callers(d, "mathutil/mathutil.go:Circle.Area");
    assert!(!has(&wrong, "main", "main.go"), "Area resolved via the wrong method: {wrong:?}");
}

#[test]
fn go_interface_call_is_inferred_never_resolved() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `var s Shaper = mathutil.Circle{}`; `s.Area()` is an interface call:
    // method-name match only, so the resolved tier must stay empty.
    let r = resolved_callers(d, "mathutil/mathutil.go:Circle.Area");
    assert!(!has(&r, "main", "main.go"), "interface call resolved: {r:?}");
    // The name linker still connects it at the inferred tier.
    let i = callers(d, "mathutil/mathutil.go:Circle.Area", "inferred");
    assert!(has(&i, "main", "main.go"), "interface call missing at inferred tier: {i:?}");
}

#[test]
fn go_unknown_call_stays_guessed() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `mystery.Report()` – `mystery` is no import and no declared type, and
    // two `Report` functions exist. No resolved edge may pick one for main.
    for file in ["main.go", "report.go"] {
        let c = resolved_callers(d, &format!("{file}:Report"));
        assert!(!has(&c, "main", "main.go"), "unknown call resolved into {file}: {c:?}");
    }
}

#[test]
fn go_import_cycle_resolves_both_ways() {
    let t = cycle_fixture();
    let d = t.path();
    kula(d, &["index"]);

    // a → b and b → a: indexing is cycle-free and each pkg call is exact.
    let b = resolved_callers(d, "pkgb/b.go:DoB");
    assert!(has(&b, "DoA", "pkga/a.go"), "a→b call: {b:?}");
    let a = resolved_callers(d, "pkga/a.go:Helper");
    assert!(has(&a, "DoA", "pkga/a.go"), "a's own call: {a:?}");
    assert!(has(&a, "DoB", "pkgb/b.go"), "b→a call: {a:?}");
}
