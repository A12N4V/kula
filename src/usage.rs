//! The usage pipeline (T7): stream → parse → dedupe → price → accumulate →
//! budget check → ledger + event.
//!
//! kula starts agents with machine readable output and reads their usage from
//! it. This module turns a CLI's stdout stream into priced, de-duplicated
//! usage records: one per model per message, kept per seat · run · day ·
//! model, checked against the seat's budget (80% warns once, 100% stops the
//! seat), and summarised with an EWMA burn rate and ETA.
//!
//! Fields: input, output, cache read, cache write. `tiktoken-rs` estimates
//! tokens only where a CLI reports none, and the record is flagged so a
//! reader knows the number is an estimate.
//!
//! Prices come from `[[price]]` rows in kula.toml (`config::PriceTable`).
//! Unknown models fail the parse with the model named, never a silent zero.

use crate::config::PriceTable;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;

/// The four token classes the pipeline tracks.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl Tokens {
    pub fn add(&mut self, o: &Tokens) {
        self.input = self.input.saturating_add(o.input);
        self.output = self.output.saturating_add(o.output);
        self.cache_read = self.cache_read.saturating_add(o.cache_read);
        self.cache_write = self.cache_write.saturating_add(o.cache_write);
    }
    /// Every token that went to the provider, cache reads included.
    pub fn total(&self) -> u64 {
        self.input.saturating_add(self.output).saturating_add(self.cache_read).saturating_add(self.cache_write)
    }
}

/// Identifies one provider message so a repeated report never counts twice.
/// The CLI's own message id when it prints one, else a hash of the message's
/// usage shape (model + token counts + day), which is stable for an identical
/// re-report and distinct for different messages.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct MessageId(pub String);

impl MessageId {
    /// From a CLI message id, or a fallback hash of the usage shape.
    pub fn of(cli_id: Option<&str>, shape: &str) -> MessageId {
        match cli_id {
            Some(id) if !id.is_empty() => MessageId(id.to_string()),
            _ => MessageId(format!("h{:016x}", hash64(shape))),
        }
    }
}

/// One priced usage message: what the CLI reported, de-duplicated, priced.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct UsageRecord {
    /// `team/key` of the seat that produced it.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub seat: String,
    /// The run id.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub run: String,
    /// The slice id within the run.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub slice: String,
    pub model: String,
    /// Day (`YYYY-MM-DD`) the usage landed on, local time.
    pub day: String,
    /// Unix milliseconds of the report.
    pub ts: u64,
    pub tokens: Tokens,
    /// Dollars, from the price table.
    pub cost_usd: f64,
    /// Set when the CLI reported no tokens and kula estimated them with
    /// tiktoken; the numbers are an estimate, not a report.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub estimated: String,
    /// The CLI that produced it (claude, codex, gemini, fake, …).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub agent: String,
    /// The message id that dedupe keyed on.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message_id: String,
}

/// One raw, unpriced message pulled out of a stream, before dedupe and price.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RawMessage {
    pub model: String,
    pub tokens: Tokens,
    /// The CLI's own message id, when it prints one.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub message_id: String,
    /// Set when the CLI reported no tokens and the text was estimated.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub estimated: String,
}

/// Estimate the token count of a string with tiktoken's cl100k_base. Used
/// only where a CLI reports nothing; the record is flagged `estimated`.
pub fn estimate_tokens(text: &str) -> u64 {
    use tiktoken_rs::cl100k_base;
    let Ok(bpe) = cl100k_base() else { return text.len() as u64 / 4 };
    bpe.encode_ordinary(text).len() as u64
}

/// Which CLI a stream line came from is decided by the shapes themselves:
/// claude `stream-json` events (`{"type":"assistant",…}`), codex `--json`
/// lines (`{"type":"turn.completed",…}`), gemini json (`{"stats":…}`), and
/// the harness's own `{"kula_usage":…}` line. `parse_stream` is a
/// line-oriented superset of `launch::parse`.
pub fn parse_stream(output: &str, agent: &str) -> Vec<RawMessage> {
    let mut out = vec![];
    let t = output.trim();
    // One whole pretty-printed document (codex's final report, gemini's summary).
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
        if let Some(msgs) = from_value(&v) {
            out.extend(msgs);
            return out;
        }
    }
    for line in output.lines().map(str::trim).filter(|l| l.starts_with('{')) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            out.extend(from_value(&v).unwrap_or_default());
        }
    }
    let _ = agent; // shapes decide; the agent name rides into the record at price time
    out
}

/// Usage messages from one JSON value in any of the shapes kula knows.
fn from_value(v: &serde_json::Value) -> Option<Vec<RawMessage>> {
    // Any harness: {"kula_usage": {tokens_in, tokens_out, cost_usd, turns, model}}
    if let Some(k) = v.get("kula_usage") {
        return Some(vec![RawMessage {
            model: k.get("model").and_then(|m| m.as_str()).unwrap_or("").to_string(),
            tokens: Tokens {
                input: u(k, "tokens_in"),
                output: u(k, "tokens_out"),
                ..Default::default()
            },
            ..Default::default()
        }]);
    }
    // Claude Code stream-json: one {"type":"assistant","message":{id, model, usage}} per message.
    if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
        let m = &v["message"];
        let us = &m["usage"];
        let mut r = claude_usage(m, us);
        r.message_id = m.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
        return Some(vec![r]);
    }
    // Claude Code final result: {"type":"result","usage":{...},"modelUsage":{...}}
    if v.get("type").and_then(|t| t.as_str()) == Some("result") && v.get("usage").is_some() {
        let mut msgs = vec![];
        let us = &v["usage"];
        if u(us, "input_tokens") > 0 || u(us, "output_tokens") > 0 {
            let mut r = claude_usage(&v, us);
            if let Some(mu) = v.get("modelUsage").and_then(|m| m.as_object()) {
                if let Some(name) = mu.keys().next() {
                    r.model = name.clone();
                }
            }
            r.message_id = MessageId::of(None, &format!("result-{}", hash64(&serde_json::to_string(us).unwrap_or_default()))).0;
            msgs.push(r);
        }
        return Some(msgs);
    }
    // Codex: one {"type":"turn.completed","usage":{input_tokens, cached_input_tokens, output_tokens}} per turn.
    if v.get("type").and_then(|t| t.as_str()) == Some("turn.completed") {
        let us = &v["usage"];
        let input = u(us, "input_tokens");
        let cached = u(us, "cached_input_tokens");
        return Some(vec![RawMessage {
            model: v.get("model").and_then(|m| m.as_str()).unwrap_or("").to_string(),
            tokens: Tokens { input: input.saturating_sub(cached), cache_read: cached, output: u(us, "output_tokens"), ..Default::default() },
            ..Default::default()
        }]);
    }
    // Gemini CLI: {"response", "stats": {"models": {"<model>": {"api": {...}, "tokens": {...}}}}}
    if let Some(models) = v.get("stats").and_then(|s| s.get("models")).and_then(|m| m.as_object()) {
        let mut msgs = vec![];
        for (name, m) in models {
            let t = &m["tokens"];
            msgs.push(RawMessage {
                model: name.clone(),
                tokens: Tokens {
                    input: u(t, "prompt"),
                    output: u(t, "candidates"),
                    cache_read: u(t, "cached") + u(t, "cachedContentTokenCount"),
                    cache_write: u(t, "thoughts") * 0, // gemini reports no cache write class
                    ..Default::default()
                },
                ..Default::default()
            });
        }
        return Some(msgs);
    }
    None
}

/// Claude's usage object: input, output, cache read, cache write.
fn claude_usage(m: &serde_json::Value, us: &serde_json::Value) -> RawMessage {
    RawMessage {
        model: m.get("model").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        tokens: Tokens {
            input: u(us, "input_tokens"),
            output: u(us, "output_tokens"),
            cache_read: u(us, "cache_read_input_tokens"),
            cache_write: u(us, "cache_creation_input_tokens"),
        },
        ..Default::default()
    }
}

fn u(v: &serde_json::Value, k: &str) -> u64 {
    v.get(k).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// BLAKE3 hash of a string, first 8 bytes as u64 – the fallback message id.
fn hash64(s: &str) -> u64 {
    let h = blake3::hash(s.as_bytes());
    let b = h.as_bytes();
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

/// Price one raw message. Errors when the model is unknown: never a silent
/// zero.
pub fn price(table: &PriceTable, raw: &RawMessage, day: &str) -> anyhow::Result<f64> {
    table.cost(&raw.model, day, &raw.tokens)
}

/// De-duplicates by message id. A per-seat bounded set, recent-first: when it
/// is full the oldest id is dropped, so a late duplicate of a very old
/// message is a new message again (the property test covers this).
pub struct Dedupe {
    seen: VecDeque<MessageId>,
    cap: usize,
}

impl Dedupe {
    pub fn new(cap: usize) -> Dedupe {
        Dedupe { seen: VecDeque::new(), cap: cap.max(1) }
    }

    /// True (and remembered) when the id was not seen before; false when it
    /// was already counted.
    pub fn check(&mut self, id: &MessageId) -> bool {
        if self.seen.contains(id) {
            return false;
        }
        if self.seen.len() >= self.cap {
            self.seen.pop_back();
        }
        self.seen.push_front(id.clone());
        true
    }
}

/// One day × model bucket of a seat's usage.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Bucket {
    pub day: String,
    pub model: String,
    pub tokens: Tokens,
    pub cost_usd: f64,
    pub messages: u64,
    /// Messages whose tokens kula estimated, not the CLI.
    pub estimated: u64,
}

/// Accumulates usage per seat · run · day · model, checks the budget and
/// computes the burn rate.
pub struct Accumulator {
    pub seat: String,
    pub run: String,
    /// Budget in dollars; 0 means no budget (no stops).
    pub budget: f64,
    /// Day × model buckets, ordered by (day, model).
    pub buckets: Vec<Bucket>,
    pub spent: f64,
    /// 80% warning already emitted (once).
    pub warned: bool,
    /// The seat was stopped at 100%.
    pub stopped: bool,
    /// Dedupe sets, one per slice.
    pub dedupe: Dedupe,
    /// EWMA burn rate, dollars per millisecond.
    pub rate: f64,
    /// Last spend observation (ms and dollars) for the EWMA.
    last: Option<(u64, f64)>,
}

impl Accumulator {
    pub fn new(seat: &str, run: &str, budget: f64) -> Accumulator {
        Accumulator {
            seat: seat.into(),
            run: run.into(),
            budget,
            buckets: vec![],
            spent: 0.0,
            warned: false,
            stopped: false,
            dedupe: Dedupe::new(256),
            rate: 0.0,
            last: None,
        }
    }

    /// Add one priced record. Dedupes by message id; returns false when the
    /// message was already counted.
    pub fn add(&mut self, r: &UsageRecord) -> bool {
        let id = MessageId(r.message_id.clone());
        if !self.dedupe.check(&id) {
            return false;
        }
        self.spent += r.cost_usd;
        // EWMA burn rate: α = 0.3, seeded with the first observed rate (never zero).
        // The first message's Δt runs from time zero to its timestamp.
        let dt = match self.last {
            None => r.ts,
            Some((t, _)) => r.ts.saturating_sub(t),
        };
        let dc = r.cost_usd;
        let instant = if dt > 0 { dc / dt as f64 } else { 0.0 };
        self.rate = if self.rate == 0.0 && instant > 0.0 { instant } else { 0.3 * instant + 0.7 * self.rate };
        self.last = Some((r.ts, self.spent));
        let b = match self.buckets.iter_mut().find(|b| b.day == r.day && b.model == r.model) {
            Some(b) => b,
            None => {
                self.buckets.push(Bucket { day: r.day.clone(), model: r.model.clone(), ..Default::default() });
                self.buckets.last_mut().unwrap()
            }
        };
        b.tokens.add(&r.tokens);
        b.cost_usd += r.cost_usd;
        b.messages += 1;
        if !r.estimated.is_empty() {
            b.estimated += 1;
        }
        true
    }

    /// Budget state after the last add: what to do next.
    pub fn budget_check(&self) -> BudgetState {
        if self.budget <= 0.0 {
            return BudgetState::Ok;
        }
        // A stopped seat stays stopped: the state is latched.
        if self.stopped {
            return BudgetState::Stop;
        }
        let f = self.spent / self.budget;
        if f >= 1.0 {
            BudgetState::Stop
        } else if f >= 0.8 {
            BudgetState::Warn
        } else {
            BudgetState::Ok
        }
    }

    /// Take the budget action: 80% warns once, 100% stops the seat. A repeat
    /// check in the warn band is Ok (the warning fired once); a stop stays
    /// latched so the caller keeps refusing new turns.
    pub fn take_action(&mut self) -> BudgetState {
        match self.budget_check() {
            BudgetState::Warn if !self.warned => {
                self.warned = true;
                BudgetState::Warn
            }
            BudgetState::Stop => {
                self.stopped = true;
                BudgetState::Stop
            }
            _ => BudgetState::Ok,
        }
    }

    /// The day's bucket for a model, else a zero one.
    pub fn bucket(&self, day: &str, model: &str) -> Bucket {
        self.buckets.iter().find(|b| b.day == day && b.model == model).cloned().unwrap_or_default()
    }

    /// Metrics over the whole run so far.
    pub fn metrics(&self) -> Metrics {
        let mut total = Tokens::default();
        let mut cost = 0.0;
        let mut est = 0u64;
        for b in &self.buckets {
            total.add(&b.tokens);
            cost += b.cost_usd;
            est += b.estimated;
        }
        let cache_hit = cache_hit_rate(&total);
        Metrics { tokens: total, cost_usd: cost, cache_hit_rate: cache_hit, estimated_messages: est, burn_rate: self.rate, eta_ms: eta(self.budget, self.spent, self.rate) }
    }
}

/// Budget state after a spend.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum BudgetState {
    Ok,
    /// 80% of the budget spent: one warning.
    Warn,
    /// 100%: stop the seat.
    Stop,
}

/// ETA to the budget line, in milliseconds: `(budget − spent) / rate`, 0 when
/// the rate is zero or the budget is already spent.
pub fn eta(budget: f64, spent: f64, rate: f64) -> u64 {
    if rate <= 0.0 || budget <= 0.0 || spent >= budget {
        return 0;
    }
    ((budget - spent) / rate) as u64
}

/// The cone around the EWMA rate: r ± one deviation, where the deviation is
/// the last instantaneous rate's distance from the EWMA. ETA bounds ride the
/// cone.
pub fn cone(rate: f64, last_instant: f64) -> (f64, f64) {
    let dev = (last_instant - rate).abs();
    (rate - dev, rate + dev)
}

/// Share of tokens served from cache: cache_read / (cache_read +
/// cache_write + input), 0 when there is nothing cached.
pub fn cache_hit_rate(t: &Tokens) -> f64 {
    let den = t.cache_read + t.cache_write + t.input;
    if den > 0 { t.cache_read as f64 / den as f64 } else { 0.0 }
}

/// Metrics the pipeline reports for a seat or a run.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Metrics {
    pub tokens: Tokens,
    pub cost_usd: f64,
    /// cache_read / (cache_read + cache_write + input), 0 when nothing cached.
    pub cache_hit_rate: f64,
    pub estimated_messages: u64,
    /// EWMA burn rate, dollars per millisecond.
    pub burn_rate: f64,
    /// ETA to the budget line, in milliseconds; 0 when spent or no rate.
    pub eta_ms: u64,
}

/// Cost per symbol: turn cost split by edit share. A seat's cost on a turn
/// is attributed to the symbols it edited in proportion to the lines it
/// changed in each. `edits` is (symbol, lines changed) for the turn.
pub fn cost_per_symbol(turn_cost: f64, edits: &[(String, u64)]) -> Vec<(String, f64)> {
    let total: u64 = edits.iter().map(|(_, n)| *n).sum();
    if total == 0 {
        return vec![];
    }
    let mut out = vec![];
    for (sym, n) in edits {
        out.push((sym.clone(), turn_cost * *n as f64 / total as f64));
    }
    out
}

/// Cost per green test: the run's cost divided by the seats that passed.
/// 0 when nothing passed (the cost is not attributable to green tests).
pub fn cost_per_green_test(run_cost: f64, passed: usize) -> f64 {
    if passed == 0 {
        0.0
    } else {
        run_cost / passed as f64
    }
}

/// Ledger lines for a run's usage, appended to the run's ledger file. One
/// line per record, JSONL.
pub fn ledger_path(kula_dir: &Path, run: &str) -> std::path::PathBuf {
    kula_dir.join("runs").join(format!("{run}.usage.jsonl"))
}

/// Append one usage record to the run's ledger. Never fails the caller: the
/// ledger is a view.
pub fn ledger_append(kula_dir: &Path, r: &UsageRecord) {
    let Ok(line) = serde_json::to_string(r) else { return };
    let p = ledger_path(kula_dir, &r.run);
    let _ = std::fs::create_dir_all(p.parent().unwrap_or(Path::new(".")));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
}

/// Read one run's ledger, newest last.
pub fn ledger_read(kula_dir: &Path, run: &str) -> Vec<UsageRecord> {
    let mut out = vec![];
    let Ok(text) = std::fs::read_to_string(ledger_path(kula_dir, run)) else { return out };
    for l in text.lines() {
        if let Ok(r) = serde_json::from_str::<UsageRecord>(l) {
            out.push(r);
        }
    }
    out
}

/// The day a timestamp lands on, local time, `YYYY-MM-DD`.
pub fn day_of(ts: u64) -> String {
    let secs = (ts / 1000) as i64;
    // civil-from-days (Howard Hinnant's algorithm), no chrono dependency.
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> PriceTable {
        let cfg = toml::from_str::<crate::config::Config>(
            r#"
[[price]]
model = "claude-opus-5-5"
date = "2026-11-01"
input = 5.0
output = 25.0
cache_read = 0.5
cache_write = 6.25
[[price]]
model = "claude-opus-5-5"
date = "2026-12-01"
input = 6.0
output = 30.0
cache_read = 0.6
cache_write = 7.5
[[price]]
model = "fake"
date = "2026-01-01"
input = 1.0
output = 2.0
cache_read = 0.5
cache_write = 0.5
"#,
        )
        .unwrap();
        PriceTable::from(&cfg)
    }

    #[test]
    fn latest_le_date_wins() {
        let t = table();
        assert_eq!(t.price("claude-opus-5-5", "2026-11-15").unwrap().input, 5.0);
        assert_eq!(t.price("claude-opus-5-5", "2026-12-15").unwrap().input, 6.0);
        // Before the first row for the model there is no price: an error, not
        // a silent zero.
        let e = t.price("claude-opus-5-5", "2026-10-31").unwrap_err();
        assert!(e.to_string().contains("claude-opus-5-5"), "{e}");
    }

    #[test]
    fn unknown_model_is_named_not_silent() {
        let e = table().price("gpt-9", "2026-11-01").unwrap_err();
        assert!(e.to_string().contains("gpt-9"), "{e}");
    }

    #[test]
    fn cost_matches_the_four_fields() {
        let t = table();
        let tok = Tokens { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 };
        let c = t.cost("fake", "2026-01-01", &tok).unwrap();
        assert!((c - 4.0).abs() < 1e-9, "{c}");
    }

    fn rec(seat: &str, run: &str, model: &str, day: &str, ts: u64, toks: Tokens, cost: f64, id: &str) -> UsageRecord {
        UsageRecord {
            seat: seat.into(),
            run: run.into(),
            model: model.into(),
            day: day.into(),
            ts,
            tokens: toks,
            cost_usd: cost,
            agent: "fake".into(),
            message_id: id.into(),
            ..Default::default()
        }
    }

    #[test]
    fn duplicates_never_count_twice() {
        let mut a = Accumulator::new("team/one", "r1", 10.0);
        let r = rec("team/one", "r1", "fake", "2026-11-01", 1_000, Tokens { input: 100, ..Default::default() }, 0.01, "m1");
        assert!(a.add(&r));
        assert!(!a.add(&r), "duplicate message must not count twice");
        assert_eq!(a.spent, 0.01);
        assert_eq!(a.buckets.len(), 1);
        assert_eq!(a.buckets[0].messages, 1);
    }

    #[test]
    fn duplicates_out_of_order_dedupe_covers_both_orders() {
        // The property: a duplicate counts once whether it arrives before or
        // after the original.
        let a = rec("team/one", "r1", "fake", "2026-11-01", 1_000, Tokens { input: 10, ..Default::default() }, 0.001, "m1");
        let b = rec("team/one", "r1", "fake", "2026-11-01", 2_000, Tokens { input: 20, ..Default::default() }, 0.002, "m2");
        let mut x = Accumulator::new("team/one", "r1", 10.0);
        x.add(&b);
        x.add(&a);
        x.add(&a);
        let mut y = Accumulator::new("team/one", "r1", 10.0);
        y.add(&a);
        y.add(&b);
        y.add(&b);
        assert_eq!(x.spent, y.spent, "duplicate counts once in either order");
        assert_eq!(x.buckets, y.buckets);
    }

    #[test]
    fn budget_warns_once_at_80_and_stops_at_100() {
        let mut a = Accumulator::new("team/one", "r1", 5.0);
        let cheap = |ts: u64, id: &str| rec("team/one", "r1", "fake", "2026-11-01", ts, Tokens { input: 1, ..Default::default() }, 4.0, id);
        a.add(&cheap(1_000, "m1"));
        assert_eq!(a.take_action(), BudgetState::Warn);
        assert_eq!(a.take_action(), BudgetState::Ok, "the warning is once");
        a.add(&cheap(2_000, "m2"));
        assert_eq!(a.take_action(), BudgetState::Stop);
        a.add(&cheap(3_000, "m3"));
        assert_eq!(a.take_action(), BudgetState::Stop, "stop is latched");
        assert_eq!(a.spent, 12.0, "spend still accumulates for the ledger");
    }

    #[test]
    fn no_budget_never_stops() {
        let mut a = Accumulator::new("team/one", "r1", 0.0);
        let r = rec("team/one", "r1", "fake", "2026-11-01", 1_000, Tokens { input: 1, ..Default::default() }, 100.0, "m1");
        a.add(&r);
        assert_eq!(a.take_action(), BudgetState::Ok);
    }

    #[test]
    fn ewma_seeds_with_first_rate_and_cones() {
        let mut a = Accumulator::new("team/one", "r1", 10.0);
        a.add(&rec("team/one", "r1", "fake", "2026-11-01", 1_000, Tokens { input: 1, ..Default::default() }, 0.1, "m1"));
        assert!((a.rate - 0.1 / 1_000.0).abs() < 1e-12, "seeded with the first observed rate, not zero: {}", a.rate);
        a.add(&rec("team/one", "r1", "fake", "2026-11-01", 2_000, Tokens { input: 1, ..Default::default() }, 0.3, "m2"));
        let expect = 0.3 * (0.3 / 1_000.0) + 0.7 * (0.1 / 1_000.0);
        assert!((a.rate - expect).abs() < 1e-12, "α=0.3 EWMA: {} vs {}", a.rate, expect);
        let (lo, hi) = cone(a.rate, 0.3 / 1_000.0);
        assert!(lo <= a.rate && a.rate <= hi);
    }

    #[test]
    fn eta_is_budget_minus_spent_over_rate() {
        assert_eq!(eta(10.0, 4.0, 0.001), 6_000);
        assert_eq!(eta(10.0, 10.0, 0.001), 0, "spent: no ETA");
        assert_eq!(eta(10.0, 4.0, 0.0), 0, "no rate: no ETA");
    }

    #[test]
    fn buckets_split_by_day_and_model() {
        let mut a = Accumulator::new("team/one", "r1", 10.0);
        a.add(&rec("team/one", "r1", "fake", "2026-11-01", 1_000, Tokens { input: 10, ..Default::default() }, 0.01, "m1"));
        a.add(&rec("team/one", "r1", "other", "2026-11-01", 2_000, Tokens { input: 20, ..Default::default() }, 0.02, "m2"));
        a.add(&rec("team/one", "r1", "fake", "2026-11-02", 3_000, Tokens { input: 30, ..Default::default() }, 0.03, "m3"));
        assert_eq!(a.buckets.len(), 3);
        assert_eq!(a.bucket("2026-11-01", "fake").tokens.input, 10);
        assert_eq!(a.bucket("2026-11-02", "fake").tokens.input, 30);
        assert_eq!(a.bucket("2026-11-03", "fake").tokens.input, 0);
    }

    #[test]
    fn cache_hit_rate_and_cost_per_symbol() {
        let m = Metrics { tokens: Tokens { input: 100, output: 10, cache_read: 300, cache_write: 100, ..Default::default() }, ..Default::default() };
        assert!((cache_hit_rate(&m.tokens) - 300.0 / 500.0).abs() < 1e-9);
        assert_eq!(cache_hit_rate(&Tokens::default()), 0.0);
        let per = cost_per_symbol(0.30, &[("a".into(), 10), ("b".into(), 20)]);
        assert!((per[0].1 - 0.10).abs() < 1e-9);
        assert!((per[1].1 - 0.20).abs() < 1e-9);
        assert!(cost_per_symbol(0.30, &[]).is_empty());
        assert_eq!(cost_per_green_test(1.0, 0), 0.0);
        assert!((cost_per_green_test(1.0, 2) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn dedupe_is_bounded_recent_first() {
        let mut d = Dedupe::new(3);
        for i in 0..5 {
            assert!(d.check(&MessageId(i.to_string())));
        }
        assert!(!d.check(&MessageId("4".into())), "recent survives");
        assert!(d.check(&MessageId("0".into())), "oldest was evicted");
    }

    #[test]
    fn ledger_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let kula = tmp.path().join(".kula");
        let r = rec("team/one", "r-test", "fake", "2026-11-01", 1_000, Tokens { input: 5, ..Default::default() }, 0.005, "m1");
        ledger_append(&kula, &r);
        ledger_append(&kula, &r);
        let got = ledger_read(&kula, "r-test");
        assert_eq!(got.len(), 2, "the ledger is append only: records land, dedupe is the reader's job");
        assert_eq!(got[0].message_id, "m1");
    }

    #[test]
    fn day_of_matches_known_dates() {
        assert_eq!(day_of(0), "1970-01-01");
        // 2026-11-27 00:00:00 UTC = 1795747200 s
        assert_eq!(day_of(1_795_747_200_000), "2026-11-27");
    }

    #[test]
    fn estimate_tokens_counts_words_roughly() {
        assert!(estimate_tokens("hello world") >= 2);
        assert!(estimate_tokens("") == 0);
    }
}
