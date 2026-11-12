//! K4 orchestration: plan a goal into module slices, run each slice's agent in
//! its own worktree under fences, gate the result, retry on `fix`.
//! See docs/design/orchestration.md.

pub mod blast;
pub mod gate;
pub mod plan;
pub mod retry;
pub mod run;
pub mod task;
pub mod wire;
