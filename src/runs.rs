//! H.6: reading runs back from the ledger. A deterministic synopsis, a
//! changelog of kept work grouped by domain and flow, and trends per seat,
//! agent and team. Everything here reads `launch::Run`, never the event log,
//! so a run stays readable after `.kula/events.jsonl` rotates.

use crate::graph::FlowMap;
use crate::launch::{Run, Usage};
use serde::Serialize;
use std::collections::BTreeMap;

/// What the list shows for a run, without its paths.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Summary {
    pub id: String,
    pub plan: String,
    pub team: String,
    pub goal: String,
    pub trigger: String,
    pub started: u64,
    pub ended: u64,
    pub state: String,
    pub score: f64,
    pub usage: Usage,
    pub seats: usize,
    pub passed: usize,
    pub refusals: u32,
    pub files: usize,
}

pub fn summary(r: &Run) -> Summary {
    Summary {
        id: r.id.clone(),
        plan: r.plan.clone(),
        team: r.team.clone(),
        goal: r.goal.clone(),
        trigger: r.trigger.clone(),
        started: r.started,
        ended: r.ended,
        state: r.state.clone(),
        score: r.score,
        usage: r.usage.clone(),
        seats: r.seats.len(),
        passed: r.seats.iter().filter(|s| s.verdict == "passed").count(),
        refusals: r.seats.iter().map(|s| s.refusals).sum(),
        files: r.seats.iter().map(|s| s.files).sum(),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Synopsis {
    pub headline: String,
    pub lines: Vec<String>,
}

/// `1h 4m`, `3m 12s`, `840ms`.
pub fn span(ms: u64) -> String {
    let s = ms / 1000;
    match s {
        0 => format!("{ms}ms"),
        1..=59 => format!("{s}s"),
        60..=3599 => format!("{}m {}s", s / 60, s % 60),
        _ => format!("{}h {}m", s / 3600, s % 3600 / 60),
    }
}

fn plural(n: impl Into<u64>, one: &str, many: &str) -> String {
    let n = n.into();
    format!("{n} {}", if n == 1 { one } else { many })
}

/// A synopsis written from the ledger alone: same run, same text.
pub fn synopsis(r: &Run) -> Synopsis {
    if let Some(x) = &r.research {
        return research_synopsis(r, x);
    }
    let s = summary(r);
    let mut head = format!("{} of {} seats passed, score {}", s.passed, s.seats, r.score);
    let tokens = r.usage.tokens_in + r.usage.tokens_out;
    if tokens > 0 {
        head.push_str(&format!(", {tokens} tokens"));
    }
    if r.usage.cost_usd > 0.0 {
        head.push_str(&format!(", ${:.2}", r.usage.cost_usd));
    }
    head.push_str(&format!(", {}", span(r.ended.saturating_sub(r.started))));
    let mut lines = vec![];
    if !r.goal.is_empty() {
        lines.push(format!("Goal: {}", r.goal));
    }
    for x in &r.seats {
        let who = if x.seat.is_empty() { format!("{} ({})", x.slice, x.agent) } else { format!("{} on {} ({})", x.seat, x.slice, x.agent) };
        let mut l = format!("{who} {}: {}, {} added, {} removed", x.verdict, plural(x.files as u64, "file", "files"), x.added, x.removed);
        if x.attempts > 1 {
            l.push_str(&format!(", {}", plural(x.attempts, "attempt", "attempts")));
        }
        if x.refusals > 0 {
            l.push_str(&format!(", {} by fences", plural(x.refusals, "refusal", "refusals")));
        }
        if x.tests == Some(false) {
            l.push_str(", tests failed");
        }
        lines.push(l);
    }
    for h in &r.handoffs {
        lines.push(format!("{} handed off to {}", h.from, h.to));
    }
    let hot: Vec<&str> = r.seats.iter().filter(|x| x.refusals > 0).map(|x| x.slice.as_str()).collect();
    if !hot.is_empty() {
        lines.push(format!("Fences held on {}", hot.join(", ")));
    }
    Synopsis { headline: head, lines }
}

/// An autoresearch run told by its metric: what each experiment did to it.
fn research_synopsis(r: &Run, x: &crate::launch::ResearchLine) -> Synopsis {
    use crate::research::fmt;
    let kept = x.points.iter().filter(|p| p.verdict == "kept").count();
    let mut head = format!(
        "{} of {} kept, {} from {} to {}",
        kept,
        plural(x.points.len() as u64, "experiment", "experiments"),
        x.workflow,
        fmt(x.baseline),
        fmt(x.best)
    );
    if x.gain != 0.0 {
        head.push_str(&format!(" ({:.1}% {})", x.gain.abs() * 100.0, if x.gain > 0.0 { "better" } else { "worse" }));
    }
    head.push_str(&format!(", {}", span(r.ended.saturating_sub(r.started))));
    let mut lines = vec![format!("Metric: {} ({} is better)", x.metric, if x.goal == "max" { "higher" } else { "lower" })];
    if x.budget > 0 {
        lines.push(format!("Budget: {} of {} used", x.points.len(), plural(x.budget, "experiment", "experiments")));
    }
    for (p, s) in x.points.iter().zip(&r.seats) {
        let v = p.value.map(fmt).unwrap_or_else(|| "no value".into());
        let mut l = format!("{} {} ({}): {}, {}", s.slice, p.verdict, s.agent, v, s.note);
        if s.verdict == "passed" {
            l.push_str(&format!(", {} added, {} removed", s.added, s.removed));
        }
        lines.push(l);
    }
    let hot: Vec<&str> = r.seats.iter().filter(|s| s.refusals > 0).map(|s| s.slice.as_str()).collect();
    if !hot.is_empty() {
        lines.push(format!("Fences held on {}", hot.join(", ")));
    }
    if r.state == "running" {
        lines.push(format!("Still running on {}", x.branch));
    }
    Synopsis { headline: head, lines }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FlowRef {
    pub id: String,
    pub label: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Touch {
    pub path: String,
    pub run: String,
    pub slice: String,
    pub seat: String,
    pub commit: String,
    pub ended: u64,
}

/// Kept changes in one domain, with the flows they cross.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Section {
    /// `None` for files outside every domain.
    pub domain: Option<i64>,
    pub label: String,
    pub flows: Vec<FlowRef>,
    pub changes: Vec<Touch>,
}

/// Work kept by runs that ended at or after `since`, grouped by domain.
/// Only passing seats count: rejected work never landed.
pub fn changelog(runs: &[Run], map: Option<&FlowMap>, since: u64) -> Vec<Section> {
    let mut domain_of: BTreeMap<&str, i64> = BTreeMap::new();
    let mut labels: BTreeMap<i64, &str> = BTreeMap::new();
    if let Some(m) = map {
        for d in &m.domains {
            labels.insert(d.id, d.label.as_str());
            for f in &d.files {
                domain_of.entry(f.as_str()).or_insert(d.id);
            }
        }
    }
    let mut by: BTreeMap<Option<i64>, Vec<Touch>> = BTreeMap::new();
    for r in runs.iter().filter(|r| r.ended >= since) {
        for x in r.seats.iter().filter(|x| x.verdict == "passed") {
            for p in &x.paths {
                let t = Touch {
                    path: p.clone(),
                    run: r.id.clone(),
                    slice: x.slice.clone(),
                    seat: x.seat.clone(),
                    commit: x.commit.clone(),
                    ended: r.ended,
                };
                by.entry(domain_of.get(p.as_str()).copied()).or_default().push(t);
            }
        }
    }
    let mut out: Vec<Section> = by
        .into_iter()
        .map(|(d, mut changes)| {
            changes.sort_by(|a, b| b.ended.cmp(&a.ended).then(a.path.cmp(&b.path)));
            let flows = map
                .map(|m| {
                    m.flows
                        .iter()
                        .filter(|f| changes.iter().any(|c| f.files.contains(&c.path)))
                        .map(|f| FlowRef { id: f.id.clone(), label: f.route.clone().unwrap_or_else(|| f.entry.name.clone()) })
                        .collect()
                })
                .unwrap_or_default();
            let label = d.and_then(|d| labels.get(&d).map(|s| s.to_string())).unwrap_or_else(|| "Outside the map".into());
            Section { domain: d, label, flows, changes }
        })
        .collect();
    // Biggest sections first, unmapped files last.
    out.sort_by(|a, b| a.domain.is_none().cmp(&b.domain.is_none()).then(b.changes.len().cmp(&a.changes.len())));
    out
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Trend {
    /// `seat`, `agent` or `team`.
    pub kind: &'static str,
    pub key: String,
    pub runs: usize,
    /// Mean score.
    pub score: f64,
    /// Oldest first, the last 20.
    pub scores: Vec<f64>,
    pub tokens: u64,
    pub cost_usd: f64,
    /// Refusals per seat run.
    pub refusal_rate: f64,
    pub pass_rate: f64,
}

#[derive(Default)]
struct Acc {
    scores: Vec<f64>,
    tokens: u64,
    cost: f64,
    refusals: u32,
    passed: usize,
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Trends per seat (named seats only), per agent and per team.
pub fn trends(runs: &[Run]) -> Vec<Trend> {
    let mut acc: BTreeMap<(&'static str, String), Acc> = BTreeMap::new();
    let mut ordered: Vec<&Run> = runs.iter().collect();
    ordered.sort_by_key(|r| r.started);
    for r in ordered {
        for x in &r.seats {
            let seat = (!x.seat.is_empty()).then(|| ("seat", x.seat.clone()));
            let agent = (!x.agent.is_empty()).then(|| ("agent", x.agent.clone()));
            for key in seat.into_iter().chain(agent) {
                let a = acc.entry(key).or_default();
                a.scores.push(x.score);
                a.tokens += x.usage.tokens_in + x.usage.tokens_out;
                a.cost += x.usage.cost_usd;
                a.refusals += x.refusals;
                a.passed += usize::from(x.verdict == "passed");
            }
        }
        if !r.team.is_empty() {
            let a = acc.entry(("team", r.team.clone())).or_default();
            a.scores.push(r.score);
            a.tokens += r.usage.tokens_in + r.usage.tokens_out;
            a.cost += r.usage.cost_usd;
            a.refusals += r.seats.iter().map(|x| x.refusals).sum::<u32>();
            a.passed += usize::from(r.state == "passed");
        }
    }
    let mut out: Vec<Trend> = acc
        .into_iter()
        .map(|((kind, key), a)| {
            let n = a.scores.len().max(1) as f64;
            Trend {
                kind,
                key,
                runs: a.scores.len(),
                score: round1(a.scores.iter().sum::<f64>() / n),
                scores: a.scores[a.scores.len().saturating_sub(20)..].to_vec(),
                tokens: a.tokens,
                cost_usd: a.cost,
                refusal_rate: (a.refusals as f64 / n * 100.0).round() / 100.0,
                pass_rate: (a.passed as f64 / n * 100.0).round() / 100.0,
            }
        })
        .collect();
    out.sort_by(|a, b| b.runs.cmp(&a.runs).then(a.key.cmp(&b.key)));
    out
}

/// A run still going: it has events but no `run_end` and no ledger yet.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Current {
    pub id: String,
    pub plan: String,
    pub team: String,
    pub started: u64,
    pub last: u64,
    /// Slices seen, and those whose last verdict was passed.
    pub slices: usize,
    pub passed: usize,
    pub attempts: u32,
    pub usage: Usage,
}

/// How long a run may sit silent before it counts as dead rather than live.
pub const STALE_MS: u64 = 60 * 60 * 1000;

/// Runs in the event log that have not ended, newest first. `done` holds the
/// ids already in the ledger; a run silent for `STALE_MS` before `now` is dropped.
pub fn current(events: &[crate::events::Event], done: &[String], now: u64) -> Vec<Current> {
    let mut by: BTreeMap<String, (Current, BTreeMap<String, String>, bool)> = BTreeMap::new();
    for e in events.iter().filter(|e| !e.run.is_empty()) {
        let (c, slices, ended) = by.entry(e.run.clone()).or_insert_with(|| {
            (
                Current {
                    id: e.run.clone(),
                    plan: e.plan.clone(),
                    team: e.team.clone(),
                    started: e.ts,
                    last: e.ts,
                    slices: 0,
                    passed: 0,
                    attempts: 0,
                    usage: Usage::default(),
                },
                BTreeMap::new(),
                false,
            )
        });
        c.last = c.last.max(e.ts);
        if c.team.is_empty() {
            c.team = e.team.clone();
        }
        match e.kind.as_str() {
            "run_end" => *ended = true,
            "attempt" => {
                c.attempts += 1;
                if let Some(u) = &e.usage {
                    c.usage.add(u);
                }
            }
            _ => {}
        }
        if !e.slice.is_empty() {
            let v = slices.entry(e.slice.clone()).or_default();
            if matches!(e.kind.as_str(), "slice" | "verdict") && !e.verdict.is_empty() {
                *v = e.verdict.clone();
            }
        }
    }
    let mut out: Vec<Current> = by
        .into_values()
        .filter(|(c, _, ended)| !ended && !done.contains(&c.id) && now.saturating_sub(c.last) < STALE_MS)
        .map(|(mut c, slices, _)| {
            c.slices = slices.len();
            c.passed = slices.values().filter(|v| *v == "passed").count();
            c
        })
        .collect();
    out.sort_by_key(|r| std::cmp::Reverse(r.started));
    out
}

/// Ledger runs still going (research until it stops), as current cards.
pub fn running(runs: &[Run]) -> Vec<Current> {
    runs.iter()
        .filter(|r| r.state == "running")
        .map(|r| Current {
            id: r.id.clone(),
            plan: r.plan.clone(),
            team: r.team.clone(),
            started: r.started,
            last: r.ended.max(r.started),
            slices: r.seats.len(),
            passed: r.seats.iter().filter(|s| s.verdict == "passed").count(),
            attempts: r.seats.iter().map(|s| s.attempts).sum(),
            usage: r.usage.clone(),
        })
        .collect()
}

/// T7: the usage detail of one run (or one seat of it), read from the run's
/// usage ledger at `.kula/runs/<run>.usage.jsonl`. Dedupe happens here, at
/// read time: the ledger is append only, so a reader collapses duplicates.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct UsageDetail {
    /// The seat asked for, empty for the whole run.
    pub seat: String,
    /// Day × model buckets with the four token classes.
    pub buckets: Vec<crate::usage::Bucket>,
    /// Dollars spent, summed over the buckets.
    pub spent: f64,
    /// Totals: cache hit rate, burn rate, ETA, estimated messages.
    pub metrics: crate::usage::Metrics,
}

pub fn usage_detail(kula_dir: &std::path::Path, run: &str, seat: &str) -> UsageDetail {
    let mut acc = crate::usage::Accumulator::new(seat, run, 0.0);
    for r in crate::usage::ledger_read(kula_dir, run) {
        if !seat.is_empty() && r.seat != seat {
            continue;
        }
        acc.add(&r);
    }
    let m = acc.metrics();
    UsageDetail { seat: seat.into(), buckets: acc.buckets.clone(), spent: m.cost_usd, metrics: m }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::launch::{Handoff, SeatRun};

    fn seat(slice: &str, seat: &str, verdict: &str, paths: &[&str], score: f64, refusals: u32) -> SeatRun {
        SeatRun {
            slice: slice.into(),
            seat: seat.into(),
            agent: "claude".into(),
            verdict: verdict.into(),
            files: paths.len(),
            added: 3,
            removed: 1,
            attempts: 1,
            refusals,
            score,
            paths: paths.iter().map(|p| p.to_string()).collect(),
            commit: if verdict == "passed" { "abc".into() } else { String::new() },
            usage: Usage { tokens_in: 100, tokens_out: 50, cost_usd: 0.02, ..Default::default() },
            ..Default::default()
        }
    }

    fn run(id: &str, started: u64, team: &str, seats: Vec<SeatRun>) -> Run {
        let score = seats.iter().map(|s| s.score).sum::<f64>() / seats.len() as f64;
        Run {
            id: id.into(),
            plan: "p".into(),
            team: team.into(),
            goal: "ship it".into(),
            trigger: "manual".into(),
            started,
            ended: started + 65_000,
            state: "partial".into(),
            usage: Usage { tokens_in: 200, tokens_out: 100, cost_usd: 0.04, ..Default::default() },
            score,
            seats,
            handoffs: vec![Handoff { from: "a".into(), to: "b".into() }],
            ..Default::default()
        }
    }

    #[test]
    fn synopsis_is_written_from_the_ledger() {
        let r = run(
            "p-1",
            0,
            "ship",
            vec![seat("a", "ship/lead", "passed", &["src/a.rs"], 90.0, 0), seat("b", "", "rejected", &["src/b.rs", "x"], 30.0, 2)],
        );
        let s = synopsis(&r);
        assert_eq!(s.headline, "1 of 2 seats passed, score 60, 300 tokens, $0.04, 1m 5s");
        assert!(s.lines.contains(&"ship/lead on a (claude) passed: 1 file, 3 added, 1 removed".to_string()), "{:?}", s.lines);
        assert!(
            s.lines.iter().any(|l| l.starts_with("b (claude) rejected: 2 files") && l.ends_with("2 refusals by fences")),
            "{:?}",
            s.lines
        );
        assert!(s.lines.contains(&"a handed off to b".to_string()));
        assert!(s.lines.contains(&"Fences held on b".to_string()));
        assert_eq!(synopsis(&r), s);
    }

    #[test]
    fn changelog_keeps_passed_work_since_a_time() {
        let runs = vec![
            run("old", 0, "", vec![seat("a", "", "passed", &["src/old.rs"], 90.0, 0)]),
            run(
                "new",
                100_000,
                "",
                vec![seat("a", "", "passed", &["src/a.rs", "README.md"], 90.0, 0), seat("b", "", "rejected", &["src/b.rs"], 20.0, 0)],
            ),
        ];
        let c = changelog(&runs, None, 100_000);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].label, "Outside the map");
        let paths: Vec<&str> = c[0].changes.iter().map(|t| t.path.as_str()).collect();
        assert_eq!(paths, ["README.md", "src/a.rs"]);
        assert!(c[0].changes.iter().all(|t| t.run == "new" && t.commit == "abc"));
    }

    #[test]
    fn trends_follow_seats_agents_and_teams() {
        let runs = vec![
            run("2", 2, "ship", vec![seat("a", "ship/lead", "passed", &[], 80.0, 0)]),
            run("1", 1, "ship", vec![seat("a", "ship/lead", "rejected", &[], 40.0, 2), seat("b", "", "passed", &[], 90.0, 0)]),
        ];
        let t = trends(&runs);
        let lead = t.iter().find(|t| t.key == "ship/lead").unwrap();
        assert_eq!((lead.kind, lead.runs, lead.score, lead.refusal_rate, lead.pass_rate), ("seat", 2, 60.0, 1.0, 0.5));
        assert_eq!(lead.scores, [40.0, 80.0]);
        assert_eq!(t.iter().find(|t| t.key == "claude").unwrap().kind, "agent");
        assert_eq!(t.iter().find(|t| t.kind == "team").unwrap().runs, 2);
    }

    #[test]
    fn spans_read_well() {
        assert_eq!(
            (span(840), span(5_000), span(192_000), span(3_840_000)),
            ("840ms".into(), "5s".into(), "3m 12s".into(), "1h 4m".into())
        );
    }
    #[test]
    fn a_run_is_current_until_it_ends_or_goes_quiet() {
        use crate::events::Event;
        let ev = |kind: &str, run: &str, slice: &str, verdict: &str, ts: u64| Event {
            kind: kind.into(),
            run: run.into(),
            plan: "p".into(),
            team: "ship".into(),
            slice: slice.into(),
            verdict: verdict.into(),
            ts,
            usage: (kind == "attempt").then(|| Usage { tokens_in: 10, ..Default::default() }),
            ..Default::default()
        };
        let events = vec![
            ev("slice", "p-1", "a", "running", 100),
            ev("attempt", "p-1", "a", "", 200),
            ev("slice", "p-1", "a", "passed", 300),
            ev("slice", "p-1", "b", "running", 400),
            ev("slice", "p-2", "a", "running", 100),
            ev("run_end", "p-2", "", "passed", 500),
            ev("slice", "p-3", "a", "running", 50),
            ev("slice", "p-old", "a", "running", 1),
        ];
        let c = current(&events, &["p-3".to_string()], 400 + STALE_MS - 1);
        assert_eq!(c.len(), 1, "{c:?}");
        assert_eq!(
            (c[0].id.as_str(), c[0].slices, c[0].passed, c[0].attempts, c[0].usage.tokens_in, c[0].started, c[0].last),
            ("p-1", 2, 1, 1, 10, 100, 400)
        );
    }
}
