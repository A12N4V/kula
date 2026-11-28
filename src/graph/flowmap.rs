//! H.1: the flow map. Entry points (routes, `main`, tests, uncalled callers)
//! unrolled into ordered execution flows, grouped into domains.
//!
//! Order and branches come from the caller's own text: each callee is placed
//! at the first line of the caller body that calls it, and a call nested in an
//! `if` / loop / `match` / `try` block (found by indentation, walking up from
//! the call line) is flagged. It reads the source rather than storing call
//! sites in the index, so older indexes work unchanged.

use crate::store::{Node, Store};
use anyhow::Result;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Serialize, Clone, Debug)]
pub struct Step {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: i64,
    /// Line in the caller where the call sits (0 when not found in its text).
    pub site: i64,
    pub depth: usize,
    /// `if`, `loop`, `match` or `try` when the call is inside such a block.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<&'static str>,
    pub conf: String,
    /// Index of the calling step in `steps`, none for the entry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<usize>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FlowPath {
    pub id: String,
    pub entry: Node,
    /// `route`, `main`, `test` or `entry`.
    pub kind: &'static str,
    /// The route pattern for `route` flows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    pub domain: i64,
    pub steps: Vec<Step>,
    pub files: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Domain {
    pub id: i64,
    pub label: String,
    pub flows: usize,
    pub files: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FlowMap {
    pub domains: Vec<Domain>,
    pub flows: Vec<FlowPath>,
}

const MAX_DEPTH: usize = 4;
const MAX_STEPS: usize = 40;

/// What kind of block a source line opens, if any.
fn opener(line: &str) -> Option<&'static str> {
    let t = line.trim_start().trim_start_matches('}').trim_start();
    let word: String = t.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
    match word.as_str() {
        "if" | "else" | "elif" | "unless" | "guard" => Some("if"),
        "for" | "while" | "loop" | "do" | "foreach" => Some("loop"),
        "match" | "switch" | "case" | "when" | "select" => Some("match"),
        "try" | "catch" | "except" | "finally" | "rescue" => Some("try"),
        _ => {
            // Inline forms: `x.forEach(`, `.map(|` closures, `=> match`.
            if t.contains(".forEach(") || t.contains(".for_each(") {
                Some("loop")
            } else if t.contains(" match ") && t.ends_with('{') {
                Some("match")
            } else {
                None
            }
        }
    }
}

fn indent(line: &str) -> usize {
    line.chars().take_while(|c| c.is_whitespace()).map(|c| if c == '\t' { 4 } else { 1 }).sum()
}

/// True when `line` calls `name`: `name(`, `.name(`, `name!(`, `name::<..>(` or
/// a Go/TS generic `name[`/`name<`; never inside a longer identifier.
fn calls(line: &str, name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let b = line.as_bytes();
    let mut from = 0;
    while let Some(i) = line[from..].find(name) {
        let at = from + i;
        let end = at + name.len();
        let before_ok = at == 0 || !(b[at - 1].is_ascii_alphanumeric() || b[at - 1] == b'_');
        let rest = line[end..].trim_start();
        let after_ok = rest.starts_with('(') || rest.starts_with("!(") || rest.starts_with("::<") || rest.starts_with('<');
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// Where in `body` (the caller's lines, starting at `first`) `name` is called,
/// and the block kind enclosing that call.
pub fn site(body: &[&str], first: i64, name: &str) -> Option<(i64, Option<&'static str>)> {
    let i = body.iter().skip(1).position(|l| calls(l, name))? + 1;
    let base = indent(body[0]);
    let mut cur = indent(body[i]);
    let mut kind = None;
    for l in body[1..i].iter().rev() {
        if l.trim().is_empty() {
            continue;
        }
        let ind = indent(l);
        if ind <= base {
            break;
        }
        if ind < cur {
            if let Some(k) = opener(l) {
                kind = Some(k);
                break;
            }
            cur = ind;
        }
    }
    // A call on the opener line itself (`if foo() {`) is a condition, not a branch.
    Some((first + i as i64, kind))
}

struct Src<'a> {
    root: &'a std::path::Path,
    cache: HashMap<String, Vec<String>>,
}

impl Src<'_> {
    fn body(&mut self, n: &Node) -> Vec<String> {
        if n.path.contains("..") {
            return vec![];
        }
        let root = self.root;
        let all = self.cache.entry(n.path.clone()).or_insert_with(|| {
            std::fs::read_to_string(root.join(&n.path)).map(|s| s.lines().map(str::to_string).collect()).unwrap_or_default()
        });
        let a = (n.start_line.max(1) - 1) as usize;
        let b = (n.end_line.max(n.start_line) as usize).min(all.len());
        if a >= b {
            return vec![];
        }
        all[a..b].to_vec()
    }
}

fn unroll(store: &Store, src: &mut Src, entry: &Node) -> Result<Vec<Step>> {
    let mut steps = vec![Step {
        id: entry.id,
        name: entry.name.clone(),
        kind: entry.kind.clone(),
        path: entry.path.clone(),
        line: entry.start_line,
        site: 0,
        depth: 0,
        branch: None,
        conf: "resolved".into(),
        from: None,
    }];
    let mut seen: HashSet<i64> = HashSet::from([entry.id]);
    // Depth first in call order, so the list reads top to bottom like the code runs.
    fn walk(store: &Store, src: &mut Src, at: usize, steps: &mut Vec<Step>, seen: &mut HashSet<i64>) -> Result<()> {
        let (id, depth) = (steps[at].id, steps[at].depth);
        if depth >= MAX_DEPTH || steps.len() >= MAX_STEPS {
            return Ok(());
        }
        let Some(me) = store.node(id)? else { return Ok(()) };
        let body = src.body(&me);
        let lines: Vec<&str> = body.iter().map(String::as_str).collect();
        let mut kids: Vec<(i64, Option<&'static str>, Node, String)> = store
            .neighbours_conf(id, "CALLS", true)?
            .into_iter()
            .filter(|(n, _)| !seen.contains(&n.id))
            .map(|(n, conf)| {
                let (site, branch) = if lines.is_empty() { None } else { site(&lines, me.start_line, &n.name) }.unwrap_or((0, None));
                (site, branch, n, conf)
            })
            .collect();
        // Unplaced calls (site 0) go last, then by name for a stable order.
        kids.sort_by(|a, b| (a.0 == 0).cmp(&(b.0 == 0)).then(a.0.cmp(&b.0)).then(a.2.name.cmp(&b.2.name)));
        for (site, branch, n, conf) in kids {
            if steps.len() >= MAX_STEPS {
                break;
            }
            if !seen.insert(n.id) {
                continue;
            }
            steps.push(Step {
                id: n.id,
                name: n.name.clone(),
                kind: n.kind.clone(),
                path: n.path.clone(),
                line: n.start_line,
                site,
                depth: depth + 1,
                branch,
                conf,
                from: Some(at),
            });
            let next = steps.len() - 1;
            walk(store, src, next, steps, seen)?;
        }
        Ok(())
    }
    walk(store, src, 0, &mut steps, &mut seen)?;
    Ok(steps)
}

/// CLI subcommand names, read from the source: variants of any `enum
/// Commands` / `Subcommand` / `Action` / `Verb` (the clap convention) in Rust
/// files, PascalCase → snake_case. A function named after a variant is a CLI
/// entry point.
fn cli_variants(store: &Store) -> HashSet<String> {
    let mut out = HashSet::new();
    let files: Vec<String> = store.nodes_where("kind = 'file'", []).unwrap_or_default().into_iter().map(|n| n.path).collect();
    for path in files {
        if !path.ends_with(".rs") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(store.root.join(&path)) else { continue };
        let mut in_enum = false;
        for line in text.lines() {
            let t = line.trim();
            if t.starts_with("enum ") && ["Commands", "Subcommand", "Action", "Verb"].iter().any(|k| t.contains(k)) {
                in_enum = true;
                continue;
            }
            if !in_enum {
                continue;
            }
            if t == "}" {
                in_enum = false;
                continue;
            }
            let word: &str = t.split(|c: char| !(c.is_alphanumeric() || c == '_')).next().unwrap_or("");
            if word.is_empty() || !word.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) {
                continue;
            }
            let mut snake = String::new();
            for (i, ch) in word.char_indices() {
                if ch.is_ascii_uppercase() && i > 0 {
                    snake.push('_');
                }
                snake.push(ch.to_ascii_lowercase());
            }
            out.insert(snake);
        }
    }
    out
}

/// The flow map: up to `limit` flows, routes and `main` first, then by reach.
pub fn flowmap(store: &Store, limit: usize) -> Result<FlowMap> {
    let mut entries: Vec<(Node, &'static str, Option<String>)> = Vec::new();
    let mut taken: HashSet<i64> = HashSet::new();
    for r in store.nodes_where("kind = 'route'", [])? {
        for (h, _) in store.neighbours_conf(r.id, "HANDLES", true)? {
            if taken.insert(h.id) {
                entries.push((h, "route", Some(r.name.clone())));
            }
        }
    }
    for m in store.nodes_where("kind = 'function' AND name = 'main'", [])? {
        if taken.insert(m.id) {
            entries.push((m, "main", None));
        }
    }
    // CLI subcommands: functions named after Commands/Subcommand enum variants.
    let subs = cli_variants(store);
    if !subs.is_empty() {
        let mut fns = store.nodes_where("kind = 'function'", [])?;
        fns.sort_by_key(|n| n.id);
        for f in fns {
            if subs.contains(&f.name) && taken.insert(f.id) {
                entries.push((f, "cli", None));
            }
        }
    }
    for e in super::paths::uncalled_callers(store)? {
        if taken.insert(e.id) {
            let kind = if crate::agent::is_test_path(&e.path) { "test" } else { "entry" };
            entries.push((e, kind, None));
        }
    }
    let mut src = Src { root: &store.root, cache: HashMap::new() };
    let mut flows = Vec::new();
    for (e, kind, route) in entries {
        let steps = unroll(store, &mut src, &e)?;
        let files: Vec<String> = steps.iter().map(|s| s.path.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        flows.push(FlowPath { id: format!("{kind}:{}", e.id), domain: e.community, entry: e, kind, route, steps, files });
    }
    let rank = |k: &str| match k {
        "route" => 0,
        "main" => 1,
        "cli" => 2,
        "entry" => 3,
        _ => 4,
    };
    flows.sort_by(|a, b| rank(a.kind).cmp(&rank(b.kind)).then(b.steps.len().cmp(&a.steps.len())).then(a.entry.name.cmp(&b.entry.name)));
    // Single-step flows say nothing unless they are routes.
    flows.retain(|f| f.steps.len() > 1 || f.kind == "route");
    flows.truncate(limit);
    let labels: HashMap<i64, String> = store.communities()?.into_iter().map(|c| (c.id, c.label)).collect();
    let mut by: BTreeMap<i64, (usize, std::collections::BTreeSet<String>)> = BTreeMap::new();
    for f in &flows {
        let d = by.entry(f.domain).or_default();
        d.0 += 1;
        d.1.extend(f.files.iter().cloned());
    }
    let mut domains: Vec<Domain> = by
        .into_iter()
        .map(|(id, (n, files))| Domain {
            id,
            label: labels.get(&id).cloned().filter(|l| !l.is_empty()).unwrap_or_else(|| common_dir(&files)),
            flows: n,
            files: files.into_iter().collect(),
        })
        .collect();
    domains.sort_by(|a, b| b.flows.cmp(&a.flows).then(a.label.cmp(&b.label)));
    Ok(FlowMap { domains, flows })
}

fn common_dir(files: &std::collections::BTreeSet<String>) -> String {
    let mut it = files.iter();
    let Some(first) = it.next() else { return "root".into() };
    let mut pre: Vec<&str> = first.split('/').collect();
    pre.pop();
    for f in it {
        let parts: Vec<&str> = f.split('/').collect();
        let n = pre.iter().zip(parts.iter()).take_while(|(a, b)| a == b).count();
        pre.truncate(n);
    }
    if pre.is_empty() {
        "root".into()
    } else {
        pre.join("/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_orders_and_flags_branches() {
        let body = [
            "fn run(x: u8) {",
            "    let a = load(x);",
            "    if a > 1 {",
            "        save(a);",
            "    }",
            "    for i in 0..a {",
            "        step(i);",
            "    }",
            "    preload(x);",
            "}",
        ];
        assert_eq!(site(&body, 10, "load"), Some((11, None)));
        assert_eq!(site(&body, 10, "save"), Some((13, Some("if"))));
        assert_eq!(site(&body, 10, "step"), Some((16, Some("loop"))));
        // `preload` must not match `load`, and `load` stays at its own line.
        assert_eq!(site(&body, 10, "preload"), Some((18, None)));
        assert_eq!(site(&body, 10, "missing"), None);
    }

    #[test]
    fn python_and_try_blocks() {
        let body = ["def go(self):", "    try:", "        self.fetch()", "    except Exception:", "        report()", "    done()"];
        assert_eq!(site(&body, 1, "fetch"), Some((3, Some("try"))));
        assert_eq!(site(&body, 1, "report"), Some((5, Some("try"))));
        assert_eq!(site(&body, 1, "done"), Some((6, None)));
    }

    #[test]
    fn match_arms_and_macros() {
        let body = [
            "fn f(k: K) {",
            "    match k {",
            "        K::A => one(),",
            "        K::B => {",
            "            two!(k);",
            "        }",
            "    }",
            "}",
        ];
        assert_eq!(site(&body, 1, "one"), Some((3, Some("match"))));
        assert_eq!(site(&body, 1, "two"), Some((5, Some("match"))));
    }
}
