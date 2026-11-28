//! B5: capture an agent attempt's activity into the run scoped event log.
//!
//! `capture()` is the single entry point other modules call (B6 fills the
//! usage field through it); `capture_stream()` parses a recorded CLI stream –
//! claude `stream-json`, codex `--json`, gemini `--output-format json` – into
//! events. No live agent is ever started here; tests use the fixtures under
//! `tests/fixtures/streams/`.

use crate::events::{EventKind, EventV2, UsageDelta};
use std::path::Path;

/// Record one activity event for a seat of a run: into the run's JSONL (seq
/// assigned there) and mirrored into the global log so existing UI surfaces
/// keep working. Returns the seq, or None when the log refused the write.
pub fn capture(kula_dir: &Path, run: &str, seat: &str, kind: EventKind, target: &str, msg: &str) -> Option<u64> {
    capture_event(kula_dir, run, seat, EventV2 { kind, target: target.into(), msg: msg.into(), ..Default::default() })
}

/// Record a fully formed event (usage, op and ts already set; ts falls back
/// to now). The event goes into the run's JSONL (seq assigned there) and is
/// mirrored into the global log in the legacy shape. Returns the seq, or
/// None when the log refused the write.
pub fn capture_event(kula_dir: &Path, run: &str, seat: &str, mut e: EventV2) -> Option<u64> {
    e.run = run.into();
    e.seat = seat.into();
    if e.ts == 0 {
        e.ts = crate::events::now_ms();
    }
    let seq = crate::events::with_run_log(kula_dir, run, |log| log.append(e.clone())).ok()?;
    e.seq = seq;
    // Mirror in the legacy global shape; `mirrored` stops the echo back.
    crate::events::append(
        kula_dir,
        crate::events::Event {
            ts: e.ts,
            kind: e.kind.as_str().into(),
            agent: seat.into(),
            path: e.target.clone(),
            msg: e.msg.clone(),
            run: run.into(),
            mirrored: true,
            ..Default::default()
        },
    );
    Some(seq)
}

/// A CLI's recorded stream format, pinned by fixtures under
/// `tests/fixtures/streams/` – a format change is a test failure, never a
/// runtime panic.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamFormat {
    /// claude -p --output-format stream-json --verbose
    Claude,
    /// codex exec --json
    Codex,
    /// gemini --output-format json
    Gemini,
}

impl StreamFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }
}

/// What one stream line means, before it gets a seq.
#[derive(Clone, Debug, PartialEq)]
pub struct Draft {
    pub kind: EventKind,
    pub target: String,
    pub msg: String,
    pub path: String,
    pub verdict: String,
    pub usage: Option<UsageDelta>,
}

impl Draft {
    fn new(kind: EventKind) -> Self {
        Draft { kind, target: String::new(), msg: String::new(), path: String::new(), verdict: String::new(), usage: None }
    }
}

fn str_at(v: &serde_json::Value, keys: &[&str]) -> String {
    for k in keys {
        // A key may be a dotted path into nested objects ("input.file_path").
        let mut cur = v;
        let mut found = true;
        for part in k.split('.') {
            match cur.get(part) {
                Some(n) => cur = n,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            if let Some(s) = cur.as_str() {
                return s.to_string();
            }
        }
    }
    String::new()
}

fn num_at(v: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = v.get(k).and_then(|x| x.as_u64()) {
            return Some(n);
        }
    }
    None
}

/// Parse one JSON line of a recorded stream into drafts. Unknown lines are
/// skipped (the caller counts them), never a panic. A line may produce more
/// than one event: one claude assistant message can carry several tool calls.
pub fn parse_line(fmt: StreamFormat, line: &str) -> Vec<Draft> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else { return vec![] };
    match fmt {
        StreamFormat::Claude => parse_claude(&v),
        StreamFormat::Codex => parse_codex(&v),
        StreamFormat::Gemini => parse_gemini(&v),
    }
}

/// claude stream-json: assistant messages carry `content` items (text and
/// `tool_use` with `input.file_path`), user messages carry `tool_result`,
/// the final `result` line carries the totals.
fn parse_claude(v: &serde_json::Value) -> Vec<Draft> {
    let mut out = vec![];
    match str_at(v, &["type"]).as_str() {
        "assistant" => {
            if let Some(content) = v.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                for item in content {
                    match str_at(item, &["type"]).as_str() {
                        "tool_use" => {
                            let mut d = Draft::new(EventKind::Tool);
                            d.msg = str_at(item, &["name"]);
                            d.target = str_at(item, &["input.file_path"]);
                            d.path = d.target.clone();
                            if d.target.is_empty() {
                                d.target = d.msg.clone();
                            }
                            out.push(d);
                        }
                        "text" => {
                            let mut d = Draft::new(EventKind::Turn);
                            d.msg = str_at(item, &["text"]);
                            out.push(d);
                        }
                        _ => {}
                    }
                }
            }
        }
        "user" => {
            if let Some(content) = v.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                for item in content {
                    if str_at(item, &["type"]) == "tool_result" {
                        let mut d = Draft::new(EventKind::Read);
                        d.msg = "tool_result".into();
                        out.push(d);
                    }
                }
            }
        }
        "result" => {
            let mut d = Draft::new(EventKind::Turn);
            d.msg = str_at(v, &["subtype", "result"]);
            if let Some(u) = v.get("usage") {
                d.usage = Some(UsageDelta {
                    tokens_in: num_at(u, &["input_tokens"]).unwrap_or(0) as i64,
                    tokens_out: num_at(u, &["output_tokens"]).unwrap_or(0) as i64,
                });
            }
            out.push(d);
        }
        _ => {}
    }
    out
}

/// codex --json: `{"id": .., "msg": { "type": .., ... }}` envelopes.
fn parse_codex(v: &serde_json::Value) -> Vec<Draft> {
    let mut out = vec![];
    let m = match v.get("msg") {
        Some(m) => m,
        None => return out,
    };
    match str_at(m, &["type"]).as_str() {
        "exec_command_begin" => {
            let mut d = Draft::new(EventKind::Tool);
            let cmd = m.get("command").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>()).unwrap_or_default();
            d.msg = cmd.join(" ");
            d.target = cmd.first().map(|s| s.to_string()).unwrap_or_default();
            out.push(d);
        }
        "agent_message" => {
            let mut d = Draft::new(EventKind::Turn);
            d.msg = str_at(m, &["message"]);
            out.push(d);
        }
        "task_started" | "task_complete" => {
            let mut d = Draft::new(EventKind::Turn);
            d.msg = str_at(m, &["type"]);
            out.push(d);
        }
        "token_count" => {
            let info = m.get("info").cloned().unwrap_or(serde_json::Value::Null);
            let total = info.get("total_token_usage").or_else(|| info.get("last_token_usage")).cloned().unwrap_or(serde_json::Value::Null);
            let mut d = Draft::new(EventKind::Turn);
            d.msg = "token_count".into();
            d.usage = Some(UsageDelta {
                tokens_in: num_at(&total, &["input_tokens", "cached_input_tokens"]).unwrap_or(0) as i64,
                tokens_out: num_at(&total, &["output_tokens"]).unwrap_or(0) as i64,
            });
            out.push(d);
        }
        _ => {}
    }
    out
}

/// gemini --output-format json: typed lines (`message`, `tool_call`,
/// `tool_response`, `usage`).
fn parse_gemini(v: &serde_json::Value) -> Vec<Draft> {
    let mut out = vec![];
    match str_at(v, &["type"]).as_str() {
        "message" => {
            let mut d = Draft::new(EventKind::Turn);
            d.msg = str_at(v, &["content"]);
            out.push(d);
        }
        "tool_call" => {
            let mut d = Draft::new(EventKind::Tool);
            d.msg = str_at(v, &["name"]);
            d.target = str_at(v, &["args.path", "args.file_path"]);
            d.path = d.target.clone();
            if d.target.is_empty() {
                d.target = d.msg.clone();
            }
            out.push(d);
        }
        "tool_response" => {
            let mut d = Draft::new(EventKind::Read);
            d.msg = "tool_response".into();
            d.target = str_at(v, &["name"]);
            out.push(d);
        }
        "usage" => {
            let mut d = Draft::new(EventKind::Turn);
            d.msg = "usage".into();
            d.usage = Some(UsageDelta {
                tokens_in: num_at(v, &["input_tokens", "prompt_tokens"]).unwrap_or(0) as i64,
                tokens_out: num_at(v, &["output_tokens", "candidates_tokens"]).unwrap_or(0) as i64,
            });
            out.push(d);
        }
        _ => {}
    }
    out
}

/// True when the line is a recognised stream record that intentionally
/// produces no event (codex `exec_command_end` bookkeeping). Such lines are
/// not drift, so they are not counted as skipped.
fn recognized_no_event(fmt: StreamFormat, line: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else { return false };
    match fmt {
        StreamFormat::Codex => str_at(&v, &["msg.type"]) == "exec_command_end",
        _ => false,
    }
}

/// Parse a whole recorded stream and capture it for one seat of one run.
/// Returns the captured events (with seqs) and how many lines were skipped.
/// Never launches an agent; the stream is text already on disk.
pub fn capture_stream(fmt: StreamFormat, output: &str, kula_dir: &Path, run: &str, seat: &str) -> (Vec<EventV2>, usize) {
    let mut out = vec![];
    let mut skipped = 0usize;
    for line in output.lines() {
        let drafts = parse_line(fmt, line);
        if drafts.is_empty() {
            if !recognized_no_event(fmt, line) && line.trim().starts_with('{') {
                skipped += 1; // JSON we do not recognise, not noise
            }
            continue;
        }
        for d in drafts {
            let e = EventV2 {
                run: run.into(),
                seat: seat.into(),
                seq: 0,
                ts: crate::events::now_ms(),
                kind: d.kind.clone(),
                target: d.target.clone(),
                msg: d.msg.clone(),
                path: d.path.clone(),
                verdict: d.verdict.clone(),
                usage: d.usage.clone(),
                ..Default::default()
            };
            if let Some(seq) = capture_event(kula_dir, run, seat, e.clone()) {
                out.push(EventV2 { seq, ..e });
            }
        }
    }
    (out, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_lines_are_counted_not_panics() {
        for f in [StreamFormat::Claude, StreamFormat::Codex, StreamFormat::Gemini] {
            assert!(parse_line(f, "not json at all").is_empty());
            assert!(parse_line(f, "{\"type\":\"who-knows\"}").is_empty());
        }
    }

    fn fixture(fmt: StreamFormat, cli: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/streams/{cli}/stream.jsonl"))).unwrap()
    }

    /// Parse every line of a recorded stream the way `capture_stream` does,
    /// returning the drafts and the skipped-unknown count.
    fn parse_all(fmt: StreamFormat, text: &str) -> (Vec<Draft>, usize) {
        let mut drafts = vec![];
        let mut skipped = 0;
        for l in text.lines() {
            let d = parse_line(fmt, l);
            if d.is_empty() {
                if !recognized_no_event(fmt, l) && l.trim().starts_with('{') {
                    skipped += 1;
                }
                continue;
            }
            drafts.extend(d);
        }
        (drafts, skipped)
    }

    /// The recorded claude stream parses into the exact event sequence the
    /// fixture pins: turn, read, two tools in one message, turn with usage.
    #[test]
    fn claude_stream_fixture_parses_to_pinned_events() {
        let (drafts, skipped) = parse_all(StreamFormat::Claude, &fixture(StreamFormat::Claude, "claude"));
        let kinds: Vec<&str> = drafts.iter().map(|d| d.kind.as_str()).collect();
        assert_eq!(kinds, vec!["turn", "tool", "read", "tool", "tool", "read", "read", "turn"], "{drafts:?}");
        assert_eq!(drafts[1].target, "src/guard.rs", "tool_use file_path becomes the target");
        assert_eq!(drafts[3].msg, "Edit");
        assert_eq!(drafts[4].msg, "Bash");
        assert_eq!(drafts[7].usage, Some(UsageDelta { tokens_in: 1200, tokens_out: 340 }));
        assert_eq!(skipped, 1, "only the init line is unknown");
    }

    /// The recorded codex stream: agent messages are turns, exec commands are
    /// tools, the token_count line carries the delta.
    #[test]
    fn codex_stream_fixture_parses_to_pinned_events() {
        let (drafts, skipped) = parse_all(StreamFormat::Codex, &fixture(StreamFormat::Codex, "codex"));
        let kinds: Vec<&str> = drafts.iter().map(|d| d.kind.as_str()).collect();
        assert_eq!(kinds, vec!["turn", "turn", "tool", "turn", "tool", "turn", "turn"], "{drafts:?}");
        assert_eq!(drafts[2].target, "sed");
        assert_eq!(drafts[2].msg, "sed -n 1,5p src/guard.rs");
        assert_eq!(drafts[4].target, "cargo");
        assert_eq!(drafts[5].usage, Some(UsageDelta { tokens_in: 2100, tokens_out: 480 }));
        assert_eq!(skipped, 0, "exec_command_end lines are skipped silently, not counted as drift");
    }

    /// The recorded gemini stream: messages are turns, tool_call/tool_response
    /// pairs are tool and read, the usage line carries the delta.
    #[test]
    fn gemini_stream_fixture_parses_to_pinned_events() {
        let (drafts, skipped) = parse_all(StreamFormat::Gemini, &fixture(StreamFormat::Gemini, "gemini"));
        let kinds: Vec<&str> = drafts.iter().map(|d| d.kind.as_str()).collect();
        assert_eq!(kinds, vec!["turn", "tool", "read", "turn", "tool", "read", "turn"], "{drafts:?}");
        assert_eq!(drafts[1].target, "src/guard.rs");
        assert_eq!(drafts[6].usage, Some(UsageDelta { tokens_in: 1500, tokens_out: 420 }));
        assert_eq!(skipped, 2, "init and result lines are unknown but counted");
    }

    /// The whole recorded stream captured for a seat: seqs rise per seat,
    /// the run log holds exactly the parsed events, and the mirror keeps the
    /// global log in step.
    #[test]
    fn capture_stream_appends_with_rising_seqs_and_mirrors() {
        let d = std::env::temp_dir().join(format!("kula-b5-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let f = fixture(StreamFormat::Claude, "claude");
        let (evs, skipped) = capture_stream(StreamFormat::Claude, &f, &d, "p-9", "team/a");
        assert_eq!(evs.len(), 8);
        assert_eq!(skipped, 1);
        assert_eq!(evs.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(crate::events::replay(&d, "p-9", "team/a", 0, 100).unwrap(), evs);
        let global = crate::events::read(&d, 0, 100);
        assert_eq!(global.len(), 8, "every captured event is mirrored to the global log");
        let _ = std::fs::remove_dir_all(&d);
    }
}
