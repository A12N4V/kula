//! Language packs: grammars that live outside the binary.
//!
//! The binary carries the core languages. Every other grammar is a pack: a
//! native shared library exporting `tree_sitter_<symbol>`, installed under
//! `~/.kula/grammars/<id>/<version>/` and opened with `dlopen` the first time a
//! file of that language is indexed.
//!
//! What a pack is lives in `packs.toml` (grammar source pinned to a commit or a
//! crate version, file names, definition kinds). Its extraction queries stay
//! embedded in the binary (`queries/<id>.scm`, a few hundred bytes each): they
//! are tied to how this kula reads captures, so shipping them with the binary
//! means a query fix never needs a new pack, and the pinned grammar revision in
//! the same table keeps node names and queries in step.
//!
//! Packs come from the GitHub release of the running kula version, checked
//! against the release's sha256 manifest – no other source is trusted. `--build`
//! compiles one locally from the pinned grammar source with the system C
//! compiler instead.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock, RwLock};
use tree_sitter::Language;

use super::langs::Lang;

include!(concat!(env!("OUT_DIR"), "/queries.rs"));

/// Where release assets come from. Nothing else is downloaded.
const RELEASES: &str = "https://github.com/A12N4V/kula/releases/download";
/// The target triple this binary was built for (set by build.rs).
pub const TRIPLE: &str = env!("KULA_TARGET");

#[derive(Debug, Deserialize)]
pub struct Pack {
    pub id: String,
    pub name: String,
    /// Upstream git repository, pinned to `rev`.
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub rev: String,
    /// Or a crates.io grammar crate, `name@version` (for grammars whose repos
    /// don't commit the generated parser).
    #[serde(default, rename = "crate")]
    pub krate: String,
    /// Directory holding `src/parser.c`, when not the repository root.
    #[serde(default)]
    pub path: String,
    /// `tree_sitter_<symbol>`; defaults to the id.
    #[serde(default)]
    pub symbol: String,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub exts: Vec<String>,
    #[serde(default)]
    pub names: Vec<String>,
    #[serde(default)]
    pub class_kinds: Vec<String>,
    #[serde(default)]
    pub def_kinds: Vec<String>,
    /// What the queries extract, measured on the grammar's own test corpus:
    /// "imports" (definitions, calls and imports), "calls" or "defs".
    #[serde(default)]
    pub tier: String,
}

#[derive(Deserialize)]
struct Table {
    pack: Vec<Pack>,
}

impl Pack {
    /// The installed version directory name: the pinned commit or crate version.
    pub fn version(&self) -> String {
        if !self.krate.is_empty() {
            self.krate.rsplit('@').next().unwrap_or_default().to_string()
        } else {
            self.rev.chars().take(12).collect()
        }
    }
    pub fn symbol(&self) -> &str {
        if self.symbol.is_empty() {
            &self.id
        } else {
            &self.symbol
        }
    }
    pub fn family(&self) -> &str {
        if self.family.is_empty() {
            &self.id
        } else {
            &self.family
        }
    }
    pub fn query(&self) -> Option<&'static str> {
        QUERIES.iter().find(|(id, _)| *id == self.id).map(|(_, q)| *q)
    }
    fn dir(&self) -> PathBuf {
        grammars_dir().join(&self.id).join(self.version())
    }
    pub fn lib_path(&self) -> PathBuf {
        self.dir().join(lib_file(&self.id))
    }
}

/// Every pack this kula knows about.
pub fn all() -> &'static [Pack] {
    static T: OnceLock<Vec<Pack>> = OnceLock::new();
    T.get_or_init(|| toml::from_str::<Table>(include_str!("packs.toml")).map(|t| t.pack).unwrap_or_default())
}

pub fn get(id: &str) -> Option<&'static Pack> {
    all().iter().find(|p| p.id == id)
}

/// `~/.kula`, or `$KULA_HOME`.
pub fn home() -> PathBuf {
    if let Some(h) = std::env::var_os("KULA_HOME") {
        return PathBuf::from(h);
    }
    let base = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).unwrap_or_else(|| ".".into());
    PathBuf::from(base).join(".kula")
}

pub fn grammars_dir() -> PathBuf {
    home().join("grammars")
}

pub fn lib_file(id: &str) -> String {
    format!("{}{id}{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX)
}

/// Ids of installed packs (current version only), cached until an install or removal.
fn installed_set() -> &'static RwLock<Option<HashSet<String>>> {
    static S: RwLock<Option<HashSet<String>>> = RwLock::new(None);
    &S
}

pub fn is_installed(id: &str) -> bool {
    if let Some(s) = installed_set().read().ok().and_then(|g| g.as_ref().map(|s| s.contains(id))) {
        return s;
    }
    let set: HashSet<String> = all().iter().filter(|p| p.lib_path().is_file()).map(|p| p.id.clone()).collect();
    let hit = set.contains(id);
    if let Ok(mut g) = installed_set().write() {
        *g = Some(set);
    }
    hit
}

/// Forget cached install state and failed loads (after add/remove).
pub fn refresh() {
    if let Ok(mut g) = installed_set().write() {
        *g = None;
    }
    if let Ok(mut f) = failed().lock() {
        f.clear();
    }
}

/// A pack claiming a multi-part extension (`blade.php`) of this file name.
pub fn for_compound(name: &str) -> Option<&'static Pack> {
    let lower = name.to_ascii_lowercase();
    all().iter().find(|p| p.exts.iter().any(|e| e.contains('.') && lower.ends_with(&format!(".{e}"))))
}

/// The pack id for a file name, installed or not.
pub fn for_name(name: &str) -> Option<&'static Pack> {
    if let Some(p) = all().iter().find(|p| p.names.iter().any(|n| n == name)) {
        return Some(p);
    }
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    let mut hits = all().iter().filter(|p| p.exts.contains(&ext));
    let first = hits.next()?;
    // A shared extension goes to whichever claimant is installed.
    Some(if is_installed(&first.id) { first } else { hits.find(|p| is_installed(&p.id)).unwrap_or(first) })
}

fn failed() -> &'static Mutex<HashSet<String>> {
    static F: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    F.get_or_init(Default::default)
}

/// Open an installed pack's grammar, refusing an ABI this tree-sitter can't read.
pub fn open(p: &Pack) -> Result<Language> {
    open_file(&p.lib_path(), p.symbol()).map_err(|e| anyhow!("{e:#} – reinstall it with `kula lang add {} --force`", p.id))
}

pub fn open_file(path: &Path, symbol: &str) -> Result<Language> {
    // SAFETY: the library is a tree-sitter grammar whose only export we call is
    // `tree_sitter_<symbol>`, which returns a static TSLanguage pointer. The
    // library is leaked so that pointer stays valid for the process's life.
    let lib = unsafe { libloading::Library::new(path) }.with_context(|| format!("can't open {}", path.display()))?;
    let lib: &'static libloading::Library = Box::leak(Box::new(lib));
    let name = format!("tree_sitter_{symbol}");
    let f = unsafe { lib.get::<unsafe extern "C" fn() -> *const ()>(name.as_bytes()) }
        .with_context(|| format!("{} has no {name}", path.display()))?;
    let lang = Language::new(unsafe { tree_sitter_language::LanguageFn::from_raw(*f) });
    let abi = lang.abi_version();
    let ok = tree_sitter::MIN_COMPATIBLE_LANGUAGE_VERSION..=tree_sitter::LANGUAGE_VERSION;
    if !ok.contains(&abi) {
        bail!("{} uses tree-sitter ABI {abi}; this kula reads ABI {}–{}", path.display(), ok.start(), ok.end());
    }
    Ok(lang)
}

/// A pack's grammar and compiled queries, loaded once per process.
pub fn lang(id: &str) -> Option<&'static Lang> {
    static CACHE: OnceLock<Mutex<HashMap<String, &'static Lang>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(l) = cache.lock().ok()?.get(id) {
        return Some(l);
    }
    if failed().lock().ok()?.contains(id) {
        return None;
    }
    let p = get(id)?;
    if !is_installed(id) {
        return None;
    }
    let built = open(p).and_then(|language| {
        let q = p.query().ok_or_else(|| anyhow!("no queries for {id}"))?;
        Ok(super::langs::build_lang(&p.id, language, &[q], leak_strs(&p.class_kinds), leak_strs(&p.def_kinds)))
    });
    match built {
        Ok(l) => {
            let l: &'static Lang = Box::leak(Box::new(l));
            cache.lock().ok()?.insert(id.to_string(), l);
            Some(l)
        }
        Err(e) => {
            eprintln!("kula: language pack {id}: {e:#}");
            failed().lock().ok()?.insert(id.to_string());
            None
        }
    }
}

fn leak_strs(v: &'static [String]) -> &'static [&'static str] {
    Box::leak(v.iter().map(String::as_str).collect::<Vec<_>>().into_boxed_slice())
}

// ---------------------------------------------------------------- install

/// The release manifest: `langpacks-<triple>.json`.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Manifest {
    pub kula: String,
    pub triple: String,
    pub packs: BTreeMap<String, Entry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub version: String,
    pub file: String,
    pub sha256: String,
    pub size: u64,
    pub abi: usize,
    #[serde(default)]
    pub tier: String,
}

pub fn manifest_name() -> String {
    format!("langpacks-{TRIPLE}.json")
}

pub fn asset_name(id: &str) -> String {
    let ext = std::env::consts::DLL_EXTENSION;
    format!("langpack-{id}-{TRIPLE}.{ext}")
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Where to fetch from: the release for this version, or `$KULA_LANGPACK_DIR`
/// (a local directory laid out like a release, for offline mirrors).
enum Source {
    Release(String),
    Dir(PathBuf),
}

fn source() -> Source {
    match std::env::var_os("KULA_LANGPACK_DIR") {
        Some(d) => Source::Dir(PathBuf::from(d)),
        None => Source::Release(format!("{RELEASES}/v{}", env!("CARGO_PKG_VERSION"))),
    }
}

fn fetch(src: &Source, name: &str) -> Result<Vec<u8>> {
    match src {
        Source::Dir(d) => std::fs::read(d.join(name)).with_context(|| format!("{} not found", d.join(name).display())),
        Source::Release(base) => {
            let url = format!("{base}/{name}");
            let out = Command::new("curl")
                .args(["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "5", "--retry", "2", &url])
                .output()
                .context("curl is needed to download language packs")?;
            if !out.status.success() {
                bail!("download failed: {url} ({})", String::from_utf8_lossy(&out.stderr).trim());
            }
            Ok(out.stdout)
        }
    }
}

/// Download, verify and install packs from the release.
pub fn download(ids: &[&str], force: bool) -> Result<Vec<String>> {
    download_from(&source(), ids, force)
}

fn download_from(src: &Source, ids: &[&str], force: bool) -> Result<Vec<String>> {
    let raw = fetch(src, &manifest_name()).context("no prebuilt language packs for this version and platform (try --build)")?;
    let m: Manifest = serde_json::from_slice(&raw).context("bad language-pack manifest")?;
    let mut done = vec![];
    for id in ids {
        let p = get(id).ok_or_else(|| anyhow!("no language pack called {id}"))?;
        if !force && is_installed(id) {
            continue;
        }
        let e = m.packs.get(*id).ok_or_else(|| anyhow!("{id} has no prebuilt pack for {TRIPLE} (try --build)"))?;
        if e.version != p.version() {
            bail!("the release's {id} pack is version {}, this kula wants {}", e.version, p.version());
        }
        let bytes = fetch(src, &e.file)?;
        let got = sha256(&bytes);
        if got != e.sha256 {
            bail!("{id}: checksum mismatch (expected {}, got {got}) – not installed", e.sha256);
        }
        install_bytes(p, &bytes)?;
        done.push(id.to_string());
    }
    Ok(done)
}

/// Write a pack's library into place and check it opens before keeping it.
fn install_bytes(p: &Pack, bytes: &[u8]) -> Result<()> {
    let dir = p.dir();
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join(format!(".{}.tmp", lib_file(&p.id)));
    std::fs::write(&tmp, bytes)?;
    if let Err(e) = open_file(&tmp, p.symbol()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, p.lib_path())?;
    // Older versions of this pack are dead weight.
    if let Ok(rd) = std::fs::read_dir(grammars_dir().join(&p.id)) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy() != p.version() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    refresh();
    Ok(())
}

pub fn remove(id: &str) -> Result<bool> {
    get(id).ok_or_else(|| anyhow!("no language pack called {id}"))?;
    let d = grammars_dir().join(id);
    let had = d.exists();
    if had {
        std::fs::remove_dir_all(&d)?;
    }
    refresh();
    Ok(had)
}

// ---------------------------------------------------------------- build

/// The pinned grammar source, fetched once into `~/.kula/cache/grammar-src`.
pub fn fetch_source(p: &Pack) -> Result<PathBuf> {
    let root = home().join("cache").join("grammar-src").join(format!("{}-{}", p.id, p.version()));
    let base = |r: &Path| if p.krate.is_empty() { r.join(&p.path) } else { r.to_path_buf() };
    if base(&root).join("src/parser.c").is_file() {
        return Ok(base(&root));
    }
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root)?;
    let run = |c: &mut Command| -> Result<()> {
        let out = c.output()?;
        if !out.status.success() {
            bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(())
    };
    if !p.krate.is_empty() {
        let (name, ver) = p.krate.split_once('@').ok_or_else(|| anyhow!("bad crate {}", p.krate))?;
        let url = format!("https://static.crates.io/crates/{name}/{name}-{ver}.crate");
        let file = root.join("src.crate");
        run(Command::new("curl").args(["-fsSL", "--proto", "=https", "-o"]).arg(&file).arg(&url))
            .with_context(|| format!("fetching {url}"))?;
        run(Command::new("tar").args(["xzf"]).arg(&file).arg("-C").arg(&root).args(["--strip-components", "1"]))?;
    } else {
        if p.rev.is_empty() {
            bail!("{} has no pinned revision", p.id);
        }
        run(Command::new("git").args(["init", "-q"]).arg(&root))?;
        run(Command::new("git").arg("-C").arg(&root).args(["fetch", "-q", "--depth", "1", &p.repo, &p.rev]))
            .with_context(|| format!("fetching {} at {}", p.repo, p.rev))?;
        run(Command::new("git").arg("-C").arg(&root).args(["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"]))?;
    }
    if !base(&root).join("src/parser.c").is_file() {
        bail!("{} ships no generated parser.c", p.id);
    }
    Ok(base(&root))
}

/// Compile a pack's shared library from its grammar source into `out`.
pub fn compile(p: &Pack, grammar: &Path, out: &Path) -> Result<()> {
    if cfg!(windows) {
        bail!("building language packs needs a Unix-like C toolchain; on Windows install prebuilt packs");
    }
    let src = grammar.join("src");
    let tmp = std::env::temp_dir().join(format!("kula-pack-{}-{}", p.id, std::process::id()));
    std::fs::create_dir_all(&tmp)?;
    // CC and CXX may carry flags ("cc -arch x86_64"), as make and the cc crate allow
    let tool = |var: &str, dflt: &str| -> Vec<String> {
        let v: Vec<String> = std::env::var(var).unwrap_or_default().split_whitespace().map(String::from).collect();
        if v.is_empty() {
            vec![dflt.into()]
        } else {
            v
        }
    };
    let (cc, cxx) = (tool("CC", "cc"), tool("CXX", "c++"));
    let cmd = |t: &[String]| {
        let mut c = Command::new(&t[0]);
        c.args(&t[1..]);
        c
    };
    let mut objs = vec![];
    let mut cpp = false;
    for f in ["parser.c", "scanner.c", "scanner.cc", "scanner.cpp"] {
        let file = src.join(f);
        if !file.is_file() {
            continue;
        }
        let is_cpp = !f.ends_with(".c");
        cpp |= is_cpp;
        let obj = tmp.join(format!("{f}.o"));
        let mut c = cmd(if is_cpp { &cxx } else { &cc });
        c.args(["-c", "-O2", "-fPIC", "-w"]).arg(if is_cpp { "-std=c++14" } else { "-std=gnu11" });
        c.arg("-I").arg(&src).arg(&file).arg("-o").arg(&obj);
        let o = c.output().with_context(|| format!("no C compiler ({}); install one or use prebuilt packs", cc.join(" ")))?;
        if !o.status.success() {
            bail!("compiling {}: {}", file.display(), String::from_utf8_lossy(&o.stderr).lines().take(5).collect::<Vec<_>>().join("\n"));
        }
        objs.push(obj);
    }
    if objs.is_empty() {
        bail!("{}: no parser.c", grammar.display());
    }
    let mut l = cmd(if cpp { &cxx } else { &cc });
    l.arg("-shared").args(&objs).arg("-o").arg(out);
    if cfg!(target_os = "linux") {
        l.arg("-s");
    }
    let o = l.output()?;
    let _ = std::fs::remove_dir_all(&tmp);
    if !o.status.success() {
        bail!("linking {}: {}", p.id, String::from_utf8_lossy(&o.stderr).trim());
    }
    if cfg!(target_os = "macos") {
        let _ = Command::new("strip").arg("-x").arg(out).output();
    }
    Ok(())
}

/// `kula lang add --build`: compile from source and install.
pub fn build_install(id: &str) -> Result<()> {
    let p = get(id).ok_or_else(|| anyhow!("no language pack called {id}"))?;
    let g = fetch_source(p)?;
    std::fs::create_dir_all(p.dir())?;
    let tmp = p.dir().join(format!(".{}.build", lib_file(&p.id)));
    compile(p, &g, &tmp)?;
    let bytes = std::fs::read(&tmp)?;
    let _ = std::fs::remove_file(&tmp);
    install_bytes(p, &bytes)
}

/// Code samples for a smoke test: the fixture if kula has one, plus the
/// grammar's own test corpus.
pub fn samples(p: &Pack, grammar: &Path) -> Vec<String> {
    let mut out = vec![];
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/langs");
    if let Ok(rd) = std::fs::read_dir(&fixtures) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.split('.').next() == Some(p.id.as_str()) {
                out.extend(std::fs::read_to_string(e.path()).ok());
            }
        }
    }
    // Sample sources some grammars keep for highlight/tag tests or as examples.
    for dir in ["examples", "example", "test/highlight", "test/tags", "test/samples", "samples"] {
        let Ok(rd) = std::fs::read_dir(grammar.join(dir)) else { continue };
        let mut files: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        out.extend(files.iter().take(40).filter_map(|f| std::fs::read_to_string(f).ok()).filter(|s| s.len() < 200_000));
    }
    for dir in ["test/corpus", "corpus", "tests/corpus", "test/corpus/declarations"] {
        let Ok(rd) = std::fs::read_dir(grammar.join(dir)) else { continue };
        let mut files: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        for f in files {
            let Ok(t) = std::fs::read_to_string(&f) else { continue };
            out.extend(corpus_cases(&t));
        }
    }
    out
}

/// The source half of each tree-sitter corpus case (`===` title, code, `---`, tree).
fn corpus_cases(t: &str) -> Vec<String> {
    let mut out = vec![];
    let lines: Vec<&str> = t.lines().collect();
    let is_rule = |l: &str, c: char| {
        l.len() >= 3 && l.trim_end().chars().all(|x| x == c)
            || l.starts_with(&c.to_string().repeat(3))
                && l.trim_start_matches(c).trim().chars().all(|x| x.is_alphanumeric() || x == '-' || x == '_')
    };
    let mut i = 0;
    while i < lines.len() {
        if is_rule(lines[i], '=') {
            // title line(s) then a closing === rule
            let mut j = i + 1;
            while j < lines.len() && !is_rule(lines[j], '=') {
                j += 1;
            }
            let start = j + 1;
            let mut k = start;
            while k < lines.len() && !is_rule(lines[k], '-') {
                k += 1;
            }
            if start < k {
                out.push(lines[start..k].join("\n"));
            }
            i = k + 1;
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pack_has_a_source_and_query() {
        assert!(all().len() > 100);
        for p in all() {
            assert!(!p.repo.is_empty() && p.rev.len() == 40 || p.krate.contains('@'), "{}: pin a commit or a crate version", p.id);
            assert!(p.query().is_some(), "{}: no query file", p.id);
        }
    }

    #[test]
    fn a_tampered_pack_is_refused() {
        let dir = std::env::temp_dir().join(format!("kula-packs-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = get("kotlin").unwrap();
        let file = asset_name("kotlin");
        std::fs::write(dir.join(&file), b"not a library").unwrap();
        let mut m = Manifest { kula: "0".into(), triple: TRIPLE.into(), ..Default::default() };
        m.packs
            .insert("kotlin".into(), Entry { version: p.version(), file, sha256: "0".repeat(64), size: 13, abi: 14, tier: String::new() });
        std::fs::write(dir.join(manifest_name()), serde_json::to_string(&m).unwrap()).unwrap();
        let err = download_from(&Source::Dir(dir.clone()), &["kotlin"], true).unwrap_err();
        assert!(format!("{err:#}").contains("checksum mismatch"), "{err:#}");
        // A pack for another grammar revision is refused too.
        m.packs.get_mut("kotlin").unwrap().version = "stale".into();
        std::fs::write(dir.join(manifest_name()), serde_json::to_string(&m).unwrap()).unwrap();
        let err = download_from(&Source::Dir(dir.clone()), &["kotlin"], true).unwrap_err();
        assert!(format!("{err:#}").contains("this kula wants"), "{err:#}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_non_grammar_library_is_refused() {
        let f = std::env::temp_dir().join(format!("kula-not-a-lib-{}{}", std::process::id(), std::env::consts::DLL_SUFFIX));
        std::fs::write(&f, b"nope").unwrap();
        assert!(open_file(&f, "kotlin").is_err());
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn corpus_cases_split() {
        let t = "==========\nfunctions\n==========\n\nfn a() {}\n\n---\n\n(source_file)\n\n===\nmore\n===\nb()\n---\n(x)\n";
        let c = corpus_cases(t);
        assert_eq!(c.len(), 2);
        assert!(c[0].contains("fn a()") && c[1].contains("b()"));
    }
}
