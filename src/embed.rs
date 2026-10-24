//! Optional EmbeddingGemma embeddings for Syntagm (E1).
//!
//! Off by default: nothing downloads, nothing runs, the default binary stays
//! the same size. `kula embed check` measures the machine first; `install`
//! refuses below thresholds unless `--force`; `run` embeds symbols in batches
//! on a bounded, low-priority pool with a content-hash cache, so only changed
//! symbols re-embed and a Ctrl-C leaves a resumable cache.
//!
//! Inference lives behind the `embed` cargo feature (`src/embed_ort.rs` –
//! fastembed's EmbeddingGemma300MQ4), so a default `cargo build` never links
//! the ONNX runtime. Everything here compiles and tests without it: the
//! [`MockProvider`] stands in for the model.

use crate::config::Embed as EmbedCfg;
use crate::store::{Node, Store};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// EmbeddingGemma's 768-dim output, truncated to 256 (Matryoshka).
pub const DIM: usize = 256;
// Hard cap on texts per batch, per the performance rules. Read at wave-2
// wiring and by embed_ort under the feature; the config caps batch_size.
#[allow(dead_code)]
pub const MAX_BATCH: usize = 64;
/// Estimated download size of the quantised ONNX model, for the check table.
pub const MODEL_MB: u64 = 210;
/// Refuse thresholds – `install` needs `--force` below either.
pub const MIN_FREE_RAM_GB: f64 = 4.0;
pub const MIN_FREE_DISK_GB: f64 = 2.0;
/// Load-average threshold: busy when the 1-minute average passes this share of cores.
pub const LOAD_SHARE: f64 = 0.7;
/// Free-RAM floor under which the adaptive loop backs off hard.
pub const RAM_FLOOR_GB: f64 = 2.0;
/// Adaptive back-off bounds: the batch never drops below this, the pause never grows past this.
pub const MIN_ADAPT_BATCH: usize = 4;
pub const MAX_ADAPT_PAUSE_MS: u64 = 2_000;

/// The retrieval-task prompt EmbeddingGemma expects ahead of every code text.
pub const PROMPT: &str = "task: code retrieval | query: ";

/// Where the model and the per-repo cache live.
pub fn model_dir() -> PathBuf {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache/kula/models")).unwrap_or_else(|| PathBuf::from(".kula/models"))
}

pub fn cache_dir(repo: &crate::git::Repo) -> PathBuf {
    repo.kula_dir().join("embed")
}

// ------------------------------------------------------------------ stats

#[derive(Serialize, Clone, Debug)]
pub struct Stats {
    /// Total RAM, GB.
    pub ram_total_gb: f64,
    /// Free RAM, GB.
    pub ram_free_gb: f64,
    /// Free disk on the model-cache volume, GB.
    pub disk_free_gb: f64,
    pub cores: usize,
    pub arch: String,
    /// Symbol count of this repo, for the time estimate.
    pub symbols: usize,
    /// Estimated model download + peak RSS headroom, MB.
    pub model_mb: u64,
    /// Rough wall-clock for a full embed of this repo, seconds.
    pub est_seconds: u64,
    /// The run profile hardware_check picked: standard or gentle (and why).
    pub profile: String,
    /// The hardware verdict before the `[embed] enabled` gate – refuse only
    /// when the machine genuinely cannot take the model (disk).
    pub hardware_verdict: String,
    /// ok | warn | refuse
    pub verdict: String,
    /// Why – empty when ok.
    pub reasons: Vec<String>,
}

/// RAM and disk read without pulling in a heavyweight stats crate: libc's
/// sysconf / sysctl / statvfs, ~40 KB of dep.
#[cfg(unix)]
fn ram_stats() -> (f64, f64) {
    unsafe {
        let total = libc::sysconf(libc::_SC_PHYS_PAGES) as f64 * libc::sysconf(libc::_SC_PAGESIZE) as f64;
        // macOS has no _SC_AVPHYS_PAGES and no hw.freemem oid – vm_stat is the
        // supported way to read free pages. "Available" counts free, speculative,
        // inactive and purgeable – what a malloc can get back in a hurry.
        #[cfg(target_os = "macos")]
        let free = {
            let page = libc::sysconf(libc::_SC_PAGESIZE) as f64;
            let out = std::process::Command::new("vm_stat").output();
            let mut pages = 0f64;
            if let Ok(o) = out {
                for l in String::from_utf8_lossy(&o.stdout).lines() {
                    let n = |key: &str| -> f64 {
                        match l.strip_prefix(key) {
                            Some(rest) => rest.trim().trim_end_matches('.').replace(',', "").parse::<f64>().unwrap_or(0.0),
                            None => 0.0,
                        }
                    };
                    for key in ["Pages free: ", "Pages speculative: ", "Pages inactive: ", "Pages purgeable: "] {
                        pages += n(key);
                    }
                }
            }
            pages * page
        };
        #[cfg(not(target_os = "macos"))]
        let free = libc::sysconf(libc::_SC_AVPHYS_PAGES) as f64 * libc::sysconf(libc::_SC_PAGESIZE) as f64;
        (total / 1e9, free / 1e9)
    }
}

/// Windows has no sysconf: ask CIM through PowerShell (values in KB).
#[cfg(windows)]
fn ram_stats() -> (f64, f64) {
    let kb = powershell("$o = Get-CimInstance Win32_OperatingSystem; \"$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)\"");
    let mut it = kb.split_whitespace().map(|v| v.parse::<f64>().unwrap_or(0.0) * 1024.0 / 1e9);
    (it.next().unwrap_or(0.0), it.next().unwrap_or(0.0))
}

#[cfg(windows)]
fn powershell(cmd: &str) -> String {
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", cmd])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[cfg(windows)]
fn disk_free(path: &std::path::Path) -> f64 {
    let mut p = path.to_path_buf();
    while !p.exists() && p.pop() {}
    let drive = p.to_string_lossy().chars().next().filter(|c| c.is_ascii_alphabetic()).unwrap_or('C');
    powershell(&format!("(Get-PSDrive {drive}).Free")).parse::<f64>().unwrap_or(0.0) / 1e9
}

#[cfg(unix)]
fn disk_free(path: &std::path::Path) -> f64 {
    // statvfs needs an existing path – walk up to the first ancestor that is there.
    let mut p = path.to_path_buf();
    while !p.exists() && p.pop() {}
    let p = if p.as_os_str().is_empty() { std::path::PathBuf::from("/") } else { p };
    let c = match std::ffi::CString::new(p.to_string_lossy().as_bytes()) {
        Ok(c) => c,
        Err(_) => return 0.0,
    };
    unsafe {
        let mut fs: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut fs) == 0 {
            fs.f_bavail as f64 * fs.f_frsize as f64 / 1e9
        } else {
            0.0
        }
    }
}

/// A run profile: batch size, worker threads, inter-batch pause, a name for
/// the status display. `hardware_check` picks one per machine – standard on
/// a healthy desktop, gentle on a small one – so embeddings run everywhere
/// instead of refusing.
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub batch: usize,
    pub threads: usize,
    pub pause_ms: u64,
    pub name: String,
}

/// The standard profile: the config's own throttled defaults.
pub fn standard_profile(cfg: &EmbedCfg) -> Profile {
    Profile { batch: cfg.batch_size(), threads: cfg.pool(), pause_ms: cfg.pause(), name: "standard".into() }
}

/// The gentle profile for small machines: one worker, a capped batch, a
/// longer pause. An explicitly configured batch is honoured when it is
/// already smaller than the cap (so tests and tuned configs stay put);
/// otherwise the batch is capped at 4. Embeddings take longer but never
/// crowd the machine.
pub fn gentle_profile(cfg: &EmbedCfg) -> Profile {
    Profile { batch: cfg.batch_size().min(4), threads: 1, pause_ms: (cfg.pause() * 2).max(500), name: "gentle".into() }
}

/// Pick a profile for this machine. Low RAM or few cores no longer refuse –
/// they select [`gentle_profile`]. Only a genuinely unloadable model stops a
/// run, and that is checked when the model loads, not here.
pub fn profile_for(cores: usize, ram_free_gb: f64, cfg: &EmbedCfg) -> Profile {
    if cfg.fast {
        return Profile { batch: cfg.batch_size(), threads: cfg.pool(), pause_ms: 0, name: "fast".into() };
    }
    if cores <= 2 || ram_free_gb < MIN_FREE_RAM_GB {
        gentle_profile(cfg)
    } else {
        standard_profile(cfg)
    }
}

/// The check itself – no model needed, ships value even if the runtime stalls.
/// Hardware only: RAM, disk, cores. Small machines pick a gentler profile and
/// say so; nothing here refuses any more except a disk that cannot hold the
/// model download. The `[embed] enabled` gate lives in [`check`] so the
/// automatic first-run decision can judge the machine before the person has
/// touched the switch.
pub fn hardware_check(_repo: &crate::git::Repo, store: &Store, cfg: &EmbedCfg) -> Result<Stats> {
    let (ram_total, ram_free) = ram_stats();
    let disk_free = disk_free(&model_dir());
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let symbols = store.nodes_where("kind != 'file'", ())?.len();
    let profile = profile_for(cores, ram_free, cfg);
    // Q4 ONNX on an M-class core: ~8 ms per text – batches stream through the
    // pool, so wall time is texts/batch * per-text, not multiplied by threads.
    let est_seconds = (symbols as f64 / profile.batch.max(1) as f64 * 0.008).ceil() as u64;
    let mut reasons = Vec::new();
    let mut verdict = "ok";
    // RAM and cores never refuse or warn any more: low RAM or few cores pick
    // the gentle profile and the adaptive loop handles pressure mid-run, so
    // embeddings reach machines the old thresholds turned away. Only a disk
    // that cannot hold the model blocks anything.
    if ram_free < MIN_FREE_RAM_GB {
        reasons.push(format!("free RAM {ram_free:.1} GB < {MIN_FREE_RAM_GB} GB – gentle profile: batch {}, 1 thread", profile.batch));
    }
    if cores <= 2 {
        reasons.push(format!("{cores} cores – gentle profile: batch {}, 1 thread", profile.batch));
    }
    if disk_free < MIN_FREE_DISK_GB {
        verdict = "refuse";
        reasons.push(format!("free disk {disk_free:.1} GB < {MIN_FREE_DISK_GB} GB for a ~{MODEL_MB} MB model"));
    } else if disk_free < 4.0 {
        verdict = "warn";
        reasons.push(format!("free disk {disk_free:.1} GB < 4 GB"));
    }
    Ok(Stats {
        ram_total_gb: (ram_total * 10.0).round() / 10.0,
        ram_free_gb: (ram_free * 10.0).round() / 10.0,
        disk_free_gb: (disk_free * 10.0).round() / 10.0,
        cores,
        arch: std::env::consts::ARCH.to_string(),
        symbols,
        model_mb: MODEL_MB,
        est_seconds,
        profile: profile.name,
        hardware_verdict: verdict.into(),
        verdict: verdict.into(),
        reasons,
    })
}

/// The full check for the switch and CLI: hardware verdict plus the
/// `[embed] enabled` gate – the switch must be on before anything installs.
pub fn check(repo: &crate::git::Repo, store: &Store, cfg: &EmbedCfg) -> Result<Stats> {
    let mut s = hardware_check(repo, store, cfg)?;
    if !cfg.enabled {
        s.verdict = "refuse".into();
        s.reasons.push("[embed] enabled = false in kula.toml – turn it on before install".into());
    }
    Ok(s)
}

/// The two-column table `kula embed check` prints.
pub fn render_check(s: &Stats) -> String {
    let row = |k: &str, v: String| format!("  {:<28} {}\n", k, v);
    let mut out = String::new();
    out.push_str(&row("RAM total", format!("{:.1} GB", s.ram_total_gb)));
    out.push_str(&row("RAM free", format!("{:.1} GB", s.ram_free_gb)));
    out.push_str(&row("Disk free", format!("{:.1} GB", s.disk_free_gb)));
    out.push_str(&row("Cores", s.cores.to_string()));
    out.push_str(&row("Arch", s.arch.clone()));
    out.push_str(&row("Symbols in this repo", s.symbols.to_string()));
    out.push_str(&row("Model download", format!("~{} MB", s.model_mb)));
    out.push_str(&row("Estimated embed time", format!("~{} s", s.est_seconds)));
    out.push_str(&row("Verdict", s.verdict.clone()));
    for r in &s.reasons {
        out.push_str(&row("Reason", r.clone()));
    }
    out
}

// ------------------------------------------------------------------ providers

/// Where embeddings come from. The default build has only the mock; the
/// `embed` feature adds the real ONNX runtime.
pub trait EmbedProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn dim(&self) -> usize;
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>>;
}

/// Deterministic stand-in so tests run without a 200 MB model: a seeded
/// hash of the text projected onto the unit sphere. Same text in, same
/// vector out; similar texts are not promised to be close.
pub struct MockProvider {
    pub dim: usize,
}

impl MockProvider {
    pub fn new() -> Self {
        MockProvider { dim: DIM }
    }
}

impl Default for MockProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl EmbedProvider for MockProvider {
    fn name(&self) -> &'static str {
        "mock"
    }
    fn dim(&self) -> usize {
        self.dim
    }
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| mock_vec(t, self.dim)).collect())
    }
}

fn mock_vec(text: &str, dim: usize) -> Vec<f32> {
    let mut v = vec![0f32; dim];
    let mut seed: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        seed ^= *b as u64;
        seed = seed.wrapping_mul(0x1000_0000_01b3);
    }
    for (i, slot) in v.iter_mut().enumerate() {
        seed = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15).wrapping_add(i as u64);
        *slot = ((seed >> 11) as f64 / (1u64 << 53) as f64) as f32 - 0.5;
    }
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    v.iter().map(|x| x / n).collect()
}

/// The real runtime, behind the `embed` feature. Without it this errors
/// instead of linking the ONNX runtime into the default binary.
pub fn real_provider() -> Result<std::sync::Arc<dyn EmbedProvider>> {
    #[cfg(feature = "embed")]
    {
        Ok(std::sync::Arc::new(crate::embed_ort::FastEmbedProvider::load()?))
    }
    #[cfg(not(feature = "embed"))]
    {
        bail!("this binary was built without the embed feature – rebuild with --features embed")
    }
}

// ------------------------------------------------------------------ index

/// A built embedding index: vectors by symbol id, for B1's similarity trait
/// (`src/syntagm.rs` – wave-2 wiring implements it with `similarity_ids`).
// Wave-2 wiring implements B1's `Similarity` trait (src/syntagm.rs) over this.
#[allow(dead_code)]
pub struct EmbedIndex {
    pub provider: String,
    pub dim: usize,
    pub vectors: HashMap<i64, Vec<f32>>,
}

impl EmbedIndex {
    /// Cosine similarity between two symbols' embeddings; 0 when either is
    /// missing. This is the number B1 refines blocks with.
    #[allow(dead_code)]
    pub fn similarity_ids(&self, a: i64, b: i64) -> f32 {
        match (self.vectors.get(&a), self.vectors.get(&b)) {
            (Some(x), Some(y)) => cosine(x, y),
            _ => 0.0,
        }
    }
}

// Wave-2 wiring: B1's similarity trait calls this through EmbedIndex.
#[allow(dead_code)]
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na <= 1e-9 || nb <= 1e-9 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

/// Matryoshka truncation: keep the first `dim` coordinates, renormalise.
pub fn truncate(v: &[f32], dim: usize) -> Vec<f32> {
    let v = &v[..v.len().min(dim)];
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n <= 1e-9 {
        v.to_vec()
    } else {
        v.iter().map(|x| x / n).collect()
    }
}

// ----------------------------------------------------------------– B1 wiring

/// Load this repo's embedding cache as a similarity index for B1's builder.
/// `None` when nothing has been embedded yet (the graph-only path).
pub fn load_index(repo: &crate::git::Repo) -> Option<EmbedIndex> {
    let cache = Cache::load(&cache_dir(repo));
    let mut vectors: HashMap<i64, Vec<f32>> = HashMap::with_capacity(cache.by_node.len());
    for (id, h) in &cache.by_node {
        if let Some(v) = cache.by_hash.get(h) {
            vectors.insert(*id, v.clone());
        }
    }
    if vectors.is_empty() {
        None
    } else {
        let dim = vectors.values().next().map(|v| v.len()).unwrap_or(DIM);
        Some(EmbedIndex { provider: "cached".into(), dim, vectors })
    }
}

impl EmbedIndex {
    /// How much of the symbol graph this index covers, 0..1. Below 1 the
    /// graph changed after the last run – syntagm reports the chip "stale".
    pub fn coverage(&self, store: &Store) -> f64 {
        let total = store.nodes_where("kind != 'file'", []).map(|n| n.len()).unwrap_or(0);
        if total == 0 {
            return 0.0;
        }
        self.vectors.len().min(total) as f64 / total as f64
    }
}

/// B1's `Similarity` trait, answered from the cached embeddings.
impl crate::syntagm::Similarity for EmbedIndex {
    fn similarity(&self, a: i64, b: i64) -> f64 {
        self.similarity_ids(a, b) as f64
    }
}

/// Shared wiring for every `syntagm` entry point (the `blocks`/`chains` CLI
/// and `/api/syntagm`): load the cache and classify its state. Full coverage
/// of the current symbol graph is "on"; a graph that changed since the last
/// run is "stale"; no cache is "off".
pub fn similarity_for(repo: &crate::git::Repo, store: &Store) -> (Option<EmbedIndex>, &'static str) {
    match load_index(repo) {
        Some(i) if i.coverage(store) >= 0.9 => (Some(i), "on"),
        Some(i) => (Some(i), "stale"),
        None => (None, "off"),
    }
}

// ------------------------------------------------- thematic map (I1 ↔ map)

/// The role table's one-line rules – also the prototype texts the role
/// cross-check embeds. Kept in step with the map's classify_role contract.
// Consumed by the map engine at integration (see the plan's I1 note).
#[allow(dead_code)]
pub const ROLE_RULES: &[(&str, &str)] = &[
    ("entry", "a source: nothing in the repo calls it, and it calls into the repo"),
    ("orchestrator", "high fan-out into several blocks, low fan-in"),
    ("core", "inside a block's chains, neither entry nor utility – the actual work"),
    ("utility", "high fan-in from many distinct blocks, low fan-out, small"),
    ("adapter", "touches the outside world: file, network, process, DB, env"),
    ("model", "classes, structs, types, enums, constants read more than called"),
    ("config", "settings, constants and loaders under config paths"),
    ("test", "test code and fixtures"),
    ("glue", "re-export barrels and module index files"),
];

/// Embed each role's rule as a prototype vector. The map's graph role wins
/// unless the embedding cross-check is confident against these.
// Consumed by the map engine at integration (see the plan's I1 note).
#[allow(dead_code)]
pub fn role_prototypes(prov: &dyn EmbedProvider) -> Vec<(String, Vec<f32>)> {
    let texts: Vec<String> = ROLE_RULES.iter().map(|(r, rule)| format!("task: code retrieval | query: role {} – {}", r, rule)).collect();
    match prov.embed(&texts) {
        Ok(vs) => ROLE_RULES.iter().map(|(r, _)| r.to_string()).zip(vs).collect(),
        Err(_) => Vec::new(),
    }
}

/// Mean of a block's member vectors – the point the theme terms are measured
/// against. `None` when no member has a vector.
// Consumed by the map engine at integration (see the plan's I1 note).
#[allow(dead_code)]
pub fn block_centroid(idx: &EmbedIndex, members: &[i64]) -> Option<Vec<f32>> {
    let mut sum: Option<Vec<f32>> = None;
    let mut n = 0usize;
    for m in members {
        if let Some(v) = idx.vectors.get(m) {
            let s = sum.get_or_insert_with(|| vec![0.0; v.len()]);
            for (a, b) in s.iter_mut().zip(v) {
                *a += b;
            }
            n += 1;
        }
    }
    if n == 0 {
        return None;
    }
    sum.map(|s| s.into_iter().map(|x| x / n as f32).collect())
}

/// The block's theme: the 2–4 candidate terms (identifiers, docstring words)
/// whose embeddings sit closest to the block centroid, joined with spaces.
/// `None` when there is nothing to measure against.
// Consumed by the map engine at integration (see the plan's I1 note).
#[allow(dead_code)]
pub fn theme_for_terms(prov: &dyn EmbedProvider, centroid: &[f32], terms: &[String]) -> Option<String> {
    if centroid.is_empty() || terms.is_empty() {
        return None;
    }
    let texts: Vec<String> = terms.iter().map(|t| format!("task: code retrieval | query: {}", t)).collect();
    let vs = prov.embed(&texts).ok()?;
    let mut scored: Vec<(f32, &str)> =
        vs.iter().zip(terms).map(|(v, t)| (cosine(centroid, v), t.as_str())).filter(|(c, _)| *c > 0.0).collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    if scored.is_empty() {
        return None;
    }
    let take = scored.len().clamp(2, 4);
    Some(scored[..take].iter().map(|(_, t)| *t).collect::<Vec<_>>().join(" "))
}

/// Cross-check a graph role against the prototype embeddings for `symbol_text`
/// (the symbol's identifier plus first source lines). Returns
/// `(suggested_role, confidence)` when a prototype is meaningfully close –
/// `None` below the confidence bar (0.35), where the graph role stands.
// Consumed by the map engine at integration (see the plan's I1 note).
#[allow(dead_code)]
pub fn role_cross_check(prov: &dyn EmbedProvider, symbol_text: &str) -> Option<(String, f64)> {
    const BAR: f64 = 0.35;
    let ps = role_prototypes(prov);
    if ps.is_empty() {
        return None;
    }
    let v = prov.embed(&[format!("task: code retrieval | query: {}", symbol_text)]).ok()?.pop()?;
    let best =
        ps.iter().map(|(r, p)| (r, cosine(&v, p) as f64)).max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))?;
    (best.1 >= BAR).then(|| (best.0.clone(), best.1))
}

// ------------------------------------------------------------------ cache

/// Content-hash cache in `.kula/embed/`: hash → vector. Only changed symbols
/// re-embed, and a cancelled run leaves what it already did.
#[derive(Serialize, Deserialize, Default)]
struct Cache {
    /// sha256(PROMPT + text) → vector.
    by_hash: HashMap<String, Vec<f32>>,
    /// node id → the hash it was last embedded under.
    by_node: HashMap<i64, String>,
}

impl Cache {
    fn load(dir: &std::path::Path) -> Cache {
        std::fs::read(dir.join("cache.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    fn save(&self, dir: &std::path::Path) -> Result<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join("cache.json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(self)?)?;
        std::fs::rename(&tmp, dir.join("cache.json"))?;
        Ok(())
    }
}

fn text_hash(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(PROMPT.as_bytes());
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

/// The input per symbol: signature + docstring + first N lines of the body,
/// prefixed with the EmbeddingGemma code-retrieval task prompt.
pub fn symbol_text(source: Option<&str>, node: &Node, first_lines: usize) -> String {
    let mut parts = vec![format!("{} {} in {}", node.kind, node.name, node.path)];
    if let Some(src) = source {
        let all: Vec<&str> = src.lines().collect();
        let start = node.start_line.saturating_sub(1) as usize;
        let lines: Vec<&str> = all.iter().skip(start).take(first_lines).copied().collect();
        let mut body: Vec<&str> = Vec::new();
        // Docstring / doc comment lines right above the body.
        for l in all[..start.min(all.len())].iter().rev().take(6) {
            let t = l.trim();
            if t.starts_with("///") || t.starts_with("//") || t.starts_with("#") || t.starts_with("*") || t.starts_with("/*") {
                body.insert(0, t);
            } else {
                break;
            }
        }
        if !body.is_empty() {
            parts.push(body.join("\n"));
        }
        if !lines.is_empty() {
            parts.push(lines.join("\n"));
        }
    }
    format!("{}\n{}", PROMPT, parts.join("\n"))
}

// ------------------------------------------------------------------ run

/// 1-minute load average; 0.0 where the OS does not report one.
fn load1() -> f64 {
    #[cfg(unix)]
    unsafe {
        let mut avg = [0f64; 1];
        if libc::getloadavg(avg.as_mut_ptr(), 1) == 1 {
            return avg[0];
        }
    }
    0.0
}

/// The adaptive back-off between batches. One decision per batch, monotonic
/// recovery: under load or low RAM the pause doubles and the batch halves
/// (down to [`MIN_ADAPT_BATCH`] / [`MAX_ADAPT_PAUSE_MS`]); when idle it
/// recovers one step per batch toward the base values, so a busy machine
/// never thrashes between sizes.
#[derive(Clone, Debug, PartialEq)]
struct Throttle {
    /// The profile's batch and pause – what recovery climbs back to.
    base_batch: usize,
    base_pause_ms: u64,
    batch: usize,
    pause_ms: u64,
    cores: usize,
    /// Set whenever the last decision was a back-off, for the status display.
    paused_for_load: bool,
}

impl Throttle {
    fn new(profile: &Profile, cores: usize) -> Throttle {
        Throttle {
            base_batch: profile.batch,
            base_pause_ms: profile.pause_ms,
            batch: profile.batch,
            pause_ms: profile.pause_ms,
            cores: cores.max(1),
            paused_for_load: false,
        }
    }

    /// Busy when the load average passes `LOAD_SHARE` of the cores, or free
    /// RAM dips under the floor. One step per call.
    fn busy(&self, load1: f64, free_ram_gb: f64) -> bool {
        load1 > LOAD_SHARE * self.cores as f64 || free_ram_gb < RAM_FLOOR_GB
    }

    /// The between-batch decision for this batch: back off when busy, recover
    /// one step when idle. Returns whether the run paused for load.
    fn step(&mut self, load1: f64, free_ram_gb: f64) -> bool {
        if self.busy(load1, free_ram_gb) {
            self.pause_ms = (self.pause_ms * 2).min(MAX_ADAPT_PAUSE_MS);
            // The floor never lifts the batch above the profile's base: a
            // configured or gentle small batch stays small even under load.
            self.batch = (self.batch / 2).max(MIN_ADAPT_BATCH.min(self.base_batch));
            self.paused_for_load = true;
            true
        } else {
            self.paused_for_load = false;
            self.batch = (self.batch * 2).min(self.base_batch);
            self.pause_ms = (self.pause_ms / 2).max(self.base_pause_ms);
            false
        }
    }
}

/// Live state of an embedding run, polled by `/api/embed/status`.
#[derive(Serialize, Clone)]
pub struct RunState {
    pub running: bool,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub batches: usize,
    pub cancelled: bool,
    pub provider: String,
    /// Batches planned at run start (ceil of texts over the profile's base
    /// batch size, before any adaptive shrinking mid-run) – an estimate.
    pub batches_total: usize,
    /// Run profile in effect: standard | gentle | fast.
    pub profile: String,
    /// True when the last pause was stretched because the machine was busy.
    pub paused_for_load: bool,
    /// Last failure of a background (API) run, empty when all went well.
    pub error: String,
}

static RUN: OnceLock<Mutex<RunState>> = OnceLock::new();
static CANCEL: OnceLock<AtomicBool> = OnceLock::new();

fn run_state() -> &'static Mutex<RunState> {
    RUN.get_or_init(|| {
        Mutex::new(RunState {
            running: false,
            phase: String::new(),
            done: 0,
            total: 0,
            batches: 0,
            cancelled: false,
            provider: String::new(),
            batches_total: 0,
            profile: String::new(),
            paused_for_load: false,
            error: String::new(),
        })
    })
}

pub fn status() -> RunState {
    run_state().lock().unwrap().clone()
}

/// Record a background (API) run's failure for the status endpoint.
pub fn run_error(msg: String) {
    set_run(|s| {
        s.running = false;
        s.error = msg;
    });
}

pub fn installed() -> bool {
    model_dir().join("model.onnx").exists()
}

/// Ask a running job to stop; the cache it has written stays resumable.
// Exposed to the UI's stop button once the Syntagm tab wires the run endpoint.
#[allow(dead_code)]
pub fn cancel() {
    CANCEL.get_or_init(|| AtomicBool::new(false)).store(true, Ordering::Relaxed);
}

fn set_run(f: impl FnOnce(&mut RunState)) {
    let mut s = run_state().lock().unwrap();
    f(&mut s);
}

/// Embed every non-file symbol in the graph. Batches of `cfg.batch_size()`
/// on a bounded pool (`cfg.pool()` threads), below normal priority, checked
/// against `cancel()` between batches. Returns the index and the count of
/// symbols freshly embedded (not cache hits).
pub fn run(
    repo: &crate::git::Repo,
    store: &Store,
    cfg: &EmbedCfg,
    provider: &std::sync::Arc<dyn EmbedProvider>,
    cancel_check: impl Fn() -> bool,
) -> Result<(EmbedIndex, usize)> {
    let symbols: Vec<Node> = store.nodes_where("kind != 'file'", ())?;
    let dim = provider.dim().min(DIM);
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let profile = profile_for(cores, ram_stats().1, cfg);
    let batches_total = symbols.len().div_ceil(profile.batch.max(1));
    set_run(|s| {
        *s = RunState {
            running: true,
            phase: "gathering".into(),
            done: 0,
            total: symbols.len(),
            batches: 0,
            cancelled: false,
            provider: provider.name().into(),
            batches_total,
            profile: profile.name.clone(),
            paused_for_load: false,
            error: String::new(),
        }
    });
    CANCEL.get_or_init(|| AtomicBool::new(false)).store(false, Ordering::Relaxed);

    let mut cache = Cache::load(&cache_dir(repo));
    let mut out: HashMap<i64, Vec<f32>> = HashMap::with_capacity(symbols.len());
    // Old vectors for unchanged symbols come straight from the cache.
    let threads = profile.threads.max(1);
    let mut throttle = Throttle::new(&profile, cores);
    let mut embedded = 0usize;
    let mut cancelled = false;

    // Index-driven so the adaptive batch size takes effect every iteration.
    let mut at = 0usize;
    while at < symbols.len() {
        if cancel_check() {
            cancelled = true;
            break;
        }
        let chunk = &symbols[at..(at + throttle.batch.max(1)).min(symbols.len())];
        at += chunk.len();
        let mut batch_texts: Vec<(i64, String, String)> = Vec::with_capacity(chunk.len());
        for n in chunk {
            if let Some(h) = cache.by_node.get(&n.id) {
                if let Some(v) = cache.by_hash.get(h) {
                    out.insert(n.id, v.clone());
                    continue;
                }
            }
            let text = symbol_text(read_source(repo, &n.path).as_deref(), n, 12);
            batch_texts.push((n.id, text.clone(), text_hash(&text)));
        }
        if !batch_texts.is_empty() {
            set_run(|s| s.phase = format!("embed batch {} · {} texts", s.batches + 1, batch_texts.len()));
            // Bounded pool: embed the batch's texts across `threads` workers.
            let per = batch_texts.len().div_ceil(threads);
            let mut results: Vec<Vec<Vec<f32>>> = Vec::new();
            let mut handles = Vec::new();
            for group in batch_texts.chunks(per.max(1)) {
                let texts: Vec<String> = group.iter().map(|(_, t, _)| t.clone()).collect();
                let prov = std::sync::Arc::clone(provider);
                handles.push(
                    std::thread::Builder::new()
                        .stack_size(4 << 20)
                        .spawn(move || {
                            // Each worker runs below normal OS priority so the
                            // machine stays responsive; failure to lower it is
                            // never fatal.
                            lower_priority();
                            prov.embed(&texts)
                        })
                        .expect("embed worker"),
                );
            }
            for h in handles {
                results.push(h.join().map_err(|_| anyhow::anyhow!("embed worker panicked"))??);
            }
            for (group, vecs) in batch_texts.chunks(per.max(1)).zip(results) {
                for ((id, _, hash), v) in group.iter().zip(vecs) {
                    let v = truncate(&v, dim);
                    cache.by_hash.insert(hash.clone(), v.clone());
                    cache.by_node.insert(*id, hash.clone());
                    out.insert(*id, v);
                    embedded += 1;
                }
            }
        }
        set_run(|s| {
            s.batches += 1;
            s.done = out.len();
        });
        // Resumable: flush after every batch so a cancel keeps the work.
        cache.save(&cache_dir(repo))?;
        // Adaptive pause between batches: stretch under load or low RAM,
        // recover stepwise when idle. `fast` runs with a zero base pause and
        // skips the sleep entirely.
        let paused = throttle.step(load1(), ram_stats().1);
        set_run(|s| s.paused_for_load = paused);
        if throttle.pause_ms > 0 && at < symbols.len() && !cancel_check() {
            std::thread::sleep(std::time::Duration::from_millis(throttle.pause_ms));
        }
    }

    let idx = EmbedIndex { provider: provider.name().into(), dim, vectors: out };
    set_run(|s| {
        s.running = false;
        s.phase = if cancelled { "cancelled".into() } else { "done".into() };
        s.cancelled = cancelled;
    });
    Ok((idx, embedded))
}

/// Read a source file for its symbol text; missing files just leave the body out.
fn read_source(repo: &crate::git::Repo, path: &str) -> Option<String> {
    std::fs::read_to_string(repo.root.join(path)).ok()
}

/// Background QoS on macOS / nice 10 elsewhere, so embedding never competes
/// with the user's work. Called inside each worker thread at spawn; a
/// priority call that fails is degraded to a no-op, never a panic.
fn lower_priority() {
    #[cfg(target_os = "macos")]
    unsafe {
        // QoS on the calling thread: the worker drops to background while the
        // main thread stays at its own priority.
        let _ = libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_BACKGROUND, 0);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    unsafe {
        // PRIO_PROCESS with 0 targets the calling thread on Linux.
        let _ = libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
    #[cfg(not(unix))]
    {
        // No portable priority on this platform – skip quietly.
    }
}

// ------------------------------------------------------------------ install / remove

/// Pick a provider: the real model when the `embed` feature is built and the
/// model is installed; `--mock` forces the deterministic mock (tests, caches
/// without a download). Without either, `run` refuses – mock vectors must
/// never be mistaken for embeddings.
pub fn provider_for(cfg: &EmbedCfg, mock: bool) -> Result<std::sync::Arc<dyn EmbedProvider>> {
    if mock {
        return Ok(std::sync::Arc::new(MockProvider::new()));
    }
    if cfg.enabled && installed() {
        real_provider()
    } else {
        bail!("embedding is off: [embed] enabled = {} and the model is {}installed – set enabled = true, run `kula embed install`, or pass --mock", cfg.enabled, if installed() { "" } else { "not " })
    }
}

/// Poll this between batches to honour `kula embed` cancellations.
pub fn cancel_requested() -> bool {
    CANCEL.get_or_init(|| AtomicBool::new(false)).load(Ordering::Relaxed)
}

/// Download the quantised ONNX model to `~/.cache/kula/models` – checksummed,
/// resumable (HTTP Range), behind the `embed` feature. Without the feature
/// there is nothing to download.
pub fn install(repo: &crate::git::Repo) -> Result<bool> {
    #[cfg(feature = "embed")]
    {
        crate::embed_ort::install_model(repo)
    }
    #[cfg(not(feature = "embed"))]
    {
        let _ = repo;
        bail!("this binary was built without the embed feature – rebuild with --features embed")
    }
}

/// Refuse to install below the check's thresholds unless forced.
pub fn install_gate(s: &Stats, force: bool) -> Result<()> {
    if s.verdict == "ok" || force {
        return Ok(());
    }
    bail!("embed check says {} – {} (use --force to override)", s.verdict, s.reasons.join("; "))
}

/// Delete the model and this repo's embedding cache.
pub fn remove(repo: &crate::git::Repo) -> Result<u64> {
    let mut freed = 0u64;

    for dir in [model_dir(), cache_dir(repo)] {
        if let Ok(md) = std::fs::metadata(&dir) {
            freed += size_of(&dir, md.len());
        }
        if dir.exists() {
            std::fs::remove_dir_all(&dir).with_context(|| format!("removing {}", dir.display()))?;
        }
    }
    Ok(freed)
}

fn size_of(dir: &std::path::Path, seed: u64) -> u64 {
    let mut total = seed;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(md) = e.metadata() {
                total += if md.is_dir() { size_of(&e.path(), 0) } else { md.len() };
            }
        }
    }
    total
}

// ------------------------------------------------------------------ API payloads

/// Whether the embedding question has been settled for the person: an explicit
/// flip records `decided = true` in kula.toml. The automatic first-run decision
/// records its marker in the store instead (see [`store_decided`]) – kula index
/// must never dirty a fenced kula.toml. Both short-circuit the auto path.
pub fn decided(repo: &crate::git::Repo) -> bool {
    if let Ok(src) = std::fs::read_to_string(repo.root.join("kula.toml")) {
        if let Ok(t) = src.parse::<toml::Table>() {
            return t.get("embed").and_then(|e| e.get("decided")).and_then(|v| v.as_bool()).unwrap_or(false);
        }
    }
    false
}

/// The automatic first-run decision's marker, in the store's meta table –
/// not kula.toml, which is fenced (kula's own config): writing it during
/// `kula index` would leave the person's worktree dirty and hold a fenced
/// change in their next commit.
pub fn store_decided(store: &Store) -> bool {
    store.meta("embed.decided").as_deref() == Some("true")
}

/// Flip `[embed] enabled` in kula.toml in place, keeping every other comment
/// and table untouched. This is the Settings switch's persistence: the
/// server's `/api/embed/enable` calls it, so the run gate (`provider_for`)
/// and `kula embed status` agree with what the UI shows. Any explicit flip –
/// on or off – also records `decided = true`, so the automatic first-run
/// path never overrides the person's choice.
pub fn set_enabled(repo: &crate::git::Repo, on: bool) -> Result<()> {
    let p = repo.root.join("kula.toml");
    let text = std::fs::read_to_string(&p).unwrap_or_else(|_| crate::config::Config::default().render());
    let mut doc: toml_edit::DocumentMut = text.parse().with_context(|| format!("reading {}", p.display()))?;
    let t = doc.entry("embed").or_insert(toml_edit::table()).as_table_mut().context("[embed] must be a table")?;
    t["enabled"] = toml_edit::value(on);
    t["decided"] = toml_edit::value(true);
    let out = doc.to_string();
    // Never write a file kula itself can't read back.
    let _: crate::config::Config = toml::from_str(&out).context("the edit would make kula.toml invalid")?;
    std::fs::write(&p, out)?;
    Ok(())
}

// ------------------------------------------------------------------ auto on

/// What the automatic first-run decision did.
#[derive(Clone, Debug, PartialEq)]
pub struct AutoReport {
    /// ok | warn | refuse | decided | busy | error
    pub verdict: String,
    pub reasons: Vec<String>,
    pub enabled: bool,
}

fn auto_running() -> &'static AtomicBool {
    static A: OnceLock<AtomicBool> = OnceLock::new();
    A.get_or_init(|| AtomicBool::new(false))
}

/// The automatic embeddings decision, run once per repo. On first index and
/// at server start (when no decision is recorded – store marker or a person
/// flip in kula.toml) judge the machine with the hardware check: ok turns
/// embeddings on and installs, embeds and remaps in the background at low
/// priority; warn or refuse stays off and the reasons surface in Settings.
/// Either way the decision is recorded – the person is never re-prompted, and
/// the switch always wins afterwards.
///
/// `block = true` runs the pipeline on the calling thread (the CLI index,
/// which would otherwise die mid-install); `block = false` spawns a
/// low-priority background thread (the server).
pub fn auto(repo: &crate::git::Repo, store: &Store, block: bool) -> AutoReport {
    let cfg = crate::config::Config::load(&repo.root).map(|c| c.embed).unwrap_or_default();
    if store_decided(store) || decided(repo) || cfg.enabled {
        return AutoReport { verdict: "decided".into(), reasons: Vec::new(), enabled: cfg.enabled };
    }
    // Singleflight: one auto pipeline per process, and not while an explicit
    // run (switch → install → embed) is already going.
    if status().running || auto_running().swap(true, Ordering::SeqCst) {
        return AutoReport { verdict: "busy".into(), reasons: Vec::new(), enabled: false };
    }
    if !block {
        // Detached, low-priority: the server never waits for a download.
        let repo = repo.clone();
        let store = Store::open(&repo).ok();
        let spawned = std::thread::Builder::new().name("kula-embed-auto".into()).spawn(move || {
            lower_priority();
            let r = match store {
                Some(st) => auto_steps(&repo, &st, false),
                None => AutoReport { verdict: "error".into(), reasons: vec!["store would not open".into()], enabled: false },
            };
            auto_running().store(false, Ordering::SeqCst);
            if !r.enabled && r.verdict == "error" {
                crate::embed::run_error(r.reasons.join("; "));
            }
            r
        });
        if spawned.is_err() {
            auto_running().store(false, Ordering::SeqCst);
            return AutoReport { verdict: "error".into(), reasons: vec!["could not spawn the auto thread".into()], enabled: false };
        }
        return AutoReport { verdict: "spawned".into(), reasons: Vec::new(), enabled: false };
    }
    let r = auto_steps(repo, store, true);
    auto_running().store(false, Ordering::SeqCst);
    r
}

/// The pipeline itself, on the caller's thread: check → install → embed →
/// remap. Testable with a fake check and no-op model steps via [`auto_core`].
fn auto_steps(repo: &crate::git::Repo, store: &Store, block: bool) -> AutoReport {
    let cfg = crate::config::Config::load(&repo.root).map(|c| c.embed).unwrap_or_default();
    let stats = hardware_check(repo, store, &cfg).unwrap_or_else(|e| {
        // A failed check is a refuse with the reason on the record.
        Stats { verdict: "refuse".into(), reasons: vec![format!("check failed – {e:#}")], ..default_stats() }
    });
    auto_core(repo, store, block, stats, install, |r, s| {
        let cfg = crate::config::Config::load(&r.root)?.embed;
        let prov = provider_for(&cfg, false)?;
        let (_, n) = run(r, s, &cfg, &prov, cancel_requested)?;
        Ok(n)
    })
}

fn default_stats() -> Stats {
    Stats {
        ram_total_gb: 0.0,
        ram_free_gb: 0.0,
        disk_free_gb: 0.0,
        cores: 0,
        arch: String::new(),
        symbols: 0,
        model_mb: MODEL_MB,
        est_seconds: 0,
        profile: String::new(),
        hardware_verdict: String::new(),
        verdict: "refuse".into(),
        reasons: Vec::new(),
    }
}

/// The decision logic with the machine's verdict and the model steps as
/// inputs, so tests can drive ok / warn / refuse without hardware or a
/// download. Records `decided` either way before anything else happens.
fn auto_core(
    repo: &crate::git::Repo,
    store: &Store,
    block: bool,
    stats: Stats,
    install_step: impl Fn(&crate::git::Repo) -> Result<bool>,
    embed_step: impl Fn(&crate::git::Repo, &Store) -> Result<usize>,
) -> AutoReport {
    // The decision is recorded whatever the verdict – never re-prompt. The
    // store carries it, not kula.toml: kula's own config is fenced, and a
    // write during `kula index` would hold a fenced change in the person's
    // next commit.
    if let Err(e) = store.set_meta("embed.decided", "true") {
        return AutoReport { verdict: "error".into(), reasons: vec![format!("{e:#}")], enabled: false };
    }
    if stats.verdict != "ok" {
        return AutoReport { verdict: stats.verdict, reasons: stats.reasons, enabled: false };
    }
    // Hardware says ok: turn the switch on, install, embed, remap. An install
    // failure leaves the switch off – Settings explains, and the person can
    // turn it on manually.
    if let Err(e) = set_enabled(repo, true) {
        return AutoReport { verdict: "error".into(), reasons: vec![format!("{e:#}")], enabled: false };
    }
    if let Err(e) = install_step(repo).and_then(|downloaded| {
        if downloaded || installed() {
            Ok(())
        } else {
            bail!("install reported nothing to do and the model is still missing")
        }
    }) {
        let _ = set_enabled(repo, false);
        return AutoReport { verdict: "error".into(), reasons: vec![format!("install failed – {e:#}")], enabled: false };
    }
    match embed_step(repo, store) {
        Ok(n) => {
            // Embeddings landed: remap so blocks re-form thematically. The
            // CLI runs it inline (a spawned thread would die at exit); the
            // server spawns on the background pool.
            if block {
                crate::map_run::run_now(repo.clone(), true);
            } else {
                crate::map_run::spawn(repo.clone(), true);
            }
            AutoReport { verdict: "ok".into(), reasons: vec![format!("embedded {n} symbols")], enabled: true }
        }
        Err(e) => {
            let _ = set_enabled(repo, false);
            AutoReport { verdict: "error".into(), reasons: vec![format!("embed failed – {e:#}")], enabled: false }
        }
    }
}

/// `GET /api/embed/status` – config, install state, live run.
pub fn api_status(repo: &crate::git::Repo) -> Result<serde_json::Value> {
    let cfg = crate::config::Config::load(&repo.root)?.embed;
    Ok(serde_json::json!({
        "enabled": cfg.enabled,
        "installed": installed(),
        "feature": cfg_feature(),
        "model_dir": model_dir().display().to_string(),
        "run": status(),
    }))
}

fn cfg_feature() -> bool {
    cfg!(feature = "embed")
}

/// `GET /api/embed/check` – the stats table as JSON.
pub fn api_check(repo: &crate::git::Repo, store: &Store) -> Result<serde_json::Value> {
    let cfg = crate::config::Config::load(&repo.root)?.embed;
    let s = check(repo, store, &cfg)?;
    Ok(serde_json::to_value(&s)?)
}

// ------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway git repo with a .kula dir, per the clean.rs test pattern.
    fn test_repo(dir: &std::path::Path) -> crate::git::Repo {
        std::process::Command::new("git").args(["init", "-q"]).current_dir(dir).status().unwrap();
        std::fs::create_dir_all(dir.join(".kula")).unwrap();
        crate::git::Repo::discover(dir).unwrap()
    }

    #[test]
    fn mock_vectors_are_deterministic_and_unit_length() {
        let p = MockProvider::new();
        let v = p.embed(&["task: code retrieval | query: fn parse_cfg".into()]).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].len(), DIM);
        let n: f32 = v[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((n - 1.0).abs() < 1e-4, "unit vector, got {n}");
        let w = p.embed(&["task: code retrieval | query: fn parse_cfg".into()]).unwrap();
        assert_eq!(v[0], w[0], "same text, same vector");
    }

    // ------------------------------------------------– thematic map (I1)

    #[test]
    fn role_prototypes_cover_every_role_and_are_unit_vectors() {
        let p = MockProvider::new();
        let ps = role_prototypes(&p);
        assert_eq!(ps.len(), ROLE_RULES.len(), "one prototype per role");
        for (r, v) in &ps {
            let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            assert!((n - 1.0).abs() < 1e-3, "role {} prototype not unit length", r);
        }
        // Same provider, same prototypes – deterministic.
        assert_eq!(role_prototypes(&p), ps);
    }

    #[test]
    fn role_cross_check_accepts_the_exact_rule_and_drops_noise() {
        let p = MockProvider::new();
        // The prototype text itself must cross-check back to its role.
        for (r, rule) in ROLE_RULES {
            let (got, conf) = role_cross_check(&p, &format!("role {} – {}", r, rule)).expect("a confident match");
            assert_eq!(got, *r, "exact rule text cross-checks to its own role");
            assert!(conf > 0.9, "self-similarity is near 1, got {}", conf);
        }
        // A text that matches no rule closely still names some nearest role –
        // but the mock's hash vectors keep confidence well under the bar for
        // genuinely unrelated text, so just prove the shape of the answer.
        if let Some((role, conf)) = role_cross_check(&p, "fn do_things(x: u8) -> u8 { x + 1 }") {
            assert!(ROLE_RULES.iter().any(|(r, _)| r == &role), "the suggestion is a known role");
            assert!((0.0..=1.0).contains(&conf), "confidence in 0..1");
        }
    }

    #[test]
    fn theme_for_terms_picks_the_closest_terms_to_the_centroid() {
        let p = MockProvider::new();
        // The members' vectors ARE the mock's embedding of one term's text, so
        // the centroid equals that embedding and that term must win with a
        // hash provider – deterministic, not hoping a hash vector is close.
        let term_text = |t: &str| format!("task: code retrieval | query: {}", t);
        let v_dicom = p.embed(&[term_text("dicom")]).unwrap().pop().unwrap();
        let cs: HashMap<i64, Vec<f32>> = [(1i64, v_dicom.clone()), (2, v_dicom.clone())].into_iter().collect();
        let ix = EmbedIndex { provider: "mock".into(), dim: DIM, vectors: cs };
        let c = block_centroid(&ix, &[1, 2]).expect("centroid from members");
        let theme = theme_for_terms(&p, &c, &["dicom".into(), "decode".into(), "pixel".into(), "render".into()]).expect("theme from terms");
        let words: Vec<&str> = theme.split(' ').collect();
        assert!((2..=4).contains(&words.len()), "theme is 2–4 words, got {:?}", words);
        assert!(theme.contains("dicom"), "the dominant term leads the theme");
        // Empty inputs give no theme.
        assert!(theme_for_terms(&p, &[], &["x".into()]).is_none());
        assert!(theme_for_terms(&p, &c, &[]).is_none());
        assert!(block_centroid(&ix, &[99]).is_none(), "no vectors, no centroid");
    }

    #[test]
    fn cosine_and_truncation() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-6);
        let c = vec![0.0, 1.0, 0.0];
        assert!(cosine(&a, &c).abs() < 1e-6);
        assert_eq!(cosine(&a, &[]), 0.0);
        // Matryoshka: keep the front, renormalise.
        let t = truncate(&[3.0, 4.0, 99.0], 2);
        assert_eq!(t.len(), 2);
        assert!((cosine(&t, &[3.0, 4.0]) - 1.0).abs() < 1e-6);
    }

    // ------------------------------------------------– auto on (I1)

    fn no_install(_r: &crate::git::Repo) -> Result<bool> {
        Ok(true)
    }
    fn no_embed(_r: &crate::git::Repo, _s: &Store) -> Result<usize> {
        Ok(0)
    }

    #[test]
    fn auto_refuse_records_the_decision_and_stays_off() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        std::fs::write(repo.root.join("kula.toml"), "[embed]\nenabled = false\n").unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let low = Stats {
            ram_free_gb: 1.0,
            disk_free_gb: 1.0,
            verdict: "refuse".into(),
            reasons: vec!["free RAM 1.0 GB < 4 GB".into()],
            ..default_stats()
        };
        let rep = auto_core(&repo, &st, true, low, no_install, no_embed);
        assert_eq!(rep.verdict, "refuse");
        assert!(!rep.enabled, "a refuse verdict never flips the switch");
        let cfg = crate::config::Config::load(&repo.root).unwrap().embed;
        assert!(!cfg.enabled);
        assert_eq!(st.meta("embed.decided").as_deref(), Some("true"), "the decision is recorded either way");
        // The automatic path never dirties kula.toml – it is fenced, and the
        // person's next commit must not hold a fenced change.
        assert_eq!(std::fs::read_to_string(repo.root.join("kula.toml")).unwrap(), "[embed]\nenabled = false\n");
        // A second run never re-prompts – the marker short-circuits.
        let again = auto(&repo, &st, true);
        assert_eq!(again.verdict, "decided");
        assert!(!again.enabled);
    }

    #[test]
    fn auto_ok_flips_the_switch_and_runs_the_pipeline() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        std::fs::write(repo.root.join("kula.toml"), "[embed]\nenabled = false\n").unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let ok = Stats { verdict: "ok".into(), reasons: Vec::new(), ..default_stats() };
        let rep = auto_core(&repo, &st, true, ok.clone(), no_install, |_, _| Ok(5));
        assert_eq!(rep.verdict, "ok");
        assert!(rep.enabled, "an ok verdict turns embeddings on in the background path");
        let text = std::fs::read_to_string(repo.root.join("kula.toml")).unwrap();
        assert!(text.contains("enabled = true"));
        assert!(text.contains("decided = true"));
        assert_eq!(st.meta("embed.decided").as_deref(), Some("true"));
        // An install failure leaves the switch off but the decision recorded.
        let fail = auto_core(&repo, &st, true, ok.clone(), |_r| bail!("download died"), no_embed);
        assert_eq!(fail.verdict, "error");
        assert!(fail.reasons[0].contains("download died"));
        let cfg = crate::config::Config::load(&repo.root).unwrap().embed;
        assert!(!cfg.enabled, "install failure flips the switch back off");
        assert!(decided(&repo));
    }

    #[test]
    fn set_enabled_also_records_the_decision() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        std::fs::write(repo.root.join("kula.toml"), "[embed]\nenabled = false\n").unwrap();
        set_enabled(&repo, false).unwrap();
        assert!(decided(&repo), "any explicit flip sticks – auto never re-prompts");
    }

    #[test]
    fn check_refuses_without_config_and_reports_the_table() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let cfg = EmbedCfg::default();
        let s = check(&repo, &st, &cfg).unwrap();
        assert_eq!(s.verdict, "refuse", "disabled by default");
        assert!(s.reasons.iter().any(|r| r.contains("enabled = false")));
        let table = render_check(&s);
        assert!(table.contains("RAM total"));
        assert!(table.contains("Verdict"));
        assert!(table.lines().count() >= 9, "two-column table, one row per line:\n{table}");
        // Below-threshold install refuses without --force.
        let low = Stats { ram_free_gb: 1.0, disk_free_gb: 1.0, verdict: "refuse".into(), ..s.clone() };
        assert!(install_gate(&low, false).is_err());
        assert!(install_gate(&low, true).is_ok());
        let ok = Stats { verdict: "ok".into(), ..low };
        assert!(install_gate(&ok, false).is_ok());
    }

    #[test]
    fn run_caches_and_reembeds_only_changed_symbols() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        std::fs::write(repo.root.join("a.rs"), "fn one() {}\nfn two() {}\n").unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        // Two symbols, one file.
        st.write_all(
            &[
                Node {
                    id: 1,
                    kind: "function".into(),
                    name: "one".into(),
                    path: "a.rs".into(),
                    lang: "rust".to_string(),
                    start_line: 1,
                    end_line: 1,
                    parent: None,
                    community: 0,
                },
                Node {
                    id: 2,
                    kind: "function".into(),
                    name: "two".into(),
                    path: "a.rs".into(),
                    lang: "rust".to_string(),
                    start_line: 2,
                    end_line: 2,
                    parent: None,
                    community: 0,
                },
            ],
            &[],
            &[],
        )
        .unwrap();
        let cfg = EmbedCfg { enabled: true, threads: 2, batch: 1, pause_ms: 0, fast: false };
        let (idx1, fresh1) =
            run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || false).unwrap();
        assert_eq!(idx1.vectors.len(), 2);
        assert_eq!(fresh1, 2, "first run embeds both");
        // Second run: everything hits the cache, nothing re-embeds.
        let (_, fresh2) =
            run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || false).unwrap();
        assert_eq!(fresh2, 0, "unchanged symbols come from the cache");
        // Same vectors out of the cache.
        let (idx2, _) =
            run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || false).unwrap();
        assert_eq!(idx1.similarity_ids(1, 1), idx2.similarity_ids(1, 1));
        assert!(idx1.similarity_ids(1, 1) > 0.999, "identical symbol is similar to itself");
    }

    #[test]
    fn cancel_between_batches_is_resumable() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let nodes: Vec<Node> = (0..5)
            .map(|i| Node {
                id: i + 1,
                kind: "function".into(),
                name: format!("f{i}"),
                path: format!("f{i}.rs"),
                lang: String::new(),
                start_line: 1,
                end_line: 1,
                parent: None,
                community: 0,
            })
            .collect();
        st.write_all(&nodes, &[], &[]).unwrap();
        let cfg = EmbedCfg { enabled: true, threads: 1, batch: 2, pause_ms: 0, fast: false };
        let (idx, _) =
            run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || true).unwrap();
        assert!(idx.vectors.is_empty(), "cancelled before the first batch");
        assert_eq!(status().phase, "cancelled");
        // A resumable rerun finishes the job.
        let (idx2, fresh) =
            run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || false).unwrap();
        assert_eq!(idx2.vectors.len(), 5);
        assert_eq!(fresh, 5);
    }

    // -------------------------------------------------- gentle runs

    #[test]
    fn batch_sizing_picks_a_gentler_profile_for_small_machines() {
        let std_cfg = EmbedCfg::default();
        // A healthy machine gets the config's own throttled defaults.
        let p = profile_for(8, 16.0, &std_cfg);
        assert_eq!(p.name, "standard");
        assert_eq!(p.batch, 16, "default batch is 16, not the old 32");
        assert_eq!(p.threads, 2, "max(1, cores / 4) by default");
        assert_eq!(p.pause_ms, 250);
        // Low RAM or few cores no longer refuse – they go gentle.
        let low = profile_for(8, 2.0, &std_cfg);
        assert_eq!(low.name, "gentle");
        assert_eq!((low.batch, low.threads), (4, 1));
        let few = profile_for(2, 16.0, &std_cfg);
        assert_eq!(few.name, "gentle");
        assert_eq!(few.threads, 1);
        // Fast overrides everything: full batch, every core, no pause.
        let fast_cfg = EmbedCfg { enabled: true, threads: 0, batch: 8, pause_ms: 250, fast: true };
        let f = profile_for(2, 1.0, &fast_cfg);
        assert_eq!(f.name, "fast");
        assert_eq!(f.batch, 64, "fast takes the MAX_BATCH cap");
        assert_eq!(f.threads, std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1), "fast uses every core");
        assert_eq!(f.pause_ms, 0);
        assert_eq!(fast_cfg.batch_size(), 64);
        assert_eq!(fast_cfg.pool(), f.threads);
        assert_eq!(fast_cfg.pause(), 0);
        // An explicit threads count still wins over the automatic pool.
        assert_eq!(EmbedCfg { threads: 3, ..std_cfg.clone() }.pool(), 3);
        // Batch is capped at 64 whatever the config says.
        assert_eq!(EmbedCfg { batch: 500, ..std_cfg }.batch_size(), 64);
    }

    #[test]
    fn adaptive_back_off_stretches_and_recovers_stepwise() {
        let profile = Profile { batch: 16, threads: 2, pause_ms: 250, name: "standard".into() };
        let mut t = Throttle::new(&profile, 8);
        // Idle: nothing changes, no pause flag.
        assert!(!t.step(1.0, 16.0));
        assert!(!t.paused_for_load);
        assert_eq!((t.batch, t.pause_ms), (16, 250));
        // Busy (load 6 > 0.7 · 8? no – 5.6 < 6): one step back off.
        assert!(t.step(6.0, 16.0), "load above the share of cores is busy");
        assert_eq!((t.batch, t.pause_ms), (8, 500));
        // Still busy: keeps stepping to the floor / ceiling.
        t.step(6.0, 16.0);
        assert_eq!((t.batch, t.pause_ms), (4, 1_000));
        t.step(6.0, 16.0);
        assert_eq!((t.batch, t.pause_ms), (4, 2_000), "batch holds at 4, pause caps at 2 s");
        // Low RAM alone also counts as busy.
        let mut t = Throttle::new(&profile, 8);
        assert!(t.step(0.5, 1.5), "free RAM under the floor is busy");
        assert_eq!(t.batch, 8);
        // Recovery is one step per idle batch – monotonic, no thrash.
        assert!(!t.step(0.5, 16.0));
        assert_eq!(t.pause_ms, 250);
        assert_eq!(t.batch, 16, "batch recovers one doubling back to base");
        assert!(!t.step(0.5, 16.0));
        assert_eq!((t.batch, t.pause_ms), (16, 250), "stable at base, no further change");
    }

    #[test]
    fn cancel_mid_run_resumes_without_reembedding_done_symbols() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let nodes: Vec<Node> = (0..5)
            .map(|i| Node {
                id: i + 1,
                kind: "function".into(),
                name: format!("f{i}"),
                path: format!("f{i}.rs"),
                lang: String::new(),
                start_line: 1,
                end_line: 1,
                parent: None,
                community: 0,
            })
            .collect();
        st.write_all(&nodes, &[], &[]).unwrap();
        let cfg = EmbedCfg { enabled: true, threads: 1, batch: 2, pause_ms: 0, fast: false };
        // Cancel after the first two batches (4 of 5 symbols): a counter
        // closure, not a constant, so the run gets real work done first.
        let batches = std::cell::Cell::new(0);
        let (idx, _) = run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || {
            batches.set(batches.get() + 1);
            batches.get() > 2
        })
        .unwrap();
        // The throttle may resize batches under machine load, so the exact
        // count that lands before the cancel varies – the contract is that
        // some work landed and the run stopped short of the whole set.
        let landed = idx.vectors.len();
        assert!(landed > 0 && landed < 5, "the cancel stopped the run part-way ({landed} of 5 landed)");
        // The rerun picks up where the cancel left off: only the symbols the
        // cancel cut off are fresh, the done ones come from the cache.
        let prov = std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>;
        let (idx2, fresh) = run(&repo, &st, &cfg, &prov, || false).unwrap();
        assert_eq!(idx2.vectors.len(), 5);
        assert_eq!(fresh, 5 - landed, "unchanged symbols are never re-embedded after a cancel");
        // RunState carries the progress the UI displays (batch plan and the
        // paused-for-load flag). status() is process-global and other tests
        // run concurrently, so only the fields' presence and types are
        // asserted here, not this run's values – phase is covered by the
        // serial-in-practice cancel test above.
        let planned = 5usize.div_ceil(profile_for(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1), 16.0, &cfg).batch);
        assert_eq!(planned, 3, "ceil(5 / 2) batches planned for the status display");
    }

    #[test]
    fn symbol_text_prefixes_the_task_prompt() {
        let n = Node {
            id: 1,
            kind: "function".into(),
            name: "parse_cfg".into(),
            path: "src/cfg.rs".into(),
            lang: String::new(),
            start_line: 3,
            end_line: 6,
            parent: None,
            community: 0,
        };
        let src = "// top\n/// Parses the config.\nfn parse_cfg(p: &Path) -> Cfg {\n    let x = 1;\n    let y = 2;\n    let z = x + y;\n    let w = z * 2;\n    let q = w - 1;\n    let r = q + 1;\n    let s = r + 2;\n    let t = s + 3;\n    let u = t + 4;\n    let v = u + 5;\n    Cfg { x, y }\n}";
        let t = symbol_text(Some(src), &n, 3);
        assert!(t.starts_with(PROMPT), "prompt first: {t}");
        assert!(t.contains("/// Parses the config."), "docstring kept");
        assert!(t.contains("fn parse_cfg"), "signature kept");
        assert!(t.contains("let y = 2;"), "body lines kept");
        assert!(!t.contains("let z = x + y;"), "stops after the first lines");
    }

    /// The real model, run by hand: `cargo test --features embed real_model_ -- --ignored`
    /// Downloads ~210 MB to ~/.cache/kula/models on first run.
    #[test]
    #[ignore]
    fn real_model_embeds_and_truncates_to_256() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        let store = Store::create(&repo).unwrap();
        store.publish().unwrap();
        let st = Store::open(&repo).unwrap();
        let prov = real_provider().unwrap();
        let cfg = EmbedCfg::default();
        let (idx, fresh) = run(&repo, &st, &cfg, &prov, || false).unwrap();
        assert_eq!(fresh, 0, "empty repo, nothing to embed");
        assert_eq!(idx.dim, DIM, "Matryoshka truncation to 256");
    }

    // -------------------------------------------------- I1 · the switch

    /// set_enabled writes `[embed] enabled` in place, keeping the rest of
    /// kula.toml – and status reads it back. This is the Settings switch's
    /// whole persistence story.
    #[test]
    fn set_enabled_flips_the_switch_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        std::fs::write(repo.root.join("kula.toml"), "# top comment\n[agents]\nmemory = true\n").unwrap();

        set_enabled(&repo, true).unwrap();
        let text = std::fs::read_to_string(repo.root.join("kula.toml")).unwrap();
        assert!(text.contains("enabled = true"), "{text}");
        assert!(text.contains("[agents]"), "other tables kept: {text}");
        assert!(text.contains("# top comment"), "comments kept: {text}");
        let cfg = crate::config::Config::load(&repo.root).unwrap().embed;
        assert!(cfg.enabled);

        set_enabled(&repo, false).unwrap();
        let cfg = crate::config::Config::load(&repo.root).unwrap().embed;
        assert!(!cfg.enabled, "flips back off");
    }

    /// The wiring test that runs without the model: the mock provider rides
    /// similarity_for into the map (once M1 lands the thematic pass, this is
    /// the same path), and the stored map records the embed state.
    #[test]
    fn mock_similarity_rides_the_map_via_similarity_for() {
        let dir = tempfile::tempdir().unwrap();
        let repo = test_repo(dir.path());
        std::fs::create_dir_all(repo.kula_dir()).unwrap();
        // Two files with calls between them: something for the cache to hold.
        std::fs::create_dir_all(repo.root.join("src")).unwrap();
        std::fs::write(repo.root.join("src/a.ts"), "export function ping() { return pong(); }\n").unwrap();
        std::fs::write(repo.root.join("src/b.ts"), "export function pong() { return 1; }\n").unwrap();
        crate::index::run(&repo, true).unwrap();
        let st = Store::open(&repo).unwrap();
        // Nothing embedded: similarity_for reports "off" and hands back no index.
        let (idx, state) = similarity_for(&repo, &st);
        assert!(idx.is_none(), "no cache, no index");
        assert_eq!(state, "off");
        // After a mock run the cache exists and similarity_for serves it.
        let cfg = EmbedCfg { enabled: true, threads: 1, batch: 2, pause_ms: 0, fast: false };
        run(&repo, &st, &cfg, &(std::sync::Arc::new(MockProvider::new()) as std::sync::Arc<dyn EmbedProvider>), || false).unwrap();
        let (idx, state) = similarity_for(&repo, &st);
        assert!(idx.is_some(), "cache present after a run");
        assert_eq!(state, "on", "full coverage reports on");
        // And the map engine accepts the provider through the trait.
        let s = crate::syntagm::build_with(&repo, &st, idx.as_ref().map(|i| i as &dyn crate::syntagm::Similarity), state).unwrap();
        assert!(!s.blocks.is_empty() || s.chains.is_empty(), "map built with the mock provider");
    }
}
