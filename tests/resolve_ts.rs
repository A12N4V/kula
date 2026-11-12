//! End-to-end tests for the TypeScript/JavaScript resolver (module R1).
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

/// A repo exercising every R1 resolution rule. Returns the temp dir.
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    let d = t.path();
    git(d, &["init", "-q", "-b", "main"]);
    git(d, &["config", "user.name", "Tester"]);
    git(d, &["config", "user.email", "t@example.com"]);
    git(d, &["config", "commit.gpgsign", "false"]);

    // Named import.
    write(d, "src/named.ts", "import { alpha } from \"./exports\";\nexport function useNamed() {\n  return alpha();\n}\n");
    write(d, "src/exports.ts", "export function alpha() { return 1; }\nexport function other() { return 2; }\n");

    // Default import: `new Widget()` then a member call on the new expression.
    write(d, "src/widget.ts", "export default class Widget {\n  render() { return 1; }\n}\n");
    write(
        d,
        "src/c.ts",
        "import Widget from \"./widget\";\nexport function make() {\n  const w = new Widget();\n  return w.render();\n}\n",
    );

    // Namespace import.
    write(d, "src/util.ts", "export function helper() { return 3; }\n");
    write(d, "src/ns.ts", "import * as util from \"./util\";\nexport function useNs() {\n  return util.helper();\n}\n");

    // Aliased import.
    write(d, "src/alias.ts", "import { alpha as beta } from \"./exports\";\nexport function useAlias() {\n  return beta();\n}\n");

    // Re-exports + barrel (`export *` and `export {x as y} from`).
    write(d, "src/barrel.ts", "export * from \"./exports\";\nexport { other as renamed } from \"./exports\";\n");
    write(
        d,
        "src/use_barrel.ts",
        "import { alpha, renamed } from \"./barrel\";\nexport function viaBarrel() {\n  return alpha() + renamed();\n}\n",
    );

    // Member call on a typed parameter in the same file.
    write(d, "src/typed.ts", "import { Thing } from \"./thing\";\nexport function useTyped(x: Thing) {\n  return x.doIt();\n}\n");
    write(d, "src/thing.ts", "export class Thing {\n  doIt() { return 1; }\n}\n");

    // tsconfig `baseUrl`/`paths` alias (JSONC: a comment and a trailing comma).
    write(
        d,
        "tsconfig.json",
        "{\n  // alias\n  \"compilerOptions\": {\n    \"baseUrl\": \".\",\n    \"paths\": { \"@lib/*\": [\"lib/*\"], },\n  },\n}\n",
    );
    write(d, "lib/deep.ts", "export function deepFn() { return 4; }\n");
    write(d, "src/use_path.ts", "import { deepFn } from \"@lib/deep\";\nexport function usePathAlias() {\n  return deepFn();\n}\n");

    // Same name in two files, imported under an alias.
    write(d, "src/dup1.ts", "export function dup() { return 1; }\n");
    write(d, "src/dup2.ts", "export function dup() { return 2; }\n");
    write(d, "src/pick.ts", "import { dup as chosen } from \"./dup2\";\nexport function pick() {\n  return chosen();\n}\n");

    // Cyclic barrels: chasing `export *` must terminate and still resolve.
    write(d, "src/cyc_a.ts", "export * from \"./cyc_b\";\nexport function fromA() { return 1; }\n");
    write(d, "src/cyc_b.ts", "export * from \"./cyc_a\";\nexport function fromB() { return 2; }\n");
    write(d, "src/use_cyc.ts", "import { fromB } from \"./cyc_a\";\nexport function useCyc() {\n  return fromB();\n}\n");

    // `this` rule, must stay resolved (regression guard for the moved rule).
    write(d, "src/self.ts", "export class Store {\n  get() { return 1; }\n  put() { return this.get(); }\n}\n");

    git(d, &["add", "-A"]);
    git(d, &["commit", "-qm", "initial"]);
    t
}

fn has(calls: &[(String, String)], name: &str, path: &str) -> bool {
    calls.iter().any(|(n, p)| n == name && p == path)
}

#[test]
fn ts_imports_resolve_exactly() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // Named import → the exported function.
    assert!(has(&resolved_callers(d, "alpha"), "useNamed", "src/named.ts"), "named import");
    // Default import: constructor call resolves to the class.
    assert!(has(&resolved_callers(d, "Widget"), "make", "src/c.ts"), "new-expression class call");
    // Member call on a `new` expression var.
    assert!(has(&resolved_callers(d, "render"), "make", "src/c.ts"), "member on new expression");
    // Member call on a typed parameter in the same file.
    assert!(has(&resolved_callers(d, "doIt"), "useTyped", "src/typed.ts"), "member on typed param");
    // Namespace import → `util.helper()`.
    assert!(has(&resolved_callers(d, "helper"), "useNs", "src/ns.ts"), "namespace import");
    // Aliased import → `beta()` is `alpha`.
    assert!(has(&resolved_callers(d, "alpha"), "useAlias", "src/alias.ts"), "aliased import");
}

#[test]
fn ts_reexports_and_barrels_resolve() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `export * from` chased through the barrel.
    assert!(has(&resolved_callers(d, "alpha"), "viaBarrel", "src/use_barrel.ts"), "barrel re-export");
    // `export { other as renamed } from` – the alias must follow to `other`.
    assert!(has(&resolved_callers(d, "other"), "viaBarrel", "src/use_barrel.ts"), "aliased re-export");
    // Cyclic barrels must terminate and still resolve a name across the cycle.
    assert!(has(&resolved_callers(d, "fromB"), "useCyc", "src/use_cyc.ts"), "cyclic barrel");
}

#[test]
fn ts_tsconfig_paths_alias_resolves() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    // `@lib/*` → `lib/*`, with a JSONC comment and trailing comma present.
    assert!(has(&resolved_callers(d, "deepFn"), "usePathAlias", "src/use_path.ts"), "tsconfig paths alias");
}

#[test]
fn ts_same_name_in_two_files_picks_the_imported_one() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);

    // `pick` calls `dup` imported from ./dup2, not the same-named dup1.
    let d2 = kula_json(d, &["context", "src/dup2.ts:dup"]);
    let callers2: Vec<&str> = d2["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(callers2.contains(&"pick"), "dup2 callers: {callers2:?}");

    let d1 = kula_json(d, &["context", "src/dup1.ts:dup"]);
    let callers1: Vec<&str> = d1["callers"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap()).collect();
    assert!(!callers1.contains(&"pick"), "dup1 must have no callers: {callers1:?}");
}

#[test]
fn ts_this_rule_stays_resolved() {
    let t = fixture();
    let d = t.path();
    kula(d, &["index"]);
    // The moved `this`/`self` rule keeps its exact resolved edge: put → get.
    assert!(has(&resolved_callers(d, "get"), "put", "src/self.ts"), "this/self rule");
}
