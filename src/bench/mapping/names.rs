//! Flow-name quality: the rubric from `docs/MAPPING.md` plus keyword overlap.
//! Score 0–1: 0.25 verb–object, 0.25 ≤ 12 words, 0.25 no code identifiers,
//! 0.25 keyword overlap with the gold flow's keywords.

use std::collections::BTreeSet;

/// Verbs the rubric recognises at the start of a name (case-insensitive).
const VERBS: [&str; 60] = [
    "add",
    "aggregate",
    "apply",
    "build",
    "check",
    "clean",
    "collect",
    "commit",
    "compare",
    "complete",
    "compute",
    "count",
    "decode",
    "detect",
    "diff",
    "dispatch",
    "draw",
    "encode",
    "extract",
    "fetch",
    "find",
    "format",
    "generate",
    "group",
    "handle",
    "import",
    "index",
    "install",
    "list",
    "load",
    "log",
    "map",
    "merge",
    "name",
    "parse",
    "plan",
    "print",
    "query",
    "read",
    "record",
    "remove",
    "render",
    "resolve",
    "run",
    "save",
    "scan",
    "search",
    "serve",
    "show",
    "sort",
    "split",
    "store",
    "stream",
    "summarise",
    "summarize",
    "sync",
    "test",
    "track",
    "update",
    "write",
];

/// Rubric + keyword score for one produced name against one gold keyword set.
pub fn score(name: &str, keywords: &[String]) -> f64 {
    let mut s = 0.0;
    let first = name.split_whitespace().next().unwrap_or("").to_lowercase();
    if VERBS.contains(&first.as_str()) {
        s += 0.25;
    }
    if name.split_whitespace().count() <= 12 {
        s += 0.25;
    }
    if !has_identifiers(name) {
        s += 0.25;
    }
    s + 0.25 * keyword_overlap(name, keywords)
}

fn has_identifiers(name: &str) -> bool {
    // snake_case, path separators or camelCase glued words read as code, not
    // as a value proposition.
    name.contains('_')
        || name.contains("::")
        || name.contains('/')
        || name.split_whitespace().any(|w| w.len() > 3 && w[1..].chars().any(|c| c.is_uppercase()))
}

/// Fraction of gold keywords that appear in the name (case-insensitive),
/// clamped to 1.0.
pub fn keyword_overlap(name: &str, keywords: &[String]) -> f64 {
    if keywords.is_empty() {
        return 0.0;
    }
    let words: BTreeSet<String> =
        name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| w.to_string()).collect();
    let hits = keywords.iter().filter(|k| words.contains(&k.to_lowercase())).count();
    (hits as f64 / keywords.len() as f64).min(1.0)
}

/// Baseline flow name from the family's source and terminal identifiers:
/// "run_index → save_map" becomes "Run index to save map". Wave 2's real
/// namer replaces this; it exists so the bench has something to score.
pub fn baseline_name(source: &str, terminal: &str) -> String {
    let words = |s: &str| -> Vec<String> { s.split(['_', '-', '.']).filter(|w| !w.is_empty()).map(|w| w.to_string()).collect() };
    let src = words(source);
    let term = words(terminal);
    let mut out = String::new();
    if let Some(w) = src.first() {
        let mut it = w.chars();
        if let Some(c) = it.next() {
            out.extend(c.to_uppercase());
        }
        out.push_str(it.as_str());
        out.push(' ');
        out.push_str(&src[1..].join(" "));
    }
    if !term.is_empty() {
        if !out.is_empty() {
            out.push_str(" to ");
        }
        out.push_str(&term.join(" "));
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rubric_prefers_verb_object_outcome() {
        assert!(score("Decode a pedigree file", &["decode".into(), "pedigree".into()]) > 0.9);
        assert!(score("index_repo chain", &[]) < 0.6);
    }

    #[test]
    fn camel_words_count_as_identifiers() {
        assert!(has_identifiers("Save MapState"));
        assert!(!has_identifiers("Save the map state"));
    }

    #[test]
    fn baseline_name_reads_as_a_sentence() {
        assert_eq!(baseline_name("run_index", "save_map"), "Run index to save map");
    }
}
