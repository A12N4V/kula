//! Go call resolver.
//!
//! Handles package imports (the `go.mod` module path maps an import path onto
//! a repo-relative directory), `pkg.Func` calls to an imported package's
//! exported symbol, and method calls on receivers whose type is declared in
//! the same package (`w := Wheel{}` then `w.Spin()`, method sets by receiver
//! type name).
//!
//! Interface calls are never resolved: satisfaction by method-name match is
//! the name linker's inferred tier, so the resolver simply leaves those bytes
//! unclaimed. Unknown receivers stay guessed the same way.
//!
//! Out of scope (left unresolved on purpose): dot-imports, blank imports,
//! external modules, generics, and calls through package-level variables.

use super::{ImportBinding, ImportKind, ResolveCtx, ResolveOut, Resolver};
use crate::index::ParsedFile;

/// Separator inside `ParsedFile::var_types` values, matching the other
/// resolvers: `"Type\u{1f}scope_start"`.
const SCOPE_SEP: char = '\u{1f}';

pub struct Go;

impl Resolver for Go {
    fn langs(&self) -> &'static [&'static str] {
        &["go"]
    }

    fn resolve(&self, ctx: &ResolveCtx) -> ResolveOut {
        let mut out = ResolveOut::default();
        let pkg = Pkg::new(ctx);
        for (name, byte) in &ctx.file.calls {
            let byte = *byte;
            let target = match ctx.file.receivers.get(&byte) {
                Some(recv) => pkg.selector(recv, name, byte),
                None => None,
            };
            if let Some((t, soft)) = target {
                out.claimed.insert(byte);
                if soft {
                    out.soft.push((byte, t));
                } else {
                    out.edges.push((byte, t));
                }
            }
        }
        out
    }
}

/// One file's view of its module: the module path from `go.mod` and the
/// import bindings the scan recorded.
struct Pkg<'a> {
    ctx: &'a ResolveCtx<'a>,
    /// The directory this file lives in: the package it belongs to.
    dir: String,
    /// The module path from `go.mod`, empty when there is none.
    module: String,
}

impl<'a> Pkg<'a> {
    fn new(ctx: &'a ResolveCtx<'a>) -> Self {
        let module = (ctx.read)("go.mod").and_then(|m| module_path(&m)).unwrap_or_default();
        let dir = ctx.file.path.rsplit_once('/').map(|(d, _)| d).unwrap_or("").to_string();
        Pkg { ctx, dir, module }
    }

    fn pf(&self) -> &ParsedFile {
        self.ctx.file
    }

    /// Whether `ty` is declared as an interface in the file being resolved.
    fn is_interface(&self, ty: &str) -> bool {
        let ty = ty.rsplit('.').next().unwrap_or(ty);
        if self.pf().interfaces.iter().any(|i| i == ty) {
            return true;
        }
        // Declared in a sibling file of the same package.
        let needle = format!("type {ty} interface");
        let mut seen: Vec<&str> = Vec::new();
        for id in self.ctx.by_name.get(ty).into_iter().flatten() {
            let n = &self.ctx.nodes[*id];
            if n.path.ends_with(".go") && !seen.contains(&n.path.as_str()) {
                seen.push(n.path.as_str());
                if (self.ctx.read)(&n.path).is_some_and(|t| t.contains(&needle)) {
                    return true;
                }
            }
        }
        false
    }

    /// A selector call: `pkg.Func(...)` when `recv` names an imported package,
    /// else `recv.Name(...)` on a typed local. `Some((target, soft))`: `soft`
    /// means the edge is proven bound but only by name match (`inferred`).
    fn selector(&self, recv: &str, name: &str, byte: usize) -> Option<(usize, bool)> {
        if let Some(b) = self.pf().import_bindings.iter().find(|b| b.local == recv) {
            return self.pkg_symbol(&b.module, name).map(|t| (t, false));
        }
        self.typed_method(recv, name, byte)
    }

    /// `pkg.Func`: the import path minus the module prefix is the package's
    /// directory; the symbol must exist exactly once in it and be exported.
    fn pkg_symbol(&self, import: &str, name: &str) -> Option<usize> {
        if !is_exported(name) {
            return None;
        }
        let dir = self.import_dir(import)?;
        let hit: Vec<usize> = self
            .ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| {
                let n = &self.ctx.nodes[*id];
                n.kind != "file" && n.path.ends_with(".go") && package_dir_of(&n.path) == dir
            })
            .collect();
        (hit.len() == 1).then(|| hit[0])
    }

    /// The repo-relative directory an in-module import path points at.
    /// `example.com/m/internal/util` with module `example.com/m` →
    /// `internal/util`; the module root itself → `""`.
    fn import_dir(&self, import: &str) -> Option<String> {
        let rest = if self.module.is_empty() { import } else { import.strip_prefix(&self.module)? };
        let rest = rest.trim_start_matches('/');
        if rest.is_empty() {
            Some(String::new())
        } else {
            Some(rest.to_string())
        }
    }

    /// `recv.Name()`: the receiver variable's type is known from a
    /// `:=`/`var` binding (or a parameter), the type is declared in this
    /// package, and exactly one method of that type has the called name. An
    /// interface type is satisfaction by method-name match instead: an
    /// `inferred` edge, never `resolved`.
    fn typed_method(&self, recv: &str, name: &str, byte: usize) -> Option<(usize, bool)> {
        if !recv.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }
        let raw = self.pf().var_types.get(recv)?;
        let (ty, scope) = raw.split_once(SCOPE_SEP)?;
        let scope: usize = scope.parse().ok()?;
        if scope != enclosing_scope(self.pf(), byte) {
            return None;
        }
        let ty = ty.trim_start_matches('*').trim_start_matches("[]").trim_start_matches("map[string]");
        if self.is_interface(ty) {
            return self.iface_satisfaction(ty.rsplit('.').next().unwrap_or(ty), name);
        }
        // The type lives in this package: same directory, one declaration.
        let ty_file = self
            .ctx
            .by_name
            .get(ty)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| {
                let n = &self.ctx.nodes[*id];
                n.kind == "class" && n.path.ends_with(".go") && package_dir_of(&n.path) == self.dir
            })
            .collect::<Vec<_>>();
        if ty_file.len() != 1 {
            return None;
        }
        // The method set: nodes owned by the type, anywhere in its package.
        let ty_dir = package_dir_of(&self.ctx.nodes[ty_file[0]].path);
        let hit: Vec<usize> = self
            .ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| {
                let n = &self.ctx.nodes[*id];
                n.path.ends_with(".go")
                    && package_dir_of(&n.path) == ty_dir
                    && n.parent.is_some_and(|p| self.ctx.nodes[p as usize].name == ty)
            })
            .collect();
        (hit.len() == 1).then(|| (hit[0], false))
    }

    /// Interface satisfaction by method-name match: the receiver's declared
    /// type is an interface. Prefer the unique concrete method of that name
    /// in the repo; with no concrete method, the interface's own method node
    /// is the target. Always `inferred`, never `resolved`.
    fn iface_satisfaction(&self, iface: &str, name: &str) -> Option<(usize, bool)> {
        let concrete: Vec<usize> = self
            .ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| {
                let n = &self.ctx.nodes[*id];
                n.path.ends_with(".go")
                    && n.parent.is_some_and(|p| {
                        let pn = &self.ctx.nodes[p as usize].name;
                        pn != iface && !pn.ends_with(".go")
                    })
            })
            .collect();
        if concrete.len() == 1 {
            return Some((concrete[0], true));
        }
        if concrete.is_empty() {
            let own: Vec<usize> = self
                .ctx
                .by_name
                .get(name)
                .into_iter()
                .flatten()
                .copied()
                .filter(|id| {
                    let n = &self.ctx.nodes[*id];
                    n.path.ends_with(".go")
                        && n.parent.is_some_and(|p| {
                            let pn = &self.ctx.nodes[p as usize].name;
                            pn == iface || pn.ends_with(".go")
                        })
                })
                .collect();
            return (own.len() == 1).then(|| (own[0], true));
        }
        None
    }
}

/// Go visibility: a capital first letter.
fn is_exported(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_uppercase())
}

/// The package directory of a file path: everything before the last `/`.
fn package_dir_of(path: &str) -> String {
    path.rsplit_once('/').map(|(d, _)| d).unwrap_or("").to_string()
}

/// The module path from a `go.mod` body.
fn module_path(go_mod: &str) -> Option<String> {
    go_mod
        .lines()
        .map(str::trim)
        .find_map(|l| l.strip_prefix("module "))
        .map(|m| m.trim().trim_matches('"').to_string())
        .filter(|m| !m.is_empty())
}

/// The start byte of the innermost enclosing function, 0 at package level.
fn enclosing_scope(pf: &ParsedFile, byte: usize) -> usize {
    pf.defs
        .iter()
        .filter(|d| d.start_byte <= byte && byte < d.end_byte && matches!(d.kind, "function" | "method"))
        .min_by_key(|d| d.end_byte - d.start_byte)
        .map(|d| d.start_byte)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- the scan

/// Fill the Go-only parts of `ParsedFile`: import bindings (alias or last
/// path segment → import path), selector-call receivers, and typed local
/// receivers from `:=` and `var` declarations.
pub fn scan(tree: &tree_sitter::Tree, src: &str, pf: &mut ParsedFile) {
    let bytes = src.as_bytes();
    let mut stack = vec![tree.root_node()];
    // (variable, type, enclosing function start byte)
    let mut assigned: Vec<(String, String, usize)> = Vec::new();
    while let Some(n) = stack.pop() {
        stack.extend(n.children(&mut n.walk()));
        match n.kind() {
            "import_spec" => {
                let path = n.child_by_field_name("path").and_then(|p| p.utf8_text(bytes).ok());
                let Some(path) = path else { continue };
                let path = path.trim_matches('"').to_string();
                // A package name clause wins; else the path's last segment.
                let local = n
                    .child_by_field_name("name")
                    .and_then(|a| a.utf8_text(bytes).ok())
                    .map(str::to_string)
                    .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(&path).to_string());
                if !path.is_empty() && local != "_" && local != "." {
                    pf.import_bindings.push(ImportBinding { local, module: path, exported: None, kind: ImportKind::Namespace });
                }
            }
            "call_expression" => {
                let f = n.child_by_field_name("function");
                if let Some(sel) = f.filter(|f| f.kind() == "selector_expression") {
                    if let (Some(obj), Some(field)) = (sel.child_by_field_name("operand"), sel.child_by_field_name("field")) {
                        if let (Ok(o), Ok(_)) = (obj.utf8_text(bytes), field.utf8_text(bytes)) {
                            if !o.is_empty() && o.len() <= 80 && !o.contains('\n') {
                                pf.receivers.insert(field.start_byte(), o.to_string());
                            }
                        }
                    }
                }
            }
            "type_spec" => {
                // `type Greeter interface { ... }`: the name is an interface
                // type; its method set is matched by name, never resolved.
                let ty = n.child_by_field_name("type");
                if ty.is_some_and(|t| t.kind() == "interface_type") {
                    if let Some(nm) = n.child_by_field_name("name").and_then(|x| x.utf8_text(bytes).ok()) {
                        pf.interfaces.push(nm.to_string());
                    }
                }
            }
            "parameter_declaration" => {
                // A parameter's declared type pins the receiver for method
                // calls and interface satisfaction inside the function.
                if let (Some(nm), Some(ty)) = (n.child_by_field_name("name"), n.child_by_field_name("type")) {
                    if let (Ok(v), Some(t)) = (nm.utf8_text(bytes), plain_type(ty, bytes)) {
                        if !v.is_empty() && v != "_" {
                            assigned.push((v.to_string(), t, scope_start_of(pf, n.start_byte())));
                        }
                    }
                }
            }
            "short_var_declaration" => {
                let Some(right) = n.child_by_field_name("right") else { continue };
                let Some(ty) = literal_type(right, bytes) else { continue };
                let Some(left) = n.child_by_field_name("left") else { continue };
                for var in named_idents(left, bytes) {
                    assigned.push((var, ty.clone(), scope_start_of(pf, n.start_byte())));
                }
            }
            "var_spec" => {
                let Some(ty) = n.child_by_field_name("type").and_then(|t| plain_type(t, bytes)) else { continue };
                for var in named_idents(n, bytes) {
                    assigned.push((var, ty.clone(), scope_start_of(pf, n.start_byte())));
                }
            }
            _ => {}
        }
    }
    for (var, ty, scope) in assigned {
        pf.var_types.insert(var, format!("{ty}{SCOPE_SEP}{scope}"));
    }
}

/// The type of a bound value: `Foo{...}`, `&Foo{...}` or `[]Foo{...}`.
fn literal_type<'t>(expr: tree_sitter::Node<'t>, bytes: &[u8]) -> Option<String> {
    let node = match expr.kind() {
        "expression_list" => expr.child(0)?,
        "unary_expression" => expr.child_by_field_name("argument")?,
        _ => expr,
    };
    if node.kind() != "composite_literal" {
        return None;
    }
    plain_type(node.child_by_field_name("type")?, bytes)
}

/// A plain type text: identifier, qualified identifier or pointer to one.
fn plain_type(node: tree_sitter::Node, bytes: &[u8]) -> Option<String> {
    let text = node.utf8_text(bytes).ok()?;
    let last = text.rsplit('.').next()?;
    let last = last.trim_start_matches('*');
    if last.is_empty() || !last.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    Some(last.to_string())
}

/// Identifier names under a declaration (the declared variables).
fn named_idents(node: tree_sitter::Node, bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.kind() == "identifier" && n.parent().is_some_and(|p| matches!(p.kind(), "expression_list" | "var_spec")) {
            if let Ok(t) = n.utf8_text(bytes) {
                if !t.is_empty() && t != "_" {
                    out.push(t.to_string());
                }
            }
        }
        stack.extend(n.children(&mut n.walk()));
    }
    out
}

/// The enclosing function's start byte, 0 at package level: `var` blocks are
/// package scope, `:=` is function scope.
fn scope_start_of(pf: &ParsedFile, byte: usize) -> usize {
    enclosing_scope(pf, byte)
}
