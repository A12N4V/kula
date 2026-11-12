//! What a slice leaves behind besides code. Its agent writes facts to
//! `$KULA_LEARNED`; they ride on the slice until `kula merge-train` makes them
//! memories pinned to the merged code. Fence suggestions it made inside its
//! worktree move to this checkout's queue for a person to review.

use super::task::Learned;
use crate::agents::{self, Suggestion};
use crate::git::Repo;
use crate::memory;
use crate::store::Store;
use std::path::Path;

/// `<target>: <fact>` lines; blank lines, `#` comments and lines without a target are skipped.
pub fn parse(text: &str) -> Vec<Learned> {
    let mut out: Vec<Learned> = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let Some((t, f)) = line.split_once(": ") else { continue };
        let l = Learned { target: t.trim().trim_matches('`').to_string(), text: f.trim().to_string() };
        if !l.target.is_empty() && !l.text.is_empty() && !out.contains(&l) {
            out.push(l);
        }
    }
    out
}

/// The slice's learned facts, and how many of its suggestions moved to `repo`.
pub fn harvest(repo: &Repo, wt: &Path, log_dir: &Path, slice: &str) -> (Vec<Learned>, usize) {
    let learned = std::fs::read_to_string(log_dir.join("learned.txt")).map(|t| parse(&t)).unwrap_or_default();
    let mut moved = 0;
    if let Ok(w) = Repo::discover(wt) {
        let theirs: Vec<Suggestion> = agents::suggestions(&w);
        for s in theirs {
            let by = format!("{} (slice {slice})", s.by);
            if agents::suggest(repo, s, &by).is_ok() {
                moved += 1;
            }
        }
    }
    (learned, moved)
}

/// Turns facts into memories anchored to the code in `tree`, indexing it first.
/// Returns the new memory ids and why any fact was not kept.
pub fn adopt(tree: &Repo, facts: &[Learned], by: &str) -> (Vec<u64>, Vec<String>) {
    let (mut ids, mut why) = (Vec::new(), Vec::new());
    if facts.is_empty() {
        return (ids, why);
    }
    let st = match crate::index::run(tree, true).and_then(|_| Store::open(tree)) {
        Ok(s) => s,
        Err(e) => return (ids, vec![format!("could not index the integrated tree for memories: {e:#}")]),
    };
    for f in facts {
        match memory::remember(tree, &st, &f.target, &f.text, by) {
            Ok(n) => ids.push(n.id),
            Err(e) => why.push(format!("memory for {} not kept: {e:#}", f.target)),
        }
    }
    (ids, why)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_target_and_fact() {
        let l = parse("# notes\n`greet`: says hello twice\nno target here\n\ngreet: says hello twice\na/lib.py: entry point\n");
        assert_eq!(l.len(), 2);
        assert_eq!(l[0], Learned { target: "greet".into(), text: "says hello twice".into() });
        assert_eq!(l[1].target, "a/lib.py");
    }
}
