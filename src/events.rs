//! The team's event log (P3.17): an append only `.kula/events.jsonl` that
//! team starts and stops, guard refusals, slice hand-offs and gate verdicts
//! write to, and that `GET /api/agents/events` streams and replays.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Lines kept before the log is cut back to its newer half.
const KEEP: usize = 4000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Event {
    /// Position in the log, set on read (1 based line number).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub seq: u64,
    /// Unix milliseconds.
    pub ts: u64,
    /// team_start | team_stop | refused | handoff | slice | verdict
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub team: String,
    /// The agent the event is about (the receiver of a hand-off).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub agent: String,
    /// The agent a hand-off comes from.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub from: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub plan: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub slice: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
    /// passed | failed | rejected | refused, or a slice state.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub verdict: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub msg: String,
    /// The run the event belongs to (`<plan>-<start>`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub run: String,
    /// What an agent attempt cost, on `attempt` events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<crate::launch::Usage>,
    /// Set when this event already came from a run scoped log (no re-mirror).
    #[serde(skip)]
    pub mirrored: bool,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn log_path(kula_dir: &Path) -> PathBuf {
    kula_dir.join("events.jsonl")
}

/// Append one event. Never fails the caller: the log is a view, not a record anything depends on.
pub fn append(kula_dir: &Path, mut e: Event) {
    if e.ts == 0 {
        e.ts = now_ms();
    }
    e.seq = 0;
    let Ok(line) = serde_json::to_string(&e) else { return };
    let _ = std::fs::create_dir_all(kula_dir);
    let p = log_path(kula_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{line}");
    }
    // B5: an event that names a run is also recorded in that run's scoped log.
    if !e.mirrored {
        mirror_to_run(kula_dir, &e);
    }
    trim(&p);
}

fn trim(p: &Path) {
    let Ok(meta) = std::fs::metadata(p) else { return };
    if meta.len() < 1_500_000 {
        return;
    }
    if let Ok(s) = std::fs::read_to_string(p) {
        let lines: Vec<&str> = s.lines().collect();
        if lines.len() > KEEP {
            let keep = lines[lines.len() - KEEP / 2..].join("\n") + "\n";
            let _ = std::fs::write(p, keep);
        }
    }
}

/// Events after `since` (a seq), oldest first, at most `limit` of the newest.
pub fn read(kula_dir: &Path, since: u64, limit: usize) -> Vec<Event> {
    let Ok(s) = std::fs::read_to_string(log_path(kula_dir)) else { return vec![] };
    let mut out: Vec<Event> = s
        .lines()
        .enumerate()
        .filter(|(i, _)| (*i as u64 + 1) > since)
        .filter_map(|(i, l)| {
            let mut e: Event = serde_json::from_str(l).ok()?;
            e.seq = i as u64 + 1;
            Some(e)
        })
        .collect();
    if out.len() > limit {
        out.drain(..out.len() - limit);
    }
    out
}

/// The repository path a guard refusal names, if any.
pub fn refused_path(msg: &str) -> String {
    let rest = msg.strip_prefix("kula guard: ").unwrap_or("");
    match rest.split_once(" is ") {
        Some((p, _)) if !p.contains(' ') => p.to_string(),
        _ => String::new(),
    }
}

/// What changed between two saves of a run: slice moves, hand-offs from the
/// slices it waited on, and gate verdicts.
pub fn plan_diff(old: Option<&crate::orch::task::Plan>, new: &crate::orch::task::Plan) -> Vec<Event> {
    use crate::orch::task::SliceState;
    let mut out = vec![];
    for s in &new.slices {
        let was = old.and_then(|o| o.slice(&s.id)).map(|o| o.state);
        if was == Some(s.state) || (was.is_none() && s.state == SliceState::Queued) {
            continue;
        }
        let st = serde_json::to_value(s.state).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        let base = Event {
            kind: "slice".into(),
            agent: s.agent.clone(),
            plan: new.id.clone(),
            run: new.run.clone(),
            team: new.team.clone(),
            slice: s.id.clone(),
            verdict: st.clone(),
            ..Default::default()
        };
        if s.state == SliceState::Running {
            for d in &s.deps {
                if let Some(dep) = new.slice(d) {
                    out.push(Event {
                        kind: "handoff".into(),
                        from: dep.agent.clone(),
                        msg: format!("{} after {}", s.id, dep.id),
                        ..base.clone()
                    });
                }
            }
        }
        if s.state.done() {
            out.push(Event { kind: "verdict".into(), msg: s.reasons.first().cloned().unwrap_or_default(), ..base });
        } else {
            out.push(base);
        }
    }
    out
}

// ----- B5: run scoped activity log -----
//
// The global log above stays: `/api/agents/events`, `runs::current` and the
// guard feed from it. Run scoped events are a second, parallel artefact –
// one JSONL per run under `.kula/runs/`, fsynced every 32 appends, compacted
// at run end into a ledger commit on `refs/kula/runs/<run>`.

use anyhow::Result;
use std::io::Seek;

/// What an activity event is about: read, edit, refuse, test, tool, handoff
/// or turn. Legacy global log kinds mirrored into a run keep their original
/// strings (`team_start`, `slice`, ...) as `Other`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum EventKind {
    #[default]
    Read,
    Edit,
    Refuse,
    Test,
    Tool,
    Handoff,
    Turn,
    Other(String),
}

impl EventKind {
    pub fn as_str(&self) -> &str {
        match self {
            EventKind::Read => "read",
            EventKind::Edit => "edit",
            EventKind::Refuse => "refuse",
            EventKind::Test => "test",
            EventKind::Tool => "tool",
            EventKind::Handoff => "handoff",
            EventKind::Turn => "turn",
            EventKind::Other(s) => s,
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "read" => EventKind::Read,
            "edit" => EventKind::Edit,
            "refuse" => EventKind::Refuse,
            "test" => EventKind::Test,
            "tool" => EventKind::Tool,
            "handoff" => EventKind::Handoff,
            "turn" => EventKind::Turn,
            other => EventKind::Other(other.into()),
        }
    }
    /// How a legacy global log kind maps into the run scoped schema.
    pub fn from_legacy(s: &str) -> Self {
        match s {
            "refused" => EventKind::Refuse,
            "handoff" => EventKind::Handoff,
            other => EventKind::from_str(other),
        }
    }
}

impl serde::Serialize for EventKind {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

impl<'de> serde::Deserialize<'de> for EventKind {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(EventKind::from_str(&String::deserialize(d)?))
    }
}

/// Token delta an event carries. Filled by B6 (tokens); always a delta, never
/// a running total, so events stay order independent.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UsageDelta {
    #[serde(default)]
    pub tokens_in: i64,
    #[serde(default)]
    pub tokens_out: i64,
}

/// One activity event: identified by `(run, seat, seq)` with the seq strictly
/// rising per seat, ts in monotonic milliseconds. `target` is a symbol id when
/// the event is about a parsed symbol, else the path it touched; `op` is B2's
/// op id when the event belongs to an op.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct EventV2 {
    pub run: String,
    pub seat: String,
    pub seq: u64,
    /// Monotonic milliseconds (unix ms; tests inject a clock).
    pub ts: u64,
    pub kind: EventKind,
    /// Symbol id when known else path.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageDelta>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub msg: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub verdict: String,
}

/// Events per fsync batch on the hot path.
const FSYNC_EVERY: u32 = 32;

/// `(run, seat, seq) -> byte offset` index over a run's JSONL. Per seat the
/// offsets are strictly rising with seq, so replay can seek to the first
/// event it needs instead of scanning the file from the front.
#[derive(Default, Clone, Debug)]
pub struct EventIndex {
    /// seat -> (seq, byte offset of the line), rising in seq.
    pub offsets: std::collections::BTreeMap<String, Vec<(u64, u64)>>,
}

impl EventIndex {
    pub fn note(&mut self, seat: &str, seq: u64, offset: u64) {
        self.offsets.entry(seat.to_string()).or_default().push((seq, offset));
    }
    /// First offset holding an event of `seat` with seq >= `from`.
    pub fn seek(&self, seat: &str, from: u64) -> Option<u64> {
        let v = self.offsets.get(seat)?;
        let i = v.partition_point(|(seq, _)| *seq < from);
        v.get(i).map(|(_, off)| *off)
    }
    /// Last seq seen for a seat.
    pub fn last_seq(&self, seat: &str) -> u64 {
        self.offsets.get(seat).and_then(|v| v.last()).map(|(s, _)| *s).unwrap_or(0)
    }
}

/// The per run activity log: `.kula/runs/<run>.jsonl`.
pub struct RunLog {
    pub run: String,
    path: PathBuf,
    file: Option<std::fs::File>,
    unsynced: u32,
    seqs: std::collections::HashMap<String, u64>,
    pub index: EventIndex,
}

impl RunLog {
    pub fn path(kula_dir: &Path, run: &str) -> PathBuf {
        kula_dir.join("runs").join(format!("{}.jsonl", run_ref_name(run)))
    }

    /// Open (or create) a run's log. The seq of every seat is derived from the
    /// file tail on disk, never from process memory, so a seat that restarts
    /// keeps counting where it stopped. A torn last line (a crash mid write)
    /// is truncated away before anything appends.
    pub fn open(kula_dir: &Path, run: &str) -> Result<RunLog> {
        let path = Self::path(kula_dir, run);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut seqs: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        let mut index = EventIndex::default();
        if let Ok(s) = std::fs::read(&path) {
            let mut off = 0u64;
            let mut good_end = 0u64;
            for line in s.split(|b| *b == b'\n') {
                let next = off + line.len() as u64 + 1;
                if line.is_empty() {
                    break;
                }
                if let Ok(e) = serde_json::from_slice::<EventV2>(line) {
                    seqs.entry(e.seat.clone()).and_modify(|m| *m = (*m).max(e.seq)).or_insert(e.seq);
                    index.note(&e.seat, e.seq, off);
                    good_end = next;
                }
                off = next;
            }
            // Drop a torn tail so the next append writes a complete line.
            if good_end < s.len() as u64 {
                let _ = std::fs::write(&path, &s[..good_end as usize]);
            }
        }
        let file = std::fs::OpenOptions::new().create(true).append(true).open(&path).ok();
        Ok(RunLog { run: run.into(), path, file, unsynced: 0, seqs, index })
    }

    /// Append one event, assigning its seq (strictly rising per seat) and
    /// timestamp when unset. Returns the seq. fsync every `FSYNC_EVERY`
    /// appends; `flush` forces it.
    pub fn append(&mut self, mut e: EventV2) -> Result<u64> {
        if e.ts == 0 {
            e.ts = now_ms();
        }
        e.run = self.run.clone();
        let seq = self.seqs.get(&e.seat).copied().unwrap_or(0) + 1;
        e.seq = seq;
        let line = serde_json::to_string(&e)?;
        let _ = std::fs::create_dir_all(self.path.parent().unwrap_or(Path::new(".")));
        let f = match self.file.take() {
            Some(f) => f,
            None => std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?,
        };
        let f = self.file.insert(f);
        let off = f.metadata().map(|m| m.len()).unwrap_or(0);
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        self.seqs.insert(e.seat.clone(), seq);
        self.index.note(&e.seat, seq, off);
        self.unsynced += 1;
        if self.unsynced >= FSYNC_EVERY {
            let _ = f.sync_data();
            self.unsynced = 0;
        }
        Ok(seq)
    }

    pub fn flush(&mut self) -> Result<()> {
        if let Some(f) = self.file.as_mut() {
            f.sync_data()?;
        }
        self.unsynced = 0;
        Ok(())
    }

    pub fn last_seq(&self, seat: &str) -> u64 {
        self.seqs.get(seat).copied().unwrap_or(0)
    }
}

/// Cache open run logs so mirroring the global log into runs stays O(1) per
/// event instead of rescanning the JSONL tail each time.
fn run_logs() -> &'static std::sync::Mutex<std::collections::HashMap<PathBuf, RunLog>> {
    static LOGS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<PathBuf, RunLog>>> = std::sync::OnceLock::new();
    LOGS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Run `f` with the cached log of one run, opening it on first use.
pub fn with_run_log<T>(kula_dir: &Path, run: &str, f: impl FnOnce(&mut RunLog) -> Result<T>) -> Result<T> {
    let path = RunLog::path(kula_dir, run);
    let mut logs = run_logs().lock().unwrap_or_else(|p| p.into_inner());
    let log = logs.entry(path).or_insert_with(|| RunLog::open(kula_dir, run).unwrap_or_else(|_| RunLog { run: run.into(), path: RunLog::path(kula_dir, run), file: None, unsynced: 0, seqs: Default::default(), index: Default::default() }));
    f(log)
}

/// A run id as a git ref leaf: runs may contain characters git ref names
/// dislike (`/` in plan ids); they never collide after this mapping.
pub fn run_ref_name(run: &str) -> String {
    run.replace(['/', ' ', ':'], "_")
}

/// Drop the cached log for a run (tests and compaction use this).
pub fn forget_run_log(kula_dir: &Path, run: &str) {
    let path = RunLog::path(kula_dir, run);
    let mut logs = run_logs().lock().unwrap_or_else(|p| p.into_inner());
    logs.remove(&path);
}

/// Mirror a global log event into its run's scoped log. Called from
/// `append()` whenever the event names a run; errors never fail the caller.
fn mirror_to_run(kula_dir: &Path, e: &Event) {
    if e.run.is_empty() {
        return;
    }
    let v2 = EventV2 {
        run: e.run.clone(),
        seat: e.agent.clone(),
        seq: 0,
        ts: e.ts,
        kind: EventKind::from_legacy(&e.kind),
        target: e.path.clone(),
        msg: e.msg.clone(),
        path: e.path.clone(),
        verdict: e.verdict.clone(),
        ..Default::default()
    };
    let _ = with_run_log(kula_dir, &e.run, |log| log.append(v2));
}

/// Replay one seat's events: `from` is the first seq wanted (0 = all).
/// Seeks through the `(run, seat, seq) -> offset` index – it never scans the
/// file from byte 0 once the index exists. Torn tail lines are skipped.
pub fn replay(kula_dir: &Path, run: &str, seat: &str, from: u64, limit: usize) -> Result<Vec<EventV2>> {
    let path = RunLog::path(kula_dir, run);
    let idx = index_for(&path)?;
    let Some(off) = idx.seek(seat, from.max(1)) else { return Ok(vec![]) };
    let f = std::fs::File::open(&path)?;
    let mut r = std::io::BufReader::new(f);
    r.seek(std::io::SeekFrom::Start(off)).ok();
    let mut out = vec![];
    for line in std::io::BufRead::lines(r) {
        let Ok(line) = line else { break };
        let Ok(e) = serde_json::from_str::<EventV2>(&line) else { continue };
        if e.seat != seat || e.seq < from.max(1) {
            continue;
        }
        out.push(e);
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

/// The index for a run's JSONL, from the sidecar when it matches the file's
/// current length, else a fresh scan persisted for the next reader.
pub fn index_for(path: &Path) -> Result<EventIndex> {
    let len = std::fs::metadata(path)?.len();
    let side = sidecar_path(path);
    if let Ok(s) = std::fs::read_to_string(&side) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            if v.get("len").and_then(|l| l.as_u64()) == Some(len) {
                let mut idx = EventIndex::default();
                if let Some(map) = v.get("offsets").and_then(|m| m.as_object()) {
                    for (seat, rows) in map {
                        if let Some(rows) = rows.as_array() {
                            for r in rows.iter().filter_map(|r| r.as_array()) {
                                if let (Some(seq), Some(off)) = (r.first().and_then(|x| x.as_u64()), r.get(1).and_then(|x| x.as_u64())) {
                                    idx.offsets.entry(seat.clone()).or_default().push((seq, off));
                                }
                            }
                        }
                    }
                }
                return Ok(idx);
            }
        }
    }
    // Fresh scan: one pass over the file, tolerant of a torn tail.
    let mut idx = EventIndex::default();
    let s = std::fs::read(path)?;
    let mut off = 0u64;
    for line in s.split(|b| *b == b'\n') {
        let next = off + line.len() as u64 + 1;
        if line.is_empty() {
            break;
        }
        if let Ok(e) = serde_json::from_slice::<EventV2>(line) {
            idx.note(&e.seat, e.seq, off);
        }
        off = next;
    }
    if serde_json::to_string(&json_index(&idx, len)).map(|j| std::fs::write(side, j)).is_ok() {
        // Sidecar written best effort; a stale one is detected by length.
    }
    Ok(idx)
}

fn sidecar_path(jsonl: &Path) -> PathBuf {
    let mut name = jsonl.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    name.push_str(".idx");
    jsonl.with_file_name(name)
}

fn json_index(idx: &EventIndex, len: u64) -> serde_json::Value {
    serde_json::json!({
        "len": len,
        "offsets": idx.offsets.iter().map(|(seat, rows)| (seat.clone(), serde_json::json!(rows))).collect::<serde_json::Map<String, serde_json::Value>>(),
    })
}

/// Compact a finished run: the JSONL becomes one blob, one tree, one commit
/// on `refs/kula/runs/<run>`, appended with a single compare and swap
/// `update-ref` (the ops pattern). Idempotent: a marker file remembers the
/// compaction, so compacting twice – or a double run end – applies once; the
/// same content also returns the existing commit. Callers may compact lazily
/// (the route does) because a no-op costs one stat.
pub fn compaction(repo: &crate::Repo, kula_dir: &Path, run: &str) -> Result<Option<String>> {
    let _ = with_run_log(kula_dir, run, |log| log.flush());
    let path = RunLog::path(kula_dir, run);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let marker = sidecar_marker(&path);
    if let Ok(m) = std::fs::read_to_string(&marker) {
        // "<len> <commit>": same bytes, same commit – nothing to do.
        if let Some((len, id)) = m.trim().split_once(' ') {
            if len == bytes.len().to_string() && !id.is_empty() {
                return Ok(Some(id.to_string()));
            }
        }
    }
    if bytes.is_empty() {
        return Ok(None);
    }
    let n = bytes.iter().filter(|b| **b == b'\n').count();
    let blob = repo.run_stdin(&["hash-object", "-w", "--stdin"], &bytes)?.trim().to_string();
    let tree = repo.run_stdin(&["mktree"], format!("100644 blob {blob}\tevents.jsonl\n").as_bytes())?.trim().to_string();
    let refname = format!("refs/kula/runs/{}", run_ref_name(run));
    let old = repo.run(&["rev-parse", "--verify", "--quiet", &format!("{refname}^{{commit}}")]).ok().map(|s| s.trim().to_string());
    if let Some(old) = &old {
        if let Ok(t) = repo.run(&["rev-parse", &format!("{old}^{{tree}}")]) {
            if t.trim() == tree {
                let _ = std::fs::write(&marker, format!("{} {old}", bytes.len()));
                return Ok(Some(old.clone()));
            }
        }
    }
    let no_ref = "0000000000000000000000000000000000000000";
    let old_ref = old.clone().unwrap_or_else(|| no_ref.to_string());
    let mut parents: Vec<&str> = old.iter().map(String::as_str).collect();
    parents.truncate(1);
    let msg = format!("kula run: {run} ledger ({n} events)");
    // Inline identity, like the op log: config flags go before the subcommand.
    let mut args: Vec<String> = vec!["-c".into(), "user.name=kula".into(), "-c".into(), "user.email=kula@localhost".into()];
    args.push("commit-tree".into());
    args.push(tree.clone());
    args.push("-m".into());
    args.push(msg);
    for p in &parents {
        args.push("-p".into());
        args.push(p.to_string());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let id = repo.run(&refs)?.trim().to_string();
    repo.run(&["update-ref", &refname, &id, &old_ref])?;
    let _ = std::fs::write(&marker, format!("{} {id}", bytes.len()));
    Ok(Some(id))
}

fn sidecar_marker(jsonl: &Path) -> PathBuf {
    let mut name = jsonl.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    name.push_str(".led");
    jsonl.with_file_name(name)
}

/// Read every complete event appended after byte `offset`; returns them plus
/// the new file length for the next tail read. The SSE tail uses this.
pub fn read_after(kula_dir: &Path, run: &str, offset: u64) -> (Vec<EventV2>, u64) {
    let path = RunLog::path(kula_dir, run);
    let Ok(bytes) = std::fs::read(&path) else { return (vec![], 0) };
    let start = offset.min(bytes.len() as u64) as usize;
    let mut out = vec![];
    let mut line_start = start;
    let mut off = start;
    for line in &bytes[start..] {
        let next = off + 1;
        if *line == b'\n' {
            if let Ok(e) = serde_json::from_slice::<EventV2>(&bytes[line_start..off]) {
                out.push(e);
            }
            line_start = next;
            off = next;
        } else {
            off += 1;
        }
    }
    (out, bytes.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orch::task::{Plan, Slice, SliceState};

    #[test]
    fn append_and_replay() {
        let d = std::env::temp_dir().join(format!("kula-events-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        append(&d, Event { kind: "team_start".into(), team: "ship".into(), ..Default::default() });
        append(&d, Event { kind: "refused".into(), agent: "codex".into(), path: "src/a.rs".into(), ..Default::default() });
        let all = read(&d, 0, 100);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].seq, 2);
        assert_eq!(read(&d, 1, 100), vec![all[1].clone()]);
        assert_eq!(read(&d, 0, 1).len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn refusal_names_its_path() {
        assert_eq!(refused_path("kula guard: src/a.rs is locked for agents – x (y)."), "src/a.rs");
        assert_eq!(refused_path("kula guard: refused – eval."), "");
    }

    #[test]
    fn plan_diff_sees_handoffs_and_verdicts() {
        let s = |id: &str, agent: &str, deps: &[&str], st| Slice {
            id: id.into(),
            agent: agent.into(),
            deps: deps.iter().map(|x| x.to_string()).collect(),
            state: st,
            ..Default::default()
        };
        let old = Plan {
            id: "p".into(),
            slices: vec![s("a", "claude", &[], SliceState::Gating), s("b", "codex", &["a"], SliceState::Queued)],
            ..Default::default()
        };
        let new = Plan {
            id: "p".into(),
            slices: vec![s("a", "claude", &[], SliceState::Passed), s("b", "codex", &["a"], SliceState::Running)],
            ..Default::default()
        };
        let ev = plan_diff(Some(&old), &new);
        assert!(ev.iter().any(|e| e.kind == "verdict" && e.slice == "a" && e.verdict == "passed"));
        assert!(ev.iter().any(|e| e.kind == "handoff" && e.from == "claude" && e.agent == "codex"));
        assert!(plan_diff(Some(&new), &new).is_empty());
    }

    // ----- B5: run scoped log, property and ledger tests -----

    use crate::git::Repo;

    /// A deterministic xorshift so the property tests never flake.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    fn b5_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("kula-b5-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Property: whatever the interleaving, each seat's seq strictly rises,
    /// and replaying a seat returns exactly what was appended for it.
    #[test]
    fn seq_monotone_and_replay_equals_live() {
        let d = b5_dir("mono");
        let seats = ["team/a", "team/b", "team/c"];
        let mut live: std::collections::HashMap<String, Vec<EventV2>> = Default::default();
        let mut rng = Rng(0x9e3779b97f4a7c15);
        for i in 0..200u64 {
            let seat = seats[rng.below(3) as usize];
            let mut ev = EventV2 {
                run: "r".into(),
                seat: seat.into(),
                ts: 1_000 + i,
                kind: EventKind::from_str(["read", "edit", "tool", "turn"][rng.below(4) as usize]),
                msg: format!("event {i}"),
                ..Default::default()
            };
            let seq = with_run_log(&d, "r", |log| log.append(ev.clone())).unwrap();
            assert_eq!(seq, live.get(seat).map(|v| v.last().unwrap().seq + 1).unwrap_or(1), "seq must strictly rise per seat");
            ev.seq = seq;
            live.entry(seat.into()).or_default().push(ev);
        }
        for seat in seats {
            let got = replay(&d, "r", seat, 0, 1000).unwrap();
            assert_eq!(got, live[seat], "replay must equal live for {seat}");
            // From a middle seq on, replay is a suffix: the index seeks.
            let skip = got.len() / 2;
            let from = got[skip].seq;
            assert_eq!(replay(&d, "r", seat, from, 1000).unwrap(), got[skip..], "replay from {from} is the suffix for {seat}");
            // Seq survives a "restart": drop the cached log, reopen from disk.
            forget_run_log(&d, "r");
            let ev = EventV2 { run: "r".into(), seat: seat.into(), ts: 9_999, kind: EventKind::Turn, ..Default::default() };
            let seq = with_run_log(&d, "r", |log| log.append(ev)).unwrap();
            assert_eq!(seq, live[seat].last().unwrap().seq + 1, "seq derived from the file tail after restart");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn torn_tail_is_truncated_not_fatal() {
        let d = b5_dir("torn");
        let ev = EventV2 { run: "r".into(), seat: "a".into(), ts: 1, kind: EventKind::Edit, msg: "one".into(), ..Default::default() };
        with_run_log(&d, "r", |log| log.append(ev.clone())).unwrap();
        forget_run_log(&d, "r");
        // Simulate a crash mid write: a partial line with no newline.
        let p = RunLog::path(&d, "r");
        let mut s = std::fs::read_to_string(&p).unwrap();
        s.push_str("{\"run\":\"r\",\"seat\":\"a\",\"seq\":2,\"ts\":2,\"kind\":\"to");
        std::fs::write(&p, s).unwrap();
        forget_run_log(&d, "r");
        let ev2 = EventV2 { run: "r".into(), seat: "a".into(), ts: 2, kind: EventKind::Edit, msg: "two".into(), ..Default::default() };
        let seq = with_run_log(&d, "r", |log| log.append(ev2.clone())).unwrap();
        assert_eq!(seq, 2, "the torn line cost no seq");
        let mut got1 = ev.clone();
        got1.seq = 1;
        let mut got2 = ev2.clone();
        got2.seq = seq;
        assert_eq!(replay(&d, "r", "a", 0, 10).unwrap(), vec![got1, got2]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn fsync_batches_do_not_lose_events_on_read() {
        let d = b5_dir("fsync");
        for i in 0..40u64 {
            let ev = EventV2 { run: "r".into(), seat: "a".into(), ts: i, kind: EventKind::Tool, msg: format!("t{i}"), ..Default::default() };
            with_run_log(&d, "r", |log| log.append(ev)).unwrap();
        }
        assert_eq!(replay(&d, "r", "a", 0, 100).unwrap().len(), 40, "every event is on disk despite batching");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn compaction_appends_one_ledger_commit_and_is_idempotent() {
        let d = b5_dir("led");
        let root = d.join("repo");
        std::fs::create_dir_all(&root).unwrap();
        let out = |args: &[&str]| {
            let o = std::process::Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
            String::from_utf8_lossy(&o.stdout).into_owned()
        };
        out(&["init", "-q", "-b", "main"]);
        out(&["config", "user.name", "t"]);
        out(&["config", "user.email", "t@e"]);
        let repo = Repo::discover(&root).unwrap();
        let kd = root.join(".kula");
        let ev = EventV2 { run: "p-1".into(), seat: "team/a".into(), ts: 1, kind: EventKind::Edit, msg: "x".into(), ..Default::default() };
        with_run_log(&kd, "p-1", |log| log.append(ev.clone())).unwrap();
        forget_run_log(&kd, "p-1");
        let c1 = compaction(&repo, &kd, "p-1").unwrap().unwrap();
        assert_eq!(compaction(&repo, &kd, "p-1").unwrap().unwrap(), c1, "compacting twice applies once");
        // The ledger commit is on refs/kula/runs and holds the whole JSONL.
        assert_eq!(out(&["rev-parse", "refs/kula/runs/p-1^{commit}"]).trim(), c1);
        let blob = out(&["rev-parse", "refs/kula/runs/p-1^{tree}:events.jsonl"]).trim().to_string();
        assert_eq!(out(&["cat-file", "-p", &blob]).lines().count(), 1);
        // A new event after the ledger re-compacts to a new commit on top.
        with_run_log(&kd, "p-1", |log| log.append(EventV2 { run: "p-1".into(), seat: "team/a".into(), ts: 2, kind: EventKind::Tool, msg: "y".into(), ..Default::default() })).unwrap();
        forget_run_log(&kd, "p-1");
        let c2 = compaction(&repo, &kd, "p-1").unwrap().unwrap();
        assert_ne!(c1, c2);
        let rev = out(&["rev-list", "--parents", "-1", &c2]);
        let words: Vec<&str> = rev.split_whitespace().collect();
        assert_eq!(words, vec![c2.as_str(), c1.as_str()], "new ledger commit's parent is the old one");
        let blob2 = out(&["rev-parse", "refs/kula/runs/p-1^{tree}:events.jsonl"]).trim().to_string();
        assert_eq!(out(&["cat-file", "-p", &blob2]).lines().count(), 2, "the re-compacted ledger holds both events");
        let _ = std::fs::remove_dir_all(&d);
    }
}
