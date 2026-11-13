//! Entry points declared in manifests: Cargo `[[bin]]` targets and Python
//! `[project.scripts]` / `[tool.poetry.scripts]`.

use std::collections::BTreeSet;
use std::path::Path;

/// Calls `push(symbol, kind, file)` for each declared entry. Looks for
/// manifests in every directory that holds an indexed file, and its parents.
pub fn manifest_entries(root: &Path, files: &[&str], push: &mut dyn FnMut(&str, &str, &str)) {
    let mut dirs: BTreeSet<String> = BTreeSet::new();
    dirs.insert(String::new());
    for f in files {
        let mut d = *f;
        while let Some((parent, _)) = d.rsplit_once('/') {
            if !dirs.insert(parent.to_string()) {
                break;
            }
            d = parent;
        }
    }
    let have: BTreeSet<&str> = files.iter().copied().collect();
    for dir in &dirs {
        let join = |rel: &str| if dir.is_empty() { rel.to_string() } else { format!("{dir}/{rel}") };
        if let Some(v) = read_toml(&root.join(dir).join("Cargo.toml")) {
            for b in v.get("bin").and_then(|b| b.as_array()).into_iter().flatten() {
                let Some(name) = b.get("name").and_then(|n| n.as_str()) else { continue };
                let path = b.get("path").and_then(|p| p.as_str()).map(str::to_string).unwrap_or_else(|| format!("src/bin/{name}.rs"));
                push(name, "cli", &join(&path));
            }
        }
        if let Some(v) = read_toml(&root.join(dir).join("pyproject.toml")) {
            let tables = [
                v.get("project").and_then(|p| p.get("scripts")),
                v.get("tool").and_then(|t| t.get("poetry")).and_then(|p| p.get("scripts")),
            ];
            for t in tables.into_iter().flatten().filter_map(|t| t.as_table()) {
                for (script, target) in t {
                    let Some(target) = target.as_str() else { continue };
                    let (module, func) = target.split_once(':').unwrap_or((target, script.as_str()));
                    let file = py_module_file(module, &join, &have).unwrap_or_else(|| join("pyproject.toml"));
                    push(func.trim(), "cli", &file);
                }
            }
        }
    }
}

fn read_toml(p: &Path) -> Option<toml::Value> {
    let text = std::fs::read_to_string(p).ok()?;
    text.parse::<toml::Table>().ok().map(toml::Value::Table)
}

/// `pkg.cli` → the indexed `pkg/cli.py` (or `src/pkg/cli.py`, or a package
/// `__init__.py`), if any.
fn py_module_file(module: &str, join: &dyn Fn(&str) -> String, have: &BTreeSet<&str>) -> Option<String> {
    let rel = module.trim().replace('.', "/");
    [format!("{rel}.py"), format!("src/{rel}.py"), format!("{rel}/__init__.py"), format!("src/{rel}/__init__.py")]
        .iter()
        .map(|c| join(c))
        .find(|c| have.contains(c.as_str()))
}
