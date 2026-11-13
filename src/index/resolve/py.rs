//! Python call resolver.
//!
//! Handles `import a.b as c` (module aliases), `from a import b` (named and
//! aliased), relative imports (`.` / `..` against the file's package
//! directory), `__init__.py` re-export chasing to depth 5 with chain-scoped
//! cycle protection, calls through a module alias (`c.fn()`), `self.method()`
//! and `cls.method()` including inherited methods whose base class is in-repo,
//! and `x = Klass()` followed by `x.m()` in the same function body.
//!
//! The resolver only emits edges it has proven: a module specifier must name
//! exactly one indexed file, a name must map to exactly one definition, and a
//! base class must be unique in the repo. Anything ambiguous falls through to
//! the name linker untouched.

use std::collections::{HashMap, HashSet};

use super::{ImportBinding, ImportKind, ResolveCtx, ResolveOut, Resolver};
use crate::index::{normalize, ParsedFile};

/// How deep `__init__.py` / module re-export chains are chased.
const MAX_REEXPORT_DEPTH: usize = 5;

/// Separator inside `ParsedFile::var_types` values: `"Type\u{1f}scope_start"`.
/// The scope is the byte offset of the enclosing function (0 at module level),
/// so a typed local only resolves member calls in the function that binds it.
const SCOPE_SEP: char = '\u{1f}';

pub struct Py;

impl Resolver for Py {
    fn langs(&self) -> &'static [&'static str] {
        &["python"]
    }

    fn resolve(&self, ctx: &ResolveCtx) -> ResolveOut {
        let mut out = ResolveOut::default();
        let pf = ctx.file;
        let mut bases: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
        for (name, byte) in &pf.calls {
            let byte = *byte;
            // 1. `self.method()`, including a method inherited from an in-repo base.
            if pf.self_calls.contains(&byte) {
                let hit = super::self_target(ctx, name, byte).or_else(|| {
                    let owner = enclosing_class(pf, byte)?;
                    lookup_member(ctx, &owner, name, &pf.path, &mut bases, 0, &mut HashSet::new())
                });
                if let Some(t) = hit {
                    out.claimed.insert(byte);
                    out.edges.push((byte, t));
                }
                continue;
            }
            let Some(recv) = pf.receivers.get(&byte) else {
                // 2. A directly imported name: `from a import b; b()`.
                if let Some(t) = resolve_imported(ctx, name) {
                    out.claimed.insert(byte);
                    out.edges.push((byte, t));
                }
                continue;
            };
            let hit = if recv == "cls" {
                // 3. `cls.method()` inside a classmethod: the enclosing class.
                enclosing_class(pf, byte).and_then(|owner| lookup_member(ctx, &owner, name, &pf.path, &mut bases, 0, &mut HashSet::new()))
            } else if let Some(t) = module_member(ctx, recv, name) {
                // 4. A call through a module alias: `import a.b as c; c.fn()`.
                Some(t)
            } else if let Some(raw) = pf.var_types.get(recv) {
                // 5. `x = Klass(); x.m()` in the same function body.
                typed_member(ctx, pf, raw, byte, name, &mut bases)
            } else {
                // 6. A class used directly: `Klass.method(...)`.
                lookup_member(ctx, recv, name, &pf.path, &mut bases, 0, &mut HashSet::new())
            };
            if let Some(t) = hit {
                out.claimed.insert(byte);
                out.edges.push((byte, t));
            }
        }
        out
    }
}

/// `x.m()` where `x` was bound by a single `x = Klass()` in the same function.
fn typed_member(
    ctx: &ResolveCtx,
    pf: &ParsedFile,
    raw: &str,
    byte: usize,
    name: &str,
    bases: &mut HashMap<String, HashMap<String, Vec<String>>>,
) -> Option<usize> {
    let (ty, scope) = raw.split_once(SCOPE_SEP)?;
    let scope: usize = scope.parse().ok()?;
    let here = enclosing_function(pf, byte).unwrap_or(0);
    if scope != here {
        return None;
    }
    lookup_member(ctx, ty, name, &pf.path, bases, 0, &mut HashSet::new())
}

/// The innermost def enclosing `byte` that is a member of a class.
fn enclosing_class(pf: &ParsedFile, byte: usize) -> Option<String> {
    pf.defs
        .iter()
        .filter(|d| d.start_byte <= byte && byte < d.end_byte)
        .min_by_key(|d| d.end_byte - d.start_byte)
        .and_then(|d| d.parent_name.clone())
}

/// The start byte of the innermost function body enclosing `byte`; `None` at
/// module level. Used to keep `x = Klass()` bindings function-local.
fn enclosing_function(pf: &ParsedFile, byte: usize) -> Option<usize> {
    pf.defs
        .iter()
        .filter(|d| d.start_byte <= byte && byte < d.end_byte && matches!(d.kind, "function" | "method"))
        .min_by_key(|d| d.end_byte - d.start_byte)
        .map(|d| d.start_byte)
}

/// A directly called name bound by an import in this file.
fn resolve_imported(ctx: &ResolveCtx, name: &str) -> Option<usize> {
    let pf = ctx.file;
    for b in pf.import_bindings.iter().filter(|b| b.kind == ImportKind::Named && b.local == name) {
        let exported = b.exported.as_deref().unwrap_or(name);
        // `from pkg import helper` – the name may be a function in `pkg` (or its
        // `__init__.py`) or a submodule, so try both.
        for spec in [join_module(&b.module, exported), b.module.clone()] {
            let targets = resolve_module(ctx, &spec, &pf.path);
            if targets.len() != 1 {
                continue;
            }
            if let Some(t) = resolve_export(ctx, &targets[0], exported, 0, &HashSet::new()) {
                return Some(t);
            }
        }
    }
    None
}

/// `recv.name()` where `recv` is an imported module (alias or submodule).
fn module_member(ctx: &ResolveCtx, recv: &str, name: &str) -> Option<usize> {
    let pf = ctx.file;
    for b in pf.import_bindings.iter().filter(|b| b.local == recv) {
        let specs: Vec<String> = match b.kind {
            ImportKind::Namespace => vec![b.module.clone()],
            // `from . import core` binds `core` to the submodule `.core`, while
            // `from a import b` binds `b` to an attribute of `a`.
            ImportKind::Named => match b.exported.as_deref() {
                Some(e) => vec![join_module(&b.module, e), b.module.clone()],
                None => vec![b.module.clone()],
            },
            _ => vec![],
        };
        for spec in specs {
            let targets = resolve_module(ctx, &spec, &pf.path);
            if targets.len() != 1 {
                continue;
            }
            if let Some(t) = resolve_export(ctx, &targets[0], name, 0, &HashSet::new()) {
                return Some(t);
            }
        }
    }
    None
}

/// A method `name` on the class `ty`, following an in-repo base class chain to
/// depth 5. `from` is the file the type name is written in (bindings differ).
fn lookup_member(
    ctx: &ResolveCtx,
    ty: &str,
    name: &str,
    from: &str,
    bases: &mut HashMap<String, HashMap<String, Vec<String>>>,
    depth: usize,
    visited: &mut HashSet<usize>,
) -> Option<usize> {
    if depth > MAX_REEXPORT_DEPTH {
        return None;
    }
    let classes = class_ids(ctx, ty, from);
    if classes.len() != 1 {
        return None;
    }
    let cls = classes[0];
    if !visited.insert(cls) {
        return None;
    }
    let mut hits: Vec<usize> =
        ctx.by_name.get(name).into_iter().flatten().copied().filter(|c| ctx.nodes[*c].parent == Some(cls as i64)).collect();
    hits.sort_unstable();
    hits.dedup();
    match hits.len() {
        1 => return Some(hits[0]),
        0 => {}
        _ => return None,
    }
    let cls_path = ctx.nodes[cls].path.clone();
    let parents = bases_of(ctx, &cls_path, &mut *bases).get(ty).cloned().unwrap_or_default();
    for base in parents {
        let mut chain = visited.clone();
        if let Some(t) = lookup_member(ctx, &base, name, &cls_path, bases, depth + 1, &mut chain) {
            return Some(t);
        }
    }
    None
}

/// The class nodes `ty` may name **and that are in scope** in file `from`.
/// A class is in scope when it is defined in `from` or reached through one of
/// `from`'s named import bindings. A name that is merely unique repo-wide does
/// not count: `Widget.static()` in a file that neither defines nor imports
/// `Widget` is a `NameError` in Python, so it must not become a `resolved` edge.
fn class_ids(ctx: &ResolveCtx, ty: &str, from: &str) -> Vec<usize> {
    let mut in_scope: Vec<usize> = ctx
        .by_name
        .get(ty)
        .into_iter()
        .flatten()
        .copied()
        .filter(|c| ctx.nodes[*c].kind == "class" && ctx.nodes[*c].path == from)
        .collect();
    // Imported class: `from a import Base`.
    let bindings = if from == ctx.file.path { ctx.file.import_bindings.clone() } else { bindings_of(ctx, from) };
    for b in bindings.iter().filter(|b| b.local == ty && b.kind == ImportKind::Named) {
        let exported = b.exported.as_deref().unwrap_or(ty);
        for spec in [join_module(&b.module, exported), b.module.clone()] {
            let targets = resolve_module(ctx, &spec, from);
            if targets.len() != 1 {
                continue;
            }
            if let Some(t) = resolve_export(ctx, &targets[0], exported, 0, &HashSet::new()) {
                if ctx.nodes[t].kind == "class" {
                    in_scope.push(t);
                }
            }
        }
    }
    in_scope.sort_unstable();
    in_scope.dedup();
    in_scope
}

/// Import bindings of another file, parsed from its source text.
fn bindings_of(ctx: &ResolveCtx, path: &str) -> Vec<ImportBinding> {
    (ctx.read)(path).map(|src| parse_bindings_text(&src)).unwrap_or_default()
}

/// `class X(Base, ...)` bases per class, for one file, cached.
fn bases_of<'a>(
    ctx: &ResolveCtx,
    path: &str,
    cache: &'a mut HashMap<String, HashMap<String, Vec<String>>>,
) -> &'a HashMap<String, Vec<String>> {
    if !cache.contains_key(path) {
        let parsed = (ctx.read)(path).map(|src| parse_class_bases(&src)).unwrap_or_default();
        cache.insert(path.to_string(), parsed);
    }
    cache.get(path).expect("inserted above")
}

/// Parse `class Child(Base, Mixin):` headers. `metaclass=` and other keyword
/// arguments are not bases.
fn parse_class_bases(src: &str) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for line in src.lines() {
        let t = line.trim_start();
        let Some(rest) = t.strip_prefix("class ") else { continue };
        let (name, inner) = match rest.split_once('(') {
            Some((n, t)) => (n, Some(t.split(')').next().unwrap_or(""))),
            None => (rest.split_once(':').map(|(n, _)| n).unwrap_or(rest), None),
        };
        let name = name.trim();
        if name.is_empty() || name.contains(char::is_whitespace) {
            continue;
        }
        let mut bases: Vec<String> = Vec::new();
        if let Some(inner) = inner {
            for item in inner.split(',') {
                let item = item.trim();
                if item.is_empty() || item.contains('=') {
                    continue; // metaclass=..., keyword arguments
                }
                let head = item.split('[').next().unwrap_or(item).trim();
                let head = head.rsplit('.').next().unwrap_or(head).trim();
                if !head.is_empty() && head.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    bases.push(head.to_string());
                }
            }
        }
        out.insert(name.to_string(), bases);
    }
    out
}

/// A name exported by the module at `path`: its own top-level definitions, then
/// names it imported or re-exported. Chased to depth 5, chain-scoped.
fn resolve_export(ctx: &ResolveCtx, path: &str, name: &str, depth: usize, chain: &HashSet<String>) -> Option<usize> {
    if depth > MAX_REEXPORT_DEPTH {
        return None;
    }
    let mut chain = chain.clone();
    if !chain.insert(path.to_string()) {
        return None;
    }
    let mut hits: Vec<usize> = ctx.top_level(path).into_iter().filter(|c| ctx.nodes[*c].name == name).collect();
    hits.sort_unstable();
    hits.dedup();
    if hits.len() == 1 {
        return Some(hits[0]);
    }
    let src = (ctx.read)(path)?;
    for b in parse_bindings_text(&src) {
        match b.kind {
            ImportKind::Named if b.local == name => {
                let exported = b.exported.as_deref().unwrap_or(name);
                for spec in [join_module(&b.module, exported), b.module.clone()] {
                    let targets = resolve_module(ctx, &spec, path);
                    if targets.len() != 1 {
                        continue;
                    }
                    if let Some(t) = resolve_export(ctx, &targets[0], exported, depth + 1, &chain) {
                        return Some(t);
                    }
                }
            }
            ImportKind::Reexport if b.local == "*" => {
                let targets = resolve_module(ctx, &b.module, path);
                if targets.len() != 1 {
                    continue;
                }
                if let Some(t) = resolve_export(ctx, &targets[0], name, depth + 1, &chain) {
                    return Some(t);
                }
            }
            _ => {}
        }
    }
    None
}

/// Resolve a Python module specifier (`"a.b"`, `".core"`, `"..pkg"`) written in
/// `from` to the indexed files it names. Relative specs are resolved against
/// the file's package directory: for `pkg/mod.py` and `pkg/__init__.py` alike,
/// one dot is `pkg` (the directory holding the file).
fn resolve_module(ctx: &ResolveCtx, spec: &str, from: &str) -> Vec<String> {
    let s = spec.trim();
    if s.is_empty() {
        return vec![];
    }
    let lead = s.chars().take_while(|c| *c == '.').count();
    let body = s[lead..].replace('.', "/");
    let dir = from.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let mut base = dir.to_string();
    for _ in 1..lead {
        base = base.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
    }
    let key = if lead > 0 {
        // Relative: the dots resolve against the directory holding the file.
        normalize(&format!("{base}/{body}"))
    } else {
        // Absolute: a Python module path is rooted at the repo (sys.path root),
        // never at the importing file's directory.
        normalize(&body)
    };
    let lookup = |k: String| -> Vec<String> {
        let ids = if let Some(v) = ctx.by_stem.get(&k) {
            v.clone()
        } else {
            ctx.by_stem.get(&format!("{k}/__init__")).cloned().unwrap_or_default()
        };
        let mut paths: Vec<String> = ids.iter().filter_map(|i| ctx.nodes.get(*i).map(|n| n.path.clone())).collect();
        paths.sort();
        paths.dedup();
        paths
    };
    if lead > 0 {
        return lookup(key);
    }
    // Absolute: exact stem first, then one source root (`src/pkg/mod` for
    // `pkg.mod`). Deeper suffixes are not tried: `import requests` must not
    // land on some `vendor/x/requests.py`, and a stdlib name on a local file.
    let mut hits = lookup(key.clone());
    if hits.is_empty() {
        let mut ids: Vec<usize> = ctx
            .by_stem
            .iter()
            .filter(|(k, _)| {
                let rest = k.strip_suffix("/__init__").unwrap_or(k);
                rest.strip_suffix(key.as_str())
                    .and_then(|r| r.strip_suffix('/'))
                    .is_some_and(|root| !root.is_empty() && !root.contains('/') && !ctx.by_stem.contains_key(&format!("{root}/__init__")))
            })
            .flat_map(|(_, v)| v.iter().copied())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        hits = ids.iter().filter_map(|i| ctx.nodes.get(*i).map(|n| n.path.clone())).collect();
        if hits.len() > 1 {
            hits.clear();
        }
    }
    hits
}

/// `module` + `.` + `name`, keeping leading relative dots.
fn join_module(module: &str, name: &str) -> String {
    if module.is_empty() {
        name.to_string()
    } else if module.ends_with('.') {
        // `from . import core` – the dots already separate.
        format!("{module}{name}")
    } else {
        format!("{module}.{name}")
    }
}

// ---------------------------------------------------------------------------
// Parse-time extraction. Called from `index::parse_source` for Python files so
// the resolver can see import bindings, receivers and local variable types.
// ---------------------------------------------------------------------------

/// Fill `import_bindings`, `receivers` and `var_types` from the file's tree.
/// `pf.imports` (raw module strings) is left to the generic capture path.
pub fn scan(tree: &tree_sitter::Tree, src: &str, pf: &mut ParsedFile) {
    let bytes = src.as_bytes();
    let mut stack = vec![tree.root_node()];
    // (name, type, enclosing function start byte) for every typed/constructed assignment.
    let mut assigned: Vec<(String, String, usize)> = Vec::new();
    while let Some(n) = stack.pop() {
        match n.kind() {
            "import_statement" | "import_from_statement" => {
                if let Ok(text) = n.utf8_text(bytes) {
                    parse_import_stmt(text, &mut pf.import_bindings);
                }
            }
            "assignment" | "annotated_assignment" => {
                let left = n.child_by_field_name("left");
                let ty = n.child_by_field_name("type").map(|t| t.utf8_text(bytes).unwrap_or("").to_string()).or_else(|| {
                    let right = n.child_by_field_name("right")?;
                    if right.kind() != "call" {
                        return None;
                    }
                    let f = right.child_by_field_name("function")?;
                    if f.kind() == "identifier" {
                        f.utf8_text(bytes).ok().map(str::to_string)
                    } else {
                        None
                    }
                });
                if let (Some(l), Some(t)) = (left, ty) {
                    if l.kind() == "identifier" {
                        if let Ok(var) = l.utf8_text(bytes) {
                            let ty = plain_type(&t);
                            if let Some(ty) = ty {
                                assigned.push((var.to_string(), ty, scope_start(n)));
                            }
                        }
                    }
                }
            }
            "call" => {
                if let Some(f) = n.child_by_field_name("function") {
                    if f.kind() == "attribute" {
                        let obj = f.child_by_field_name("object");
                        let attr = f.child_by_field_name("attribute");
                        if let (Some(obj), Some(attr)) = (obj, attr) {
                            if obj.kind() == "identifier" {
                                if let Ok(r) = obj.utf8_text(bytes) {
                                    if !r.is_empty() && r.len() <= 60 && !r.contains('\n') {
                                        pf.receivers.insert(attr.start_byte(), r.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        let mut c = n.walk();
        for ch in n.named_children(&mut c) {
            stack.push(ch);
        }
    }
    // A typed local resolves only when it is assigned exactly once in the file:
    // two functions using the same local name must not cross-resolve.
    let mut counts: HashMap<&str, (usize, &str, usize)> = HashMap::new();
    for (name, ty, scope) in &assigned {
        let e = counts.entry(name.as_str()).or_insert((0, ty.as_str(), *scope));
        e.0 += 1;
    }
    for (name, (count, ty, scope)) in counts {
        if count == 1 {
            if let Some((_, _, _)) = assigned.iter().find(|(n, _, _)| n == name) {
                pf.var_types.insert(name.to_string(), format!("{ty}{SCOPE_SEP}{scope}"));
            }
        }
    }
}

/// The start byte of the innermost enclosing function, 0 at module level.
fn scope_start(mut n: tree_sitter::Node) -> usize {
    while let Some(p) = n.parent() {
        if p.kind() == "function_definition" {
            return p.start_byte();
        }
        n = p;
    }
    0
}

/// A plain class name, or `None` for `list[X]`, `A | B`, `a.B`.
fn plain_type(t: &str) -> Option<String> {
    let t = t.trim();
    if t.is_empty() || t.contains(['[', '|', '.', ' ', ',']) {
        return None;
    }
    if t.chars().all(|c| c.is_alphanumeric() || c == '_') {
        Some(t.to_string())
    } else {
        None
    }
}

/// Parse one `import ...` / `from ... import ...` statement into bindings.
fn parse_import_stmt(stmt: &str, out: &mut Vec<ImportBinding>) {
    let s = stmt.trim().trim_end_matches(';').trim();
    let s = match s.find('#') {
        Some(i) => s[..i].trim(),
        None => s,
    };
    if let Some(rest) = s.strip_prefix("from ") {
        let Some((module, names)) = rest.split_once(" import ") else { return };
        let module = module.trim();
        if module.is_empty() {
            return;
        }
        let names = names.trim().trim_start_matches('(').trim_end_matches(')');
        for item in names.split(',') {
            let item = item.trim().trim_end_matches('\\').trim();
            if item.is_empty() {
                continue;
            }
            if item == "*" {
                out.push(ImportBinding { local: "*".into(), module: module.to_string(), exported: None, kind: ImportKind::Reexport });
                continue;
            }
            let (name, alias) = split_as(item);
            if name.is_empty() {
                continue;
            }
            out.push(ImportBinding {
                local: alias.unwrap_or_else(|| name.clone()),
                module: module.to_string(),
                exported: Some(name),
                kind: ImportKind::Named,
            });
        }
    } else if let Some(rest) = s.strip_prefix("import ") {
        for item in rest.split(',') {
            let item = item.trim().trim_end_matches('\\').trim();
            if item.is_empty() {
                continue;
            }
            let (module, alias) = split_as(item);
            if module.is_empty() {
                continue;
            }
            // `import a.b as c` binds `c` to the module `a.b`.
            // Plain `import a.b` binds the top-level package `a`, so `a.name`
            // is an attribute of `a/__init__.py`, not of `a/b.py`. Binding the
            // dotted path here made `a.name()` resolve against `a/b.py` – a
            // wrong `resolved` edge on valid Python.
            let (local, module) = match alias {
                Some(a) => (a, module),
                None => {
                    let top = module.split('.').next().unwrap_or(&module).to_string();
                    (top.clone(), top)
                }
            };
            out.push(ImportBinding { local, module, exported: None, kind: ImportKind::Namespace });
        }
    }
}

/// `a as b` → (`a`, Some(`b`)).
fn split_as(item: &str) -> (String, Option<String>) {
    match item.split_once(" as ") {
        Some((n, a)) => (n.trim().to_string(), Some(a.trim().to_string())),
        None => (item.trim().to_string(), None),
    }
}

/// Import bindings of a file, from its source text (multi-line statements with
/// parentheses are accumulated).
fn parse_bindings_text(src: &str) -> Vec<ImportBinding> {
    let mut out = Vec::new();
    let mut buf = String::new();
    for line in src.lines() {
        let t = line.trim();
        if buf.is_empty() && !(t.starts_with("import ") || t.starts_with("from ")) {
            continue;
        }
        buf.push_str(t);
        buf.push(' ');
        let unbalanced = buf.matches('(').count() > buf.matches(')').count();
        if t.ends_with('\\') || unbalanced {
            continue;
        }
        let stmt = std::mem::take(&mut buf);
        parse_import_stmt(&stmt, &mut out);
    }
    if !buf.is_empty() {
        parse_import_stmt(&buf, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings(src: &str) -> Vec<ImportBinding> {
        parse_bindings_text(src)
    }

    #[test]
    fn module_alias_binds_the_alias() {
        let b = bindings("import pkg.core as pc\n");
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].local, "pc");
        assert_eq!(b[0].module, "pkg.core");
        assert_eq!(b[0].kind, ImportKind::Namespace);
        assert_eq!(b[0].exported, None);
    }

    #[test]
    fn plain_import_binds_the_top_level_package() {
        // `import a.b` binds `a` to the package `a`, not to the dotted `a.b`:
        // `a.name()` looks the name up on `a/__init__.py`.
        let b = bindings("import a.b\n");
        assert_eq!(b[0].local, "a");
        assert_eq!(b[0].module, "a");
        assert_eq!(b[0].kind, ImportKind::Namespace);
    }

    #[test]
    fn plain_import_of_a_plain_module_binds_it() {
        let b = bindings("import core\n");
        assert_eq!((b[0].local.as_str(), b[0].module.as_str()), ("core", "core"));
    }

    #[test]
    fn aliased_dotted_import_keeps_the_full_module() {
        // `import a.b as c` binds `c` to `a.b`.
        let b = bindings("import a.b as c\n");
        assert_eq!((b[0].local.as_str(), b[0].module.as_str()), ("c", "a.b"));
    }

    #[test]
    fn from_import_keeps_names_and_aliases() {
        let b = bindings("from .core import helper, other as o\n");
        assert_eq!(b.len(), 2);
        assert_eq!((b[0].local.as_str(), b[0].module.as_str(), b[0].exported.as_deref()), ("helper", ".core", Some("helper")));
        assert_eq!((b[1].local.as_str(), b[1].exported.as_deref()), ("o", Some("other")));
        assert_eq!(b[0].kind, ImportKind::Named);
    }

    #[test]
    fn star_import_is_a_reexport() {
        let b = bindings("from .x import *\n");
        assert_eq!(b.len(), 1);
        assert_eq!((b[0].local.as_str(), b[0].kind), ("*", ImportKind::Reexport));
    }

    #[test]
    fn parenthesised_multiline_from_import_is_one_statement() {
        let b = bindings("from .core import (\n    a,\n    b as c,\n)\n");
        assert_eq!(b.len(), 2, "{b:?}");
        assert_eq!(b[1].local, "c");
    }

    #[test]
    fn class_bases_skip_metaclass_and_keep_names() {
        let m = parse_class_bases("class Child(Base, mixins.Mixin, metaclass=Meta):\n    pass\n");
        assert_eq!(m.get("Child").unwrap(), &vec!["Base".to_string(), "Mixin".to_string()]);
        let m = parse_class_bases("class Plain:\n    pass\n");
        assert_eq!(m.get("Plain").unwrap().len(), 0);
    }

    #[test]
    fn relative_module_levels() {
        // `.` in pkg/mod.py is pkg; `..` in pkg/sub/deep.py is pkg.
        assert_eq!(normalize(&format!("{}/{}", "pkg", "")), "pkg");
        assert_eq!(normalize(&format!("{}/{}", "pkg", "core")), "pkg/core");
        assert_eq!(join_module(".", "core"), ".core");
        assert_eq!(join_module(".core", "helper"), ".core.helper");
    }

    #[test]
    fn plain_types_only() {
        assert_eq!(plain_type("Klass"), Some("Klass".to_string()));
        assert_eq!(plain_type("Klass()"), None);
        assert_eq!(plain_type("list[Klass]"), None);
        assert_eq!(plain_type("A | B"), None);
    }
}
