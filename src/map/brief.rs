//! `kula brief`: a one-page semantic brief for agents – what this repo is,
//! where to enter it, what is hot, and what to watch out for. Pure and
//! deterministic; no LLM, offline. Under 1500 tokens by a 4 chars per token
//! estimate, so the text is hard-capped at 6000 characters.

use super::arch::{self, ArchReport};
use super::entries::{self, Entry};
use super::tree::ModuleTree;
use serde::Serialize;

/// Token estimate the spec fixes: 4 characters per token.
pub const CHARS_PER_TOKEN: usize = 4;
/// The brief never exceeds this many tokens.
pub const MAX_TOKENS: usize = 1500;

/// What fits in one page, at 4 characters per token.
pub fn token_budget_chars() -> usize {
    MAX_TOKENS * CHARS_PER_TOKEN
}

#[derive(Debug, Serialize)]
pub struct BriefReport {
    pub schema: u32,
    pub repo: String,
    /// One package line each: name, modules, loc, churn.
    pub packages: Vec<String>,
    /// How to get in: mains, handlers, public roots.
    pub entry_points: Vec<Entry>,
    /// Architecture warnings: cycles, god modules, coupling.
    pub cycles: Vec<String>,
    pub god_modules: Vec<String>,
    pub coupling: f64,
    /// Modules ordered by churn times fan_in, hottest first.
    pub hot_spots: Vec<String>,
}

/// Build the report from the already-built tree (call `tree::module_tree`
/// once and share it). Deterministic: sorted everywhere, truncated by budget.
pub fn report(tree: &ModuleTree, db: &crate::store::Store) -> BriefReport {
    let entries = entries::entry_points(db);
    let ArchReport { cycles, god_modules, coupling, .. } = arch::check(tree, db);
    let hot = hot_spots(tree);

    BriefReport {
        schema: 1,
        repo: tree.name.clone(),
        packages: packages(tree),
        entry_points: entries,
        cycles: cycles.iter().map(|c| c.join(" -> ")).collect(),
        god_modules,
        coupling,
        hot_spots: hot,
    }
}

/// Render the report as a one-page markdown brief, capped at
/// [`token_budget_chars`] characters (1500 tokens at 4 chars per token).
pub fn markdown(r: &BriefReport) -> String {
    let mut s = String::new();
    s.push_str(&format!("## Brief: {}\n\n", r.repo));
    s.push_str("Packages, hottest first by churn and fan-in:\n");
    for p in &r.packages {
        s.push_str(&format!("- {p}\n"));
    }
    if !r.entry_points.is_empty() {
        s.push_str("\nEntry points:\n");
        for e in &r.entry_points {
            s.push_str(&format!("- {} ({}) {}\n", e.symbol, e.kind, e.file));
        }
    }
    if !r.cycles.is_empty() {
        s.push_str("\nDependency cycles to untangle:\n");
        for c in &r.cycles {
            s.push_str(&format!("- {c}\n"));
        }
    }
    if !r.god_modules.is_empty() {
        s.push_str("\nGod modules (above p95 fan and 1000 loc):\n");
        for m in &r.god_modules {
            s.push_str(&format!("- {m}\n"));
        }
    }
    if !r.hot_spots.is_empty() {
        s.push_str("\nHot spots (churn x fan-in):\n");
        for h in &r.hot_spots {
            s.push_str(&format!("- {h}\n"));
        }
    }
    s.push_str(&format!("\nModule coupling: {:.3} (mean fan-in normalised).\n", r.coupling));
    s.push_str("\nDig deeper with `kula map`, `kula explain <target>`, `kula check architecture`.\n");
    truncate(&s, token_budget_chars())
}

/// Cut at the character budget on a line boundary so the page never exceeds
/// 1500 tokens, and mark the cut.
fn truncate(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let cut: String = s.chars().take(cap).collect();
    let at = cut.rfind('\n').unwrap_or(cap);
    format!("{}\n… (truncated to fit one page)\n", &cut[..at])
}

/// One line per package: name, module count, loc, churn, top fan-in module.
fn packages(tree: &ModuleTree) -> Vec<String> {
    let mut rows: Vec<(i64, String, String)> = vec![];
    for p in &tree.packages {
        let loc: usize = p.loc + p.children.iter().map(|m| m.loc).sum::<usize>();
        let churn: i64 = p.churn_30d.max(p.children.iter().map(|m| m.churn_30d).max().unwrap_or(0));
        let hottest = p.children.iter().max_by_key(|m| (m.churn_30d, m.fan_in, reversed(&m.name))).cloned();
        let hot = hottest
            .map(|m| format!("hottest {}", m.name))
            .unwrap_or_else(|| "no modules".into());
        rows.push((churn, p.name.clone(), format!("{} ({} modules, loc {}, churn {}): {}", p.name, p.children.len(), loc, churn, hot)));
    }
    // Hottest packages first; ties alphabetical by name.
    rows.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    rows.into_iter().map(|(_, _, line)| line).collect()
}

/// Sort key helper so equal keys break alphabetically (max_by_key picks the
/// last maximum, so reverse the name to keep the first alphabetically).
fn reversed(s: &str) -> std::cmp::Reverse<Vec<u8>> {
    std::cmp::Reverse(s.as_bytes().to_vec())
}

/// Modules and packages ordered by churn times fan_in, hottest first.
fn hot_spots(tree: &ModuleTree) -> Vec<String> {
    let mut out: Vec<(i64, String)> = vec![];
    for p in &tree.packages {
        for m in &p.children {
            let score = m.churn_30d * m.fan_in;
            if score > 0 {
                out.push((score, format!("{} (churn {} x fan_in {})", m.path, m.churn_30d, m.fan_in)));
            }
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    out.truncate(5);
    out.into_iter().map(|(_, s)| s).collect()
}
