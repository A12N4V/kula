//! `kula lang`: list, add and remove language packs.

use crate::index::{self, langs, packs};
use crate::term::{bold, dim, green};
use anyhow::{Result, bail};
use clap::Subcommand;
use std::path::{Path, PathBuf};

#[derive(Subcommand)]
pub enum LangCmd {
    /// Languages: built in, installed, available, and which this repo contains.
    #[command(after_help = "Examples:\n  kula lang list   ·  kula lang list --all")]
    List {
        /// Every available pack, not just installed and detected ones.
        #[arg(long)]
        all: bool,
    },
    /// Install language packs (prebuilt from the kula release, sha256-checked).
    #[command(after_help = "Examples:\n  kula lang add kotlin swift   ·  kula lang add --detected   ·  kula lang add zig --build")]
    Add {
        ids: Vec<String>,
        /// Every language this repo contains that isn't installed yet.
        #[arg(long)]
        detected: bool,
        /// When no prebuilt pack can be fetched, compile it from the pinned
        /// grammar source with the system C compiler.
        #[arg(long)]
        build: bool,
        /// Reinstall even if installed.
        #[arg(long)]
        force: bool,
    },
    /// Remove an installed language pack.
    Remove { id: String },
    /// Build packs for this platform into a directory with a sha256 manifest (release CI).
    #[command(hide = true)]
    Build {
        ids: Vec<String>,
        #[arg(long)]
        all: bool,
        #[arg(long, default_value = "dist/langpacks")]
        out: PathBuf,
        #[arg(short, long, default_value_t = 8)]
        jobs: usize,
    },
    /// Print what a language's queries capture in a file (pack authoring).
    #[command(hide = true)]
    Check {
        id: String,
        file: PathBuf,
        /// Also print the syntax tree.
        #[arg(long)]
        tree: bool,
    },
}

pub fn run(cwd: &Path, cmd: LangCmd, json: bool) -> Result<()> {
    match cmd {
        LangCmd::List { all } => list(cwd, all, json),
        LangCmd::Add { ids, detected, build, force } => {
            let mut want: Vec<String> = ids;
            if detected {
                let root = crate::git::Repo::discover(cwd).map(|r| r.root).unwrap_or_else(|_| cwd.to_path_buf());
                for (id, _, parsed) in index::languages(&root) {
                    if !parsed && !langs::is_core(id) && !want.iter().any(|w| w == id) {
                        want.push(id.to_string());
                    }
                }
                if want.is_empty() {
                    println!("{} every language here is already indexed", green("✓"));
                    return Ok(());
                }
            }
            if want.is_empty() {
                bail!("name a language to add – `kula lang list --all` shows them");
            }
            for id in &want {
                if langs::is_core(id) {
                    bail!("{id} is built in");
                }
                if packs::get(id).is_none() {
                    bail!("no language pack called {id} – `kula lang list --all` shows them");
                }
            }
            add(&want, build, force)
        }
        LangCmd::Remove { id } => {
            if packs::remove(&id)? {
                println!("{} removed {id}", green("✓"));
            } else {
                println!("{id} was not installed");
            }
            Ok(())
        }
        LangCmd::Build { ids, all, out, jobs } => build(&ids, all, &out, jobs),
        LangCmd::Check { id, file, tree } => check(&id, &file, tree),
    }
}

fn add(ids: &[String], build: bool, force: bool) -> Result<()> {
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    match packs::download(&refs, force) {
        Ok(done) => {
            for id in &refs {
                if done.iter().any(|d| d == id) {
                    println!("{} {id}", green("✓"));
                } else {
                    println!("{} {id} {}", green("✓"), dim("(already installed)"));
                }
            }
            hint_reindex();
            Ok(())
        }
        Err(e) if build => {
            eprintln!("{} {e:#} – building locally", dim("·"));
            for id in &refs {
                if !force && packs::is_installed(id) {
                    println!("{} {id} {}", green("✓"), dim("(already installed)"));
                    continue;
                }
                eprint!("  building {id} …");
                packs::build_install(id)?;
                eprintln!(" {}", green("✓"));
            }
            hint_reindex();
            Ok(())
        }
        Err(e) => Err(e.context("could not download language packs (add --build to compile them locally)")),
    }
}

fn hint_reindex() {
    println!("{}", dim("run `kula index` to include them"));
}

fn list(cwd: &Path, all: bool, json: bool) -> Result<()> {
    let detected = crate::git::Repo::discover(cwd).map(|r| index::languages(&r.root)).unwrap_or_default();
    let count = |id: &str| detected.iter().find(|d| d.0 == id).map(|d| d.1).unwrap_or(0);
    if json {
        let v: Vec<serde_json::Value> = packs::all()
            .iter()
            .map(|p| {
                serde_json::json!({"id": p.id, "name": p.name, "tier": p.tier, "installed": packs::is_installed(&p.id), "files": count(&p.id), "version": p.version()})
            })
            .collect();
        let core: Vec<&str> = langs::SPECS.iter().map(|s| s.id).collect();
        println!("{}", serde_json::json!({"builtin": core, "packs": v}));
        return Ok(());
    }
    let core: Vec<&str> = langs::SPECS.iter().map(|s| s.id).collect();
    println!("{} {}", bold("built in"), dim(&core.join(" ")));
    let mut rows: Vec<&packs::Pack> = packs::all().iter().filter(|p| all || packs::is_installed(&p.id) || count(&p.id) > 0).collect();
    rows.sort_by(|a, b| count(&b.id).cmp(&count(&a.id)).then(a.id.cmp(&b.id)));
    let installed = packs::all().iter().filter(|p| packs::is_installed(&p.id)).count();
    println!("{} {installed} installed · {} available\n", bold("packs"), packs::all().len());
    for p in &rows {
        let state = if packs::is_installed(&p.id) { green("installed") } else { dim("available") };
        let n = count(&p.id);
        let here = match n {
            0 => String::new(),
            1 => "1 file here".to_string(),
            n => format!("{n} files here"),
        };
        println!("  {:<16} {:<22} {:<20} {:<8} {}", p.id, p.name, state, dim(&p.tier), here);
    }
    let missing: Vec<&str> = rows.iter().filter(|p| !packs::is_installed(&p.id) && count(&p.id) > 0).map(|p| p.id.as_str()).collect();
    if !missing.is_empty() {
        println!("\n{} kula lang add --detected   {}", bold("→"), dim(&format!("({})", missing.join(" "))));
    } else if !all {
        println!("\n{}", dim("kula lang list --all  shows every pack"));
    }
    Ok(())
}

fn check(id: &str, file: &Path, tree: bool) -> Result<()> {
    let src = std::fs::read_to_string(file)?;
    let Some(lang) = langs::get(id) else { bail!("{id} is not built in or installed") };
    if tree {
        let mut p = tree_sitter::Parser::new();
        p.set_language(&lang.language)?;
        if let Some(t) = p.parse(&src, None) {
            println!("{}", t.root_node().to_sexp());
        }
    }
    let mut lang = lang;
    if let Some(p) = packs::get(id) {
        // Pack authoring: prefer the query file on disk over the embedded copy.
        let disk = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("src/index/queries/{id}.scm"));
        let q: &'static str = match std::fs::read_to_string(&disk) {
            Ok(t) => Box::leak(t.into_boxed_str()),
            Err(_) => p.query().unwrap_or_default(),
        };
        let (ok, bad) = langs::check_patterns(&lang.language, q);
        println!("{ok} patterns compile");
        for b in bad {
            println!("BAD {b}");
        }
        lang = Box::leak(Box::new(langs::build_lang(&p.id, lang.language.clone(), &[q], leak(&p.class_kinds), leak(&p.def_kinds))));
    }
    for line in index::probe_detail(lang, &src) {
        println!("{line}");
    }
    Ok(())
}

/// Build packs into `out` and write the manifest the release publishes.
fn build(ids: &[String], all: bool, out: &Path, jobs: usize) -> Result<()> {
    let list: Vec<&'static packs::Pack> = if all {
        packs::all().iter().collect()
    } else {
        ids.iter().map(|i| packs::get(i).ok_or_else(|| anyhow::anyhow!("no pack {i}"))).collect::<Result<_>>()?
    };
    std::fs::create_dir_all(out)?;
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..jobs.max(1) {
            s.spawn(|| {
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(p) = list.get(i) else { break };
                    let r = build_one(p, out);
                    results.lock().unwrap().push((p.id.clone(), r));
                }
            });
        }
    });
    let mut results = results.into_inner().unwrap();
    results.sort_by(|a, b| a.0.cmp(&b.0));
    let mut manifest = packs::Manifest { kula: env!("CARGO_PKG_VERSION").into(), triple: packs::TRIPLE.into(), ..Default::default() };
    let mut failed = 0;
    println!("id\tsize\tabi\tpatterns\tbad\tdefs\tcalls\timports\ttier\tnote");
    for (id, r) in results {
        match r {
            Ok((e, report)) => {
                println!("{id}\t{}\t{}\t{report}", e.size, e.abi);
                if e.tier != "none" {
                    manifest.packs.insert(id, e);
                } else {
                    let _ = std::fs::remove_file(out.join(packs::asset_name(&id)));
                }
            }
            Err(err) => {
                failed += 1;
                println!("{id}\t-\t-\t-\t-\t-\t-\t-\tfailed\t{}", format!("{err:#}").replace('\n', " "));
            }
        }
    }
    std::fs::write(out.join(packs::manifest_name()), serde_json::to_string_pretty(&manifest)?)?;
    eprintln!("{} packs built, {failed} failed → {}", manifest.packs.len(), out.display());
    Ok(())
}

fn build_one(p: &'static packs::Pack, out: &Path) -> Result<(packs::Entry, String)> {
    let g = packs::fetch_source(p)?;
    let file = packs::asset_name(&p.id);
    let path = out.join(&file);
    packs::compile(p, &g, &path)?;
    let mut note = String::new();
    // The exported symbol, in case packs.toml has it wrong.
    let parser = std::fs::read_to_string(g.join("src/parser.c")).unwrap_or_default();
    if let Some(sym) = parser.split("tree_sitter_").skip(1).find_map(|t| {
        t.split_once("(void)")
            .map(|(n, _)| n)
            .filter(|n| !n.contains("_external_scanner") && n.chars().all(|c| c.is_alphanumeric() || c == '_'))
    }) {
        if sym != p.symbol() {
            note = format!("symbol={sym}");
        }
    }
    let language = packs::open_file(&path, p.symbol())?;
    let q = p.query().unwrap_or_default();
    let (ok, bad) = langs::check_patterns(&language, q);
    let lang = langs::build_lang(&p.id, language.clone(), &[q], leak(&p.class_kinds), leak(&p.def_kinds));
    let (mut d, mut c, mut i) = (0, 0, 0);
    let samples = packs::samples(p, &g);
    if samples.is_empty() {
        note.push_str(" no-samples");
    }
    for s in samples {
        let (a, b, x) = index::probe(&lang, &s);
        d += a;
        c += b;
        i += x;
    }
    let tier = match (d > 0, c > 0, i > 0) {
        (true, true, true) => "imports",
        (true, true, false) => "calls",
        (true, false, _) => "defs",
        _ => "none",
    };
    let bytes = std::fs::read(&path)?;
    let e = packs::Entry {
        version: p.version(),
        file,
        sha256: sha(&bytes),
        size: bytes.len() as u64,
        abi: language.abi_version(),
        tier: tier.into(),
    };
    Ok((e, format!("{ok}\t{}\t{d}\t{c}\t{i}\t{tier}\t{note}", bad.len())))
}

fn sha(b: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn leak(v: &'static [String]) -> &'static [&'static str] {
    Box::leak(v.iter().map(String::as_str).collect::<Vec<_>>().into_boxed_slice())
}
