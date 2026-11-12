//! Library surface: the parts of kula that integration tests and embedders use
//! directly. The binary re-exports `git` and `store` from here so there is one
//! `Store` type across the crate.

pub mod git;
pub mod map;
pub mod store;
