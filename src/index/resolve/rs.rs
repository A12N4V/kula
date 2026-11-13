//! Rust call resolver.
//!
//! Handles `use` trees (nested groups, `self`/`super`/`crate`, globs, `as`
//! renames), `mod` declarations including `#[path = "..."]`, calls by module
//! path (`a::b::f()`), associated functions (`Type::new()`), methods on a
//! concrete receiver (`w.spin()`, including `impl Trait for Type`), and
//! `let x = Type::new()` followed by `x.m()` in the same function body.
//!
//! Every emitted edge is proven: a module path must land on exactly one
//! indexed file, that file must hold exactly one definition of the callee, and
//! a receiver type must be in scope (declared in the file or reached through
//! its `use` bindings). Anything ambiguous is left to the name linker.
//!
//! Out of scope (left unresolved on purpose): generics and turbofish, macro
//! expanded items, `dyn`/trait-object dispatch, inline `mod x { .. }` bodies,
//! cross-crate `std` methods, `<Type as Trait>::method`, and `super::` walking
//! above the crate root.

use std::collections::HashMap;

use super::{ImportBinding, ImportKind, ResolveCtx, ResolveOut, Resolver};
use crate::index::{normalize, ParsedFile};

/// Whether `T::f()` yields a `T`: `new`, `default`, `new_*`, or a `fn f`
/// in this file declared `-> Self` or `-> T`.
fn constructor(src: &str, ty: &str, f: &str) -> bool {
    if f == "new" || f == "default" || f.starts_with("new_") {
        return true;
    }
    let last = ty.rsplit("::").next().unwrap_or(ty);
    src.match_indices(&format!("fn {f}(")).any(|(i, _)| {
        let sig = &src[i..];
        let sig = &sig[..sig.find('{').or_else(|| sig.find(';')).unwrap_or(sig.len())];
        let ret = sig.rsplit_once("->").map(|(_, r)| r.trim()).unwrap_or("");
        let ret = ret.split(" where").next().unwrap_or(ret).trim();
        ret == "Self" || ret == last
    })
}

/// Marks a `let x = T::f()` type that holds only if `f` returns `T`
/// (`"T\u{1d}f"`), checked once the type's file is known.
const CTOR_SEP: char = '\u{1d}';

/// Separator inside `ParsedFile::var_types` values: `"Type\u{1f}scope_start"`.
/// Shared with the Python resolver: the scope is the byte offset of the
/// enclosing function (0 at module level), so a typed local only binds member
/// calls in the function that binds it.
const SCOPE_SEP: char = '\u{1f}';

/// `use` depth cap, mirroring the re-export cap the other resolvers use.
const MAX_USE_DEPTH: usize = 12;

/// ImportBinding marker for a plain `mod x;`.
const MOD: &str = "\u{2}mod";
/// ImportBinding marker prefix for `#[path = "..."] mod x;`.
const PATH: &str = "\u{2}path:";
/// ImportBinding marker for an inline `mod x { .. }` (no file to point at).
const INLINE: &str = "\u{2}inline";

pub struct Rs;

impl Resolver for Rs {
    fn langs(&self) -> &'static [&'static str] {
        &["rust"]
    }

    fn resolve(&self, ctx: &ResolveCtx) -> ResolveOut {
        let mut out = ResolveOut::default();
        let scope = Scope::new(ctx);
        for (name, byte) in &ctx.file.calls {
            let byte = *byte;
            let target = if ctx.file.self_calls.contains(&byte) {
                super::self_target(ctx, name, byte).or_else(|| {
                    let owner = enclosing_owner(ctx.file, byte)?;
                    let file = scope.type_file(std::slice::from_ref(&owner))?;
                    scope.method(&owner, name, &file)
                })
            } else if let Some(recv) = ctx.file.receivers.get(&byte) {
                let segs = split_path(recv);
                if segs.len() > 1 && segs.last().map(String::as_str) == Some(name.as_str()) {
                    // A scoped call: the receiver text is the whole path (`a::b::f`).
                    scope.scoped(&segs[..segs.len() - 1], name, byte)
                } else {
                    // A field call: `w.spin()`, `x.m()`; the receiver is a local or `self`.
                    if recv == "self" || recv == "Self" {
                        super::self_target(ctx, name, byte)
                    } else {
                        scope.typed_member(recv, name, byte)
                    }
                }
            } else {
                scope.imported(name)
            };
            if let Some(t) = target {
                out.claimed.insert(byte);
                out.edges.push((byte, t));
            }
        }
        out
    }
}

/// One file's view of its crate: where module paths from this file start, and
/// what `mod` declarations live beside it.
struct Scope<'a> {
    ctx: &'a ResolveCtx<'a>,
    /// The crate root directory (`src` for a `src/lib.rs` crate, `""` otherwise).
    root: String,
    /// The directory this file's own submodules live in.
    moddir: String,
}

impl<'a> Scope<'a> {
    fn new(ctx: &'a ResolveCtx<'a>) -> Self {
        let root = crate_root(ctx, &ctx.file.path);
        let moddir = module_dir_of_file(&root, &ctx.file.path);
        Scope { ctx, root, moddir }
    }

    fn pf(&self) -> &ParsedFile {
        self.ctx.file
    }

    /// The `mod` declaration that brings `seg` into this file, if any.
    fn declared_mod(&self, seg: &str) -> Option<ModDecl> {
        for b in &self.pf().import_bindings {
            if b.local != seg {
                continue;
            }
            if b.module == INLINE {
                return Some(ModDecl::Inline);
            }
            if b.module == MOD {
                return self.child_file(&self.moddir, seg).map(ModDecl::File);
            }
            if let Some(rel) = b.module.strip_prefix(PATH) {
                let dir = parent_dir(&self.pf().path);
                let p = normalize(&join(&dir, rel));
                if self.ctx.by_path.contains_key(&p) {
                    return Some(ModDecl::File(p));
                }
                return Some(ModDecl::Inline);
            }
        }
        None
    }

    /// Whether the crate root file (not this one) declares `mod seg`.
    fn root_declares(&self, seg: &str) -> bool {
        ["lib.rs", "main.rs"].iter().map(|f| join(&self.root, f)).filter(|r| *r != self.pf().path).any(|r| {
            (self.ctx.read)(&r).is_some_and(|t| {
                t.lines().any(|l| {
                    let l = l.trim_start();
                    let l = l.strip_prefix("pub(crate) ").or_else(|| l.strip_prefix("pub ")).unwrap_or(l);
                    l.strip_prefix("mod ").is_some_and(|r| r.trim_end() == format!("{seg};"))
                })
            })
        })
    }

    /// `dir/seg.rs` or `dir/seg/mod.rs`, when indexed.
    fn child_file(&self, dir: &str, seg: &str) -> Option<String> {
        let base = join(dir, seg);
        [format!("{base}.rs"), format!("{base}/mod.rs")].into_iter().find(|c| self.ctx.by_path.contains_key(c))
    }

    /// The message file for a `::`-separated module path written in this file.
    /// Walks as far as indexed files go; trailing segments naming an inline
    /// `mod` are ignored, so `crate::shapes::render::draw` lands on `shapes.rs`.
    fn module_file(&self, segs: &[String]) -> Option<String> {
        let mut dir = self.moddir.clone();
        let mut i = 0;
        while i < segs.len() {
            match segs[i].as_str() {
                "crate" => dir = self.root.clone(),
                "self" => {}
                "super" => dir = parent_dir(&dir),
                _ => break,
            }
            i += 1;
        }
        let anchored = i > 0;
        let mut best = None;
        let mut first = true;
        while i < segs.len() {
            let seg = segs[i].as_str();
            if seg.is_empty() || seg == "*" || seg == "_" {
                break;
            }
            let found = if first && !anchored {
                match self.declared_mod(seg) {
                    Some(ModDecl::File(f)) => Some(f),
                    Some(ModDecl::Inline) => None,
                    // 2015-style `use server::X` from a submodule: crate
                    // relative when the crate root declares `mod server`.
                    None if self.root_declares(seg) => {
                        dir = self.root.clone();
                        self.child_file(&dir, seg)
                    }
                    None => None,
                }
            } else {
                self.child_file(&dir, seg)
            };
            let Some(f) = found else { break };
            // Submodules of `dir/seg.rs` live in `dir/seg/`.
            dir = join(&dir, seg);
            best = Some(f);
            first = false;
            i += 1;
        }
        best
    }

    /// The file that declares type `segs` (`Circle`, `shapes::Wheel`), when it
    /// is in scope: a struct/enum in this file or reached by a `use` binding.
    fn type_file(&self, segs: &[String]) -> Option<String> {
        let name = segs.last()?;
        if segs.len() > 1 {
            let f = self.module_file(&segs[..segs.len() - 1])?;
            return self.has_type(&f, name).then_some(f);
        }
        for d in &self.pf().defs {
            if &d.name == name && is_type_kind(d.kind) {
                return Some(self.pf().path.clone());
            }
        }
        for b in &self.pf().import_bindings {
            if b.local != *name || b.module == MOD || b.module.starts_with(PATH) || b.local == "*" {
                continue;
            }
            let Some(f) = self.module_file(&split_path(&b.module)) else { continue };
            let exp = b.exported.clone().unwrap_or_else(|| name.clone());
            if self.has_type(&f, &exp) {
                return Some(f);
            }
        }
        None
    }

    fn has_type(&self, file: &str, name: &str) -> bool {
        self.ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .any(|id| self.ctx.nodes[*id].path == file && is_type_kind(&self.ctx.nodes[*id].kind))
    }

    /// Method `name` of `type_name` declared in `file`, when exactly one impl
    /// (or trait impl) provides it. A trait `function_signature_item` and an
    /// impl body can share the name, so the parent type must match.
    fn method(&self, type_name: &str, name: &str, file: &str) -> Option<usize> {
        let hit: Vec<usize> = self
            .ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| {
                let n = &self.ctx.nodes[*id];
                n.path == file && n.kind != "file" && n.parent.is_some_and(|p| self.ctx.nodes[p as usize].name == type_name)
            })
            .collect();
        (hit.len() == 1).then(|| hit[0])
    }

    /// Exactly one definition of `name` in `file`.
    fn unique_in_file(&self, file: &str, name: &str) -> Option<usize> {
        let hit: Vec<usize> = self
            .ctx
            .by_name
            .get(name)
            .into_iter()
            .flatten()
            .copied()
            .filter(|id| self.ctx.nodes[*id].path == file && self.ctx.nodes[*id].kind != "file")
            .collect();
        (hit.len() == 1).then(|| hit[0])
    }

    /// A scoped call `prefix::name(...)`.
    fn scoped(&self, prefix: &[String], name: &str, byte: usize) -> Option<usize> {
        // `Self::assoc()` inside an impl block.
        if prefix.last().map(String::as_str) == Some("Self") {
            let owner = enclosing_owner(self.pf(), byte)?;
            let file = self.type_file(std::slice::from_ref(&owner))?;
            return self.method(&owner, name, &file);
        }
        // A module path, then a lone definition in that (possibly deepest) file.
        if let Some(f) = self.module_file(prefix) {
            if let Some(t) = self.unique_in_file(&f, name) {
                return Some(t);
            }
        }
        // `use crate::deep::inner::{self};` binds the module `inner`, so
        // `inner::leaf()` walks the rest of the path from that binding.
        if let [first] = prefix {
            let mut local = Vec::new();
            for b in &self.pf().import_bindings {
                if &b.local != first || b.exported.is_some() || b.local == "*" || b.module == MOD || b.module.starts_with(PATH) {
                    continue;
                }
                if let Some(f) = self.module_file(&split_path(&b.module)) {
                    if let Some(t) = self.unique_in_file(&f, name) {
                        local.push(t);
                    }
                }
            }
            if local.len() == 1 {
                return Some(local[0]);
            }
        }
        // `Type::assoc()` / `mod::Type::assoc()`: the last segment is a type.
        let (ty, file) = if prefix.len() > 1 {
            let ty = prefix.last()?.clone();
            let f = self.type_file(prefix)?;
            (ty, f)
        } else {
            let ty = prefix.first()?.clone();
            (ty.clone(), self.type_file(std::slice::from_ref(&ty))?)
        };
        self.method(&ty, name, &file)
    }

    /// `x.m()` where `x` is a local bound once in the enclosing function.
    fn typed_member(&self, recv: &str, name: &str, byte: usize) -> Option<usize> {
        if !recv.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return None;
        }
        let raw = self.pf().var_types.get(recv)?;
        let (ty, scope) = raw.split_once(SCOPE_SEP)?;
        let scope: usize = scope.parse().ok()?;
        if scope != enclosing_scope(self.pf(), byte) {
            return None;
        }
        let (ty, ctor) = match ty.split_once(CTOR_SEP) {
            Some((t, f)) => (t, Some(f)),
            None => (ty, None),
        };
        let file = self.type_file(&split_path(ty))?;
        if let Some(f) = ctor {
            if !(self.ctx.read)(&file).is_some_and(|t| constructor(&t, ty, f)) {
                return None;
            }
        }
        self.method(ty.rsplit("::").next().unwrap_or(ty), name, &file)
    }

    /// A bare `f()`: a named import, else a glob import that matches exactly
    /// one in-repo definition.
    fn imported(&self, name: &str) -> Option<usize> {
        for b in &self.pf().import_bindings {
            if b.local != name || b.module == MOD || b.module.starts_with(PATH) {
                continue;
            }
            if b.exported.is_none() {
                continue;
            }
            let Some(f) = self.module_file(&split_path(&b.module)) else { continue };
            // A rename (`use a::paint as brush`) makes the call name and the
            // target name differ on purpose; the file-scoped uniqueness is the proof.
            let exp = b.exported.as_deref().unwrap_or(name);
            if let Some(t) = self.unique_in_file(&f, exp) {
                return Some(t);
            }
        }
        let mut hits: Vec<usize> = Vec::new();
        for b in &self.pf().import_bindings {
            if b.local != "*" {
                continue;
            }
            let Some(f) = self.module_file(&split_path(&b.module)) else { continue };
            if let Some(t) = self.unique_in_file(&f, name) {
                if !hits.contains(&t) {
                    hits.push(t);
                }
            }
        }
        (hits.len() == 1).then(|| hits[0])
    }
}

enum ModDecl {
    File(String),
    Inline,
}

fn is_type_kind(kind: &str) -> bool {
    matches!(kind, "class" | "interface")
}

/// The type name of the `impl` block holding `byte` (`Widget` of
/// `impl Spin for Widget`), via the enclosing def's parent name.
fn enclosing_owner(pf: &ParsedFile, byte: usize) -> Option<String> {
    pf.defs
        .iter()
        .filter(|d| d.start_byte <= byte && byte < d.end_byte && d.parent_name.is_some())
        .min_by_key(|d| d.end_byte - d.start_byte)
        .and_then(|d| d.parent_name.clone())
}

/// The start byte of the innermost enclosing `fn`, 0 at module level.
fn enclosing_scope(pf: &ParsedFile, byte: usize) -> usize {
    pf.defs
        .iter()
        .filter(|d| d.start_byte <= byte && byte < d.end_byte && d.parent_name.is_some())
        .min_by_key(|d| d.end_byte - d.start_byte)
        .map(|d| d.start_byte)
        .or_else(|| {
            pf.defs
                .iter()
                .filter(|d| d.start_byte <= byte && byte < d.end_byte)
                .min_by_key(|d| d.end_byte - d.start_byte)
                .map(|d| d.start_byte)
        })
        .unwrap_or(0)
}

fn split_path(text: &str) -> Vec<String> {
    text.split("::").map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect()
}

fn join(dir: &str, seg: &str) -> String {
    if dir.is_empty() {
        seg.to_string()
    } else if seg.is_empty() {
        dir.to_string()
    } else {
        format!("{dir}/{seg}")
    }
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

/// The crate root: the nearest ancestor directory holding a `lib.rs` or
/// `main.rs`; `""` (the repo root) when the crate has neither.
fn crate_root(ctx: &ResolveCtx, file: &str) -> String {
    let mut dir = parent_dir(file);
    loop {
        if ctx.by_path.contains_key(&join(&dir, "lib.rs")) || ctx.by_path.contains_key(&join(&dir, "main.rs")) {
            return dir;
        }
        if dir.is_empty() {
            return String::new();
        }
        dir = parent_dir(&dir);
    }
}

/// The directory a file's own `mod` items live in: `a/b.rs` → `a/b`,
/// `a/mod.rs` → `a`, `lib.rs` → `""`.
fn module_dir_of_file(root: &str, path: &str) -> String {
    let rel = if root.is_empty() { path.to_string() } else { path.strip_prefix(&format!("{root}/")).unwrap_or(path).to_string() };
    let dir = parent_dir(&rel);
    let file = rel.rsplit('/').next().unwrap_or(&rel);
    if matches!(file, "mod.rs" | "lib.rs" | "main.rs") {
        return dir;
    }
    let stem = file.trim_end_matches(".rs");
    join(&dir, stem)
}

// ---------------------------------------------------------------- the scan

/// Fill the Rust-only parts of `ParsedFile` from the tree: `use`/`mod`
/// bindings, scoped-call paths and field-call receivers in `receivers`,
/// `self` receivers in `self_calls`, and `let` bindings in `var_types`.
pub fn scan(tree: &tree_sitter::Tree, src: &str, pf: &mut ParsedFile) {
    let bytes = src.as_bytes();
    let mut stack = vec![tree.root_node()];
    // (variable, type, enclosing function start byte)
    let mut assigned: Vec<(String, String, usize)> = Vec::new();
    while let Some(n) = stack.pop() {
        match n.kind() {
            "use_declaration" => {
                if let Some(arg) = n.child_by_field_name("argument") {
                    if let Ok(text) = arg.utf8_text(bytes) {
                        parse_use_tree(text, &mut pf.import_bindings, 0);
                    }
                }
            }
            "mod_item" => {
                let Some(name) = n.child_by_field_name("name").and_then(|m| m.utf8_text(bytes).ok()) else {
                    continue;
                };
                let body = n.child_by_field_name("body").is_some() || n.children(&mut n.walk()).any(|c| c.kind() == "declaration_list");
                let module = if body {
                    INLINE.to_string()
                } else if let Some(p) = path_attr(src, n.start_byte()) {
                    format!("{PATH}{p}")
                } else {
                    MOD.to_string()
                };
                pf.import_bindings.push(ImportBinding { local: name.to_string(), module, exported: None, kind: ImportKind::Named });
            }
            "let_declaration" => {
                let Some(pat) = n.child_by_field_name("pattern") else { continue };
                if pat.kind() != "identifier" {
                    continue;
                }
                let Ok(var) = pat.utf8_text(bytes) else { continue };
                let ty = n.child_by_field_name("type").and_then(|t| t.utf8_text(bytes).ok().and_then(plain_type)).or_else(|| {
                    let value = n.child_by_field_name("value")?;
                    match value.kind() {
                        "call_expression" => {
                            let f = value.child_by_field_name("function")?;
                            if f.kind() != "scoped_identifier" {
                                return None;
                            }
                            let text = f.utf8_text(bytes).ok()?;
                            // `Circle::new(..)`: the type is the path, not the last segment.
                            // Only constructors: `Config::load()` may return a Result.
                            let (prefix, f) = text.rsplit_once("::")?;
                            let ty = plain_type(prefix)?;
                            // Proven here, or left for the resolver to check in the type's file.
                            Some(if constructor(src, &ty, f) { ty } else { format!("{ty}{CTOR_SEP}{f}") })
                        }
                        "struct_expression" => {
                            let name = value.child_by_field_name("name")?;
                            plain_type(name.utf8_text(bytes).ok()?)
                        }
                        _ => None,
                    }
                });
                if let Some(ty) = ty {
                    assigned.push((var.to_string(), ty, scope_start(n)));
                }
            }
            "call_expression" => {
                let Some(f) = n.child_by_field_name("function") else { continue };
                match f.kind() {
                    "field_expression" => {
                        let (Some(value), Some(field)) = (f.child_by_field_name("value"), f.child_by_field_name("field")) else {
                            continue;
                        };
                        let Ok(text) = value.utf8_text(bytes) else { continue };
                        if text.is_empty() || text.len() > 80 || text.contains('\n') {
                            continue;
                        }
                        pf.receivers.insert(field.start_byte(), text.to_string());
                        if text == "self" {
                            pf.self_calls.insert(field.start_byte());
                        }
                    }
                    "scoped_identifier" => {
                        let Some(name) = f.child_by_field_name("name") else { continue };
                        let Ok(text) = f.utf8_text(bytes) else { continue };
                        if text.is_empty() || text.len() > 200 || text.contains('\n') {
                            continue;
                        }
                        pf.receivers.insert(name.start_byte(), text.to_string());
                    }
                    _ => {}
                }
            }
            _ => {}
        }
        let mut c = n.walk();
        for ch in n.named_children(&mut c) {
            stack.push(ch);
        }
    }
    // A name bound twice in a file cannot be told apart at a call site.
    let mut counts: HashMap<String, usize> = HashMap::new();
    for (name, _, _) in &assigned {
        *counts.entry(name.clone()).or_default() += 1;
    }
    for (name, ty, scope) in assigned {
        if counts.get(&name) == Some(&1) {
            pf.var_types.insert(name, format!("{ty}{SCOPE_SEP}{scope}"));
        }
    }
}

/// Parse one `use` argument (`crate::a::{b::{c, d}, e as f}`) into bindings.
fn parse_use_tree(text: &str, out: &mut Vec<ImportBinding>, depth: usize) {
    if depth > MAX_USE_DEPTH {
        return;
    }
    let t = text.trim().trim_end_matches(';').trim();
    if t.is_empty() {
        return;
    }
    if let Some(open) = t.find('{') {
        let Some(close) = matching_brace(t, open) else { return };
        let prefix = t[..open].trim().trim_end_matches("::").to_string();
        for part in split_top(&t[open + 1..close]) {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let joined = if prefix.is_empty() { part.to_string() } else { format!("{prefix}::{part}") };
            parse_use_tree(&joined, out, depth + 1);
        }
        return;
    }
    let (path, alias) = split_as(t);
    let segs = split_path(&path);
    let Some(last) = segs.last() else { return };
    if last == "*" {
        let module = segs[..segs.len() - 1].join("::");
        if module.is_empty() {
            return;
        }
        out.push(ImportBinding { local: "*".into(), module, exported: None, kind: ImportKind::Named });
        return;
    }
    if last == "self" {
        if segs.len() < 2 {
            return;
        }
        out.push(ImportBinding {
            local: segs[segs.len() - 2].clone(),
            module: segs[..segs.len() - 1].join("::"),
            exported: None,
            kind: ImportKind::Named,
        });
        return;
    }
    let module = segs[..segs.len() - 1].join("::");
    if module.is_empty() {
        return;
    }
    out.push(ImportBinding { local: alias.unwrap_or_else(|| last.clone()), module, exported: Some(last.clone()), kind: ImportKind::Named });
}

fn matching_brace(t: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (i, c) in t.char_indices().skip(open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_top(t: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (i, c) in t.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                out.push(&t[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&t[start..]);
    out
}

fn split_as(item: &str) -> (String, Option<String>) {
    let mut it = item.split_whitespace();
    let path = it.next().unwrap_or("").trim().to_string();
    match (it.next(), it.next()) {
        (Some("as"), Some(alias)) => (path, Some(alias.trim().to_string())),
        _ => (path, None),
    }
}

/// `&mut Foo<'a>` / `Foo<Bar>` / `a::Foo` → `Foo`; anything else (tuples,
/// slices, `dyn` types) is not a single in-repo type name.
fn plain_type(t: &str) -> Option<String> {
    let t = t.trim().trim_start_matches('&').trim();
    let t = t.strip_prefix("mut ").unwrap_or(t).trim();
    let t = t.split('<').next().unwrap_or(t).trim();
    let t = t.trim_start_matches("::").trim();
    if t.is_empty() || t.contains(['&', '(', ')', '[', ']', ' ', ',', '\'', '*', '!']) {
        return None;
    }
    let last = t.rsplit("::").next().unwrap_or(t);
    if last.is_empty() || !last.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return None;
    }
    Some(last.to_string())
}

/// A `#[path = "…"]` attribute immediately before the `mod` item at `start`.
fn path_attr(src: &str, start: usize) -> Option<String> {
    let mut from = start.saturating_sub(400);
    // A byte window may start inside a multi-byte character; walk it back.
    while from > 0 && !src.is_char_boundary(from) {
        from -= 1;
    }
    let window = src.get(from..start)?;
    let at = window.rfind("#[path")?;
    let rest = &window[at..];
    let eq = rest.find('=')?;
    let rest = rest[eq + 1..].trim_start();
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &rest[1..];
    let end = rest.find(quote)?;
    let p = rest[..end].trim();
    if p.is_empty() || p.len() > 200 {
        return None;
    }
    Some(p.to_string())
}

/// The start byte of the innermost enclosing `function_item`, 0 at module level.
fn scope_start(mut n: tree_sitter::Node) -> usize {
    while let Some(p) = n.parent() {
        if p.kind() == "function_item" {
            return p.start_byte();
        }
        n = p;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings(text: &str) -> Vec<(String, String, Option<String>)> {
        let mut out = Vec::new();
        parse_use_tree(text, &mut out, 0);
        out.into_iter().map(|b| (b.local, b.module, b.exported)).collect()
    }

    #[test]
    fn use_tree_nested_groups_and_renames() {
        let b = bindings("crate::shapes::{render::{draw, paint as brush}, Circle}");
        assert_eq!(
            b,
            vec![
                ("draw".to_string(), "crate::shapes::render".to_string(), Some("draw".to_string())),
                ("brush".to_string(), "crate::shapes::render".to_string(), Some("paint".to_string())),
                ("Circle".to_string(), "crate::shapes".to_string(), Some("Circle".to_string())),
            ]
        );
    }

    #[test]
    fn use_self_super_crate_and_glob() {
        assert_eq!(bindings("self::b::pad"), vec![("pad".to_string(), "self::b".to_string(), Some("pad".to_string()))]);
        assert_eq!(bindings("super::x"), vec![("x".to_string(), "super".to_string(), Some("x".to_string()))]);
        assert_eq!(bindings("crate::a::b::f"), vec![("f".to_string(), "crate::a::b".to_string(), Some("f".to_string()))]);
        assert_eq!(bindings("crate::widgets::*"), vec![("*".to_string(), "crate::widgets".to_string(), None)]);
        // `use a::b::{self, c}` binds the module `b` itself.
        assert_eq!(
            bindings("a::b::{self, c}"),
            vec![("b".to_string(), "a::b".to_string(), None), ("c".to_string(), "a::b".to_string(), Some("c".to_string())),]
        );
    }

    #[test]
    fn plain_types_strip_refs_and_generics() {
        assert_eq!(plain_type("&mut Circle"), Some("Circle".to_string()));
        assert_eq!(plain_type("Circle<'a>"), Some("Circle".to_string()));
        assert_eq!(plain_type("shapes::Wheel"), Some("Wheel".to_string()));
        assert_eq!(plain_type("(u32, u32)"), None);
        assert_eq!(plain_type("Vec<Circle>"), Some("Vec".to_string()));
    }

    #[test]
    fn module_dirs_follow_rust_layout() {
        assert_eq!(module_dir_of_file("", "lib.rs"), "");
        assert_eq!(module_dir_of_file("src", "src/lib.rs"), "");
        assert_eq!(module_dir_of_file("src", "src/a/b.rs"), "a/b");
        assert_eq!(module_dir_of_file("src", "src/a/mod.rs"), "a");
    }

    #[test]
    fn path_attribute_is_read_backwards() {
        let src = "#[path = \"alt/bridge.rs\"]\nmod bridge;\n";
        assert_eq!(path_attr(src, src.find("mod bridge").unwrap()), Some("alt/bridge.rs".to_string()));
        assert_eq!(path_attr("mod plain;\n", 0), None);
    }

    #[test]
    fn split_top_keeps_nested_commas() {
        assert_eq!(split_top("render::{draw, paint}, Circle"), vec!["render::{draw, paint}", " Circle"]);
    }
}
