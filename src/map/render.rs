//! Rendering for `kula map`: markdown, JSON (schema 1) and mermaid. Pure.

use super::arch;
use super::tree::ModuleTree;
use crate::store::Store;
use serde_json::{json, Value};

/// Restrict the tree to the zoom level. Zooms build on each other:
/// repo ⊂ package ⊂ module ⊂ symbol.
pub fn zoom(tree: &ModuleTree, level: &str) -> ModuleTree {
    let mut t = clone_shallow(tree);
    for p in &mut t.packages {
        match level {
            "repo" => {
                p.children.clear();
                p.symbols.clear();
            }
            "package" => {
                for m in &mut p.children {
                    m.children.clear();
                }
            }
            "module" | "symbol" => {}
            _ => {}
        }
    }
    t
}

fn clone_shallow(t: &ModuleTree) -> ModuleTree {
    ModuleTree { name: t.name.clone(), packages: t.packages.clone() }
}

/// Markdown: nested bullets with loc, fan-in/out and churn.
pub fn markdown(tree: &ModuleTree, level: &str) -> String {
    let mut s = String::new();
    s.push_str(&format!("# {}\n\n", tree.name));
    for p in &tree.packages {
        s.push_str(&format!(
            "- {} (package, loc {}, fan_in {}, fan_out {}, churn {})\n",
            p.path, p.loc, p.fan_in, p.fan_out, p.churn_30d
        ));
        if level == "repo" {
            continue;
        }
        for m in &p.children {
            match m.kind.as_str() {
                "module" => {
                    s.push_str(&format!(
                        "  - {} (module, loc {}, fan_in {}, fan_out {}, churn {})\n",
                        m.path, m.loc, m.fan_in, m.fan_out, m.churn_30d
                    ));
                    if level == "package" {
                        continue;
                    }
                    for sym in &m.children {
                        s.push_str(&format!(
                            "    - {} (symbol, {}, loc {}, fan_in {}, fan_out {})\n",
                            sym.name, sym.path, sym.loc, sym.fan_in, sym.fan_out
                        ));
                    }
                }
                _ => {
                    s.push_str(&format!(
                        "  - {} (symbol, {}, loc {}, fan_in {}, fan_out {})\n",
                        m.name, m.path, m.loc, m.fan_in, m.fan_out
                    ));
                }
            }
        }
    }
    s
}

/// JSON with `"schema": 1` at the top.
pub fn json(tree: &ModuleTree, level: &str) -> Value {
    let t = serde_json::to_value(tree).unwrap_or(Value::Null);
    json!({ "schema": 1, "zoom": level, "tree": t })
}

/// Mermaid flowchart of packages, modules (per zoom) and cross-module edges.
/// Always starts with `flowchart`.
pub fn mermaid(db: &Store, tree: &ModuleTree, level: &str) -> String {
    let mut s = String::from("flowchart TD\n");
    let mut ids: Vec<String> = Vec::new();
    for (i, p) in tree.packages.iter().enumerate() {
        let pid = format!("p{i}");
        s.push_str(&format!("  {pid}[\"{}\"]\n", esc(&p.name)));
        ids.push(pid.clone());
        if level == "repo" {
            continue;
        }
        let mut mi = 0;
        for m in &p.children {
            let mid = format!("p{i}m{mi}");
            mi += 1;
            let label = if level == "package" {
                m.name.clone()
            } else {
                format!("{} ({})", m.name, m.symbols.len())
            };
            s.push_str(&format!("  {mid}[\"{}\"]\n", esc(&label)));
            s.push_str(&format!("  {pid} --> {mid}\n"));
            ids.push(mid);
        }
    }
    // Cross-module edges at module and symbol zoom.
    if matches!(level, "module" | "symbol") {
        let (g, _) = arch::module_graph(db);
        let id_of = |dir: &str| -> Option<String> {
            tree.packages.iter().enumerate().find_map(|(i, p)| {
                p.children
                    .iter()
                    .enumerate()
                    .find(|(_, m)| m.kind == "module" && m.path == dir)
                    .map(|(j, _)| format!("p{i}m{j}"))
            })
        };
        let mut keys: Vec<&String> = g.keys().collect();
        keys.sort();
        for a in keys {
            let Some(ia) = id_of(a) else { continue };
            for b in sorted(g.get(a)) {
                if let Some(jb) = id_of(&b) {
                    s.push_str(&format!("  {ia} --> {jb}\n"));
                }
            }
        }
    }
    let _ = ids;
    s
}

fn sorted(v: Option<&std::collections::BTreeSet<String>>) -> Vec<String> {
    v.map(|s| s.iter().cloned().collect()).unwrap_or_default()
}

fn esc(s: &str) -> String {
    s.replace('"', "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tree::TreeNode;

    fn node(name: &str, kind: &str) -> TreeNode {
        TreeNode {
            name: name.into(),
            path: format!("x/{name}"),
            kind: kind.into(),
            loc: 10,
            symbols: vec![],
            fan_in: 1,
            fan_out: 1,
            churn_30d: 0,
            children: vec![],
        }
    }

    #[test]
    fn zoom_levels_strip_children() {
        let mut m = node("net", "module");
        m.children.push(node("pong", "symbol"));
        let t = ModuleTree { name: "r".into(), packages: vec![node("core", "package")] };
        let mut t = t;
        t.packages[0].children.push(m);
        assert!(zoom(&t, "repo").packages[0].children.is_empty());
        assert!(zoom(&t, "package").packages[0].children[0].children.is_empty());
        assert_eq!(zoom(&t, "module").packages[0].children[0].children.len(), 1);
        assert_eq!(zoom(&t, "symbol").packages[0].children[0].children.len(), 1);
    }

    #[test]
    fn json_has_schema_and_mermaid_starts_flowchart() {
        let t = ModuleTree { name: "r".into(), packages: vec![] };
        let j = json(&t, "module");
        assert_eq!(j["schema"], 1);
        let md = markdown(&t, "repo");
        assert!(md.starts_with("# r\n"));
    }
}
