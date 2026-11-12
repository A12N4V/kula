//! The shell routes past the fences that the tokenizer and the first
//! `shell_guard` checks miss: long in-place flags, links and editors, archive
//! extraction, globbed targets, `xargs` and `find -exec` writers, scripts piped
//! or sourced into a shell, history-moving git, and recursive reads that sweep
//! hidden files up. Each check only refuses; none grants anything.

use super::{check_target, expand, join_rel, Vars};
use std::path::PathBuf;
use std::process::Command;

/// A working directory the guard cannot follow (a glob, or a path out of the repo).
pub(super) const LOST: &str = "\u{0}lost";

/// Commands that write the files they are handed.
const WRITERS: &[&str] = &[
    "rm", "mv", "cp", "ln", "tee", "touch", "truncate", "dd", "install", "rsync", "sed", "perl", "ruby", "awk", "gawk", "chmod", "chown",
    "shred", "unlink", "rmdir", "ed", "ex", "vi", "vim", "nvim", "nano", "emacs", "patch", "sh", "bash", "zsh", "python", "python3",
    "node",
];
const EDITORS: &[&str] = &["ed", "ex", "vi", "vim", "nvim", "nano", "emacs", "pico", "micro", "joe", "kak", "hx"];
const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "ksh", "fish"];
const INTERPRETERS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "ksh", "fish", "source", ".", "python", "python3", "node", "ruby", "perl", "php", "deno", "bun", "tsx",
    "ts-node",
];

fn refuse(why: &str) -> Option<String> {
    Some(format!("kula guard: refused – {why}."))
}

fn base(w: &str) -> &str {
    w.rsplit('/').next().unwrap_or(w)
}

/// The repository's top level, from the hook's own working directory.
fn root() -> Option<PathBuf> {
    static ROOT: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    ROOT.get_or_init(|| {
        let out = Command::new("git").args(["rev-parse", "--show-toplevel"]).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !s.is_empty()).then(|| PathBuf::from(s))
    })
    .clone()
}

/// An absolute path inside the repository, made repo-relative; `None` when it is outside.
pub(super) fn inside(abs: &str) -> Option<String> {
    let r = root()?;
    let roots = [r.clone(), r.canonicalize().unwrap_or(r)];
    let p = std::path::Path::new(abs);
    roots.iter().find_map(|r| p.strip_prefix(r).ok()).map(|rel| rel.to_string_lossy().trim_start_matches('/').to_string())
}

/// Where `cd <d>` (or `pushd`) lands, repo-relative, or [`LOST`].
pub(super) fn cd_to(cd: &str, d: &str, vars: &Vars, cwd: &str) -> String {
    let d = expand(d, vars, cwd);
    if d.contains('$') || d.contains(['*', '?', '[']) || d == "-" || d.starts_with('~') {
        return LOST.into();
    }
    if d.starts_with('/') {
        return inside(&d).unwrap_or_else(|| LOST.into());
    }
    if cd == LOST {
        return LOST.into();
    }
    // `..` past the top leaves the repository
    let mut parts: Vec<&str> = cd.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    for c in d.split('/') {
        match c {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return LOST.into();
                }
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn glob_chars(s: &str) -> bool {
    s.contains(['*', '?', '['])
}

/// Whether the repo-relative `full` (which may be a glob) names `f` or a directory above it.
pub(super) fn covers(full: &str, f: &str) -> bool {
    if full.is_empty() || f == full || f.starts_with(&format!("{full}/")) {
        return true;
    }
    if !glob_chars(full) {
        return false;
    }
    let Ok(g) = globset::GlobBuilder::new(full).literal_separator(true).build() else { return true };
    let m = g.compile_matcher();
    // the glob names f itself, or one of its parent directories
    let parts: Vec<&str> = f.split('/').collect();
    (1..=parts.len()).any(|n| m.is_match(parts[..n].join("/")))
}

/// The fenced path a word would reach from `cd`, if any.
fn hit<'a>(w: &str, cd: &str, vars: &Vars, cwd: &str, paths: &'a [String]) -> Option<&'a str> {
    let e = expand(w, vars, cwd);
    let full = if e.starts_with('/') {
        inside(&e)?
    } else if cd == LOST || e.starts_with('~') {
        return None;
    } else {
        join_rel(cd, &e)
    };
    paths.iter().find(|f| covers(&full, f)).map(String::as_str)
}

fn args(ws: &[String]) -> Vec<&str> {
    ws.iter().skip(1).map(String::as_str).filter(|w| !w.starts_with('-')).collect()
}

/// Checks for one segment, its first word already past assignments.
#[allow(clippy::too_many_arguments)]
pub(super) fn segment(
    seg: &str,
    ws: &[String],
    cd: &str,
    vars: &Vars,
    cwd: &str,
    fenced: &[String],
    hidden: &[String],
    extra: &mut Vec<String>,
) -> Option<String> {
    let name = base(&ws[0]);
    // what the tokenizer reads as written, resolved from this segment's cwd and globs
    for t in crate::agents::shell_targets(seg).0.into_iter().filter(|t| t.write) {
        if t.path.starts_with('/') && inside(&t.path).is_none() {
            continue;
        }
        let p = if t.path.starts_with('/') { inside(&t.path).unwrap_or_default() } else { t.path.clone() };
        if cd == LOST && !t.path.starts_with('/') {
            return refuse(&format!("cannot tell which directory {p} is written from – use a repo path"));
        }
        if let Some(why) = check_target(&p, if t.path.starts_with('/') { "" } else { cd }, vars, cwd, fenced, extra) {
            return Some(why);
        }
        if super::is_own(&join_rel(cd, &p)) {
            return refuse(&format!("{p} is kula's own state – a person's to change"));
        }
    }
    // in-place edits in their long spelling
    if matches!(name, "sed" | "gsed" | "perl" | "ruby")
        && ws.iter().any(|w| w.starts_with("--in-place") || w.starts_with("-i") || w.starts_with("-pi") || w.starts_with("-ni"))
    {
        if let Some(f) = args(ws).iter().find_map(|w| hit(w, cd, vars, cwd, fenced)) {
            return refuse(&format!("{name} would edit {f} in place, and it is fenced for agents"));
        }
    }
    // a link to fenced files is a door to them
    if name == "ln" {
        if let Some(f) = args(ws).iter().find_map(|w| hit(w, cd, vars, cwd, fenced)) {
            return refuse(&format!("`ln` would link to {f}, which is fenced for agents"));
        }
    }
    if EDITORS.contains(&name) {
        if let Some(f) = args(ws).iter().find_map(|w| hit(w, cd, vars, cwd, fenced)) {
            return refuse(&format!("{name} would edit {f}, which is fenced for agents"));
        }
    }
    if let Some(why) = extract(name, ws, cd, vars, cwd, fenced) {
        return Some(why);
    }
    // writers fed from a pipe or a search: the files they get are unknown here
    for (i, w) in ws.iter().enumerate() {
        let feeds = base(w) == "xargs" || base(w) == "parallel";
        let exec = matches!(w.as_str(), "-exec" | "-execdir" | "-ok" | "-okdir") && name == "find";
        if !feeds && !exec {
            continue;
        }
        let next = ws[i + 1..].iter().map(|w| base(w)).find(|w| !w.starts_with('-') && !w.chars().all(|c| c.is_ascii_digit()));
        let Some(cmd) = next else { continue };
        if !WRITERS.contains(&cmd) {
            continue;
        }
        if exec {
            let roots = find_roots(ws, cd);
            if fenced.iter().any(|f| roots.iter().any(|r| covers(r, f))) {
                return refuse(&format!("`find -exec {cmd}` would reach fenced files – narrow the search path"));
            }
        } else {
            return refuse(&format!("`{w} {cmd}` writes files the fence cannot see in advance – name them directly"));
        }
    }
    if name == "find" && ws.iter().any(|w| w == "-delete") {
        let roots = find_roots(ws, cd);
        if fenced.iter().any(|f| roots.iter().any(|r| covers(r, f))) {
            return refuse("`find -delete` would remove fenced files");
        }
    }
    if let Some(why) = scripts(seg, ws, cd, vars, cwd, fenced, hidden) {
        return Some(why);
    }
    sweeps(name, ws, cd, vars, cwd, hidden)
}

fn find_roots(ws: &[String], cd: &str) -> Vec<String> {
    let from: Vec<&str> = ws.iter().skip(1).take_while(|w| !w.starts_with('-') && *w != "!" && *w != "(").map(String::as_str).collect();
    if from.is_empty() {
        return vec![cd.to_string()];
    }
    from.iter().map(|f| if f.starts_with('/') { inside(f).unwrap_or_else(|| LOST.into()) } else { join_rel(cd, f) }).collect()
}

/// `tar -x` / `unzip`: refused when what they unpack lands on fenced files.
fn extract(name: &str, ws: &[String], cd: &str, vars: &Vars, cwd: &str, fenced: &[String]) -> Option<String> {
    let flag_after = |flags: &[&str]| -> Option<String> {
        for (i, w) in ws.iter().enumerate() {
            for f in flags {
                if w == f {
                    return ws.get(i + 1).cloned();
                }
                if let Some(v) = w.strip_prefix(&format!("{f}=")) {
                    return Some(v.to_string());
                }
            }
        }
        None
    };
    let (dest, archive, list): (Option<String>, Option<String>, &[&str]) = match name {
        "tar" | "bsdtar" | "gtar" => {
            let cluster = ws.get(1).map(|w| w.trim_start_matches('-').to_string()).unwrap_or_default();
            let extracting = ws.iter().any(|w| w == "--extract" || w == "--get")
                || (cluster.contains('x') && !cluster.contains('c') && cluster.chars().all(|c| c.is_ascii_alphabetic()))
                || ws.iter().any(|w| w.starts_with('-') && !w.starts_with("--") && w.contains('x'));
            if !extracting {
                return None;
            }
            // the archive follows the cluster that holds `f`, or `-f` / `--file`
            let mut archive = flag_after(&["-f", "--file"]);
            if archive.is_none() {
                if let Some(i) = ws.iter().position(|w| !w.starts_with("--") && w.trim_start_matches('-').contains('f') && w != "tar") {
                    archive = ws.get(i + 1).cloned();
                }
            }
            (flag_after(&["-C", "--directory"]), archive, &["-tf"])
        }
        "unzip" => {
            let archive = ws.iter().skip(1).find(|w| !w.starts_with('-') && Some(w.as_str()) != flag_after(&["-d"]).as_deref()).cloned();
            (flag_after(&["-d"]), archive, &["-Z1"])
        }
        _ => return None,
    };
    let dest = match dest {
        Some(d) if d.starts_with('/') => inside(&expand(&d, vars, cwd))?,
        Some(d) => cd_to(cd, &d, vars, cwd),
        None => cd.to_string(),
    };
    if dest == LOST {
        return refuse(&format!("cannot tell where `{name}` unpacks – name a repo path"));
    }
    if let Some(f) = fenced.iter().find(|f| *f == &dest || dest.starts_with(&format!("{f}/"))) {
        return refuse(&format!("`{name}` would unpack into {f}, which is fenced for agents"));
    }
    if !fenced.iter().any(|f| covers(&dest, f)) {
        return None;
    }
    // unpacking above fenced files: read the archive's own list
    let Some(a) = archive else { return refuse(&format!("cannot tell what `{name}` unpacks")) };
    let a = expand(&a, vars, cwd);
    let a_path = if a.starts_with('/') { PathBuf::from(&a) } else { root().unwrap_or_default().join(join_rel(cd, &a)) };
    let tool = if name == "unzip" { "unzip" } else { "tar" };
    let out = Command::new(tool).args(list).arg(&a_path).output();
    let entries = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return refuse(&format!("cannot read what {a} would unpack – unpack it outside the repo, or as a person")),
    };
    for e in entries.lines().map(str::trim).filter(|e| !e.is_empty()) {
        let p = join_rel(&dest, e);
        if let Some(f) = fenced.iter().find(|f| covers(p.trim_end_matches('/'), f)) {
            return refuse(&format!("{a} would unpack over {f}, which is fenced for agents"));
        }
    }
    None
}

/// Scripts piped into a shell, and script files run or sourced: their text is
/// what runs, so it is read for fenced and hidden paths.
fn scripts(seg: &str, ws: &[String], cd: &str, vars: &Vars, cwd: &str, fenced: &[String], hidden: &[String]) -> Option<String> {
    // `… | sh`: the script is whatever came down the pipe
    let pieces: Vec<&str> = seg.split('|').collect();
    for (i, p) in pieces.iter().enumerate().skip(1) {
        if p.trim().is_empty() || pieces[i - 1].trim().is_empty() {
            continue; // `||`
        }
        let w: Vec<&str> = p.split_whitespace().filter(|w| !matches!(*w, "sudo" | "env" | "command" | "exec")).collect();
        let Some(first) = w.first().map(|w| base(w)) else { continue };
        let reads_stdin = w.iter().skip(1).all(|a| a.starts_with('-'));
        if (SHELLS.contains(&first) || matches!(first, "python" | "python3" | "node" | "ruby" | "perl" | "php")) && reads_stdin {
            return refuse(&format!("a script piped into `{first}` runs what the fence cannot see – run the commands themselves"));
        }
    }
    let name = base(&ws[0]);
    let direct = ws[0].contains('/') && !INTERPRETERS.contains(&name);
    let file = if direct {
        Some(ws[0].as_str())
    } else if INTERPRETERS.contains(&name) {
        if ws.iter().any(|w| matches!(w.as_str(), "-c" | "-e" | "-m" | "--eval" | "-p" | "--version" | "-V" | "-h" | "--help")) {
            return None;
        }
        ws.iter().skip(1).map(String::as_str).find(|w| !w.starts_with('-'))
    } else {
        None
    }?;
    let e = expand(file, vars, cwd);
    let path = if e.starts_with('/') {
        PathBuf::from(&e)
    } else if cd == LOST {
        return refuse(&format!("cannot tell which {file} would run"));
    } else {
        root().unwrap_or_default().join(join_rel(cd, &e))
    };
    let text = match std::fs::read(&path) {
        Ok(b) => match String::from_utf8(b) {
            Ok(t) => t,
            Err(_) => return None, // a binary, not a script
        },
        Err(_) if direct => return None,
        Err(_) => return refuse(&format!("cannot read the script {file} – write it first, then run it, so the fence can read it")),
    };
    let own = ["kula.toml", ".kula/", ".git/hooks", "core.hooksPath"];
    if let Some(f) = fenced.iter().chain(hidden).map(String::as_str).chain(own).find(|f| text.contains(*f)) {
        return refuse(&format!("the script {file} touches {f}, which is fenced for agents"));
    }
    None
}

/// Recursive reads and archives whose sweep takes hidden files along.
fn sweeps(name: &str, ws: &[String], cd: &str, vars: &Vars, cwd: &str, hidden: &[String]) -> Option<String> {
    if hidden.is_empty() {
        return None;
    }
    let short = |c: char| ws.iter().any(|w| w.starts_with('-') && !w.starts_with("--") && w.contains(c));
    let mut roots: Vec<&str> = args(ws);
    let sweeping = match name {
        "grep" | "egrep" | "fgrep" => {
            if !(short('r') || short('R') || ws.iter().any(|w| w.starts_with("--recursive") || w.starts_with("--dereference-recursive")))
                || ws.iter().any(|w| w.starts_with("--exclude"))
            {
                return None;
            }
            // the pattern comes first unless -e or -f gave it
            if !ws.iter().any(|w| w == "-e" || w == "-f") && !roots.is_empty() {
                roots.remove(0);
            }
            true
        }
        "rg" | "ag" => ws.iter().any(|w| w == "--hidden" || w == "-uu" || w == "-uuu" || w == "-." || w == "--no-ignore"),
        "tar" | "bsdtar" | "gtar" => {
            let cluster = ws.get(1).map(|w| w.trim_start_matches('-').to_string()).unwrap_or_default();
            let c = cluster.contains('c') && cluster.chars().all(|c| c.is_ascii_alphabetic())
                || short('c')
                || ws.iter().any(|w| w == "--create");
            if c {
                // the archive named after f is written, not read
                if let Some(i) = ws.iter().position(|w| w.trim_start_matches('-').contains('f') && !w.starts_with("--") && w != "tar") {
                    let skip = ws.get(i + 1).map(String::as_str);
                    roots.retain(|r| Some(*r) != skip && !r.chars().all(|c| c.is_ascii_alphabetic() && cluster == *r));
                }
            }
            c
        }
        "zip" => {
            if !roots.is_empty() {
                roots.remove(0);
            }
            short('r') || ws.iter().any(|w| w == "--recurse-paths")
        }
        "cp" | "rsync" | "scp" => short('r') || short('R') || short('a') || ws.iter().any(|w| w == "--recursive" || w == "--archive"),
        _ => false,
    };
    if !sweeping {
        return None;
    }
    if roots.is_empty() {
        roots.push(".");
    }
    for r in roots {
        if let Some(h) = hit(r, cd, vars, cwd, hidden) {
            return refuse(&format!("`{name}` would sweep up {h}, which is hidden from agents – narrow the path or exclude it"));
        }
    }
    None
}

/// `git …` that moves the tree from history: refused when the change it brings touches fenced files.
pub(super) fn git_moves(sub: &str, args: &[&str], cd: &str, fenced: &[String], hidden: &[String]) -> Option<String> {
    let pos: Vec<&str> = args.iter().skip(1).copied().filter(|a| !a.starts_with('-')).collect();
    let force = args.iter().any(|a| matches!(*a, "-f" | "--force" | "--discard-changes" | "--hard" | "--merge"));
    let touched = |revs: &[&str]| -> Option<Vec<String>> {
        let out = Command::new("git").args(["diff", "--name-only"]).args(revs).arg("--").output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).lines().map(String::from).collect())
    };
    let is_rev = |r: &str| {
        Command::new("git")
            .args(["rev-parse", "--verify", "-q", &format!("{r}^{{commit}}")])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    let check = |files: Option<Vec<String>>, what: &str| -> Option<String> {
        match files {
            None => refuse(&format!("cannot tell what `git {sub} {what}` would change – a person's to run")),
            Some(fs) => fs
                .iter()
                .find(|f| fenced.contains(f))
                .and_then(|f| refuse(&format!("`git {sub} {what}` would change {f}, which is fenced for agents"))),
        }
    };
    let fenced_any = !fenced.is_empty();
    match sub {
        "clean" if args.iter().any(|a| *a == "--force" || (a.starts_with('-') && !a.starts_with("--") && a.contains('f'))) => {
            let paths: Vec<String> = args.iter().skip(1).filter(|a| !a.starts_with('-')).map(|p| join_rel(cd, p)).collect();
            let paths = if paths.is_empty() { vec![cd.to_string()] } else { paths };
            let ignored = args.iter().any(|a| a.starts_with('-') && !a.starts_with("--") && (a.contains('x') || a.contains('X')));
            let pool: Vec<&String> = if ignored { fenced.iter().chain(hidden).collect() } else { fenced.iter().collect() };
            if let Some(f) = pool.iter().find(|f| paths.iter().any(|p| covers(p, f))) {
                return refuse(&format!("`git clean` would delete {f}, which is fenced for agents"));
            }
        }
        "pull" if fenced_any => {
            return refuse("`git pull` brings changes the fence cannot see first – `git fetch`, then merge a named ref")
        }
        "worktree" if fenced_any && args.get(1) == Some(&"add") => {
            return refuse("a new worktree sits outside this checkout's fences – a person's to make, or use `kula run`");
        }
        "merge" | "rebase" if fenced_any => {
            if args.iter().any(|a| matches!(*a, "--abort" | "--quit" | "--skip" | "--continue")) {
                return None;
            }
            let Some(r) = pos.last() else { return refuse(&format!("cannot tell what `git {sub}` would bring")) };
            return check(touched(&[&format!("HEAD...{r}")]), r);
        }
        "cherry-pick" | "revert" if fenced_any => {
            if args.iter().any(|a| matches!(*a, "--abort" | "--quit" | "--skip" | "--continue")) {
                return None;
            }
            for r in &pos {
                let files = match r.split_once("..") {
                    Some((a, b)) => touched(&[a.trim_end_matches('.'), b.trim_start_matches('.')]),
                    None => touched(&[&format!("{r}^"), r]),
                };
                if let Some(why) = check(files, r) {
                    return Some(why);
                }
            }
        }
        "switch" | "checkout" if fenced_any => {
            if force {
                return refuse(&format!("`git {sub} -f` throws away working-tree changes, fenced files included"));
            }
            // the first positional before `--` that is a revision moves the tree
            let before: Vec<&str> = args.iter().skip(1).take_while(|a| **a != "--").copied().filter(|a| !a.starts_with('-')).collect();
            if let Some(r) = before.first() {
                if is_rev(r) {
                    if let Some(why) = check(touched(&["HEAD", r]), r) {
                        return Some(why);
                    }
                }
            }
        }
        _ => {}
    }
    None
}
