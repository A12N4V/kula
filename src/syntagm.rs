//! Compat shim – the engine now lives in `src/map.rs`. Every name is
//! re-exported unchanged so `embed.rs`, `map_run.rs` and the legacy CLI/API
//! call sites (which read `crate::syntagm`) keep compiling untouched.

pub use crate::map::*;
