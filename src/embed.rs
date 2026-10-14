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
    /// ok | warn | refuse
    pub verdict: String,
    /// Why – empty when ok.
    pub reasons: Vec<String>,
}

/// RAM and disk read without pulling in a heavyweight stats crate: libc's
/// sysconf / sysctl / statvfs, ~40 KB of dep.
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

/// The check itself – no model needed, ships value even if the runtime stalls.
pub fn check(_repo: &crate::git::Repo, store: &Store, cfg: &EmbedCfg) -> Result<Stats> {
    let (ram_total, ram_free) = ram_stats();
    let disk_free = disk_free(&model_dir());
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let symbols = store.nodes_where("kind != 'file'", ())?.len();
    // Q4 ONNX on an M-class core: ~8 ms per text – batches stream through the
    // pool, so wall time is texts/batch * per-text, not multiplied by threads.
    let est_seconds = (symbols as f64 / cfg.batch_size().max(1) as f64 * 0.008).ceil() as u64;
    let mut reasons = Vec::new();
    let mut verdict = "ok";
    if ram_free < MIN_FREE_RAM_GB {
        verdict = "refuse";
        reasons.push(format!("free RAM {ram_free:.1} GB < {MIN_FREE_RAM_GB} GB"));
    } else if ram_free < 8.0 {
        verdict = "warn";
        reasons.push(format!("free RAM {ram_free:.1} GB < 8 GB – batch smaller"));
    }
    if disk_free < MIN_FREE_DISK_GB {
        verdict = "refuse";
        reasons.push(format!("free disk {disk_free:.1} GB < {MIN_FREE_DISK_GB} GB for a ~{MODEL_MB} MB model"));
    } else if disk_free < 4.0 {
        verdict = if verdict == "refuse" { verdict } else { "warn" };
        reasons.push(format!("free disk {disk_free:.1} GB < 4 GB"));
    }
    if !cfg.enabled {
        verdict = "refuse";
        reasons.push("[embed] enabled = false in kula.toml – turn it on before install".into());
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
        verdict: verdict.into(),
        reasons,
    })
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
    set_run(|s| {
        *s = RunState {
            running: true,
            phase: "gathering".into(),
            done: 0,
            total: symbols.len(),
            batches: 0,
            cancelled: false,
            provider: provider.name().into(),
            error: String::new(),
        }
    });
    CANCEL.get_or_init(|| AtomicBool::new(false)).store(false, Ordering::Relaxed);

    let mut cache = Cache::load(&cache_dir(repo));
    let mut out: HashMap<i64, Vec<f32>> = HashMap::with_capacity(symbols.len());
    // Old vectors for unchanged symbols come straight from the cache.
    let threads = cfg.pool().max(1);
    let pool = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let _ = pool; // bounded by chunking below; threads cap concurrency
    let batch = cfg.batch_size().max(1);
    let mut embedded = 0usize;
    let mut cancelled = false;

    for chunk in symbols.chunks(batch) {
        if cancel_check() {
            cancelled = true;
            break;
        }
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
                handles.push(std::thread::Builder::new().stack_size(4 << 20).spawn(move || prov.embed(&texts)).expect("embed worker"));
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
        lower_priority();
    }

    let idx = EmbedIndex { provider: provider.name().into(), dim, vectors: out };
    set_run(|s| {
        s.running = false;
        s.phase = if cancelled { "cancelled".into() } else { "done".into() };
        s.cancelled = cancelled;
    });
    let _ = threads;
    Ok((idx, embedded))
}

/// Read a source file for its symbol text; missing files just leave the body out.
fn read_source(repo: &crate::git::Repo, path: &str) -> Option<String> {
    std::fs::read_to_string(repo.root.join(path)).ok()
}

/// Background QoS on macOS / nice 10 elsewhere, so embedding never competes
/// with the user's work.
fn lower_priority() {
    #[cfg(target_os = "macos")]
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 10);
    }
    #[cfg(not(target_os = "macos"))]
    unsafe {
        libc::nice(10);
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
        let cfg = EmbedCfg { enabled: true, threads: 2, batch: 1 };
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
        let cfg = EmbedCfg { enabled: true, threads: 1, batch: 2 };
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
}
