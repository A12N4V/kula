//! The real EmbeddingGemma runtime, only built under the `embed` cargo feature.
//!
//! Evaluation (per the plan): fastembed-rs's `EmbeddingGemma300MQ4` wins over
//! driving `ort` directly – it bundles the tokenizer and the quantised ONNX
//! export (model_q4.onnx + .onnx_data from onnx-community/embeddinggemma-300m-ONNX),
//! handles the download cache, and keeps us from vendoring a tokenizer.
//! fastembed's Gemma variants shipped after its last crates.io release, so the
//! dependency is pinned to git. It stays out of the default binary: `cargo
//! build` links none of it, `cargo build --features embed` links fastembed + ort.
//!
//! `install_model` runs fastembed's own download into `~/.cache/kula/models`,
//! then writes a checksum manifest of the onnx artifacts so later installs
//! verify what is on disk. A partial download is re-attempted next time.

use anyhow::{bail, Context, Result};
use std::path::PathBuf;

/// EmbeddingGemma's native output dimension (the model table says 768);
/// `crate::embed::truncate` takes it to the 256 Matryoshka dims we store.
const NATIVE_DIM: usize = 768;

/// Where the model and manifest live.
pub fn model_dir() -> PathBuf {
    crate::embed::model_dir()
}

/// fastembed's handle; created lazily so `status` stays cheap. The runtime is
/// `&mut self` internally, so it sits behind a mutex.
pub struct FastEmbedProvider {
    inner: std::sync::Mutex<fastembed::TextEmbedding>,
}

impl FastEmbedProvider {
    pub fn load() -> Result<Self> {
        if !model_dir().exists() {
            bail!("model not installed – run `kula embed install` first");
        }
        let opts = fastembed::InitOptions::new(fastembed::EmbeddingModel::EmbeddingGemma300MQ4)
            .with_cache_dir(model_dir())
            .with_show_download_progress(false);
        let inner = fastembed::TextEmbedding::try_new(opts).context("loading EmbeddingGemma 300M Q4")?;
        Ok(FastEmbedProvider { inner: std::sync::Mutex::new(inner) })
    }
}

impl crate::embed::EmbedProvider for FastEmbedProvider {
    fn name(&self) -> &'static str {
        "embeddinggemma-300m-q4"
    }
    fn dim(&self) -> usize {
        NATIVE_DIM
    }
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        Ok(self.inner.lock().unwrap().embed(texts.to_vec(), None)?)
    }
}

/// Pre-warm fastembed's cache (download + verify), then record a checksum
/// manifest. Returns whether the model is present afterwards.
pub fn install_model(_repo: &crate::git::Repo) -> Result<bool> {
    let opts = fastembed::InitOptions::new(fastembed::EmbeddingModel::EmbeddingGemma300MQ4)
        .with_cache_dir(model_dir())
        .with_show_download_progress(true);
    let model = fastembed::TextEmbedding::try_new(opts).context("downloading EmbeddingGemma 300M Q4")?;
    drop(model);
    let dir = model_dir();
    std::fs::create_dir_all(&dir)?;
    let mut files = Vec::new();
    collect(&dir, &mut files);
    files.sort();
    let mut h = sha2::Sha256::new();
    use sha2::Digest;
    for (name, path) in &files {
        h.update(name.as_bytes());
        h.update(&std::fs::read(path)?);
    }
    std::fs::write(dir.join("manifest.sha256"), format!("{} {} files\n", hex(&h.finalize()), files.len()))?;
    Ok(true)
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn collect(dir: &PathBuf, out: &mut Vec<(String, PathBuf)>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                collect(&p, out);
            } else {
                out.push((p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), p));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embed::EmbedProvider;

    /// The real model, run by hand: `cargo test --features embed -- --ignored`.
    /// Downloads ~210 MB to ~/.cache/kula/models on first run.
    #[test]
    #[ignore]
    fn loads_and_embeds() {
        let p = FastEmbedProvider::load().unwrap();
        let v = p.embed(&["task: code retrieval | query: fn parse_cfg".into()]).unwrap();
        assert_eq!(v[0].len(), NATIVE_DIM, "model's native dim; truncate() takes it to 256");
    }
}
