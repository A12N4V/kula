//! Attempts for one slice: launch, gate, and on `fix` hand the reasons back, at
//! most `max_retries` times. `reject` stops at once. Every attempt is written to
//! `.kula/runs/<plan>/<slice>/attempt-N.md`.

use super::gate::{self, tail, Outcome};
use super::task::{Plan, Slice, SliceState};
use anyhow::Result;
use std::path::Path;

/// Where a slice ended up.
#[derive(Debug, Clone)]
pub struct SliceEnd {
    pub state: SliceState,
    pub attempts: u32,
    pub escalate: bool,
    pub reasons: Vec<String>,
}

/// `kula run` exits 3 when it had to put fenced files back.
pub const FENCE_BREACH: i32 = 3;

/// The prompt for one attempt; retries carry the last gate's reasons.
pub fn prompt(plan: &Plan, s: &Slice, attempt: u32, reasons: &[String]) -> String {
    let mut p = format!("Goal: {}\n\nYou own slice `{}` (module {}). Change only: {}.\n", plan.goal, s.id, s.module, s.scope.join(", "));
    if !s.tests.is_empty() {
        p.push_str(&format!("Tests for it, which you may also change: {}.\n", s.tests.join(", ")));
    }
    p.push_str("Do not commit; kula gates and commits the slice.\n");
    if attempt > 1 && !reasons.is_empty() {
        p.push_str(&format!("\nAttempt {attempt}. The gate sent the last attempt back:\n"));
        for r in reasons {
            p.push_str(&format!("- {r}\n"));
        }
    }
    p
}

#[allow(clippy::too_many_arguments)]
fn record(dir: &Path, n: u32, prompt: &str, code: i32, output: &str, verdict: &str, reasons: &[String], notes: &[String]) {
    let _ = std::fs::create_dir_all(dir);
    let mut md = format!(
        "# attempt {n}\n\n## prompt\n\n{prompt}\n## agent\n\nexit {code}\n\n```\n{}\n```\n\n## verdict: {verdict}\n\n",
        tail(output, 40)
    );
    for r in reasons {
        md.push_str(&format!("- {r}\n"));
    }
    for r in notes {
        md.push_str(&format!("- note: {r}\n"));
    }
    let _ = std::fs::write(dir.join(format!("attempt-{n}.md")), md);
}

/// Runs a slice to its end state. `launch(attempt, prompt)` runs the agent and
/// returns its exit code and output; `on_state` hears every transition.
pub fn drive(
    plan: &Plan,
    slice: &Slice,
    tree: &Path,
    log_dir: &Path,
    mut launch: impl FnMut(u32, &str) -> (i32, String),
    mut on_state: impl FnMut(SliceState, u32, &[String]),
) -> Result<SliceEnd> {
    let last = 1 + plan.max_retries;
    let mut reasons: Vec<String> = Vec::new();
    for n in 1..=last {
        on_state(SliceState::Running, n, &reasons);
        let p = prompt(plan, slice, n, &reasons);
        let (code, out) = launch(n, &p);
        on_state(SliceState::Gating, n, &reasons);
        let v = gate::gate(plan, slice, tree)?;
        let (mut outcome, mut why, notes) = (v.verdict, v.reasons, v.notes);
        if code == FENCE_BREACH {
            outcome = Outcome::Reject;
            why.insert(0, "the agent changed fenced files; kula put them back".into());
        } else if code != 0 && outcome == Outcome::Pass {
            outcome = Outcome::Fix;
            why.push(format!("the agent exited with code {code}"));
        }
        record(log_dir, n, &p, code, &out, outcome.as_str(), &why, &notes);
        match outcome {
            Outcome::Pass => return Ok(SliceEnd { state: SliceState::Passed, attempts: n, escalate: false, reasons: vec![] }),
            Outcome::Reject => return Ok(SliceEnd { state: SliceState::Rejected, attempts: n, escalate: false, reasons: why }),
            Outcome::Fix if n == last => return Ok(SliceEnd { state: SliceState::Failed, attempts: n, escalate: true, reasons: why }),
            Outcome::Fix => reasons = why,
        }
    }
    unreachable!("the loop returns on its last attempt")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_prompt_carries_reasons() {
        let plan = Plan { goal: "g".into(), ..Default::default() };
        let s = Slice { id: "net".into(), module: "net".into(), scope: vec!["core/src/net".into()], ..Default::default() };
        assert!(!prompt(&plan, &s, 1, &["x".into()]).contains("Attempt"));
        let p = prompt(&plan, &s, 2, &["tests failed".into()]);
        assert!(p.contains("Attempt 2") && p.contains("- tests failed"));
    }
}
