//! TypeScript / JavaScript call resolver.
//!
//! Handles named, default and namespace imports, aliased imports
//! (`import {a as b}`), re-exports and barrel files (`export * from`,
//! `export {x} from`) chased to depth 5 with cycle protection, calls on an
//! imported class's members when the receiver is a `new` expression or a typed
//! parameter in the same file, and tsconfig/jsconfig `baseUrl`/`paths` aliases.

use std::collections::{HashMap, HashSet};

use super::{ImportBinding, ImportKind, ResolveCtx, ResolveOut, Resolver};
use crate::index::{normalize, strip_ext, ParsedFile};

/// How deep `export * from` / `export {x} from` chains are chased.
const MAX_REEXPORT_DEPTH: usize = 5;

pub struct Ts;

impl Resolver for Ts {
    fn langs(&self) -> &'static [&'static str] {
        &["javascript", "typescript", "tsx"]
    }

    fn resolve(&self, ctx: &ResolveCtx) -> ResolveOut {
        let mut out = ResolveOut::default();
        let pf = ctx.file;
        let ts = TsPaths::load(ctx);
        for (name, byte) in &pf.calls {
            let byte = *byte;
            // 1. `this`/`self` rule, unchanged: claim only when proven.
            if pf.self_calls.contains(&byte) {
                if let Some(t) = super::self_target(ctx, name, byte) {
                    out.claimed.insert(byte);
                    out.edges.push((byte, t));
                }
                continue;
            }
            let recv = pf.receivers.get(&byte).map(String::as_str);
            // 2. Namespace member call: `NS.fn()`.
            if let Some(r) = recv {
                if let Some(b) = pf.import_bindings.iter().find(|b| b.kind == ImportKind::Namespace && b.local == r) {
                    if let Some(t) = resolve_export(ctx, &b.module, name, &pf.path, &ts, 0, &HashSet::new()) {
                        out.claimed.insert(byte);
                        out.edges.push((byte, t));
                        continue;
                    }
                }
            }
            // 3. Member call on a var of a known class type: `const f = new Foo(); f.bar()`.
            if let Some(r) = recv {
                if let Some(ty) = pf.var_types.get(r) {
                    if let Some(t) = resolve_member(ctx, ty, name) {
                        out.claimed.insert(byte);
                        out.edges.push((byte, t));
                        continue;
                    }
                }
            }
            // 4. Imported name used directly: `fn()` or `new Foo()`.
            if let Some(t) = resolve_imported(ctx, name, &ts) {
                out.claimed.insert(byte);
                out.edges.push((byte, t));
            }
        }
        out
    }
}

/// Resolve a called name against this file's import bindings.
fn resolve_imported(ctx: &ResolveCtx, name: &str, ts: &TsPaths) -> Option<usize> {
    let pf = ctx.file;
    for b in &pf.import_bindings {
        if b.local != name {
            continue;
        }
        match b.kind {
            ImportKind::Named => {
                let exported = b.exported.as_deref().unwrap_or(name);
                if let Some(t) = resolve_export(ctx, &b.module, exported, &pf.path, ts, 0, &HashSet::new()) {
                    return Some(t);
                }
            }
            ImportKind::Default => {
                if let Some(t) = resolve_default(ctx, &b.module, &pf.path, ts) {
                    return Some(t);
                }
            }
            _ => {}
        }
    }
    None
}

/// The default export of the module `spec` imported from `from`.
fn resolve_default(ctx: &ResolveCtx, spec: &str, from: &str, ts: &TsPaths) -> Option<usize> {
    let targets = resolve_module(ctx, spec, from, ts);
    if targets.len() != 1 {
        return None;
    }
    let path = &targets[0];
    let top = ctx.top_level(path);
    let callable: Vec<usize> =
        top.iter().copied().filter(|c| matches!(ctx.nodes[*c].kind.as_str(), "class" | "function" | "method")).collect();
    if callable.len() == 1 {
        Some(callable[0])
    } else {
        None
    }
}

/// Resolve an exported name through a module specifier, chasing barrels.
/// `chain` is the set of modules on the current path (cycle protection); it is
/// extended per path, never accumulated across sibling branches.
fn resolve_export(
    ctx: &ResolveCtx,
    spec: &str,
    exported: &str,
    from: &str,
    ts: &TsPaths,
    depth: usize,
    chain: &HashSet<String>,
) -> Option<usize> {
    if depth > MAX_REEXPORT_DEPTH {
        return None;
    }
    let targets = resolve_module(ctx, spec, from, ts);
    if targets.len() != 1 {
        return None;
    }
    exports_of(ctx, &targets[0], ts, depth, chain).remove(exported)
}

/// All names a file exports (its own top-level defs plus re-exports).
fn exports_of(ctx: &ResolveCtx, path: &str, ts: &TsPaths, depth: usize, chain: &HashSet<String>) -> HashMap<String, usize> {
    let mut out: HashMap<String, usize> = HashMap::new();
    let mut chain = chain.clone();
    if depth > MAX_REEXPORT_DEPTH || !chain.insert(path.to_string()) {
        return out;
    }
    for c in ctx.top_level(path) {
        out.insert(ctx.nodes[c].name.clone(), c);
    }
    let Some(src) = (ctx.read)(path) else { return out };
    for b in file_reexports(&src) {
        if b.local == "*" {
            if let Some(t) = resolve_module(ctx, &b.module, path, ts).first() {
                for (k, v) in exports_of(ctx, t, ts, depth + 1, &chain) {
                    out.entry(k).or_insert(v);
                }
            }
        } else if let Some(t) = resolve_export(ctx, &b.module, b.exported.as_deref().unwrap_or(&b.local), path, ts, depth + 1, &chain) {
            out.insert(b.local.clone(), t);
        }
    }
    out
}

/// A method `name` on the class `ty` (in this file or an imported one).
fn resolve_member(ctx: &ResolveCtx, ty: &str, name: &str) -> Option<usize> {
    let pf = ctx.file;
    let mut classes: Vec<usize> = ctx
        .by_name
        .get(ty)
        .into_iter()
        .flatten()
        .copied()
        .filter(|c| matches!(ctx.nodes[*c].kind.as_str(), "class" | "interface"))
        .collect();
    if let Some(b) = pf.import_bindings.iter().find(|b| b.local == ty) {
        let ts = TsPaths::load(ctx);
        if let Some(id) = resolve_export(ctx, &b.module, b.exported.as_deref().unwrap_or(ty), &pf.path, &ts, 0, &HashSet::new()) {
            classes.push(id);
        }
    }
    let mut hits: Vec<usize> = Vec::new();
    for cls in classes {
        hits.extend(ctx.by_name.get(name).into_iter().flatten().copied().filter(|c| ctx.nodes[*c].parent == Some(cls as i64)));
    }
    hits.sort_unstable();
    hits.dedup();
    if hits.len() == 1 {
        Some(hits[0])
    } else {
        None
    }
}

/// Resolve a module specifier to the indexed files it names.
fn resolve_module(ctx: &ResolveCtx, spec: &str, from: &str, ts: &TsPaths) -> Vec<String> {
    let s = spec.trim().trim_matches(|c| c == '"' || c == '\'' || c == '`');
    if s.is_empty() {
        return vec![];
    }
    let dir = from.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let lookup = |key: String| -> Vec<String> {
        let mut ids = ctx.by_stem.get(&key).cloned().unwrap_or_default();
        if ids.is_empty() {
            ids = ctx.by_stem.get(&format!("{key}/index")).cloned().unwrap_or_default();
        }
        let mut paths: Vec<String> = ids.iter().filter_map(|i| ctx.nodes.get(*i).map(|n| n.path.clone())).collect();
        paths.sort();
        paths.dedup();
        paths
    };
    if s.starts_with('.') {
        return lookup(strip_ext(&normalize(&format!("{dir}/{s}"))).to_string());
    }
    // Non-relative: try tsconfig/jsconfig `paths` then `baseUrl`.
    if let Some(hit) = ts.lookup(s) {
        let paths = lookup(strip_ext(&normalize(&hit)).to_string());
        if !paths.is_empty() {
            return paths;
        }
    }
    vec![]
}

/// tsconfig/jsconfig `baseUrl` + `paths` aliases.
struct TsPaths {
    base_url: Option<String>,
    paths: Vec<(String, Vec<String>)>,
}

impl TsPaths {
    fn load(ctx: &ResolveCtx) -> TsPaths {
        for f in ["tsconfig.json", "jsconfig.json"] {
            if let Some(src) = (ctx.read)(f) {
                if let Some(v) = parse_jsonc(&src) {
                    let co = &v["compilerOptions"];
                    let base_url = co["baseUrl"].as_str().map(|s| s.to_string());
                    let mut paths = Vec::new();
                    if let Some(map) = co["paths"].as_object() {
                        for (k, val) in map {
                            let vals: Vec<String> =
                                val.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                            if !vals.is_empty() {
                                paths.push((k.clone(), vals));
                            }
                        }
                    }
                    return TsPaths { base_url, paths };
                }
            }
        }
        TsPaths { base_url: None, paths: Vec::new() }
    }

    /// Map a non-relative specifier to a repo path candidate.
    fn lookup(&self, spec: &str) -> Option<String> {
        for (pat, targets) in &self.paths {
            if let Some(cap) = match_pattern(pat, spec) {
                if let Some(t) = targets.first() {
                    let filled = t.replace('*', &cap);
                    let joined = match &self.base_url {
                        Some(b) if !b.is_empty() => format!("{b}/{filled}"),
                        _ => filled,
                    };
                    return Some(joined);
                }
            }
        }
        self.base_url.as_ref().filter(|b| !b.is_empty()).map(|b| format!("{b}/{spec}"))
    }
}

/// Match a tsconfig `paths` key (which may contain one `*`) against a specifier.
fn match_pattern(pat: &str, spec: &str) -> Option<String> {
    match pat.find('*') {
        Some(star) => {
            let pre = &pat[..star];
            let post = &pat[star + 1..];
            if spec.len() >= pre.len() + post.len() && spec.starts_with(pre) && spec.ends_with(post) {
                Some(spec[pre.len()..spec.len() - post.len()].to_string())
            } else {
                None
            }
        }
        None if pat == spec => Some(String::new()),
        None => None,
    }
}

/// Strip `//` and `/* */` comments and trailing commas, then parse.
fn parse_jsonc(src: &str) -> Option<serde_json::Value> {
    serde_json::from_str(&strip_jsonc(src)).ok()
}

fn strip_jsonc(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    let mut quote = ' ';
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == quote {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            in_str = true;
            quote = c;
            out.push(c);
            i += 1;
            continue;
        }
        if c == '/' && i + 1 < b.len() && b[i + 1] == '/' {
            while i < b.len() && b[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < b.len() && b[i + 1] == '*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        out.push(c);
        i += 1;
    }
    // Drop a trailing comma: a `,` followed only by whitespace and then `}`/`]`.
    // The naive `,}`/`,]` replace missed `,\n}` and `, ]`, so tsconfigs with
    // pretty-printed trailing commas failed to parse.
    let b: Vec<char> = out.chars().collect();
    let mut cleaned = String::with_capacity(out.len());
    let mut i = 0;
    let mut in_str = false;
    let mut quote = ' ';
    while i < b.len() {
        let c = b[i];
        if in_str {
            cleaned.push(c);
            if c == '\\' && i + 1 < b.len() {
                cleaned.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == quote {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == '"' || c == '\'' {
            in_str = true;
            quote = c;
            cleaned.push(c);
            i += 1;
            continue;
        }
        if c == ',' {
            let mut j = i + 1;
            while j < b.len() && b[j].is_whitespace() {
                j += 1;
            }
            if j < b.len() && (b[j] == '}' || b[j] == ']') {
                i += 1;
                continue;
            }
        }
        cleaned.push(c);
        i += 1;
    }
    cleaned
}

// ---------------------------------------------------------------------------
// Parse-time extraction. Called from `index::parse_source` for js-family files
// so the resolver can see bindings, receivers and local variable types.
// ---------------------------------------------------------------------------

/// Fill `import_bindings`, `receivers` and `var_types` from the file's tree.
pub fn scan(tree: &tree_sitter::Tree, src: &str, pf: &mut ParsedFile) {
    let bytes = src.as_bytes();
    let mut stack = vec![tree.root_node()];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "import_statement" | "export_statement" => {
                if let Ok(text) = n.utf8_text(bytes) {
                    parse_stmt(text, pf);
                }
            }
            "variable_declarator" | "required_parameter" | "optional_parameter" => {
                if let Ok(text) = n.utf8_text(bytes) {
                    parse_var(text, pf);
                }
            }
            _ => {}
        }
        let mut c = n.walk();
        for ch in n.named_children(&mut c) {
            stack.push(ch);
        }
    }
}

/// Re-export bindings in a file, from source text alone (no parser).
fn file_reexports(src: &str) -> Vec<ImportBinding> {
    let mut pf = ParsedFile::default();
    for line in src.lines() {
        let t = line.trim();
        if t.starts_with("export") {
            parse_stmt(t, &mut pf);
        }
    }
    pf.import_bindings.into_iter().filter(|b| b.kind == ImportKind::Reexport).collect()
}

fn parse_stmt(text: &str, pf: &mut ParsedFile) {
    let t = text.trim().trim_end_matches(';').trim();
    if let Some(rest) = t.strip_prefix("import") {
        let rest = rest.trim_start();
        if rest.starts_with('"') || rest.starts_with('\'') {
            return; // side-effect import
        }
        let Some(module) = module_of(t) else { return };
        let Some((clause, _)) = rest.split_once(" from ") else { return };
        add_import_clause(clause.trim(), &module, pf);
    } else if let Some(rest) = t.strip_prefix("export") {
        let rest = rest.trim_start();
        let Some(module) = module_of(t) else { return };
        if rest.starts_with('*') {
            pf.import_bindings.push(ImportBinding { local: "*".into(), module, exported: None, kind: ImportKind::Reexport });
        } else if let Some(inner) = rest.strip_prefix('{') {
            let inner = inner.split('}').next().unwrap_or("");
            push_reexports(inner, &module, pf);
        }
    }
}

fn add_import_clause(clause: &str, module: &str, pf: &mut ParsedFile) {
    let clause = clause.strip_prefix("type ").unwrap_or(clause).trim();
    if let Some(open) = clause.find('{') {
        let def_part = clause[..open].trim().trim_end_matches(',').trim();
        if !def_part.is_empty() {
            pf.import_bindings.push(ImportBinding {
                local: def_part.to_string(),
                module: module.to_string(),
                exported: None,
                kind: ImportKind::Default,
            });
        }
        let inner = clause[open + 1..].split('}').next().unwrap_or("");
        push_named(inner, module, pf);
        return;
    }
    if let Some(ns) = clause.strip_prefix("* as ") {
        pf.import_bindings.push(ImportBinding {
            local: ns.trim().to_string(),
            module: module.to_string(),
            exported: None,
            kind: ImportKind::Namespace,
        });
        return;
    }
    if clause.is_empty() {
        return;
    }
    pf.import_bindings.push(ImportBinding {
        local: clause.to_string(),
        module: module.to_string(),
        exported: None,
        kind: ImportKind::Default,
    });
}

fn push_named(inner: &str, module: &str, pf: &mut ParsedFile) {
    for item in inner.split(',') {
        let item = item.trim();
        if item.is_empty() {
            continue;
        }
        let (exported, local) = split_as(item);
        pf.import_bindings.push(ImportBinding { local, module: module.to_string(), exported: Some(exported), kind: ImportKind::Named });
    }
}

fn push_reexports(inner: &str, module: &str, pf: &mut ParsedFile) {
    for item in inner.split(',') {
        let item = item.trim();
        if item.is_empty() {
            continue;
        }
        let (exported, local) = split_as(item);
        pf.import_bindings.push(ImportBinding { local, module: module.to_string(), exported: Some(exported), kind: ImportKind::Reexport });
    }
}

fn split_as(item: &str) -> (String, String) {
    match item.split_once(" as ") {
        Some((a, b)) => (a.trim().to_string(), b.trim().to_string()),
        None => (item.to_string(), item.to_string()),
    }
}

/// The module specifier: the last quoted string in the statement.
fn module_of(text: &str) -> Option<String> {
    let mut last: Option<String> = None;
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' || c == '`' {
            let mut j = i + 1;
            let mut buf = String::new();
            while j < chars.len() && chars[j] != c {
                buf.push(chars[j]);
                j += 1;
            }
            if j < chars.len() {
                last = Some(buf);
                i = j + 1;
                continue;
            }
            break;
        }
        i += 1;
    }
    last
}

/// Record `name → Type` for `const f = new Foo()` and `f: Foo` declarations.
fn parse_var(text: &str, pf: &mut ParsedFile) {
    let t = text.trim();
    let name: String = t.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect();
    if name.is_empty() {
        return;
    }
    let head = t.split('=').next().unwrap_or(t);
    let mut ty = head
        .split_once(':')
        .map(|(_, after)| {
            after.trim().chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.' || *c == '$').collect::<String>()
        })
        .filter(|s| !s.is_empty());
    if ty.is_none() {
        let rhs = t.split_once('=').map(|(_, r)| r.trim()).unwrap_or("");
        if let Some(r) = rhs.strip_prefix("new ") {
            let n: String = r.trim().chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.' || *c == '$').collect();
            if !n.is_empty() {
                ty = Some(n);
            }
        }
    }
    if let Some(ty) = ty {
        pf.var_types.insert(name, ty);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings(src: &str) -> Vec<ImportBinding> {
        let mut pf = ParsedFile::default();
        for line in src.lines() {
            let t = line.trim();
            if t.starts_with("import") || t.starts_with("export") {
                parse_stmt(t, &mut pf);
            }
        }
        pf.import_bindings
    }

    fn find<'a>(bs: &'a [ImportBinding], local: &str, kind: ImportKind) -> &'a ImportBinding {
        bs.iter().find(|b| b.local == local && b.kind == kind).unwrap_or_else(|| panic!("no {kind:?} binding {local} in {bs:?}"))
    }

    #[test]
    fn named_and_aliased_imports() {
        let b = bindings("import { alpha, beta as gamma } from \"./m\";");
        assert_eq!(find(&b, "alpha", ImportKind::Named).exported.as_deref(), Some("alpha"));
        let g = find(&b, "gamma", ImportKind::Named);
        assert_eq!(g.exported.as_deref(), Some("beta"));
        assert_eq!(g.module, "./m");
    }

    #[test]
    fn default_namespace_and_mixed_imports() {
        let b = bindings("import Def from \"./d\";\nimport * as NS from \"./n\";\nimport Widget, { x } from \"./w\";");
        assert_eq!(find(&b, "Def", ImportKind::Default).module, "./d");
        assert_eq!(find(&b, "NS", ImportKind::Namespace).module, "./n");
        assert_eq!(find(&b, "Widget", ImportKind::Default).module, "./w");
        assert_eq!(find(&b, "x", ImportKind::Named).module, "./w");
    }

    #[test]
    fn reexports_and_barrels() {
        let b = bindings("export * from \"./all\";\nexport { other as renamed } from \"./x\";");
        assert_eq!(find(&b, "*", ImportKind::Reexport).module, "./all");
        let r = find(&b, "renamed", ImportKind::Reexport);
        assert_eq!(r.exported.as_deref(), Some("other"));
        assert_eq!(r.module, "./x");
    }

    #[test]
    fn var_types_from_new_and_annotation() {
        // `parse_var` receives the declarator text, e.g. `w = new Widget()`.
        let mut pf = ParsedFile::default();
        parse_var("w = new Widget()", &mut pf);
        assert_eq!(pf.var_types.get("w").map(String::as_str), Some("Widget"));
        parse_var("x: Thing", &mut pf);
        assert_eq!(pf.var_types.get("x").map(String::as_str), Some("Thing"));
    }

    #[test]
    fn tsconfig_paths_and_baseurl() {
        let src = "{\n  // c\n  \"compilerOptions\": { \"baseUrl\": \"src\", \"paths\": { \"@lib/*\": [\"lib/*\"], }, },\n}";
        let v = parse_jsonc(src).expect("jsonc parses");
        let co = &v["compilerOptions"];
        let ts = TsPaths { base_url: co["baseUrl"].as_str().map(String::from), paths: vec![("@lib/*".into(), vec!["lib/*".into()])] };
        assert_eq!(ts.lookup("@lib/deep").as_deref(), Some("src/lib/deep"));
        assert_eq!(ts.lookup("plain").as_deref(), Some("src/plain"));
    }

    #[test]
    fn match_pattern_single_star() {
        assert_eq!(match_pattern("@lib/*", "@lib/deep"), Some("deep".into()));
        assert_eq!(match_pattern("@lib/*", "@lib/a/b"), Some("a/b".into()));
        assert_eq!(match_pattern("exact", "exact"), Some(String::new()));
        assert_eq!(match_pattern("@lib/*", "other/deep"), None);
    }

    #[test]
    fn strip_jsonc_tolerates_comments_and_trailing_commas() {
        // Trailing commas with only whitespace before the bracket (`,\n}` and `, ]`).
        let s = strip_jsonc("{\n  // x\n  \"a\": [1, 2, ],\n  \"b\": { \"c\": 1,\n  },\n}");
        assert!(serde_json::from_str::<serde_json::Value>(&s).is_ok(), "{s}");
        // A comma inside a string is never a trailing comma.
        let s = strip_jsonc("{\"a\": \"x,}\"}");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&s).unwrap()["a"], "x,}");
    }

    #[test]
    fn module_of_takes_the_last_quoted_string() {
        assert_eq!(module_of("import { a } from \"./m\"").as_deref(), Some("./m"));
        assert_eq!(module_of("export * from './x'").as_deref(), Some("./x"));
        assert_eq!(module_of("export function f() { return \"not a module\"; }"), Some("not a module".into()));
    }

    #[test]
    fn side_effect_and_value_exports_add_nothing() {
        assert!(bindings("import \"./side-effect\";").is_empty());
        assert!(bindings("export function fn() { return 1; }").is_empty());
        assert!(bindings("export class C {}").is_empty());
    }
}
