//! End-to-end tests for the Rust resolver (module R3).
//!
//! Each test builds a small crate, runs the real `kula` binary and reads the
//! graph back through `impact` / `context` (`--json`), asserting the exact
//! `resolved` call target *file*, so a name linker guess cannot pass.

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

/// Resolved-tier callers of `target` (`path:name`, or a bare name when that
/// name is unique in the crate), as (name, path).
fn resolved_callers(dir: &Path, target: &str) -> Vec<(String, String)> {
    let imp = kula_json(dir, &["impact", target, "--depth", "8", "--min-confidence", "resolved"]);
    imp["hits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| (h["node"]["name"].as_str().unwrap_or("").to_string(), h["node"]["path"].as_str().unwrap_or("").to_string()))
        .collect()
}

fn has(calls: &[(String, String)], name: &str, path: &str) -> bool {
    calls.iter().any(|(n, p)| n == name && p == path)
}

/// One crate exercising every R3 resolution rule, plus the negative cases.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);

    write(
        d,
        "lib.rs",
        r#"
mod b;
mod deep;
mod m1;
mod m2;
mod shapes;
mod wheel;

#[path = "alt/bridge.rs"]
mod bridge;

use crate::shapes::{render::{draw, paint as brush}, Circle};
use crate::wheel::Wheel;
use self::b::pad;
use crate::shapes::widgets::*;
use crate::m1::*;
use crate::m2::*;
use crate::deep::inner::{self};

pub fn entry() {
    draw();
    brush();
    pad("x");
    gadget();
}

pub fn use_bridge() -> u32 {
    bridge::bridged()
}

pub fn path_call() {
    crate::shapes::render::draw();
}

pub fn make_circle() -> f64 {
    let c = Circle::new(2.0);
    c.area()
}

pub fn make_wheel() -> u32 {
    let w = Wheel::new();
    w.spin()
}

pub fn pick_shared() -> u32 {
    crate::m2::shared()
}

pub fn pick_glob() -> u32 {
    dup_fn()
}

pub fn via_deep() -> u32 {
    deep::outer()
}

pub fn via_self_import() -> u32 {
    inner::leaf()
}

pub fn from_deep() -> usize {
    deep::via_super()
}

pub fn first() -> f64 {
    let k = Circle::new(1.0);
    k.area()
}

pub fn second() -> f64 {
    let k = Wheel::new();
    k.area()
}

mod inline_mod {
    pub fn inside() -> u32 {
        1
    }
}

pub fn use_inline() -> u32 {
    inline_mod::inside()
}
"#,
    );
    write(d, "b.rs", "pub fn pad(s: &str) -> usize {\n    s.len()\n}\n");
    write(
        d,
        "shapes.rs",
        r#"
pub mod render {
    pub fn draw() {}
    pub fn paint() {}
}

pub mod widgets {
    pub fn gadget() -> u32 {
        1
    }
}

pub struct Circle {
    r: f64,
}

impl Circle {
    pub fn new(r: f64) -> Self {
        Circle { r }
    }

    pub fn area(&self) -> f64 {
        3.0 * self.r * self.r
    }
}
"#,
    );
    // The impl body comes first so `path:name` lookups land on it, not on the
    // trait signature above it.
    write(
        d,
        "wheel.rs",
        r#"
pub struct Wheel;

impl Wheel {
    pub fn new() -> Self {
        Wheel
    }
}

impl Spin for Wheel {
    fn spin(&self) -> u32 {
        1
    }
}

pub trait Spin {
    fn spin(&self) -> u32;
}
"#,
    );
    write(d, "alt/bridge.rs", "pub fn bridged() -> u32 {\n    1\n}\n");
    write(
        d,
        "deep/mod.rs",
        "mod inner;\n\nuse super::b::pad;\n\npub fn outer() -> u32 {\n    inner::leaf()\n}\n\npub fn via_super() -> usize {\n    pad(\"x\").len()\n}\n",
    );
    write(d, "deep/inner.rs", "pub fn leaf() -> u32 {\n    1\n}\n");
    write(d, "m1.rs", "pub fn shared() -> u32 {\n    1\n}\n\npub fn dup_fn() -> u32 {\n    1\n}\n");
    write(d, "m2.rs", "pub fn shared() -> u32 {\n    2\n}\n\npub fn dup_fn() -> u32 {\n    2\n}\n");

    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "fixture"]);
    t
}

#[test]
fn rs_use_trees_resolve_nested_groups_renames_and_self() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `use crate::shapes::{render::{draw, ..}, ..}` – a nested use group.
    assert!(has(&resolved_callers(d, "shapes.rs:draw"), "entry", "lib.rs"), "nested use group");
    // `paint as brush`: the call name and the target name differ on purpose.
    assert!(has(&resolved_callers(d, "shapes.rs:paint"), "entry", "lib.rs"), "renamed import");
    // `use self::b::pad`.
    assert!(has(&resolved_callers(d, "b.rs:pad"), "entry", "lib.rs"), "self:: import");
}

#[test]
fn rs_unique_glob_resolves_ambiguous_glob_does_not() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `use crate::shapes::widgets::*` matches exactly one `gadget`.
    assert!(has(&resolved_callers(d, "shapes.rs:gadget"), "entry", "lib.rs"), "unique glob match");
    // `use crate::m1::*` and `use crate::m2::*` both provide `dup_fn`, so no
    // exact edge may be emitted for either of them.
    for file in ["m1.rs", "m2.rs"] {
        let callers = resolved_callers(d, &format!("{file}:dup_fn"));
        assert!(callers.is_empty(), "ambiguous glob claimed into {file}: {callers:?}");
    }
}

#[test]
fn rs_mod_paths_and_path_attribute_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `mod deep;` → deep/mod.rs, and `mod inner;` → deep/inner.rs below it.
    assert!(has(&resolved_callers(d, "deep/mod.rs:outer"), "via_deep", "lib.rs"), "mod path");
    assert!(has(&resolved_callers(d, "deep/inner.rs:leaf"), "outer", "deep/mod.rs"), "nested mod file");
    // `#[path = "alt/bridge.rs"] mod bridge;` – a path no by_stem lookup finds.
    assert!(has(&resolved_callers(d, "alt/bridge.rs:bridged"), "use_bridge", "lib.rs"), "#[path] module");
    // `use crate::deep::inner::{self};` binds the module, so `inner::leaf()`
    // walks the path from that binding.
    let leaf = resolved_callers(d, "deep/inner.rs:leaf");
    assert!(has(&leaf, "via_self_import", "lib.rs"), "module binding from a use tree: {leaf:?}");
    // `use super::b::pad;` in a submodule.
    let pad = resolved_callers(d, "b.rs:pad");
    assert!(has(&pad, "from_deep", "lib.rs"), "deep:: path");
    assert!(has(&pad, "via_super", "deep/mod.rs"), "super:: import: {pad:?}");
    // An inline `mod x { .. }` has no file: the byte stays with the name linker.
    let inline = resolved_callers(d, "inside");
    assert!(!has(&inline, "use_inline", "lib.rs"), "inline mod forced exact: {inline:?}");
}

#[test]
fn rs_path_calls_pick_the_right_module() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `crate::shapes::render::draw()` – an inline module inside a file module.
    assert!(has(&resolved_callers(d, "shapes.rs:draw"), "path_call", "lib.rs"), "crate:: path call");
    // Two modules define `shared`; the path must pick m2.
    assert!(has(&resolved_callers(d, "m2.rs:shared"), "pick_shared", "lib.rs"), "same name in two modules");
    let wrong = resolved_callers(d, "m1.rs:shared");
    assert!(!has(&wrong, "pick_shared", "lib.rs"), "m1 wrongly exact: {wrong:?}");
}

#[test]
fn rs_associated_functions_and_local_receivers_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `Circle::new(..)` and `Wheel::new()`: `new` is a COMMON name the name
    // linker skips, so a caller here proves the resolver emitted the edge.
    assert!(has(&resolved_callers(d, "shapes.rs:new"), "make_circle", "lib.rs"), "Type::new()");
    assert!(has(&resolved_callers(d, "wheel.rs:new"), "make_wheel", "lib.rs"), "cross-file Type::new()");
    // `let c = Circle::new(..); c.area()` in the same function body.
    assert!(has(&resolved_callers(d, "shapes.rs:area"), "make_circle", "lib.rs"), "typed local method");
}

#[test]
fn rs_trait_impl_method_resolves_once_to_the_impl() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `let w = Wheel::new(); w.spin()` – an impl block and a trait signature
    // share the name; only the impl body may be the target, exactly once.
    let callers = resolved_callers(d, "wheel.rs:spin");
    assert_eq!(callers, vec![("make_wheel".to_string(), "lib.rs".to_string())], "trait method fan-out");
}

#[test]
fn rs_local_type_does_not_leak_between_functions() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `k` is bound twice in the file (Circle, then Wheel): neither call site is
    // proven, so `area` must not gain `first` or `second` as exact callers.
    let callers = resolved_callers(d, "shapes.rs:area");
    assert!(!has(&callers, "first", "lib.rs"), "reassigned local leaked: {callers:?}");
    assert!(callers.iter().all(|(n, _)| n != "second"), "reassigned local leaked: {callers:?}");
}
