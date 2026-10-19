//! The mapping benchmark: three gold repos, hand-written expected flows, and
//! the metrics from `docs/MAPPING.md`, printed as JSON by `kula map --bench`.
//!
//! Repos: kula itself (the working repository), homonin-scripts (copied to
//! /tmp at bench time) and the vendored miniserde fixture. Offline: no
//! network in the bench path.

mod metrics;
pub(crate) mod names;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{git, index, map, store::Store};

// ----------------------------------------------------------------– gold sets

#[derive(Debug, Deserialize)]
struct GoldFile {
    repo: String,
    flow: Vec<GoldFlow>,
}

#[derive(Debug, Deserialize)]
struct GoldFlow {
    name: String,
    #[serde(default)]
    keywords: Vec<String>,
    members: Vec<String>,
}

const GOLD_DIR: &str = "bench/mapping/gold";

/// The three gold repos, in bench order.
fn gold_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> =
        ["kula.toml", "homonin-scripts.toml", "miniserde.toml"].iter().map(|f| Path::new(GOLD_DIR).join(f)).collect();
    // Bisect-friendly: run just one repo with KULA_BENCH_ONLY=miniserde.
    if let Ok(only) = std::env::var("KULA_BENCH_ONLY") {
        files.retain(|p| p.file_stem().is_some_and(|s| s == only.as_str()));
    }
    files
}

// ----------------------------------------------------------------– results

#[derive(Debug, Serialize)]
struct RepoResult {
    repo: String,
    gold_flows: usize,
    produced_flows: usize,
    recall: f64,
    precision: f64,
    name_score: f64,
    section_purity: f64,
    edge_crossings: usize,
    build_ms: u128,
    peak_rss_kib: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    produced: Vec<ProducedFlow>,
}

#[derive(Debug, Serialize)]
struct ProducedFlow {
    name: String,
    members: usize,
}

#[derive(Debug, Serialize)]
struct BenchReport {
    repos: Vec<RepoResult>,
    summary: Summary,
}

#[derive(Debug, Serialize)]
struct Summary {
    recall: f64,
    precision: f64,
    name_score: f64,
    section_purity: f64,
    build_ms_max: u128,
}

fn r3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

// ----------------------------------------------------------------– entry

/// Run the whole bench and print the JSON report.
pub fn run() -> Result<()> {
    let cwd = std::env::current_dir().context("bench needs a working directory")?;
    let mut repos = Vec::new();
    for gold_path in gold_files() {
        let gold: GoldFile = deserialize_toml(&gold_path)?;
        let name = gold.repo.clone();
        let dir = stage(&gold, &cwd)?;
        let res = bench_repo(&name, &dir, &gold);
        match res {
            Ok(r) => repos.push(r),
            Err(e) => eprintln!("  {} bench {} failed: {e:#}", crate::term::dim("×"), name),
        }
    }
    let report = summarise(repos);
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn deserialize_toml(path: &Path) -> Result<GoldFile> {
    let src = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    toml::from_str(&src).with_context(|| format!("parse {}", path.display()))
}

/// Put a gold repo where the bench can index it: kula itself in place, the
/// others as scratch copies under /tmp (a git clone for repos with history,
/// a fresh init for the vendored fixture).
fn stage(gold: &GoldFile, cwd: &Path) -> Result<PathBuf> {
    let scratch = std::env::temp_dir().join("kula-bench");
    match gold.repo.as_str() {
        "kula" => Ok(cwd.to_path_buf()),
        "miniserde" => {
            let dir = scratch.join("miniserde");
            stage_fixture(&Path::new(GOLD_DIR).join("miniserde"), &dir)?;
            Ok(dir)
        }
        "homonin-scripts" => {
            let src = homonin_source();
            let dir = scratch.join("homonin-scripts");
            clone_to(&src, &dir)?;
            Ok(dir)
        }
        other => anyhow::bail!("unknown gold repo {other}"),
    }
}

fn homonin_source() -> PathBuf {
    if let Ok(p) = std::env::var("KULA_BENCH_HOMONIN") {
        return PathBuf::from(p);
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join("Desktop/projects/homonin/homonin-scripts");
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("homonin-scripts")
}

fn clone_to(src: &Path, dst: &Path) -> Result<()> {
    if dst.exists() && git_rev(dst).is_some() {
        return Ok(()); // reuse the scratch copy from a previous bench run
    }
    let _ = std::fs::remove_dir_all(dst);
    std::fs::create_dir_all(dst.parent().unwrap())?;
    let out = std::process::Command::new("git")
        .args(["clone", "--quiet", "--no-hardlinks"])
        .arg(src)
        .arg(dst)
        .output()
        .with_context(|| format!("clone {}", src.display()))?;
    if !out.status.success() {
        anyhow::bail!("clone {}: {}", src.display(), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// The vendored fixture has no usable remote: copy the tree (minus .git) and
/// init a scratch git repo so the indexer has a repository to work in.
fn stage_fixture(src: &Path, dst: &Path) -> Result<()> {
    if dst.join("Cargo.toml").exists() {
        return Ok(()); // already staged
    }
    let _ = std::fs::remove_dir_all(dst);
    std::fs::create_dir_all(dst)?;
    copy_tree(src, dst)?;
    let sh = |args: &[&str]| -> Result<()> {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dst)
            .args(args)
            .env("GIT_AUTHOR_NAME", "bench")
            .env("GIT_AUTHOR_EMAIL", "bench@localhost")
            .env("GIT_COMMITTER_NAME", "bench")
            .env("GIT_COMMITTER_EMAIL", "bench@localhost")
            .output()?;
        if !out.status.success() {
            anyhow::bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(())
    };
    sh(&["init", "--quiet"])?;
    sh(&["add", "-A"])?;
    sh(&["commit", "--quiet", "-m", "fixture"])?;
    Ok(())
}

fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    for entry in std::fs::read_dir(src)? {
        let e = entry?;
        let name = e.file_name();
        if name == ".git" {
            continue;
        }
        let to = dst.join(&name);
        if e.file_type()?.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_tree(&e.path(), &to)?;
        } else {
            std::fs::copy(e.path(), &to)?;
        }
    }
    Ok(())
}

fn git_rev(dir: &Path) -> Option<String> {
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

// ----------------------------------------------------------------– the run

fn bench_repo(name: &str, dir: &Path, gold: &GoldFile) -> Result<RepoResult> {
    let repo = git::Repo { root: dir.to_path_buf() };
    index::run(&repo, true).with_context(|| format!("index {name}"))?;
    let store = Store::open(&repo)?;
    let t0 = std::time::Instant::now();
    let s = map::build_with(&repo, &store, None, "off").with_context(|| format!("map {name}"))?;
    let build_ms = t0.elapsed().as_millis();
    let rss = metrics::peak_rss_kib();

    // Member names per node id, then candidate flows from chain families.
    let nodes: std::collections::HashMap<i64, (String, String)> =
        store.nodes_where("kind != 'file'", [])?.into_iter().map(|n| (n.id, (n.name, n.path))).collect();
    let member_of = |id: i64| -> Option<String> {
        nodes.get(&id).map(|(n, p)| format!("{}::{}", p, n)).filter(|m| {
            let path = m.split("::").next().unwrap_or("");
            let lower = path.to_lowercase();
            !map::is_test_path(path)
                && !path.split('/').any(|s| matches!(s, "benches" | "bench" | "benchmarks"))
                && !lower.contains("/tests/")
        })
    };
    let produced = candidate_flows(&s, &store, &member_of);
    if std::env::var("KULA_BENCH_DEBUG").is_ok() {
        // Distinct families can share a display name (e.g. two "Finish to new"
        // chains from different files). Append a file hint to same-named flows
        // so the dump stays readable – display only, metrics are unaffected.
        let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        let mut used_hints: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for f in &produced {
            *counts.entry(f.name.as_str()).or_insert(0) += 1;
        }
        for f in &produced {
            let label = if counts[f.name.as_str()] > 1 {
                // Any member path that distinguishes this family from the
                // earlier same-named one; fall back to the first member.
                let used = used_hints.entry(f.name.clone()).or_default();
                let file = f
                    .members
                    .iter()
                    .map(|m| m.split("::").next().unwrap_or("?"))
                    .find(|p| !used.contains(&p.to_string()))
                    .unwrap_or_else(|| f.members.first().and_then(|m| m.split("::").next()).unwrap_or("?"));
                used.push(file.to_string());
                format!("{} [{}]", f.name, file)
            } else {
                f.name.clone()
            };
            eprintln!("FLOW {} :: {}", label, f.members.join(", "));
        }
    }

    let blocks: Vec<(String, Vec<String>)> = s
        .blocks
        .iter()
        .filter(|b| b.depth == 0)
        .map(|b| {
            let mut seen = std::collections::BTreeSet::new();
            let members = b.symbols.iter().filter_map(|&id| member_of(id)).filter(|m| seen.insert(m.clone())).collect();
            (b.id.clone(), members)
        })
        .collect();
    let crossings = metrics::edge_crossings(&s.flows.iter().map(|f| (f.from.clone(), f.to.clone())).collect::<Vec<_>>());

    let gold_flows: Vec<metrics::Flow> = gold
        .flow
        .iter()
        .map(|f| metrics::Flow { name: f.name.clone(), members: f.members.clone(), keywords: f.keywords.clone() })
        .collect();
    let scores = metrics::flow_scores(&produced, &gold_flows);
    let purity = metrics::section_purity(&gold_flows, &blocks);
    Ok(RepoResult {
        repo: name.into(),
        gold_flows: scores.gold_flows,
        produced_flows: scores.produced_flows,
        recall: r3(scores.recall),
        precision: r3(scores.precision),
        name_score: r3(scores.name_score),
        section_purity: r3(purity),
        edge_crossings: crossings,
        build_ms,
        peak_rss_kib: rss,
        produced: produced.iter().map(|f| ProducedFlow { name: f.name.clone(), members: f.members.len() }).take(8).collect(),
    })
}

/// Candidate flows for the bench: the real value flows from `src/map/flows.rs`
/// (wave 2), mapped onto the metrics Flow shape.
fn candidate_flows(s: &map::Syntagm, _store: &Store, member_of: &dyn Fn(i64) -> Option<String>) -> Vec<metrics::Flow> {
    let mut out: Vec<metrics::Flow> = Vec::new();
    for f in &s.value_flows {
        let members: Vec<String> = f.members.iter().filter_map(|&id| member_of(id)).collect();
        if members.len() < 2 {
            continue;
        }
        out.push(metrics::Flow { name: f.name.clone(), members, keywords: vec![] });
    }
    out
}

fn summarise(mut repos: Vec<RepoResult>) -> BenchReport {
    repos.sort_by(|a, b| a.repo.cmp(&b.repo));
    let mean = |pick: fn(&RepoResult) -> f64| -> f64 {
        if repos.is_empty() {
            0.0
        } else {
            repos.iter().map(pick).sum::<f64>() / repos.len() as f64
        }
    };
    let summary = Summary {
        recall: r3(mean(|r| r.recall)),
        precision: r3(mean(|r| r.precision)),
        name_score: r3(mean(|r| r.name_score)),
        section_purity: r3(mean(|r| r.section_purity)),
        build_ms_max: repos.iter().map(|r| r.build_ms).max().unwrap_or(0),
    };
    BenchReport { repos, summary }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gold_files_are_the_three_repos() {
        let files = gold_files();
        assert_eq!(files.len(), 3);
        assert!(files.iter().all(|p| p.to_string_lossy().contains("gold")));
    }

    #[test]
    fn summary_is_deterministic_and_sorted() {
        let r = summarise(vec![
            RepoResult {
                repo: "b".into(),
                recall: 0.5,
                precision: 0.5,
                name_score: 0.5,
                section_purity: 0.5,
                edge_crossings: 0,
                build_ms: 1,
                peak_rss_kib: 1,
                gold_flows: 1,
                produced_flows: 1,
                produced: vec![],
            },
            RepoResult {
                repo: "a".into(),
                recall: 1.0,
                precision: 1.0,
                name_score: 1.0,
                section_purity: 1.0,
                edge_crossings: 0,
                build_ms: 1,
                peak_rss_kib: 1,
                gold_flows: 1,
                produced_flows: 1,
                produced: vec![],
            },
        ]);
        assert_eq!(r.repos[0].repo, "a");
        assert!((r.summary.recall - 0.75).abs() < 1e-9);
    }
}
