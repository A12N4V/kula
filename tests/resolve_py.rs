//! End-to-end tests for the Python resolver (module R2).
//!
//! Each test builds a small repo, runs the real `kula` binary and reads the
//! graph back through `impact` / `context` (`--json`), asserting the exact
//! `resolved` call target, so a name-linker guess cannot pass by accident.

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

/// Resolved-tier callers of `target`, as (name, path).
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

/// A repo exercising every R2 resolution rule. Returns the temp dir.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);

    write(d, "pkg/__init__.py", "from .core import helper\n\n__all__ = [\"helper\"]\n");
    write(d, "pkg/core.py", "def helper(x):\n    return x\n");
    write(
        d,
        "pkg/api.py",
        "from .core import helper\nfrom . import core\n\n\ndef via_relative(v):\n    return helper(v)\n\n\ndef via_module(v):\n    return core.helper(v)\n",
    );
    write(d, "pkg/sub/__init__.py", "");
    write(d, "pkg/sub/deep.py", "from ..core import helper\n\n\ndef deep(v):\n    return helper(v)\n");
    write(d, "alias.py", "import pkg.core as pc\n\n\ndef through_alias(v):\n    return pc.helper(v)\n");
    write(d, "reexport.py", "from pkg import helper\n\n\ndef through_barrel(v):\n    return helper(v)\n");
    write(d, "dup_a.py", "def shared():\n    return 1\n");
    write(d, "dup_b.py", "def shared():\n    return 2\n");
    write(d, "dup_user.py", "from dup_b import shared\n\n\ndef pick_b():\n    return shared()\n");
    write(
        d,
        "classes.py",
        "class Base:\n    def greet(self):\n        return \"hi\"\n\n    def run(self):\n        return self.greet()\n\n\nclass Child(Base):\n    def shout(self):\n        return self.greet()\n\n\nclass Item:\n    def use(self):\n        return 1\n\n\nclass Builder:\n    def make(self):\n        return Item()\n\n    @classmethod\n    def build(cls):\n        return cls.make()\n\n\ndef build_item():\n    item = Item()\n    return item.use()\n",
    );
    // A typed local must not leak from one function into another.
    write(
        d,
        "scoped.py",
        "class Widget:\n    def draw(self):\n        return 1\n\n\ndef make_widget():\n    w = Widget()\n    return w\n\n\ndef draw_other():\n    w = 0\n    return w.draw()\n",
    );
    // Two classes of the same name: an unimported base is ambiguous.
    write(d, "ax.py", "class Amb:\n    def paint_a(self):\n        return 1\n");
    write(d, "bx.py", "class Amb:\n    def paint_b(self):\n        return 2\n");
    write(d, "amb.py", "class Child2(Amb):\n    def splash(self):\n        return self.paint_a()\n");
    write(d, "cyc/__init__.py", "from .a import *\n");
    write(d, "cyc/a.py", "from .b import *\n\n\ndef from_a():\n    return 1\n");
    write(d, "cyc/b.py", "from .a import *\n\n\ndef from_b():\n    return from_a()\n");
    write(d, "cyc_user.py", "from cyc import from_b\n\n\ndef use_cycle():\n    return from_b()\n");
    write(d, "cyc_user2.py", "from cyc import from_a\n\n\ndef use_cycle_two():\n    return from_a()\n");

    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "fixture"]);
    t
}

#[test]
fn py_module_alias_and_imported_names_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `import pkg.core as pc; pc.helper()`.
    assert!(has(&resolved_callers(d, "helper"), "through_alias", "alias.py"), "module alias");
    // `from pkg import helper` chased through pkg/__init__.py's re-export.
    assert!(has(&resolved_callers(d, "helper"), "through_barrel", "reexport.py"), "init re-export");
}

#[test]
fn py_relative_imports_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    assert!(has(&resolved_callers(d, "helper"), "via_relative", "pkg/api.py"), "from .core import helper");
    // `from . import core` binds the submodule, so `core.helper()` follows.
    assert!(has(&resolved_callers(d, "helper"), "via_module", "pkg/api.py"), "from . import core");
    // `..` climbs from pkg/sub to pkg.
    assert!(has(&resolved_callers(d, "helper"), "deep", "pkg/sub/deep.py"), "parent relative import");
}

#[test]
fn py_barrels_and_cycles_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // cyc/__init__ star-reexports a, a star-reexports b, b defines from_b.
    assert!(has(&resolved_callers(d, "from_b"), "use_cycle", "cyc_user.py"), "star barrel across a cycle");
    assert!(has(&resolved_callers(d, "from_a"), "use_cycle_two", "cyc_user2.py"), "star barrel, direct name");
}

#[test]
fn py_self_inherited_method_resolves_to_base() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `self.greet()` in a subclass resolves to the base class method.
    assert!(has(&resolved_callers(d, "greet"), "shout", "classes.py"), "inherited self method");
    // And the plain same-class rule still holds.
    assert!(has(&resolved_callers(d, "greet"), "run", "classes.py"), "self method");
}

#[test]
fn py_classmethod_and_local_instance_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `cls.make()` inside a classmethod.
    assert!(has(&resolved_callers(d, "make"), "build", "classes.py"), "cls.method()");
    // `item = Item(); item.use()` in one function body.
    assert!(has(&resolved_callers(d, "use"), "build_item", "classes.py"), "instantiate then call");
}

#[test]
fn py_local_type_does_not_cross_functions() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `w = 0; w.draw()` in draw_other is not the Widget from make_widget.
    let callers = resolved_callers(d, "draw");
    assert!(!has(&callers, "draw_other", "scoped.py"), "cross-function flow leaked: {callers:?}");
}

#[test]
fn py_same_name_in_two_files_picks_the_imported_one() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    let d2 = kula_json(d, &["context", "dup_b.py:shared"]);
    let callers2: Vec<&str> = d2["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(callers2.contains(&"pick_b"), "dup_b callers: {callers2:?}");

    let d1 = kula_json(d, &["context", "dup_a.py:shared"]);
    let callers1: Vec<&str> = d1["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(!callers1.contains(&"pick_b"), "dup_a must have no callers: {callers1:?}");
}

#[test]
fn py_ambiguous_base_does_not_force_resolved() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `Amb` exists twice and amb.py imports neither: the resolver must emit
    // nothing, so the call stays below the resolved tier.
    let callers = resolved_callers(d, "paint_a");
    assert!(!has(&callers, "splash", "amb.py"), "ambiguous base forced resolved: {callers:?}");
}
