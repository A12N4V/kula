//! `kula run`: any agent harness, held to kula's fences.
//!
//! Claude Code, Cursor, Codex and Gemini CLI ask kula before every tool call.
//! Everything else – Aider, OpenCode, Goose, a script, a harness written last
//! week – runs under `kula run -w <workflow> -- <command>`: the task starts in
//! the workflow, fenced files are made read-only for the run (hidden ones
//! unreadable), and when the command exits every fenced file it still managed
//! to change is put back. The agent's version is kept in `.kula/run/` for a
//! person to look at; nothing is deleted.

use crate::agents;
use crate::git::Repo;
use crate::guard::{self, Guards, Level};
use anyhow::{bail, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct Opts {
    pub workflow: Option<String>,
    pub agent: String,
    pub title: Option<String>,
    pub cmd: Vec<String>,
}

#[derive(serde::Serialize, Debug, Default)]
pub struct Report {
    pub agent: String,
    pub workflow: String,
    pub fenced_files: usize,
    /// Fenced files the run changed, and were put back.
    pub restored: Vec<(String, String)>,
    /// New files in fenced places, moved out of the way.
    pub moved: Vec<(String, String)>,
    pub kept_in: String,
    pub code: i32,
}

struct Held {
    path: String,
    level: Level,
    reason: String,
    bytes: Option<Vec<u8>>,
    #[cfg(unix)]
    mode: u32,
}

#[cfg(unix)]
fn set_mode(p: &std::path::Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode));
}

pub fn run(repo: &Repo, o: Opts) -> Result<Report> {
    if o.cmd.is_empty() {
        bail!("give the command to run after --, e.g. `kula run -w fix -- aider`");
    }
    let agent = agents::agent_id(&o.agent);
    let by = format!("agent:{agent}");
    let mut started = false;
    if let Some(wf) = o.workflow.as_deref() {
        match guard::task(repo) {
            Some(t) if t.workflow != wf => bail!(
                "a task is open in the {} workflow – finish it first (`kula task done`)",
                if t.workflow.is_empty() { "default" } else { &t.workflow }
            ),
            Some(_) => {}
            None => {
                let title = o.title.clone().unwrap_or_else(|| format!("{agent} in {wf}"));
                guard::task_start(repo, &title, vec![], Some(wf), &by)?;
                started = true;
            }
        }
    }
    let g = Guards::for_agent(repo, Some(&agent))?;
    let wf = g.workflow().map(|w| w.name.clone()).unwrap_or_default();

    // Hold every fenced file: remember it, then take away write (or read) access.
    let files = repo.run(&["ls-files", "-z"])?;
    let mut held: Vec<Held> = vec![];
    for p in files.split('\0').filter(|p| !p.is_empty()) {
        let v = g.path(p);
        if v.level.editable() {
            continue;
        }
        let full = repo.root.join(p);
        let Ok(meta) = std::fs::symlink_metadata(&full) else { continue };
        if !meta.is_file() {
            continue;
        }
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode()
        };
        held.push(Held {
            path: p.to_string(),
            level: v.level,
            reason: v.reason,
            bytes: std::fs::read(&full).ok(),
            #[cfg(unix)]
            mode,
        });
    }
    #[cfg(unix)]
    for h in &held {
        set_mode(&repo.root.join(&h.path), if h.level == Level::Hidden { 0 } else { h.mode & !0o222 });
    }
    let untracked_before: Vec<String> = repo.status()?.into_iter().filter(|f| f.untracked).map(|f| f.path).collect();

    eprintln!(
        "kula run: {} in {} – {} fenced file{} held{}",
        agent,
        if wf.is_empty() { "kula.toml's fences".to_string() } else { format!("the {wf} workflow") },
        held.len(),
        if held.len() == 1 { "" } else { "s" },
        if started { ", task started" } else { "" }
    );

    // Run it. Ctrl-C belongs to the agent: kula waits, then tidies up.
    let done = Arc::new(AtomicBool::new(false));
    let mut child = Command::new(&o.cmd[0])
        .args(&o.cmd[1..])
        .current_dir(std::env::current_dir().ok().filter(|d| d.starts_with(&repo.root)).unwrap_or(repo.root.clone()))
        .env("KULA_AGENT", &agent)
        .env("KULA_WORKFLOW", &wf)
        .spawn();
    let code = match child.as_mut() {
        Ok(c) => {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
            let d = done.clone();
            let waiter = std::thread::scope(|s| {
                let h = s.spawn(|| {
                    let st = c.wait();
                    d.store(true, Ordering::SeqCst);
                    st
                });
                rt.block_on(async {
                    while !done.load(Ordering::SeqCst) {
                        tokio::select! {
                            _ = tokio::signal::ctrl_c() => {}
                            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
                        }
                    }
                });
                h.join()
            });
            match waiter {
                Ok(Ok(st)) => st.code().unwrap_or(130),
                _ => 1,
            }
        }
        Err(e) => {
            eprintln!("kula run: could not start {}: {e}", o.cmd[0]);
            127
        }
    };

    // Give access back, then put back anything fenced that changed anyway.
    let stamp = crate::meta::now();
    let keep: PathBuf = repo.kula_dir().join("run").join(stamp.to_string());
    let mut r = Report { agent: agent.clone(), workflow: wf.clone(), fenced_files: held.len(), code, ..Default::default() };
    let stash = |rel: &str, from: &std::path::Path| -> Result<()> {
        let to = keep.join(rel);
        std::fs::create_dir_all(to.parent().unwrap())?;
        std::fs::rename(from, &to).or_else(|_| std::fs::copy(from, &to).map(|_| ()))?;
        Ok(())
    };
    for h in &held {
        let full = repo.root.join(&h.path);
        #[cfg(unix)]
        set_mode(&full, h.mode | 0o200);
        let now = std::fs::read(&full).ok();
        if now != h.bytes {
            if full.exists() {
                stash(&h.path, &full)?;
            }
            if let Some(b) = &h.bytes {
                std::fs::create_dir_all(full.parent().unwrap())?;
                std::fs::write(&full, b)?;
            }
            r.restored.push((h.path.clone(), h.reason.clone()));
        }
        #[cfg(unix)]
        set_mode(&full, h.mode);
    }
    let before: HashMap<&str, ()> = untracked_before.iter().map(|p| (p.as_str(), ())).collect();
    for f in repo.status()?.into_iter().filter(|f| f.untracked && !before.contains_key(f.path.as_str())) {
        let v = g.path(&f.path);
        if !v.level.editable() && !f.path.starts_with(".kula/") {
            stash(&f.path, &repo.root.join(&f.path))?;
            r.moved.push((f.path, v.reason));
        }
    }
    if !r.restored.is_empty() || !r.moved.is_empty() {
        r.kept_in = keep.strip_prefix(&repo.root).unwrap_or(&keep).display().to_string();
    }
    if started {
        guard::task_done(repo)?;
    }
    Ok(r)
}
