//! Per-language call resolvers.
//!
//! A resolver receives one parsed file plus the symbol table, the import graph
//! and the lookups the linker already built, and returns exact
//! `(call byte, target node)` pairs. The linker applies those first as
//! `resolved` edges and skips the returned call bytes in the name linker. A
//! resolver may only add exact edges, or claim a call site it has *proven* the
//! name linker gets wrong – it must never silently drop recall.

use std::collections::{HashMap, HashSet};

use crate::store::Node;

use super::ParsedFile;

pub mod py;
pub mod rs;
pub mod ts;

/// How an imported (or re-exported) name reaches this file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportKind {
    /// `import {a as b}` – local `b`, the source file's `a`.
    Named,
    /// `import Def from "./m"` – local `Def` is the module's default export.
    Default,
    /// `import * as NS from "./m"`.
    Namespace,
    /// `export {x} from "./m"` / `export * from "./m"`.
    Reexport,
}

/// One binding an import (or re-export) statement introduces.
#[derive(Debug, Clone)]
pub struct ImportBinding {
    /// The name visible in this file. `"*"` for `export * from`.
    pub local: String,
    /// The module specifier as written (`"./a"`, `"@/lib/x"`, `"react"`).
    pub module: String,
    /// The name in the source module, when it differs (`a` of `a as b`).
    pub exported: Option<String>,
    pub kind: ImportKind,
}

/// Everything a resolver may read about one file and its context.
pub struct ResolveCtx<'a> {
    /// The parsed file: defs (name, parent_name, byte range), calls
    /// `(name, byte)`, `self_calls`, raw `imports` plus the `import_bindings`.
    pub file: &'a ParsedFile,
    /// id → node (name, path, lang, kind, parent).
    pub nodes: &'a [Node],
    pub by_name: &'a HashMap<String, Vec<usize>>,
    /// path → file node id.
    pub by_path: &'a HashMap<String, usize>,
    pub by_stem: &'a HashMap<String, Vec<usize>>,
    /// The file→file import graph and directory index: part of the frozen seam,
    /// read by the Python/Rust/Go resolvers in later waves.
    #[allow(dead_code)]
    pub imports_of: &'a HashMap<usize, HashSet<usize>>,
    #[allow(dead_code)]
    pub by_dir: &'a HashMap<String, Vec<usize>>,
    /// Read a repo-relative file (tsconfig.json, jsconfig.json, go.mod).
    pub read: &'a dyn Fn(&str) -> Option<String>,
}

impl<'a> ResolveCtx<'a> {
    /// The file node id of `path`, when indexed.
    pub fn file_id(&self, path: &str) -> Option<usize> {
        self.by_path.get(path).copied()
    }

    /// Top-level symbol nodes declared in `path` (parent is the file node).
    pub fn top_level(&self, path: &str) -> Vec<usize> {
        let Some(fid) = self.file_id(path) else { return vec![] };
        (0..self.nodes.len()).filter(|c| self.nodes[*c].path == path && self.nodes[*c].parent == Some(fid as i64)).collect()
    }
}

/// What a resolver found in one file.
#[derive(Debug, Default)]
pub struct ResolveOut {
    /// `(call byte, target node id)` → applied as `resolved`.
    pub edges: Vec<(usize, usize)>,
    /// Call bytes the name linker must skip.
    pub claimed: HashSet<usize>,
}

pub trait Resolver {
    fn langs(&self) -> &'static [&'static str];
    fn resolve(&self, ctx: &ResolveCtx) -> ResolveOut;
}

/// Every resolver, in order. Each wave appends exactly one entry here
/// (R1 built the seam; R2–R4 add `&py::Py`, `&rs::Rust`, `&go::Go`).
pub const RESOLVERS: &[&dyn Resolver] = &[&ts::Ts, &py::Py, &rs::Rs];

/// Run every resolver that claims this file's language and merge the results.
pub fn run(ctx: &ResolveCtx) -> ResolveOut {
    let mut out = ResolveOut::default();
    for r in RESOLVERS {
        if r.langs().contains(&ctx.file.lang) {
            let o = r.resolve(ctx);
            out.edges.extend(o.edges);
            out.claimed.extend(o.claimed);
        }
    }
    out
}

/// The `this`/`self` rule, lifted verbatim from the linker: a call whose
/// receiver is `this`/`self`/`Self` binds to a member of the caller's own
/// class, exactly, when there is exactly one such member. Returns the target
/// node id; `None` means "not proven", so the caller must let the name linker
/// handle the byte (this preserves the original fall-through semantics).
pub fn self_target(ctx: &ResolveCtx, name: &str, byte: usize) -> Option<usize> {
    let pf = ctx.file;
    let enclosing = pf
        .defs
        .iter()
        .enumerate()
        .filter(|(_, d)| d.start_byte <= byte && byte < d.end_byte)
        .min_by_key(|(_, d)| d.end_byte - d.start_byte)
        .map(|(i, _)| i)?;
    let owner = pf.defs[enclosing].parent_name.as_deref()?;
    let hit: Vec<usize> = ctx
        .by_name
        .get(name)
        .into_iter()
        .flatten()
        .copied()
        .filter(|c| ctx.nodes[*c].path == pf.path && ctx.nodes[*c].parent.is_some_and(|p| ctx.nodes[p as usize].name == owner))
        .collect();
    if hit.len() == 1 {
        Some(hit[0])
    } else {
        None
    }
}
