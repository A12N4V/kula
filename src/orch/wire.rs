//! Connects a slice's worktree to its agent the same way `kula connect` does,
//! so the agent's own tool calls pass through `kula guard hook`. The files that
//! wiring writes are kula's, not the slice's: the gate skips them and they are
//! put back before the slice is committed.

use crate::agents;
use crate::git::Repo;
use anyhow::Result;
use std::path::Path;

const LIST: &str = ".kula/wired";

/// Wires `agent` into the worktree at `wt`; returns the files it changed.
pub fn wire(wt: &Path, agent: &str) -> Result<Vec<String>> {
    let id = agents::agent_id(agent);
    if !agents::AGENTS.iter().any(|(a, _)| *a == id) {
        return Ok(vec![]);
    }
    let before = |f: &str| std::fs::read(wt.join(f)).ok();
    let files: Vec<&str> = agents::files_for(&id);
    let old: Vec<Option<Vec<u8>>> = files.iter().map(|f| before(f)).collect();
    agents::connect_files(wt, &id)?;
    let mut changed: Vec<String> = files.iter().zip(old).filter(|(f, o)| before(f) != *o).map(|(f, _)| f.to_string()).collect();
    changed.sort();
    std::fs::create_dir_all(wt.join(".kula"))?;
    std::fs::write(wt.join(LIST), changed.join("\n"))?;
    Ok(changed)
}

/// The files wiring wrote in this worktree.
pub fn wired(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join(LIST)).map(|s| s.lines().filter(|l| !l.is_empty()).map(String::from).collect()).unwrap_or_default()
}

/// Puts the wired files back as the base had them, before a commit.
pub fn unwire(w: &Repo) -> Result<()> {
    for f in wired(&w.root) {
        if w.run(&["ls-files", "--error-unmatch", "--", &f]).is_ok() {
            w.run(&["checkout", "--", &f])?;
        } else {
            let _ = std::fs::remove_file(w.root.join(&f));
        }
    }
    Ok(())
}
